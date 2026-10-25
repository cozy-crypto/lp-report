// Daily crawl for the leaderboard: busiest Meteora DLMM pools → wallets with open positions there (Solana RPC)
// → each wallet's 365-day report → data/leaderboard.json, served by GitHub Pages next to the site.
// Run: node crawl/crawl.mjs   (env: POOLS, WALLETS, RPC)
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { report, mapLimited, setRequestGap, DAYS } from '../meteora.js';

const POOLS = Number(process.env.POOLS ?? 40);      // busiest pools by 24h fees, TVL ≥ $100k
const WALLETS = Number(process.env.WALLETS ?? 1500);
// ponytail: time budget instead of exact sizing; wallets not reached today are simply missing from today's board
const BUDGET_MIN = Number(process.env.BUDGET_MIN ?? 150);
const MAX_POOLS = 300; // bots beyond this cost too many requests
const RPC = process.env.RPC ?? 'https://api.mainnet-beta.solana.com';
const PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'; // Meteora DLMM
const RANK_FEES = 100, RANK_DEPOSIT = 1000;         // below this a fees-kept number is mostly noise
// With fees under 0.25% of the money put in, small exit-price errors swamp the ratio (seen: 985% on $2M with $4k fees).
const RANK_FEE_YIELD = 0.0025;
const POOL_MIN_LPS = 5;
// Wallets whose owners asked to be left off the leaderboard (terms.html promises this), one per line.
const EXCLUDE = new Set(readFileSync(new URL('exclude.txt', import.meta.url), 'utf8').split(/\s+/).filter(Boolean));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = buf => {
  let n = BigInt('0x' + buf.toString('hex')), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b) break; s = '1' + s; }
  return s;
};

async function busiestPools() {
  const q = new URLSearchParams({ page: 1, page_size: POOLS, sort_by: 'fee_24h:desc', filter_by: 'tvl>=100000' });
  const d = await (await fetch(`https://dlmm.datapi.meteora.ag/pools?${q}`)).json();
  return d.data.filter(p => !p.is_blacklisted).map(p => ({ address: p.address, name: p.name }));
}

