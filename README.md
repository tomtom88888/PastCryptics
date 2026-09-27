# Past Cryptics

An unofficial archive for practising past [Minute Cryptic](https://www.minutecryptic.com/) clues. It uses the Minute Cryptic look: the blue background, the Sansita italic lettering, the letter tiles, the par dots, the hint sheet (indicators, fodder, definition, show letter, reveal answer) and the explainer video once you finish.

It's a static site (plain HTML, CSS and JS with no build step). Your progress is saved in your browser's `localStorage`.

## Running it

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The page loads JSON with `fetch`, so it has to be served over HTTP. Opening `index.html` directly from disk won't work.

To host it for free, enable **GitHub Pages** (Settings → Pages → deploy from branch, root folder).

## Puzzles

Each puzzle is stored as the site's own API JSON in `puzzles/YYYY-MM-DD.json`. `puzzles/index.json` is the list the archive page reads.

The Minute Cryptic API has no archive endpoint. You can only get **today's** puzzle, or a past puzzle **if you know its id**. So the archive grows over time:

- **Automatically:** `.github/workflows/collect.yml` runs every 6 hours. It saves the current puzzle and commits it. You can also run it by hand from the Actions tab and optionally give it puzzle ids.
- **By id:** `python3 scripts/collect.py --id <uuid> [<uuid> ...]`
- **From saved JSON:** `python3 scripts/collect.py --import some-puzzle.json`. This accepts a single puzzle or a list of puzzles.
- **Rebuild the index only:** `python3 scripts/collect.py --index-only`

## Credits

The clues, hints and explainer videos are by the Minute Cryptic team and their setters. The seed puzzles came from the public [is2ac2/minute_cryptic_cli](https://github.com/is2ac2/minute_cryptic_cli) history and from sample responses in [D3codes/WordPlay](https://github.com/D3codes/WordPlay).
