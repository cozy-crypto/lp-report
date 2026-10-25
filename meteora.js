// Loads a wallet's Meteora DLMM history and summarizes it. Shared by the site (app.js) and the daily crawler.
import { num, summarize } from './calc.js';

const API = 'https://dlmm.datapi.meteora.ag';
export const DAYS = 365;
const PARALLEL = 8; // Meteora allows 30 requests/s

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Requests are spaced at least `gap` ms apart across the whole process. The site doesn't need it (one wallet
// at a time); the crawler sets it so thousands of wallets stay under Meteora's rate limit.
let gap = 0, nextSlot = 0;
export const setRequestGap = ms => { gap = ms; };

async function get(url, retries = 5, wait = 1000) {
  if (gap) { const at = Math.max(Date.now(), nextSlot); nextSlot = at + gap; await sleep(at - Date.now()); }
  const r = await fetch(url);
  if ((r.status === 429 || r.status >= 500) && retries) { await sleep(wait); return get(url, retries - 1, Math.min(wait * 2, 16000)); }
  if (!r.ok) throw new Error(`Meteora API ${r.status}`);
  return r.json();
}

export async function mapLimited(items, n, f) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await f(items[i], i); }
  }));
  return out;
}

async function poolList(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await get(`${API}${path}&page=${page}&page_size=50`);
    out.push(...d.pools);
    if (!d.hasNext) return out;
  }
}

const toPosition = q => ({
  open: !q.isClosed, createdAt: q.createdAt, closedAt: q.closedAt, minPrice: num(q.minPrice), maxPrice: num(q.maxPrice),
  deposited: { x: num(q.allTimeDeposits.tokenX.amount), y: num(q.allTimeDeposits.tokenY.amount) },
  withdrawn: { x: num(q.allTimeWithdrawals.tokenX.amount), y: num(q.allTimeWithdrawals.tokenY.amount) },
  withdrawnUsd: { x: num(q.allTimeWithdrawals.tokenX.usd), y: num(q.allTimeWithdrawals.tokenY.usd) },
  balance: { x: num(q.unrealizedPnl?.balanceTokenX.amount), y: num(q.unrealizedPnl?.balanceTokenY.amount) },
  depositedUsd: num(q.allTimeDeposits.total.usd),
  feesUsd: num(q.allTimeFees.total.usd) + num(q.unrealizedPnl?.unclaimedFeeTokenX.usd) + num(q.unrealizedPnl?.unclaimedFeeTokenY.usd),
  pnlUsd: num(q.pnlUsd),
});

async function pool(address, name, user) {
  const positions = [];
  let d;
  for (let page = 1; ; page++) {
    d = await get(`${API}/positions/${address}/pnl?user=${user}&status=all&page=${page}&page_size=100`);
    positions.push(...d.positions.map(toPosition));
    if (!d.hasNext) break;
  }
  const price = v => num(v) || undefined; // "0" means no price
  return { address, name, today: { x: price(d.tokenXPrice), y: price(d.tokenYPrice) }, positions };
}

// progress(done, total) after each pool. maxPools: give up on wallets with more pools than that (crawler budget);
// returns null then.
export async function report(user, progress = () => {}, { parallel = PARALLEL, maxPools = Infinity } = {}) {
  const [closed, open] = await Promise.all([
    poolList(`/portfolio?user=${user}&days_back=${DAYS}`),
    poolList(`/portfolio/open?user=${user}`),
  ]);
  const names = new Map([...closed, ...open].map(p => [p.poolAddress, `${p.tokenX}-${p.tokenY}`]));
  if (names.size > maxPools) return null;
  let done = 0;
  const pools = await mapLimited([...names], parallel, async ([address, name]) => {
    const p = await pool(address, name, user);
    progress(++done, names.size);
    return p;
  });
  return summarize(pools, Date.now() / 1000 - DAYS * 86400);
}
