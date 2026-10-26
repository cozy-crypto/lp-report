# LP vs Hold

Free, read-only report: did your Meteora DLMM liquidity actually beat just holding the tokens you deposited?

Paste a Solana wallet address, get the result per pool and a shareable card. The browser calls the public [Meteora DLMM API](https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview.md) directly; `api/` is a Cloudflare Worker for the waitlist, analytics, share cards and wallet verification, `crawl/` builds the daily leaderboard.

## How it is calculated

Per position: tokens withdrawn plus tokens still in the position, minus tokens deposited, plus fees earned (in USD when earned).

- Closed positions are valued at the prices when they were exited, so market moves after exit don't count as LP skill.
- Open positions are valued at today's prices.
- A token never paid out (position fully swapped into the other token) is priced at the edge of the position's range.

The math lives in `calc.js` and is checked by `node calc.test.mjs`.

## Run locally

```bash
python3 -m http.server 8787
```

Then open http://localhost:8787.

## Deploying site changes

GitHub Pages caches files for 10 minutes, so after changing CSS or JS bump the `?v=` on `style.css`, `app.js` and `top.js` in the HTML pages, or visitors get new HTML with old styles.
