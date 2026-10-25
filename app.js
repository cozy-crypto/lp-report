import { num, summarize } from './calc.js';

const API = 'https://dlmm.datapi.meteora.ag';
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PARALLEL = 8; // Meteora allows 30 requests/s
const EXAMPLE = 'Abaqj8ivq6Uoinc9CQiiZ9GQNDB2RFSWqhpJKf9mN6Gu'; // an active public Meteora LP wallet

const $ = id => document.getElementById(id);
const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
const signed = v => (v >= 0 ? '+' : '') + usd(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, retries = 2) {
  const r = await fetch(url);
  if (r.status === 429 && retries) { await sleep(1000); return get(url, retries - 1); }
  if (!r.ok) throw new Error(`Meteora API ${r.status}`);
  return r.json();
}

async function mapLimited(items, n, f) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await f(items[i]); }
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
  open: !q.isClosed, minPrice: num(q.minPrice), maxPrice: num(q.maxPrice),
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

async function report(user, progress) {
  const [closed, open] = await Promise.all([
    poolList(`/portfolio?user=${user}&days_back=365`),
    poolList(`/portfolio/open?user=${user}`),
  ]);
  const names = new Map([...closed, ...open].map(p => [p.poolAddress, `${p.tokenX}-${p.tokenY}`]));
  let done = 0;
  const pools = await mapLimited([...names], PARALLEL, async ([address, name]) => {
    const p = await pool(address, name, user);
    progress(++done, names.size);
    return p;
  });
  return summarize(pools);
}

const pct = k => (k === undefined ? '—' : `${Math.round(k * 100)}%`);
const tone = v => (v >= 0 ? 'good' : 'bad');

function verdict(s) {
  if (!s.rows.length) return 'No Meteora DLMM positions found for this wallet in the last 365 days.';
  const k = s.feesKept;
  if (k === undefined) return s.vsHodl >= 0 ? 'Liquidity did a little better than holding.' : 'Holding would have done a little better.';
  if (k >= 1) return 'Liquidity beat holding by more than the fees you earned.';
  if (k >= 0.5) return 'You kept most of the fees you earned.';
  if (k >= 0) return 'Price moves ate most of the fees you earned.';
  return 'Price moves cost you more than your fees. Shoulda held.';
}

function render(s, user) {
  const set = (id, v, cls = '') => { $(id).textContent = v; $(id).className = cls; };
  $('verdict').textContent = verdict(s);
  $('full').hidden = !s.rows.length;
  $('hero').textContent = pct(s.feesKept);
  $('hero').className = 'hero ' + tone(s.feesKept ?? s.vsHodl);
  set('pnl', signed(s.pnlUsd));
  set('market', signed(s.marketUsd));
  set('lp', signed(s.vsHodl), tone(s.vsHodl));
  set('fees', signed(s.feesUsd));
  set('cost', signed(s.priceCostUsd));
  $('scope').textContent = `${s.rows.length} pools · ${usd(s.depositedUsd)} deposited in total`;
  $('unpriced').hidden = !s.unpriced;
  $('unpriced').textContent = `${s.unpriced} open pool(s) hold tokens with no current price; those tokens count as $0.`;

  const tr = r => `<tr><td>${r.name}${r.open ? ' <span class="tag">open</span>' : ''}</td>` +
    `<td class="${tone(r.feesKept ?? r.vsHodl)}">${pct(r.feesKept)}</td><td class="${tone(r.vsHodl)}">${signed(r.vsHodl)}</td><td>${usd(r.feesUsd)}</td></tr>`;
  const top = s.rows.length > 10 ? [...s.rows.slice(0, 5), ...s.rows.slice(-5)] : s.rows;
  $('rows').innerHTML = top.map(tr).join('');
  $('rows-note').textContent = s.rows.length > 10 ? `Best 5 and worst 5 of ${s.rows.length} pools.` : '';

  const link = `${location.origin}${location.pathname}?wallet=${user}`;
  const text = s.feesKept === undefined
    ? `Liquidity earned me ${signed(s.vsHodl)} after price moves. Get your receipt from @shouldaheld`
    : `I kept ${pct(s.feesKept)} of my LP fees after price moves: ${signed(s.vsHodl)} from liquidity, the rest of my PnL was the market. ${s.feesKept >= 0.5 ? 'Not bad.' : s.feesKept >= 0 ? 'Could be worse.' : 'Shoulda held.'} Get your receipt from @shouldaheld`;
  $('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
  drawCard(s);
  $('intro').hidden = true;
  $('result').hidden = false;
}

// Share card for X, 1200×630.
function drawCard(s) {
  const c = $('card'), g = c.getContext('2d');
  const measured = s.feesKept !== undefined;
  const good = (s.feesKept ?? s.vsHodl) >= 0;
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#8b949e'; g.font = '500 34px system-ui, sans-serif';
  g.fillText(measured ? 'LP fees I kept after price moves' : 'What liquidity earned me', 80, 140);
  g.fillStyle = good ? '#3fb950' : '#f85149'; g.font = '700 150px system-ui, sans-serif';
  g.fillText(measured ? pct(s.feesKept) : signed(s.vsHodl), 80, 320);
  g.fillStyle = '#e6edf3'; g.font = '400 34px system-ui, sans-serif';
  g.fillText(`From liquidity ${signed(s.vsHodl)} · fees ${usd(s.feesUsd)} · market ${signed(s.marketUsd)}`, 80, 410);
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Shoulda held? Get your receipt · @shouldaheld', 80, 550);
}

async function run(user) {
  $('error').textContent = '';
  if (!WALLET.test(user)) { $('error').textContent = 'That does not look like a Solana wallet address.'; return; }
  history.replaceState(null, '', `?wallet=${user}`);
  $('go').disabled = true; $('go').textContent = 'Checking…'; $('result').hidden = true;
  try {
    render(await report(user, (done, total) => { $('go').textContent = `Pools ${done}/${total}`; }), user);
  } catch (e) {
    $('error').textContent = `Could not load data: ${e.message}. Try again in a minute.`;
  } finally {
    $('go').disabled = false; $('go').textContent = 'Check';
  }
}

$('form').addEventListener('submit', e => { e.preventDefault(); run($('wallet').value.trim()); });
$('example').addEventListener('click', e => {
  e.preventDefault();
  $('wallet').value = EXAMPLE;
  run(EXAMPLE);
});
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = $('card').toDataURL('image/png'); a.download = 'lp-vs-hold.png'; a.click();
});
const fromUrl = new URLSearchParams(location.search).get('wallet');
if (fromUrl) { $('wallet').value = fromUrl; run(fromUrl); }
