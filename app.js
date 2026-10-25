import { num, summarize } from './calc.js';

const API = 'https://dlmm.datapi.meteora.ag';
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAYS = 365;
const PARALLEL = 8; // Meteora allows 30 requests/s
const EXAMPLE = 'Abaqj8ivq6Uoinc9CQiiZ9GQNDB2RFSWqhpJKf9mN6Gu'; // an active public Meteora LP wallet
const BACKEND = location.hostname === 'localhost' ? 'http://127.0.0.1:8788' : 'https://api.shouldaheld.com';
const params = new URLSearchParams(location.search);
const REF = /^[A-Za-z0-9]{10}$/.test(params.get('r') ?? '') ? params.get('r') : null; // came from a shared card
let lastResult = {}; // wallet and result sent along with a waitlist signup or a shared card

// Funnel events for our own analytics. Sent as text/plain to skip the CORS preflight; failures are ignored.
const track = (type, data = {}) => fetch(`${BACKEND}/event`, {
  method: 'POST', keepalive: true, body: JSON.stringify({ type, ref: REF, ...data }),
}).catch(() => {});

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

async function report(user, progress) {
  const [closed, open] = await Promise.all([
    poolList(`/portfolio?user=${user}&days_back=${DAYS}`),
    poolList(`/portfolio/open?user=${user}`),
  ]);
  const names = new Map([...closed, ...open].map(p => [p.poolAddress, `${p.tokenX}-${p.tokenY}`]));
  let done = 0;
  const pools = await mapLimited([...names], PARALLEL, async ([address, name]) => {
    const p = await pool(address, name, user);
    progress(++done, names.size);
    return p;
  });
  return summarize(pools, Date.now() / 1000 - DAYS * 86400);
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
  set('hero', pct(s.feesKept), 'big ' + tone(s.feesKept ?? s.vsHodl));
  set('pnl', signed(s.pnlUsd), tone(s.pnlUsd));
  set('market', signed(s.marketUsd));
  set('lp', signed(s.vsHodl), tone(s.vsHodl));
  set('fees', signed(s.feesUsd));
  set('cost', signed(s.priceCostUsd));
  const since = new Date(Date.now() - DAYS * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  $('scope').innerHTML = `${plural(s.positions, 'position')} in ${plural(s.rows.length, 'pool')}` +
    `${s.openPositions ? ` (${s.openPositions} open)` : ''}<br>closed since ${since} · ${usd(s.depositedUsd)} deposited`;
  $('unpriced').hidden = !s.unpriced;
  $('unpriced').textContent = `${s.unpriced} open pool(s) hold tokens with no current price; those tokens count as $0.`;

  const tr = r => `<tr><td>${r.name}${r.open ? ' <span class="tag">open</span>' : ''}</td>` +
    `<td class="${tone(r.feesKept ?? r.vsHodl)}">${pct(r.feesKept)}</td><td class="${tone(r.vsHodl)}">${signed(r.vsHodl)}</td><td>${usd(r.feesUsd)}</td></tr>`;
  const top = s.rows.length > 10 ? [...s.rows.slice(0, 5), ...s.rows.slice(-5)] : s.rows;
  $('rows').innerHTML = top.map(tr).join('');
  $('rows-note').textContent = s.rows.length > 10 ? `Best 5 and worst 5 of ${s.rows.length} pools.` : '';

  lastResult = { wallet: user, feesKept: s.feesKept, feesUsd: s.feesUsd, lpUsd: s.vsHodl, depositedUsd: s.depositedUsd };
  shareText = s.feesKept === undefined
    ? `Liquidity earned me ${signed(s.vsHodl)} after price moves. Get your receipt from @shouldaheld`
    : `I kept ${pct(s.feesKept)} of my LP fees after price moves: ${signed(s.vsHodl)} from liquidity, the rest of my PnL was the market. ${s.feesKept >= 0.5 ? 'Not bad.' : s.feesKept >= 0 ? 'Could be worse.' : 'Shoulda held.'} Get your receipt from @shouldaheld`;
  $('share-x').href = intent(`${location.origin}${location.pathname}?wallet=${user}`); // fallback if the card upload fails
  drawCard(s);
  renderWaitlist(s);
  $('shared').hidden = !(REF && user === params.get('wallet'));
  $('intro').hidden = true;
  $('top').classList.add('compact');
  $('result').hidden = false;
}

let shareText = '';
const intent = url => `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;

// Upload the drawn card and post its short link, so X shows the receipt under the post.
// The tab opens right away on click (browsers block pop-ups opened after an await).
async function shareOnX(e) {
  e.preventDefault();
  const tab = window.open('', '_blank');
  let url = $('share-x').href;
  try {
    const png = await new Promise(r => $('card').toBlob(r, 'image/png'));
    const q = new URLSearchParams({ wallet: lastResult.wallet, lp: lastResult.lpUsd });
    if (lastResult.feesKept !== undefined) q.set('k', lastResult.feesKept);
    const r = await fetch(`${BACKEND}/card?${q}`, { method: 'POST', body: png });
    if (r.ok) url = intent((await r.json()).url);
  } catch { /* keep the plain link */ }
  if (tab) tab.location = url; else location.href = url;
}

// Strong LPs are pitched the leader side, everyone else the copying side.
function renderWaitlist(s) {
  const lead = s.feesKept >= 0.5;
  $('wl-title').textContent = lead ? 'You kept most of your fees. Want to get paid for it?' : 'Want to copy LPs who keep their fees?';
  $('wl-text').textContent = lead
    ? "We're building copy-LP: others follow your positions automatically, and you earn a share of the fees they make."
    : "We're building copy-LP: follow the positions of liquidity providers with the best results, automatically, in your own wallet.";
  document.querySelector(`#waitlist input[value="${lead ? 'lead' : 'copy'}"]`).checked = true;
  $('wl-msg').textContent = ''; $('wl-msg').className = '';
}

