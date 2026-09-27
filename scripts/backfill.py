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
import html
import json
import os
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
WAYBACK_BUDGET = float(os.environ.get("WAYBACK_MINUTES", "40")) * 60


def wayback():
    start, added, tried = time.time(), 0, 0
    for host in ("www.minutecryptic.com", "minutecryptic.com"):
        url = ("https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode({
            "url": f"{host}/api/daily_puzzle/", "matchType": "prefix", "output": "json",
            "fl": "timestamp,original", "filter": "statuscode:200", "collapse": "timestamp:8",
        }))
        rows = get(url, timeout=180, tries=5) or []
        rows = [r for r in rows[1:] if "/par/" not in r[1]]
        print(f"wayback {host}: {len(rows)} daily captures", flush=True)
        for ts, original in rows:
            if time.time() - start > WAYBACK_BUDGET:
                print("wayback: time budget used up", flush=True)
                break
            day = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
            # a capture usually holds that day's puzzle (or a neighbour's across time zones)
            if all(existing_source(d) == "official" for d in (day,)):
                continue
            tried += 1
            snap = get(f"https://web.archive.org/web/{ts}id_/{original}", timeout=45, tries=2)
            if not isinstance(snap, dict):
                continue
            snap = snap.get("puzzle", snap)
            pid = snap.get("puzzleId")
            fresh = (get(f"{API_BASE}/id/{pid}", timeout=30, tries=2) if pid else None) or snap
            fresh = fresh.get("puzzle", fresh)
            if not (fresh.get("date") and fresh.get("answer") and fresh.get("clue")):
                continue
            if existing_source(fresh["date"]) == "official":
                continue
            write(clean(fresh))
            added += 1
            print(f"  official {fresh['date']} {fresh['answer']}", flush=True)
    print(f"wayback: tried {tried} captures, added {added}", flush=True)


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
            print(f"  today {p['puzzle_date']} {p['answer']} ({difficulty})", flush=True)
            time.sleep(0.5)
        print(f"minutecryptic.today {difficulty}: done ({len(seen)} seen so far)")
    print(f"minutecryptic.today: added {added}")


# ---------------------------------------------------------------- tryhardguides.com
TRYHARD = "https://tryhardguides.com"


def _text(fragment):
    fragment = re.sub(r"<script.*?</script>|<style.*?</style>", " ", fragment, flags=re.S)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", html.unescape(fragment)).strip()


def _tryhard_posts():
    """Yield (title_html, content_html, local_datetime) for every Minute Cryptic post."""
    tags = get(f"{TRYHARD}/wp-json/wp/v2/tags?slug=minute-cryptic", timeout=30)
    if tags:
        tag_id = tags[0]["id"]
        page = 1
        while True:
            posts = get(f"{TRYHARD}/wp-json/wp/v2/posts?tags={tag_id}&per_page=100&page={page}"
                        "&_fields=date,title,content,link", timeout=60)
            if not posts:
                break
            for post in posts:
                yield post["title"]["rendered"], post["content"]["rendered"], post["date"]
            page += 1
        return
    # REST API unavailable: fall back to crawling the tag pages
    print("tryhard: REST API unavailable, crawling pages", flush=True)
    page = 1
    while True:
        listing = get(f"{TRYHARD}/tag/minute-cryptic/page/{page}/", as_json=False, timeout=60)
        if not listing:
            break
        for url in dict.fromkeys(re.findall(r'https://tryhardguides\.com/[a-z0-9-]+-minute-cryptic-answer/', listing)):
            body = get(url, as_json=False, timeout=60)
            if not body:
                continue
            title = re.search(r"<title>(.*?)</title>", body, re.S)
            when = re.search(r'"datePublished":"([^"]+)"', body)
            if title and when:
                yield title.group(1), body, when.group(1)
            time.sleep(0.5)
        page += 1


def _hint_type(text):
    low = text.lower()
    found = [(low.find(k), t) for k, t in (("definition", "definition"), ("indicator", "indicators"), ("fodder", "fodder")) if k in low]
    return min(found)[1] if found else None


def convert_tryhard(title_html, content_html, when):
    clue = _text(title_html)
    clue = re.sub(r"\s*[\u2013\u2014-]\s*Minute Cryptic Answer.*$", "", clue).strip()
    text = _text(content_html)
    m = re.search(r"The Answer is\W*([A-Z][A-Z' -]*[A-Z])\b", text)
    if not clue or not m:
        return None
    answer = re.sub(r"\s+", " ", m.group(1)).strip()
    # puzzles go live overnight; evening posts are for the next day's clue
    stamp = when.replace("Z", "")[:19]
    day = time.strptime(stamp[:10], "%Y-%m-%d")
    hour = int(stamp[11:13]) if len(stamp) > 12 else 12
    epoch = time.mktime(day) + (86400 if hour >= 15 else 0) + 7200
    date = time.strftime("%Y-%m-%d", time.localtime(epoch))
    hints, seen_types = [], set()
    seg = content_html
    a = seg.find("Helpful Hints")
    b = seg.find("We hope that helps")
    if a != -1:
        seg = seg[a:b if b > a else None]
        for para in re.findall(r"<(?:p|li)[^>]*>(.*?)</(?:p|li)>", seg, re.S):
            para = _text(para)
            typ = _hint_type(para)
            if not para or not typ or typ in seen_types:
                continue
            seen_types.add(typ)
            colour = {"indicators": "pink", "fodder": "yellow", "definition": "blue"}[typ]
            hints.append({"text": para, "type": typ, "colour": colour, "highlighting": highlight_ranges(clue, para)})
    order = {"indicators": 0, "fodder": 1, "definition": 2}
    hints.sort(key=lambda h: order[h["type"]])
    words = answer.split(" ")
    letters = "".join(words)
    return {
        "puzzleId": None,
        "date": date,
        "clue": [{"text": w, "type": None} for w in clue.split(" ")],
        "answer": answer,
        "config": [len(w) for w in words],
        "letterRevealOrder": reveal_order(len(letters)),
        "hint": None,
        "hints": hints,
        "par": None,
        "parDetails": None,
        "setterName": None,
        "explainerVideo": None,
        "thumbnail": None,
        "source": "tryhardguides.com",
    }


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def tryhard():
    known = set()
    for path in PUZZLE_DIR.glob("????-??-??.json"):
        p = json.loads(path.read_text())
        known.add(_norm(" ".join(c["text"] for c in p["clue"])))
    added = total = 0
    for title_html, content_html, when in _tryhard_posts():
        total += 1
        p = convert_tryhard(title_html, content_html, when)
        if not p or _norm(" ".join(c["text"] for c in p["clue"])) in known:
            continue
        if existing_source(p["date"]) is not None:
            print(f"  skip {p['date']} (date taken): {p['answer']}", flush=True)
            continue
        write(p)
        known.add(_norm(" ".join(c["text"] for c in p["clue"])))
        added += 1
        print(f"  tryhard {p['date']} {p['answer']}", flush=True)
    print(f"tryhardguides: {total} posts, added {added}", flush=True)


def main():
    PUZZLE_DIR.mkdir(exist_ok=True)
    which = sys.argv[1:] or ["today", "tryhard"]
    if "today" in which:
        minutecryptic_today()
        build_index()
    if "tryhard" in which:
        tryhard()
        build_index()
    if "wayback" in which:
        wayback()
    build_index()


if __name__ == "__main__":
    main()
