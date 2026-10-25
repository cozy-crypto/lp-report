// Daily crawl for the leaderboard: busiest Meteora DLMM pools → wallets with open positions there (Solana RPC)
// → each wallet's 365-day report → data/leaderboard.json, served by GitHub Pages next to the site.
// Run: node crawl/crawl.mjs   (env: POOLS, WALLETS, RPC)
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { report, mapLimited, DAYS } from '../meteora.js';

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
    if (!s) skipped++;
    return s && { w, s };
  } catch (e) { failed++; fails[e.message] = (fails[e.message] ?? 0) + 1; return null; }
  finally { if (++done % 50 === 0) console.log(`${done}/${wallets.length} ${Math.round((Date.now() - started) / 1000)}s`); }
});

const ok = results.filter(Boolean);
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
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s: ${ranked.length} ranked, ${poolStats.length} pools, ${skipped} skipped (too many pools), ${failed} failed`);