// Owners of open positions in a pool. Position account: 8-byte discriminator, lb_pair (32), owner (32).
async function owners(pool) {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
    params: [PROGRAM, { encoding: 'base64', dataSlice: { offset: 40, length: 32 }, filters: [{ memcmp: { offset: 8, bytes: pool } }] }],
  };
  const d = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (d.error) throw new Error(d.error.message);
  return d.result.map(a => base58(Buffer.from(a.account.data[0], 'base64')));
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : undefined; };
const round = (v, d = 0) => (v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

setRequestGap(60); // ~16 requests/s, half of Meteora's 30/s limit
const started = Date.now();
const pools = await busiestPools();
const seen = new Map(); // wallet → open positions across crawled pools
for (const p of pools) {
  try { for (const o of await owners(p.address)) seen.set(o, (seen.get(o) ?? 0) + 1); }
  catch (e) { console.warn('owners failed', p.name, e.message); }
}
const wallets = [...seen].filter(([w]) => !EXCLUDE.has(w)).sort((a, b) => b[1] - a[1]).slice(0, WALLETS).map(([w]) => w);
console.log(`${pools.length} pools, ${seen.size} wallets found, crawling ${wallets.length}`);

let done = 0, skipped = 0, failed = 0;
const fails = {};
const results = await mapLimited(wallets, 5, async w => {
  if (Date.now() - started > BUDGET_MIN * 60e3) return null;
  try {
    const s = await report(w, undefined, { parallel: 3, maxPools: MAX_POOLS });
    if (!s) { skipped++; return { w, status: 'skipped' }; }
    return { w, s, status: 'ok' };
  } catch (e) { failed++; fails[e.message] = (fails[e.message] ?? 0) + 1; return { w, status: 'failed', error: e.message }; }
  finally { if (++done % 50 === 0) console.log(`${done}/${wallets.length} ${Math.round((Date.now() - started) / 1000)}s`); }
});

const ok = results.filter(x => x?.s);
const ranked = ok.filter(({ s }) => s.feesKept !== undefined && s.feesUsd >= RANK_FEES && s.depositedUsd >= RANK_DEPOSIT
    && s.feesUsd >= RANK_FEE_YIELD * s.depositedUsd)
  .map(({ w, s }) => ({
    w, k: round(s.feesKept, 3), fees: round(s.feesUsd), lp: round(s.vsHodl), pnl: round(s.pnlUsd), dep: round(s.depositedUsd),
    pools: s.rows.length, pos: s.positions,
    top: [...s.rows].sort((a, b) => b.feesUsd - a.feesUsd).slice(0, 3).map(r => r.name),
  }));

// Per-pool honesty: of the LPs we saw in a pool, how many beat holding and what share of fees the typical one kept.
const byPool = new Map();
for (const { s } of ok) for (const r of s.rows) {
  if (r.feesKept === undefined || r.feesUsd < 10) continue;
  const p = byPool.get(r.address) ?? byPool.set(r.address, { address: r.address, name: r.name, kept: [], fees: 0, lp: 0 }).get(r.address);
  p.kept.push(r.feesKept); p.fees += r.feesUsd; p.lp += r.vsHodl;
}
const poolStats = [...byPool.values()].filter(p => p.kept.length >= POOL_MIN_LPS).map(p => ({
  address: p.address, name: p.name, lps: p.kept.length, k: round(median(p.kept), 3),
  beat: round(p.kept.filter(k => k >= 0).length / p.kept.length, 3), fees: round(p.fees), lp: round(p.lp),
})).sort((a, b) => b.fees - a.fees);

mkdirSync('data', { recursive: true });
writeFileSync('data/leaderboard.json', JSON.stringify({
  updatedAt: new Date().toISOString(), days: DAYS, crawled: ok.length, skipped, failed,
  wallets: ranked.sort((a, b) => b.k - a.k), pools: poolStats,
}));
if (failed) console.log('failures', fails);
await saveHistory();
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s: ${ranked.length} ranked, ${poolStats.length} pools, ${skipped} skipped (too many pools), ${failed} failed`);

// Every crawled wallet, ranked or not, with per-pool rows, goes to the history database (api/crawl.js).
// ponytail: ~3 KB per wallet per day; prune old rows or keep summaries only if D1 nears its 5 GB.
async function saveHistory() {
  if (!process.env.CRAWL_KEY) return console.log('CRAWL_KEY not set, history not saved');
  const date = new Date(started).toISOString().slice(0, 10);
  const place = new Map(ranked.map((w, i) => [w.w, i + 1])); // ranked is sorted best first by now
  const rows = results.filter(Boolean).map(({ w, s, status, error }) => s ? {
    w, status, ranked: place.has(w), rank: place.get(w), k: round(s.feesKept, 4), fees: round(s.feesUsd, 2), lp: round(s.vsHodl, 2),
    pnl: round(s.pnlUsd, 2), dep: round(s.depositedUsd, 2), pools: s.rows.length, pos: s.positions, open: s.openPositions,
    rows: s.rows.map(r => ({ a: r.address, n: r.name, k: round(r.feesKept, 4), lp: round(r.vsHodl, 2), f: round(r.feesUsd, 2), d: round(r.depositedUsd, 2), o: r.open ? 1 : 0 })),
  } : { w, status, error });
  const run = { pools: pools.length, walletsFound: seen.size, crawled: ok.length, ranked: ranked.length, skipped, failed, seconds: Math.round((Date.now() - started) / 1000) };
  let saved = 0;
  for (let i = 0; i < rows.length || i === 0; i += 150) {
    const r = await fetch(`${process.env.API ?? 'https://api.shouldaheld.com'}/crawl`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRAWL_KEY}` },
      body: JSON.stringify({ date, run: i === 0 ? run : undefined, wallets: rows.slice(i, i + 150) }),
    });
    if (!r.ok) { console.warn('history save failed', r.status, await r.text()); return; }
    saved += (await r.json()).saved;
  }
  console.log(`history: ${saved} wallets saved for ${date}`);
}