async function joinWaitlist(e) {
  e.preventDefault();
  const msg = (text, cls) => { $('wl-msg').textContent = text; $('wl-msg').className = cls; };
  const email = $('wl-email').value.trim(), x = $('wl-x').value.trim();
  if (!email && !x) return msg('Add an email or an X handle.', 'err');
  $('wl-go').disabled = true;
  try {
    const r = await fetch(`${BACKEND}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, x, role: new FormData($('waitlist')).get('role'), website: $('wl-website').value, ...lastResult }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    msg("You're on the list. We'll reach out when copying opens.", 'ok');
  } catch (err) {
    msg(`${err.message}. Try again.`, 'err');
  } finally {
    $('wl-go').disabled = false;
  }
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
    const started = Date.now();
    let found = 0;
    const s = await report(user, (done, total) => { found = total; $('go').textContent = `Reading pool ${done} of ${total}…`; });
    render(s, user);
    track('check', {
      wallet: user, feesKept: s.feesKept, feesUsd: s.feesUsd, pools: s.rows.length,
      meta: {
        positions: s.positions, open: s.openPositions, poolsFound: found, depositedUsd: Math.round(s.depositedUsd),
        pnlUsd: Math.round(s.pnlUsd), lpUsd: Math.round(s.vsHodl), unpriced: s.unpriced,
        lpDays: s.firstAt && Math.round(Date.now() / 864e5 - s.firstAt / 86400), ms: Date.now() - started,
        own: user !== EXAMPLE && !(REF && user === params.get('wallet')), // typed their own wallet, not the example or a shared link
      },
    });
  } catch (e) {
    $('error').textContent = `Could not load data: ${e.message}. Try again in a minute.`;
    track('check', { wallet: user, meta: { error: e.message } });
  } finally {
    $('go').disabled = false; $('go').textContent = 'Get my receipt';
  }
}

$('form').addEventListener('submit', e => { e.preventDefault(); run($('wallet').value.trim()); });
$('waitlist').addEventListener('submit', joinWaitlist);
$('example').addEventListener('click', e => {
  e.preventDefault();
  $('wallet').value = EXAMPLE;
  run(EXAMPLE);
});
$('share-x').addEventListener('click', shareOnX);
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = $('card').toDataURL('image/png'); a.download = 'shoulda-held-receipt.png'; a.click();
});
$('check-own').addEventListener('click', () => {
  $('wallet').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('wallet').focus();
});

// Where the visit came from and on what, for the admin. No IPs, no cookies.
track('visit', {
  meta: {
    from: params.get('utm_source') || (document.referrer && new URL(document.referrer).hostname) || 'direct',
    mobile: matchMedia('(max-width: 640px)').matches, lang: navigator.language,
  },
});
const fromUrl = params.get('wallet');
if (fromUrl) { $('wallet').value = fromUrl; run(fromUrl); }
