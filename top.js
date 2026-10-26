import { usd, signed, pct, kept, tone } from './format.js';
import { trackVisit, action, BACKEND } from './analytics.js';

const $ = id => document.getElementById(id);
const SHOW = 50;
const short = w => `${w.slice(0, 4)}…${w.slice(-4)}`;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

let data, tab = 'fame', min = 0, verified = new Set(); // wallets whose owner proved them by signing

function render() {
  const wallets = data.wallets.filter(w => w.dep >= min);
  const ks = wallets.map(w => w.k).sort((a, b) => a - b);
  const stats = [
    [wallets.length.toLocaleString('en-US'), 'LPs ranked'],
    [pct(ks.filter(k => k < 0).length / (ks.length || 1)), 'did worse than holding'],
    [kept(quantile(ks, 0.5)), 'fees kept by the typical LP'],
    [`${pct(Math.min(1, quantile(ks, 0.9)))}+`, 'kept by the top 10%'],
  ];
  $('stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('sizes').hidden = tab === 'pools';

  if (tab === 'pools') {
    $('head').innerHTML = '<tr><th>#</th><th class="who">Pool</th><th>LPs seen</th><th>Beat holding</th><th>Typical fees kept</th><th>Fees earned</th></tr>';
    $('body').innerHTML = data.pools.slice(0, SHOW).map((p, i) => `<tr><td>${i + 1}</td>
      <td class="who"><a href="https://app.meteora.ag/dlmm/${p.address}" target="_blank" rel="noopener">${p.name}</a></td><td>${p.lps}</td>
      <td class="${p.beat >= 0.5 ? 'good' : 'bad'}">${pct(p.beat)}</td><td class="${tone(p.k)}">${pct(p.k)}</td><td>${usd(p.fees)}</td></tr>`).join('');
    $('note').textContent = `Busiest pools by fees among the LPs we tracked. Pools with fewer than 5 of those LPs are left out.`;
    return;
  }
  // Fame: best share of fees kept, up to 100%. Above that liquidity beat holding by more than its fees,
  // a price bet that paid off, so those go to their own tab by dollars. Shame: most dollars lost to holding.
  const rows = tab === 'fame' ? wallets.filter(w => w.k <= 1)
    : tab === 'bets' ? wallets.filter(w => w.k > 1).sort((a, b) => b.lp - a.lp)
    : [...wallets].sort((a, b) => a.lp - b.lp);
  $('head').innerHTML = '<tr><th>#</th><th class="who">Wallet</th><th>Fees kept</th><th>Liquidity</th><th>Fees</th><th>Deposited</th><th class="pools">Main pools</th></tr>';
  $('body').innerHTML = rows.slice(0, SHOW).map((w, i) => `<tr><td>${i + 1}</td>
    <td class="who"><a class="mono" href="./?wallet=${w.w}&from=board">${short(w.w)}</a>${verified.has(w.w) ? ' <span class="badge-ok" title="Owner verified this wallet by signing">✓</span>' : ''}</td>
    <td class="${tone(w.k)}">${kept(w.k)}</td><td class="${tone(w.lp)}">${signed(w.lp)}</td><td>${usd(w.fees)}</td><td>${usd(w.dep)}</td>
    <td class="pools">${w.top.join(', ')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No wallets at this size yet</td></tr>';
  $('note').textContent = {
    fame: 'Liquidity = what providing liquidity added on top of simply holding the same tokens, fees included. Click a wallet for its full receipt.',
    bets: 'Beat holding by more than all their fees: the price moved their way. Sorted by dollars gained over holding.',
    shame: 'Sorted by dollars lost to holding: these LPs earned fees, but price moves cost them more.',
  }[tab];
}

for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => {
  tab = b.dataset.tab;
  action('board_tab', { tab });
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-pressed', x === b);
  render();
});
for (const b of document.querySelectorAll('.sizes button')) b.addEventListener('click', () => {
  min = Number(b.dataset.min);
  action('board_size', { min });
  for (const x of document.querySelectorAll('.sizes button')) x.setAttribute('aria-pressed', x === b);
  render();
});

// Which rows people open tells the strategist what kind of LP is interesting.
$('body').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a) action('board_open', { tab, rank: a.closest('tr').rowIndex });
});

trackVisit('top');
try {
  verified = new Set(await fetch(`${BACKEND}/verified`).then(r => (r.ok ? r.json() : [])).catch(() => []));
  data = await (await fetch('data/leaderboard.json', { cache: 'no-cache' })).json();
  const day = new Date(data.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  $('lead').textContent = `${data.wallets.length.toLocaleString('en-US')} liquidity providers on Meteora, ranked by the share of fees they kept after price moves over the last ${data.days} days. Updated ${day}.`;
  render();
} catch (e) {
  console.error(e);
  $('note').textContent = data ? "Couldn't show the leaderboard. Try reloading." : 'The leaderboard is being built. Check back tomorrow.';
}
