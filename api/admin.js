// admin.shouldaheld.com: funnel and segmented leads. Cloudflare Access sits in front and only lets
// the allowed email through; the Worker still verifies Access's signed token and refuses without it.
import { SITE, esc, usd, pct } from './util.js';

// Who to talk to first. Thresholds are a first guess, tune them once real leads come in.
export function segments(l) {
  return [
    l.fees_kept >= 0.5 && l.fees_usd >= 500 && 'leader candidate',
    l.fees_usd >= 5000 && 'big LP',
    l.role === 'copy' && 'wants to copy',
    l.role === 'lead' && 'wants to lead',
  ].filter(Boolean);
}

export async function admin(req, env, path) {
  const email = env.DEV_ADMIN === '1' ? 'local dev' : await accessEmail(req, env);
  if (!email) return new Response('Forbidden', { status: 403 });
  if (path === '/leads.csv') return leadsCsv(env);
  if (path === '/') return page(env, email);
  return new Response('Not found', { status: 404 });
}

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));

// Verifies the Cf-Access-Jwt-Assertion header against the team's public keys and this app's AUD tag.
async function accessEmail(req, env) {
  const jwt = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt || !env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  try {
    const [h, p, s] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
    const { keys } = await (await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } })).json();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    const aud = [].concat(claims.aud);
    return valid && aud.includes(env.ACCESS_AUD) && claims.exp * 1000 > Date.now() ? claims.email : null;
  } catch {
    return null;
  }
}

const leadsQuery = env => env.DB.prepare('SELECT * FROM waitlist ORDER BY created_at DESC').all().then(r => r.results);
const priority = l => (segments(l).includes('leader candidate') ? 1e12 : 0) + (l.fees_usd ?? 0);

async function leadsCsv(env) {
  const leads = (await leadsQuery(env)).sort((a, b) => priority(b) - priority(a));
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['contact', 'email', 'x', 'role', 'segments', 'fees_kept', 'fees_usd', 'wallet', 'created_at'],
    ...leads.map(l => [l.contact, l.email, l.x, l.role, segments(l).join('; '), l.fees_kept, l.fees_usd, l.wallet, l.created_at])];
  return new Response(rows.map(r => r.map(cell).join(',')).join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="shouldaheld-leads.csv"' },
  });
}

