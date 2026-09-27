#!/usr/bin/env python3
"""Collect Minute Cryptic puzzles into puzzles/ and rebuild puzzles/index.json.

Usage:
  scripts/collect.py                 # fetch today's puzzle (in several time zones)
  scripts/collect.py --id <uuid> ... # fetch specific past puzzles by id
  scripts/collect.py --import f.json # import puzzle JSON saved from the site/API
  scripts/collect.py --index-only    # just rebuild puzzles/index.json

Uses the public JSON API at https://www.minutecryptic.com/api/daily_puzzle.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://www.minutecryptic.com/api/daily_puzzle"
USER_AGENT = "Mozilla/5.0 (PastCryptics archiver)"
ROOT = Path(__file__).resolve().parent.parent
PUZZLE_DIR = ROOT / "puzzles"
INDEX_PATH = PUZZLE_DIR / "index.json"

# Spread across the date line so a single run picks up yesterday, today and tomorrow.
TIMEZONES = ["Pacific/Kiritimati", "Australia/Sydney", "Europe/London", "America/New_York", "Pacific/Pago_Pago"]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def clean(puzzle):
    puzzle = dict(puzzle)
    puzzle.pop("stats", None)
    for piece in (puzzle.get("puzzlePieces") or {}).values():
        piece["input"] = ""
        piece["isRevealed"] = False
    return puzzle


def save(puzzle):
    if not puzzle.get("date") or not puzzle.get("answer") or not puzzle.get("clue"):
        print(f"skipping incomplete puzzle: {puzzle.get('puzzleId')}", file=sys.stderr)
        return False
    path = PUZZLE_DIR / f"{puzzle['date']}.json"
    new = json.dumps(clean(puzzle), indent=2, ensure_ascii=False) + "\n"
    if path.exists() and path.read_text() == new:
        return False
    path.write_text(new)
    print(f"saved {path.relative_to(ROOT)} ({puzzle['answer']})")
    return True


def clue_text(puzzle):
    return " ".join(part["text"] for part in puzzle["clue"])


def build_index():
    entries = []
    for path in sorted(PUZZLE_DIR.glob("????-??-??.json")):
        p = json.loads(path.read_text())
        entries.append({
            "date": p["date"],
            "id": p.get("puzzleId"),
            "clue": clue_text(p),
            "config": p["config"],
            "setter": p.get("setterName"),
        })
    entries.sort(key=lambda e: e["date"], reverse=True)
    INDEX_PATH.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    print(f"index: {len(entries)} puzzles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", nargs="*", default=[], help="puzzle ids to fetch")
    ap.add_argument("--import", dest="imports", nargs="*", default=[], help="local JSON files to import")
    ap.add_argument("--index-only", action="store_true")
    args = ap.parse_args()
    PUZZLE_DIR.mkdir(exist_ok=True)

    failures = 0
    if not args.index_only:
        urls = [f"{API_BASE}/id/{pid}" for pid in args.id]
        if not args.id and not args.imports:
            urls = [f"{API_BASE}/today?tz={tz}" for tz in TIMEZONES]
        for url in urls:
            try:
                data = fetch_json(url)
                save(data.get("puzzle", data) if isinstance(data, dict) else data)
            except (urllib.error.URLError, ValueError, KeyError) as e:
                failures += 1
                print(f"failed {url}: {e}", file=sys.stderr)
        for f in args.imports:
            data = json.loads(Path(f).read_text())
            for puzzle in data if isinstance(data, list) else [data]:
                save(puzzle)

    build_index()
    if failures and failures == len(args.id or ([] if args.imports or args.index_only else TIMEZONES)):
        sys.exit("could not fetch any puzzle")


if __name__ == "__main__":
    main()
