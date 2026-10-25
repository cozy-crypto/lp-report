import { usd, signed, pct, tone } from './format.js';

const $ = id => document.getElementById(id);
const SHOW = 50;
const short = w => `${w.slice(0, 4)}…${w.slice(-4)}`;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

let data, tab = 'fame', min = 0;

function render() {
  const wallets = data.wallets.filter(w => w.dep >= min);
  const kept = wallets.map(w => w.k).sort((a, b) => a - b);
  const stats = [
    [wallets.length.toLocaleString('en-US'), 'LPs ranked'],
    [pct(kept.filter(k => k < 0).length / (kept.length || 1)), 'did worse than holding'],
    [pct(quantile(kept, 0.5)), 'fees kept by the typical LP'],
    [`${pct(quantile(kept, 0.9))}+`, 'kept by the top 10%'],
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
  // Fame: best share of fees kept. Shame: most dollars lost to holding.
  const rows = tab === 'fame' ? wallets : [...wallets].sort((a, b) => a.lp - b.lp);
  $('head').innerHTML = '<tr><th>#</th><th class="who">Wallet</th><th>Fees kept</th><th>Liquidity</th><th>Fees</th><th>Deposited</th><th class="pools">Main pools</th></tr>';
  $('body').innerHTML = rows.slice(0, SHOW).map((w, i) => `<tr><td>${i + 1}</td>
    <td class="who"><a class="mono" href="./?wallet=${w.w}">${short(w.w)}</a></td>
    <td class="${tone(w.k)}">${pct(w.k)}</td><td class="${tone(w.lp)}">${signed(w.lp)}</td><td>${usd(w.fees)}</td><td>${usd(w.dep)}</td>
    <td class="pools">${w.top.join(', ')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No wallets at this size yet</td></tr>';
  $('note').textContent = tab === 'fame'
    ? 'Liquidity = what providing liquidity added on top of simply holding the same tokens, fees included. Click a wallet for its full receipt.'
    : 'Sorted by dollars lost to holding: these LPs earned fees, but price moves cost them more.';
}

for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => {
  tab = b.dataset.tab;
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-pressed', x === b);
  render();
});
for (const b of document.querySelectorAll('.sizes button')) b.addEventListener('click', () => {
  min = Number(b.dataset.min);
  for (const x of document.querySelectorAll('.sizes button')) x.setAttribute('aria-pressed', x === b);
  render();
});

try {
  data = await (await fetch('data/leaderboard.json', { cache: 'no-cache' })).json();
  const day = new Date(data.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  $('lead').textContent = `${data.wallets.length.toLocaleString('en-US')} liquidity providers on Meteora, ranked by the share of fees they kept after price moves over the last ${data.days} days. Updated ${day}.`;
  render();
} catch {
  $('note').textContent = 'The leaderboard is being built. Check back tomorrow.';
}