async function page(env, email) {
  const day = n => new Date(Date.now() - n * 864e5).toISOString();
  const [week, all, daily, kept, leads] = await Promise.all([
    funnel(env, day(7)),
    funnel(env, '0'),
    env.DB.prepare(`SELECT substr(created_at, 1, 10) AS d, type, count(*) AS n FROM events
      WHERE created_at >= ?1 GROUP BY d, type ORDER BY d DESC`).bind(day(14)).all().then(r => r.results),
    env.DB.prepare(`SELECT CASE WHEN fees_kept IS NULL THEN 'too few fees' WHEN fees_kept < 0 THEN 'below 0%'
      WHEN fees_kept < 0.5 THEN '0–49%' WHEN fees_kept < 1 THEN '50–99%' ELSE '100%+' END AS bucket,
      count(DISTINCT wallet_hash) AS wallets FROM events WHERE type = 'check' GROUP BY bucket`).all().then(r => r.results),
    leadsQuery(env),
  ]);

  const rate = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const funnelRow = (label, f) => `<tr><td>${label}</td><td>${f.visit}</td><td>${f.check} <small>(${f.wallets} wallets)</small></td>
    <td>${f.share} <small>${rate(f.share, f.check)}</small></td><td>${f.fromShares} <small>visits</small></td>
    <td>${f.signup} <small>${rate(f.signup, f.check)}</small></td></tr>`;

  const days = [...new Set(daily.map(r => r.d))];
  const dayCount = (d, t) => daily.find(r => r.d === d && r.type === t)?.n ?? 0;

  const segCount = s => leads.filter(l => segments(l).includes(s)).length;
  const sorted = [...leads].sort((a, b) => priority(b) - priority(a));
  const who = l => [l.email && esc(l.email), l.x && `<a href="https://x.com/${esc(l.x)}" target="_blank">@${esc(l.x)}</a>`].filter(Boolean).join('<br>');
  const leadRow = l => `<tr><td>${who(l)}</td><td>${esc(l.role)}</td>
    <td>${segments(l).map(s => `<span class="tag">${s}</span>`).join(' ')}</td>
    <td>${pct(l.fees_kept)}</td><td>${l.fees_usd == null ? '—' : usd(l.fees_usd)}</td>
    <td>${l.wallet ? `<a href="${SITE}/?wallet=${esc(l.wallet)}" target="_blank">${esc(l.wallet.slice(0, 4))}…${esc(l.wallet.slice(-4))}</a>` : '—'}</td>
    <td>${esc(l.created_at.slice(0, 10))}</td></tr>`;

  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Shoulda Held?</title><meta name="robots" content="noindex">
<style>
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 32px; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #30363d; vertical-align: top; }
  th { color: #8b949e; font-weight: 500; } small, .muted { color: #8b949e; } a { color: #58a6ff; }
  .wrap { overflow-x: auto; } .tag { font-size: 12px; border: 1px solid #58a6ff; color: #58a6ff; border-radius: 4px; padding: 0 4px; white-space: nowrap; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; } .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; }
  .card b { display: block; font-size: 22px; }
</style></head><body><main>
<h1>Shoulda Held? admin</h1><p class="muted">Signed in as ${esc(email)}</p>

<h2>Funnel</h2>
<div class="wrap"><table><thead><tr><th></th><th>Visits</th><th>Checks</th><th>Shares <small>of checks</small></th><th>From shares</th><th>Signups <small>of checks</small></th></tr></thead>
<tbody>${funnelRow('Last 7 days', week)}${funnelRow('All time', all)}</tbody></table></div>

<h2>Last 14 days</h2>
<div class="wrap"><table><thead><tr><th>Day</th><th>Visits</th><th>Checks</th><th>Shares</th><th>Signups</th></tr></thead>
<tbody>${days.map(d => `<tr><td>${d}</td><td>${dayCount(d, 'visit')}</td><td>${dayCount(d, 'check')}</td><td>${dayCount(d, 'share')}</td><td>${dayCount(d, 'signup')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No events yet</td></tr>'}</tbody></table></div>

<h2>Checked wallets by fees kept</h2>
<div class="cards">${['below 0%', '0–49%', '50–99%', '100%+', 'too few fees'].map(b => `<div class="card"><span class="muted">${b}</span><b>${kept.find(r => r.bucket === b)?.wallets ?? 0}</b></div>`).join('')}</div>

<h2>Leads (${leads.length}) <small><a href="/leads.csv">Download CSV</a></small></h2>
<div class="cards">${['leader candidate', 'big LP', 'wants to copy', 'wants to lead'].map(s => `<div class="card"><span class="muted">${s}</span><b>${segCount(s)}</b></div>`).join('')}</div>
<p class="muted">Leader candidate: kept 50%+ of fees with $500+ earned. Big LP: $5,000+ fees. Sorted: leader candidates first, then by fees.</p>
<div class="wrap"><table><thead><tr><th>Contact</th><th>Wants</th><th>Segments</th><th>Fees kept</th><th>Fees</th><th>Wallet</th><th>Joined</th></tr></thead>
<tbody>${sorted.map(leadRow).join('') || '<tr><td colspan="7" class="muted">No leads yet</td></tr>'}</tbody></table></div>
</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function funnel(env, since) {
  const rows = (await env.DB.prepare(`SELECT type, count(*) AS n, count(DISTINCT wallet_hash) AS wallets,
    sum(type = 'visit' AND ref IS NOT NULL) AS from_shares FROM events WHERE created_at >= ?1 GROUP BY type`).bind(since).all()).results;
  const get = t => rows.find(r => r.type === t) ?? {};
  return {
    visit: get('visit').n ?? 0, check: get('check').n ?? 0, wallets: get('check').wallets ?? 0,
    share: get('share').n ?? 0, signup: get('signup').n ?? 0, fromShares: get('visit').from_shares ?? 0,
  };
}
