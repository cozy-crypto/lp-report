import { report, DAYS } from './meteora.js';
import { usd, signed, pct, kept, tone } from './format.js';
import { BACKEND, params, REF, track, action, trackVisit, referredBy, firstSource } from './analytics.js';

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EXAMPLE = 'Abaqj8ivq6Uoinc9CQiiZ9GQNDB2RFSWqhpJKf9mN6Gu'; // an active public Meteora LP wallet
let lastResult = {}; // wallet and result sent along with a waitlist signup or a shared card


const $ = id => document.getElementById(id);


function verdict(s, me = true) {
  if (!me) return verdict(s).replace('You kept most of the fees you earned', 'This wallet kept most of the fees it earned')
    .replace('the fees you earned', 'the fees it earned').replace('cost you more than your fees', 'cost it more than its fees');
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
  const ks = b.wallets.map(w => w.k).sort((x, y) => x - y);
  return { beat: ks.filter(k => k < s.feesKept).length / ks.length, n: ks.length, top: ks[Math.floor(0.9 * ks.length)] };
}

function render(s, user, b, verified) {
  const bench = benchmark(s, b);
  const set = (id, v, cls = '') => { $(id).textContent = v; $(id).className = cls; };
  $('result').classList.toggle('empty', !s.rows.length);
  set('hero', kept(s.feesKept), 'big ' + tone(s.feesKept ?? s.vsHodl));
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
  if (bench) $('bench').innerHTML = `${beatText(bench)} · <a href="top.html">leaderboard</a>`;

  const tr = r => `<tr><td>${r.name}${r.open ? ' <span class="tag">open</span>' : ''}</td>` +
    `<td class="${tone(r.feesKept ?? r.vsHodl)}">${kept(r.feesKept)}</td><td class="${tone(r.vsHodl)}">${signed(r.vsHodl)}</td><td>${usd(r.feesUsd)}</td></tr>`;
  const top = s.rows.length > 10 ? [...s.rows.slice(0, 5), ...s.rows.slice(-5)] : s.rows;
  $('rows').innerHTML = top.map(tr).join('');
  $('rows-note').textContent = s.rows.length > 10 ? `Best 5 and worst 5 of ${s.rows.length} pools.` : '';

  lastResult = { wallet: user, feesKept: s.feesKept, feesUsd: s.feesUsd, lpUsd: s.vsHodl, depositedUsd: s.depositedUsd };
  mine = s; current = { s, bench, user };
  walletVerified = verified.has(user);
  // Anyone can paste any wallet, so texts stay third-person until the visitor says it's theirs.
  // The example and a wallet opened from someone's shared card are never the visitor's.
  owner = store.get(`verified:${user}`) ? true // this browser signed for it earlier
    : user === EXAMPLE || (REF && user === params.get('wallet')) ? false : null;
  guest = owner === false;
  $('verify-msg').textContent = ''; $('verify-help').hidden = true;
  $('duel-result').hidden = true;
  applyOwner();
  $('shared').hidden = !(REF && user === params.get('wallet'));
  $('intro').hidden = true;
  $('top').classList.add('compact');
  $('result').hidden = false;
}

let shareText = '', cardKind = 'receipt', mine = null, duelText = '';
let owner = null, current = null; // owner: true = the visitor said this wallet is theirs
let walletVerified = false;        // the wallet's owner proved it by signing (anyone may be looking at it)
let guest = false;                 // example or someone's shared card: don't ask whose wallet it is

// Wallets proven by signing; the receipt and cards of these wallets carry a ✓.
const verifiedWallets = fetch(`${BACKEND}/verified`).then(r => (r.ok ? r.json() : [])).then(a => new Set(a)).catch(() => new Set());
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// Everything that says "I" or pitches earning from the wallet depends on whose wallet it is.
function applyOwner() {
  const { s, bench, user } = current;
  const me = owner === true;
  lastResult.owner = me;
  $('verified-badge').hidden = !walletVerified;
  renderOwner();
  $('verdict').textContent = verdict(s, me);
  const rank = topShare(bench);
  cardKind = rank ? 'rank' : 'receipt';
  const k = kept(s.feesKept), lp = signed(s.vsHodl), end = s.feesKept >= 0 ? 'Could be worse.' : 'Shoulda held.';
  // Good results tag Meteora (they may repost wins on their pools); bad ones don't.
  shareText = me
    ? rank ? `Kept ${k} of my LP fees after price moves: top ${rank} of @MeteoraAG LPs.\n\nWhere do you rank? 🦝 via @shouldaheld`
      : s.feesKept === undefined ? `Liquidity earned me ${lp} after price moves.\n\nGet your receipt 🦝 via @shouldaheld`
      : s.feesKept >= 0.5 ? `I kept ${k} of my @MeteoraAG LP fees after price moves (${lp} from liquidity).\n\nHow much of yours did you keep? 🦝 via @shouldaheld`
      : `My PnL said one thing. My LP receipt says I kept ${k} of my fees after price moves. ${end}\n\nGet yours 🦝 via @shouldaheld`
    : rank ? `This wallet kept ${k} of its LP fees after price moves: top ${rank} of @MeteoraAG LPs.\n\nWhere do you rank? 🦝 via @shouldaheld`
      : s.feesKept === undefined ? `Liquidity earned this wallet ${lp} after price moves.\n\nCheck yours 🦝 via @shouldaheld`
      : s.feesKept >= 0.5 ? `This LP kept ${k} of their @MeteoraAG LP fees after price moves (${lp} from liquidity).\n\nHow much of yours do you keep? 🦝 via @shouldaheld`
      : `This LP's receipt: they kept ${k} of their fees after price moves. ${end}\n\nCheck yours 🦝 via @shouldaheld`;
  $('share-x').href = intent(shareText, `${location.origin}${location.pathname}?wallet=${user}`); // fallback if the card upload fails
  drawCard(s, bench);
  renderWaitlist(s);
}

