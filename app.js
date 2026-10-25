import { report, DAYS } from './meteora.js';
import { usd, signed, pct, tone } from './format.js';
import { BACKEND, params, REF, track, action, trackVisit, referredBy, firstSource } from './analytics.js';

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EXAMPLE = 'Abaqj8ivq6Uoinc9CQiiZ9GQNDB2RFSWqhpJKf9mN6Gu'; // an active public Meteora LP wallet
let lastResult = {}; // wallet and result sent along with a waitlist signup or a shared card


const $ = id => document.getElementById(id);


function verdict(s) {
  if (!s.rows.length) return 'No Meteora DLMM positions found for this wallet in the last 365 days.';
  const k = s.feesKept;
  if (k === undefined) return s.vsHodl >= 0 ? 'Liquidity did a little better than holding.' : 'Holding would have done a little better.';
  if (k >= 1) return 'Liquidity beat holding by more than the fees you earned.';
  if (k >= 0.5) return 'You kept most of the fees you earned.';
  if (k >= 0) return 'Price moves ate most of the fees you earned.';
  return 'Price moves cost you more than your fees. Shoulda held.';
}

// Ranked LPs from the daily crawl, for "better than X% of LPs". Missing file → no benchmark.
const board = fetch('data/leaderboard.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);

function benchmark(s, b) {
  if (!b?.wallets.length || s.feesKept === undefined) return null;
  const kept = b.wallets.map(w => w.k).sort((x, y) => x - y);
  return { beat: kept.filter(k => k < s.feesKept).length / kept.length, n: kept.length, top: kept[Math.floor(0.9 * kept.length)] };
}

function render(s, user, b) {
  const bench = benchmark(s, b);
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
  $('bench').hidden = !bench;
  if (bench) {
    $('bench-beat').textContent = pct(bench.beat);
    $('bench-text').textContent = `of ${bench.n.toLocaleString('en-US')} Meteora LPs we track kept a smaller share of their fees. The top 10% keep ${pct(bench.top)} or more.`;
  }

  const tr = r => `<tr><td>${r.name}${r.open ? ' <span class="tag">open</span>' : ''}</td>` +
    `<td class="${tone(r.feesKept ?? r.vsHodl)}">${pct(r.feesKept)}</td><td class="${tone(r.vsHodl)}">${signed(r.vsHodl)}</td><td>${usd(r.feesUsd)}</td></tr>`;
  const top = s.rows.length > 10 ? [...s.rows.slice(0, 5), ...s.rows.slice(-5)] : s.rows;
  $('rows').innerHTML = top.map(tr).join('');
  $('rows-note').textContent = s.rows.length > 10 ? `Best 5 and worst 5 of ${s.rows.length} pools.` : '';

  lastResult = { wallet: user, feesKept: s.feesKept, feesUsd: s.feesUsd, lpUsd: s.vsHodl, depositedUsd: s.depositedUsd };
  mine = s;
  const rank = topShare(bench);
  cardKind = rank ? 'rank' : 'receipt';
  shareText = rank
    ? `Top ${rank} of Meteora LPs: I kept ${pct(s.feesKept)} of my LP fees after price moves (${signed(s.vsHodl)} from liquidity). Where do you rank? @shouldaheld`
    : s.feesKept === undefined
    ? `Liquidity earned me ${signed(s.vsHodl)} after price moves. Get your receipt from @shouldaheld`
    : `I kept ${pct(s.feesKept)} of my LP fees after price moves: ${signed(s.vsHodl)} from liquidity, the rest of my PnL was the market. ${bench ? `Better than ${pct(bench.beat)} of LPs.` : s.feesKept >= 0.5 ? 'Not bad.' : s.feesKept >= 0 ? 'Could be worse.' : 'Shoulda held.'} Get your receipt from @shouldaheld`;
  $('share-x').href = intent(shareText, `${location.origin}${location.pathname}?wallet=${user}`); // fallback if the card upload fails
  $('duel-result').hidden = true;
  drawCard(s, bench);
  renderWaitlist(s);
  $('shared').hidden = !(REF && user === params.get('wallet'));
  $('intro').hidden = true;
  $('top').classList.add('compact');
  $('result').hidden = false;
}

let shareText = '', cardKind = 'receipt', mine = null, duelText = '';
const intent = (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
// "12%" when the wallet is in the better half of ranked LPs: a brag people actually post.
const topShare = bench => (bench && bench.beat >= 0.5 ? `${Math.max(1, Math.round((1 - bench.beat) * 100))}%` : null);

// Upload the drawn card and post its short link, so X shows the card under the post.
// The tab opens right away on click (browsers block pop-ups opened after an await).
async function shareCard(canvas, kind, text, fallback) {
  const tab = window.open('', '_blank');
  let url = fallback;
  try {
    const png = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const q = new URLSearchParams({ wallet: lastResult.wallet, lp: lastResult.lpUsd, kind });
    if (lastResult.feesKept !== undefined) q.set('k', lastResult.feesKept);
    const r = await fetch(`${BACKEND}/card?${q}`, { method: 'POST', body: png });
    if (r.ok) url = intent(text, (await r.json()).url);
  } catch { /* keep the plain link */ }
  if (tab) tab.location = url; else location.href = url;
}

function shareOnX(e) {
  e.preventDefault();
  shareCard($('card'), cardKind, shareText, $('share-x').href);
}

// Duel: the visitor's receipt next to another wallet's, as a card that tags the friend.
async function runDuel(e) {
  e?.preventDefault();
  const other = $('duel-wallet').value.trim(), handle = $('duel-x').value.trim().replace(/^@/, '');
  const msg = t => { $('duel-msg').textContent = t; };
  if (!WALLET.test(other)) return msg('That does not look like a Solana wallet address.');
  if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return msg("That X handle doesn't look right.");
  if (other === lastResult.wallet) return msg("That's the same wallet.");
  msg(''); $('duel-go').disabled = true;
  try {
    const them = await report(other, (done, total) => { $('duel-go').textContent = `Reading pool ${done} of ${total}…`; });
    const name = handle ? `@${handle}` : `${other.slice(0, 4)}…${other.slice(-4)}`;
    const k = x => x.feesKept ?? -Infinity;
    const win = k(mine) === k(them) ? 'tie' : k(mine) > k(them) ? 'me' : 'them';
    const row = (label, a, b, f, cls) => `<tr><td>${label}</td><td class="${cls ? tone(a ?? 0) : ''}">${f(a)}</td><td class="${cls ? tone(b ?? 0) : ''}">${f(b)}</td></tr>`;
    $('duel-head').innerHTML = `<tr><th></th><th>You</th><th>${name}</th></tr>`;
    $('duel-rows').innerHTML = row('Fees kept', mine.feesKept, them.feesKept, pct, true)
      + row('Liquidity', mine.vsHodl, them.vsHodl, signed, true) + row('Fees earned', mine.feesUsd, them.feesUsd, usd)
      + row('Deposited', mine.depositedUsd, them.depositedUsd, usd);
    $('duel-verdict').textContent = win === 'tie' ? 'A tie.' : win === 'me' ? 'You kept more of your fees.' : `${name} kept more of their fees.`;
    duelText = `My LP receipt vs ${name}: I kept ${pct(mine.feesKept)} of my fees after price moves, ${handle ? 'they' : 'this wallet'} kept ${pct(them.feesKept)}. `
      + `${win === 'me' ? 'Shoulda held? Not me.' : win === 'them' ? 'Fine. You win this one.' : 'Dead even.'} Compare yours: @shouldaheld`;
    drawDuel(mine, them, name, win);
    $('duel-result').hidden = false;
    action('duel', { win, handle: !!handle });
  } catch (err) {
    msg(`Could not load that wallet: ${err.message}.`);
  } finally {
    $('duel-go').disabled = false; $('duel-go').textContent = 'Compare';
  }
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
      body: JSON.stringify({ email, x, role: new FormData($('waitlist')).get('role'), website: $('wl-website').value, referredBy, source: firstSource, ...lastResult }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    msg('', 'ok');
    showQueue(d);
  } catch (err) {
    msg(`${err.message}. Try again.`, 'err');
  } finally {
    $('wl-go').disabled = false;
  }
}

// After joining: place in line and a personal link; every LP who joins through it moves them up.
function showQueue(d) {
  const link = `https://shouldaheld.com/?j=${d.code}&utm_source=referral`;
  $('wl-form').hidden = true; $('wl-done').hidden = false;
  $('wl-place').textContent = `#${d.position.toLocaleString('en-US')}`;
  $('wl-of').textContent = `of ${d.total.toLocaleString('en-US')} in line for copy-LP${d.referrals ? ` · ${d.referrals} joined through you` : ''}`;
  $('wl-link').value = link;
  $('wl-share').href = intent(`I'm #${d.position} in line for copy-LP. First, see how much of your LP fees you actually keep: @shouldaheld`, link);
}

// Share card for X, 1200×630. In the better half of ranked LPs it leads with the rank.
function drawCard(s, bench) {
  const rank = topShare(bench);
  if (rank) return drawRank(s, bench, rank);
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
  if (bench) { g.fillStyle = '#58a6ff'; g.font = '600 34px system-ui, sans-serif'; g.fillText(`Better than ${pct(bench.beat)} of Meteora LPs`, 80, 470); }
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Shoulda held? Get your receipt · @shouldaheld', 80, 550);
}

function drawRank(s, bench, rank) {
  const g = $('card').getContext('2d');
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#8b949e'; g.font = '500 34px system-ui, sans-serif';
  g.fillText(`Ranked by LP fees kept after price moves, ${bench.n.toLocaleString('en-US')} Meteora LPs`, 80, 130);
  g.fillStyle = '#3fb950'; g.font = '800 150px system-ui, sans-serif';
  g.fillText(`TOP ${rank}`, 80, 310);
  g.fillStyle = '#e6edf3'; g.font = '400 36px system-ui, sans-serif';
  g.fillText(`Kept ${pct(s.feesKept)} of ${usd(s.feesUsd)} in fees · liquidity ${signed(s.vsHodl)}`, 80, 400);
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Where do you rank? shouldaheld.com · @shouldaheld', 80, 550);
}

function drawDuel(a, b, name, win) {
  const g = $('duel-card').getContext('2d');
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#8b949e'; g.font = '500 34px system-ui, sans-serif';
  g.fillText('LP fees kept after price moves', 80, 120);
  const side = (x, label, v, won) => {
    g.fillStyle = '#8b949e'; g.font = '500 36px system-ui, sans-serif'; g.fillText(label, x, 220);
    g.fillStyle = (v ?? 0) >= 0 ? '#3fb950' : '#f85149'; g.font = `${won ? 800 : 600} 130px system-ui, sans-serif`; g.fillText(pct(v), x, 370);
  };
  side(80, 'Me', a.feesKept, win === 'me');
  side(640, name, b.feesKept, win === 'them');
  g.fillStyle = '#e6edf3'; g.font = '700 46px system-ui, sans-serif'; g.fillText('vs', 560, 330);
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Compare yours: shouldaheld.com · @shouldaheld', 80, 550);
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
    render(s, user, await board);
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
$('duel-form').addEventListener('submit', runDuel);
$('duel-share').addEventListener('click', e => {
  e.preventDefault();
  shareCard($('duel-card'), 'duel', duelText, intent(duelText, `https://shouldaheld.com/?wallet=${lastResult.wallet}`));
});
$('wl-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('wl-link').value); $('wl-copy').textContent = 'Copied'; } catch { $('wl-link').select(); }
  action('copy_referral');
});
$('wl-share').addEventListener('click', () => action('share_referral'));
$('download').addEventListener('click', () => {
  action('download', { kind: cardKind });
  const a = document.createElement('a');
  a.href = $('card').toDataURL('image/png'); a.download = 'shoulda-held-receipt.png'; a.click();
});
$('check-own').addEventListener('click', () => {
  $('wallet').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('wallet').focus();
});

trackVisit('home');
const fromUrl = params.get('wallet');
if (fromUrl) { $('wallet').value = fromUrl; run(fromUrl); }
