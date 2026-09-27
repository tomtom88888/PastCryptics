#!/usr/bin/env python3
"""Fetch URLs and print a compact summary (used to explore puzzle sources from CI)."""
import re, sys, urllib.request, urllib.error

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
urls = sys.argv[1].split()
full = sys.argv[2] if len(sys.argv) > 2 else ""
pat = sys.argv[3] if len(sys.argv) > 3 else ""
for url in urls:
    print(f"\n######## {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            print("status", r.status, r.headers.get("content-type"), "len", len(body), "final", r.url)
    except urllib.error.HTTPError as e:
        print("HTTP", e.code); continue
    except Exception as e:
        print("ERR", e); continue
    if pat:
        found = sorted(set(re.findall(pat, body)))
        print("matches:", len(found))
        for f in found[:400]: print("  M", f[:300])
        continue
    if full and full in url:
        print(body[:60000]); continue
    links = sorted(set(re.findall(r'(?:href|src)="([^"#]+)"', body)))
    print("links:", len(links))
    for l in links[:150]: print("  ", l)
    apis = sorted(set(re.findall(r'["\'`](/?(?:api|_next/data|data)/[^"\'`\s]{2,120})', body)))
    print("api-ish:", apis[:50])
    if "__NEXT_DATA__" in body: print("has __NEXT_DATA__")
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text); text = re.sub(r"\s+", " ", text)
    print("text:", text[:3000])