// The ownership slot under the verdict: a question, or one line of status with the next step.
function renderOwner() {
  const ask = owner === null && !guest;
  $('owner-ask').hidden = !ask;
  const status = walletVerified && owner ? '<span class="good-text">✓ You verified this wallet</span>'
    : walletVerified ? '✓ Verified by its owner'
    : owner === true ? 'Your wallet · <button type="button" class="link-btn" data-act="verify">verify it</button> to get a ✓ and jump 50 places in line'
    : owner === false && !guest ? '<button type="button" class="link-btn" data-act="ask">Actually, it\'s mine</button>'
    : '';
  $('owner-status').innerHTML = status;
  $('owner-status').hidden = ask || !status;
}

function setOwner(me) {
  owner = me;
  $('verify-help').hidden = true; $('verify-msg').textContent = '';
  action('owner', { mine: me });
  applyOwner();
}

// Must match verifyMessage() in api/verify.js character for character.
const verifyMessage = (wallet, issuedAt) => 'shouldaheld.com wants you to prove you own this Solana wallet.\n\n'
  + `Wallet: ${wallet}\nIssued at: ${issuedAt}\n\nSigning is free. It does not send a transaction or give access to your funds.`;
// Wallets announce themselves through the Wallet Standard (current Phantom, Solflare, Backpack…);
// older ones only inject a global. Both are turned into { name, connect(): address, sign(bytes): signature }.
const standardWallets = [];
const register = (...ws) => standardWallets.push(...ws);
window.addEventListener('wallet-standard:register-wallet', e => e.detail?.({ register }));
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } }));

function walletApp() {
  const std = standardWallets.find(w => w.features?.['solana:signMessage'] && w.features?.['standard:connect']);
  if (std) {
    let account;
    return {
      name: std.name,
      connect: async () => { account = (await std.features['standard:connect'].connect()).accounts?.[0] ?? std.accounts?.[0]; return account?.address; },
      sign: async bytes => (await std.features['solana:signMessage'].signMessage({ account, message: bytes }))[0].signature,
    };
  }
  const found = [['phantom', window.phantom?.solana], ['solflare', window.solflare], ['backpack', window.backpack], ['solana', window.solana]]
    .find(([, p]) => p?.signMessage);
  if (!found) return null;
  const [name, p] = found;
  return {
    name,
    connect: async () => ((await p.connect())?.publicKey ?? p.publicKey)?.toString(),
    sign: async bytes => { const res = await p.signMessage(bytes, 'utf8'); return res?.signature ?? res; },
  };
}

