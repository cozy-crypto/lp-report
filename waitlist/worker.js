// Waitlist API at api.shouldaheld.com: POST /waitlist stores one contact in D1.

const ORIGINS = ['https://shouldaheld.com', 'http://localhost:8787'];
const ROLES = ['copy', 'lead', 'curious'];
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = ORIGINS.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
      : {};
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/waitlist') return json({ error: 'Not found' }, 404);

    let b;
    try { b = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
    // Hidden field people never see; bots fill every input. Pretend success so they don't retry.
    // ponytail: honeypot only; add Cloudflare Turnstile if real spam shows up.
    if (b.website) return json({ ok: true });

    const email = String(b.email ?? '').trim().toLowerCase();
    const x = String(b.x ?? '').trim().replace(/^@/, '');
    if (!email && !x) return json({ error: 'Add an email or an X handle' }, 400);
    if (email && !EMAIL.test(email)) return json({ error: 'That email doesn\'t look right' }, 400);
    if (x && !HANDLE.test(x)) return json({ error: 'That X handle doesn\'t look right' }, 400);
    if (!ROLES.includes(b.role)) return json({ error: 'Pick what you are interested in' }, 400);

    // One row per person: signing up again updates the role and latest result.
    const contact = email || `@${x.toLowerCase()}`;
    await env.DB.prepare(
      `INSERT INTO waitlist (contact, email, x, role, wallet, fees_kept, fees_usd, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(contact) DO UPDATE SET x = COALESCE(excluded.x, x), role = excluded.role,
         wallet = COALESCE(excluded.wallet, wallet), fees_kept = COALESCE(excluded.fees_kept, fees_kept),
         fees_usd = COALESCE(excluded.fees_usd, fees_usd)`,
    ).bind(
      contact, email || null, x || null, b.role,
      WALLET.test(b.wallet ?? '') ? b.wallet : null, num(b.feesKept), num(b.feesUsd), new Date().toISOString(),
    ).run();
    return json({ ok: true });
  },
};
