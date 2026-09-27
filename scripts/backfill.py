#!/usr/bin/env python3
"""Backfill past Minute Cryptic puzzles into puzzles/.

Sources, best first:
  1. Wayback Machine snapshots of the official /api/daily_puzzle endpoints. Each
     snapshot carries an official puzzleId, which we re-fetch from the official
     API (/api/daily_puzzle/id/<id>) for the complete record.
  2. minutecryptic.today's /api/unlimited endpoint, which serves real past clues
     with the official indicator / fodder / definition hint texts. Enumerated
     with its `exclude` parameter and converted to the official format.

Existing files are never overwritten by a lower-quality source.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import API_BASE, PUZZLE_DIR, build_index, clean  # noqa: E402

UA = "Mozilla/5.0 (PastCryptics archiver)"


def get(url, timeout=60, tries=4, as_json=True):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
                return json.loads(body) if as_json else body
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                return None
            err = e
        except Exception as e:  # timeouts, resets, bad JSON from flaky mirrors
            err = e
        time.sleep(3 * (attempt + 1))
    print(f"  giving up on {url}: {err}", file=sys.stderr)
    return None


def existing_source(date):
    path = PUZZLE_DIR / f"{date}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text()).get("source", "official")


def write(puzzle):
    path = PUZZLE_DIR / f"{puzzle['date']}.json"
    path.write_text(json.dumps(puzzle, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- Wayback
def wayback():
    ids, snapshots = set(), {}
    for host in ("www.minutecryptic.com", "minutecryptic.com"):
        url = ("https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode({
            "url": f"{host}/api/daily_puzzle/", "matchType": "prefix", "output": "json",
            "fl": "timestamp,original,statuscode", "filter": "statuscode:200", "collapse": "digest",
        }))
        rows = get(url, timeout=180, tries=5) or []
        print(f"wayback {host}: {max(len(rows) - 1, 0)} captures")
        for ts, original, _ in rows[1:]:
            snap = get(f"https://web.archive.org/web/{ts}id_/{original}", timeout=90, tries=3)
            if isinstance(snap, dict):
                snap = snap.get("puzzle", snap)
                if snap.get("puzzleId") and snap.get("date"):
                    ids.add(snap["puzzleId"])
                    snapshots[snap["puzzleId"]] = snap
            time.sleep(1)
    added = 0
    for pid in sorted(ids):
        fresh = get(f"{API_BASE}/id/{pid}", timeout=30) or snapshots[pid]
        fresh = fresh.get("puzzle", fresh)
        if not (fresh.get("date") and fresh.get("answer") and fresh.get("clue")):
            continue
        if existing_source(fresh["date"]) == "official":
            continue
        write(clean(fresh))
        added += 1
        print(f"  official {fresh['date']} {fresh['answer']}")
    print(f"wayback: added {added}")


# ---------------------------------------------------------------- minutecryptic.today
QUOTED = re.compile(r"""(?:(?<=\s)|(?<=^)|(?<=\())(?:'(.+?)'|‘(.+?)’|"(.+?)"|“(.+?)”)(?=[\s,.;:!?)]|$)""")


def highlight_ranges(clue, hint_text):
    ranges, low = [], clue.lower()
    for groups in QUOTED.findall(hint_text or ""):
        frag = next(g for g in groups if g).strip()
        if len(frag) < 1:
            continue
        i = low.find(frag.lower())
        while i != -1 and any(a <= i < b for a, b in ranges):
            i = low.find(frag.lower(), i + 1)
        if i != -1:
            ranges.append([i, i + len(frag)])
    return sorted(ranges)


def reveal_order(n):
    evens = list(range(0, n, 2))
    odds = list(range(1, n, 2))
    return evens + odds


def convert_today(p):
    clue = re.sub(r"\s+", " ", p["clue"]).strip()
    nums = [int(x) for x in re.findall(r"\d+", p.get("clue_length") or "")]
    letters = re.sub(r"[^A-Za-z]", "", p["answer"]).upper()
    if not nums or sum(nums) != len(letters):
        nums = [len(letters)]
    hints = []
    for key, typ, colour in (("indicator_hint", "indicators", "pink"),
                             ("fodder_hint", "fodder", "yellow"),
                             ("definition_hint", "definition", "blue")):
        text = p.get(key)
        if text:
            hints.append({"text": text, "type": typ, "colour": colour,
                          "highlighting": highlight_ranges(clue, text)})
    answer_words, k = [], 0
    for n in nums:
        answer_words.append(letters[k:k + n]); k += n
    return {
        "puzzleId": None,
        "puzzleNumber": p.get("puzzle_no"),
        "date": p["puzzle_date"],
        "clue": [{"text": w, "type": None} for w in clue.split(" ")],
        "answer": " ".join(answer_words),
        "config": nums,
        "letterRevealOrder": reveal_order(len(letters)),
        "hint": None,
        "hints": hints,
        "par": None,
        "parDetails": {"averagePar": p.get("average_par"), "solveCount": None},
        "setterName": p.get("author"),
        "explainerVideo": None,
        "thumbnail": None,
        "source": "minutecryptic.today",
    }


def minutecryptic_today():
    seen, added = [], 0
    for difficulty in ("easy", "medium", "hard", "expert"):
        stalls = 0
        while stalls < 3:
            params = {"difficulty": difficulty}
            if seen:
                params["exclude"] = ",".join(str(x) for x in seen)
            data = get("https://minutecryptic.today/api/unlimited?" + urllib.parse.urlencode(params), timeout=30)
            p = (data or {}).get("puzzle")
            if not p or p.get("puzzle_no") in seen:
                stalls += 1
                continue
            seen.append(p["puzzle_no"])
            if not (p.get("puzzle_date") and p.get("answer") and p.get("clue")):
                continue
            if existing_source(p["puzzle_date"]) is not None:
                continue
            write(convert_today(p))
            added += 1
            print(f"  today {p['puzzle_date']} {p['answer']} ({difficulty})")
            time.sleep(0.5)
        print(f"minutecryptic.today {difficulty}: done ({len(seen)} seen so far)")
    print(f"minutecryptic.today: added {added}")


def main():
    PUZZLE_DIR.mkdir(exist_ok=True)
    which = sys.argv[1:] or ["wayback", "today"]
    if "wayback" in which:
        wayback()
    if "today" in which:
        minutecryptic_today()
    build_index()


if __name__ == "__main__":
    main()