// Sign a plain message with the wallet app (no transaction) and let the server check it against the address.
async function verifyOwnership() {
  const wallet = current.user, msg = t => { $('verify-msg').textContent = t; };
  const skip = ' <button type="button" class="link-btn" data-act="skip">Continue without verifying</button>';
  const found = walletApp();
  if (!found) {
    // Phones have no extensions: reopen this page inside the wallet app's browser.
    const here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
    $('verify-help').innerHTML = (matchMedia('(max-width: 640px)').matches
      ? `Open this page in your wallet app to sign: <a href="https://phantom.app/ul/browse/${here}?ref=${ref}">Phantom</a> · <a href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Solflare</a>.`
      : 'No Solana wallet in this browser. Install <a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a> and reload.') + skip;
    $('verify-help').hidden = false;
    action('verify_no_wallet', { mobile: matchMedia('(max-width: 640px)').matches, ua: navigator.userAgent.slice(0, 120), globals: Object.keys(window).filter(k => /phantom|solana|solflare|backpack/i.test(k)).join(',') });
    return;
  }
  const app = found.name;
  $('verify-go').disabled = true; msg('');
  try {
    const connected = await found.connect();
    if (connected !== wallet) throw new Error(`Your wallet app is on ${connected?.slice(0, 4)}…${connected?.slice(-4)}. Switch to ${wallet.slice(0, 4)}…${wallet.slice(-4)} and try again`);
    const issuedAt = new Date().toISOString();
    const sig = await found.sign(new TextEncoder().encode(verifyMessage(wallet, issuedAt)));
    const r = await fetch(`${BACKEND}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, issuedAt, app, signature: btoa(String.fromCharCode(...new Uint8Array(sig))) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Verification failed');
    store.set(`verified:${wallet}`, '1');
    walletVerified = true; owner = true;
    $('verify-help').hidden = true;
    applyOwner();
    if (lastSignup) { // already in line: the server now sees the wallet as verified and moves them up
      const q = await fetch(`${BACKEND}/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: lastSignup });
      if (q.ok) showQueue(await q.json());
    }
  } catch (e) {
    msg(/reject|denied|cancel/i.test(e.message) ? 'Signing cancelled.' : `${e.message}.`);
    if (owner !== true) { $('verify-help').innerHTML = `Can't sign right now?${skip}`; $('verify-help').hidden = false; }
    action('verify_failed', { app, reason: e.message.slice(0, 60) });
  } finally {
    $('verify-go').disabled = false;
  }
}
const intent = (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
// "12%" when the wallet is in the better half of ranked LPs: a brag people actually post.
// Rounded down so "better than 100%" never shows up; ahead of every ranked LP says so in words.
const beatText = b => (b.beat === 1 ? `Ahead of all ${b.n.toLocaleString('en-US')} tracked LPs`
  : `Better than ${Math.floor(b.beat * 100)}% of ${b.n.toLocaleString('en-US')} tracked LPs`);
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
    const me = owner ? 'You' : `${lastResult.wallet.slice(0, 4)}…${lastResult.wallet.slice(-4)}`;
    $('duel-head').innerHTML = `<tr><th></th><th>${me}</th><th>${name}</th></tr>`;
    $('duel-rows').innerHTML = row('Fees kept', mine.feesKept, them.feesKept, pct, true)
      + row('Liquidity', mine.vsHodl, them.vsHodl, signed, true) + row('Fees earned', mine.feesUsd, them.feesUsd, usd)
      + row('Deposited', mine.depositedUsd, them.depositedUsd, usd);
    $('duel-verdict').textContent = win === 'tie' ? 'A tie.' : win === 'me' ? `${owner ? 'You' : me} kept more of ${owner ? 'your' : 'its'} fees.` : `${name} kept more of their fees.`;
    const ending = owner ? (win === 'me' ? 'Shoulda held? Not me.' : win === 'them' ? 'Fine. You win this one.' : 'Dead even.') : '';
    duelText = (owner
      ? `My LP receipt vs ${name}: I kept ${kept(mine.feesKept)} of my fees after price moves, ${handle ? 'they' : 'this wallet'} kept ${kept(them.feesKept)}. ${ending}`
      : `LP receipts, ${me} vs ${name}: ${kept(mine.feesKept)} vs ${kept(them.feesKept)} of fees kept after price moves.`)
      + '\n\nCompare yours 🦝 via @shouldaheld';
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
// One waitlist for everyone, pitched by who's looking: a verified owner gets priority, an owner who only said so
// is offered to verify (50 places up), anyone else is pitched copying.
let role = 'copy'; // what the waitlist pitch offers: owners with a good result can lead, everyone else can copy

function renderWaitlist(s) {
  // The pitch follows the result first: a strong wallet is a would-be leader, unless the visitor says it isn't theirs.
  const good = s.feesKept >= 0.5;
  role = good && owner !== false ? 'lead' : 'copy';
  $('wl-title').textContent = (walletVerified && owner ? '✓ Verified LP. ' : '')
    + (good && owner === true ? 'Get paid when others copy you'
      : good && owner === null ? 'Your wallet? Get paid when others copy it'
      : good ? 'Copy LPs like this one'
      : 'Copy LPs who keep their fees');
  $('wl-text').textContent = (good && owner !== false
    ? "We're building copy-LP: others follow a top LP's positions, and the LP earns a share of their fees."
    : good ? "We're building copy-LP: follow the positions of LPs with results like this, automatically, in your own wallet."
    : "We're building copy-LP: follow the best LPs' positions automatically, in your own wallet.")
    + (good && owner === null ? ' Verify it above to join as a leader.' : owner === true && !walletVerified ? ' Verified wallets jump 50 places in line.' : '');
  $('wl-msg').textContent = ''; $('wl-msg').className = '';
}

async function joinWaitlist(e) {
  e.preventDefault();
  const msg = (text, cls) => { $('wl-msg').textContent = text; $('wl-msg').className = cls; };
  // One field: an email, or an X handle with or without @.
  const v = $('wl-contact').value.trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '', x = email ? '' : v.replace(/^@/, '');
  if (!v) return msg('Add an email or an X handle.', 'err');
  $('wl-go').disabled = true;
  try {
    const r = await fetch(`${BACKEND}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: (lastSignup = JSON.stringify({ email, x, role, website: $('wl-website').value, referredBy, source: firstSource, ...lastResult })),
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
let lastSignup = null; // re-sent after verifying, to move up in line

function showQueue(d) {
  const link = `https://shouldaheld.com/?j=${d.code}&utm_source=referral`;
  $('wl-form').hidden = true; $('wl-done').hidden = false;
  $('wl-place').textContent = `#${d.position.toLocaleString('en-US')}`;
  $('wl-of').textContent = `of ${d.total.toLocaleString('en-US')} in line for copy-LP${d.verified ? ' · ✓ verified, 50 places up' : ''}${d.referrals ? ` · ${d.referrals} joined through you` : ''}`;
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
  g.fillText(measured ? (owner ? 'LP fees I kept after price moves' : 'LP fees this wallet kept after price moves')
    : (owner ? 'What liquidity earned me' : 'What liquidity earned this wallet'), 80, 140);
  g.fillStyle = good ? '#3fb950' : '#f85149'; g.font = '700 150px system-ui, sans-serif';
  g.fillText(measured ? kept(s.feesKept) : signed(s.vsHodl), 80, 320);
  g.fillStyle = '#e6edf3'; g.font = '400 34px system-ui, sans-serif';
  g.fillText(`From liquidity ${signed(s.vsHodl)} · fees ${usd(s.feesUsd)} · market ${signed(s.marketUsd)}`, 80, 410);
  if (bench) { g.fillStyle = '#58a6ff'; g.font = '600 34px system-ui, sans-serif'; g.fillText(`Better than ${pct(bench.beat)} of Meteora LPs`, 80, 470); }
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Shoulda held? Get your receipt · @shouldaheld', 80, 550);
  badge(g);
}

// ✓ in the card's corner when the wallet's owner proved it by signing.
function badge(g) {
  if (!walletVerified) return;
  g.fillStyle = 'rgba(63, 185, 80, .15)'; g.beginPath(); g.roundRect(820, 60, 300, 56, 28); g.fill();
  g.fillStyle = '#3fb950'; g.font = '600 28px system-ui, sans-serif'; g.fillText('✓ Verified owner', 850, 98);
}

function drawRank(s, bench, rank) {
  const g = $('card').getContext('2d');
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#8b949e'; g.font = '500 34px system-ui, sans-serif';
  g.fillText(`Ranked by LP fees kept after price moves, ${bench.n.toLocaleString('en-US')} Meteora LPs`, 80, 130);
  g.fillStyle = '#3fb950'; g.font = '800 150px system-ui, sans-serif';
  g.fillText(`TOP ${rank}`, 80, 310);
  g.fillStyle = '#e6edf3'; g.font = '400 36px system-ui, sans-serif';
  g.fillText(`Kept ${kept(s.feesKept)} of ${usd(s.feesUsd)} in fees · liquidity ${signed(s.vsHodl)}`, 80, 400);
  g.fillStyle = '#8b949e'; g.font = '400 26px system-ui, sans-serif';
  g.fillText('Where do you rank? shouldaheld.com · @shouldaheld', 80, 550);
  badge(g);
}

function drawDuel(a, b, name, win) {
  const g = $('duel-card').getContext('2d');
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#8b949e'; g.font = '500 34px system-ui, sans-serif';
  g.fillText('LP fees kept after price moves', 80, 120);
  const side = (x, label, v, won) => {
    g.fillStyle = '#8b949e'; g.font = '500 36px system-ui, sans-serif'; g.fillText(label, x, 220);
    g.fillStyle = (v ?? 0) >= 0 ? '#3fb950' : '#f85149'; g.font = `${won ? 800 : 600} 130px system-ui, sans-serif`; g.fillText(kept(v), x, 370);
  };
  side(80, owner ? 'Me' : `${lastResult.wallet.slice(0, 4)}…${lastResult.wallet.slice(-4)}`, a.feesKept, win === 'me');
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
    render(s, user, await board, await verifiedWallets);
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
$('owner-no').addEventListener('click', () => setOwner(false));
$('verify-go').addEventListener('click', verifyOwnership);
// Links inside the ownership slot are re-rendered, so one listener handles them all.
$('owner').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'verify') verifyOwnership();
  if (act === 'skip') setOwner(true);
  if (act === 'ask') { owner = null; applyOwner(); }
});
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
