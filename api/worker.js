// One Worker for shouldaheld.com on three hostnames:
//   api.shouldaheld.com    POST /waitlist, POST /event, POST /card, GET /stats (for the agent farm, needs STATS_KEY),
//                          POST /crawl (daily crawl history, needs CRAWL_KEY),
//                          POST /verify (signed message proves wallet ownership), GET /verified (public list)
//   r.shouldaheld.com      /<id> share page for X, /<id>.png its card image
//   admin.shouldaheld.com  funnel and leads, behind Cloudflare Access
// The last two also answer at /r/ and /admin on any host (that's how `wrangler dev` reaches them);
// the admin stays closed there too without a valid Access token.
import { admin } from './admin.js';
import { saveCard, sharePage, cardImage } from './share.js';
import { buildStats } from './stats.js';
import { saveCrawl } from './crawl.js';
import { verifyWallet, verifiedList, isVerified } from './verify.js';
import { SITE, WALLET, num, now, hashWallet } from './util.js';

const ORIGINS = [SITE, 'http://localhost:8787'];
const ROLES = ['copy', 'lead', 'curious'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const CODE = /^[a-z0-9]{6}$/;
const REFERRAL_BOOST = 10; // places moved up per person you bring
const VERIFIED_BOOST = 50; // places moved up for proving the checked wallet by signing: those are the leads we want most
const EVENTS = ['visit', 'check', 'action'];
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const SHARE_BASE = 'https://r.shouldaheld.com';

    if (url.hostname.startsWith('admin.') || url.pathname.startsWith('/admin')) {
      return admin(req, env, url.pathname.replace(/^\/admin/, '') || '/');
    }
    if (url.hostname.startsWith('r.') || url.pathname.startsWith('/r/')) {
      const id = url.pathname.replace(/^\/r\//, '/').slice(1);
      return id.endsWith('.png') ? cardImage(env, id.slice(0, -4)) : sharePage(req, env, ctx, id, SHARE_BASE);
    }

    const origin = req.headers.get('Origin');
    const cors = ORIGINS.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
      : {};
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'POST' && url.pathname === '/waitlist') return waitlist(req, env, json);
    if (req.method === 'POST' && url.pathname === '/event') return event(req, env, json);
    if (req.method === 'POST' && url.pathname === '/card') return saveCard(req, env, json, SHARE_BASE);
    if (req.method === 'POST' && url.pathname === '/verify') return verifyWallet(req, env, json);
    if (req.method === 'GET' && url.pathname === '/verified') return verifiedList(env);
    if (req.method === 'POST' && url.pathname === '/crawl') {
      if (!env.CRAWL_KEY || req.headers.get('Authorization') !== `Bearer ${env.CRAWL_KEY}`) return json({ error: 'Forbidden' }, 403);
      return saveCrawl(req, env, json);
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      const key = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? url.searchParams.get('key');
      if (!env.STATS_KEY || key !== env.STATS_KEY) return json({ error: 'Forbidden' }, 403);
      return json(await buildStats(env));
    }
    return json({ error: 'Not found' }, 404);
  },
};

async function waitlist(req, env, json) {
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
  const referredBy = CODE.test(b.referredBy ?? '') ? b.referredBy : null;
  const wallet = WALLET.test(b.wallet ?? '') ? b.wallet : null;
  // 2: the wallet's owner signed on the site; 1: the visitor only said it's theirs.
  const owns = wallet && await isVerified(env, wallet) ? 2 : b.owner === true ? 1 : 0;
  const meta = JSON.stringify({ referredBy, owns, source: typeof b.source === 'string' ? b.source.slice(0, 64) : null, country: req.cf?.country });
  // Signing up again keeps the first code, referrer and join date; it updates the role and latest result.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO waitlist (contact, email, x, role, wallet, fees_kept, fees_usd, deposited_usd, code, referred_by, owns_wallet, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?12, ?11)
       ON CONFLICT(contact) DO UPDATE SET x = COALESCE(excluded.x, x), role = excluded.role,
         wallet = COALESCE(excluded.wallet, wallet), fees_kept = COALESCE(excluded.fees_kept, fees_kept),
         fees_usd = COALESCE(excluded.fees_usd, fees_usd), deposited_usd = COALESCE(excluded.deposited_usd, deposited_usd),
         code = COALESCE(code, excluded.code), referred_by = COALESCE(referred_by, excluded.referred_by),
         owns_wallet = CASE WHEN excluded.wallet IS NULL THEN owns_wallet ELSE excluded.owns_wallet END`,
    ).bind(contact, email || null, x || null, b.role, wallet, num(b.feesKept), num(b.feesUsd), num(b.depositedUsd), newCode(), referredBy, now(), owns),
    env.DB.prepare('INSERT INTO events (type, wallet_hash, fees_kept, fees_usd, meta, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind('signup', wallet && await hashWallet(wallet), num(b.feesKept), num(b.feesUsd), meta, now()),
  ]);
  return json(await queue(env, contact));
}

// Place in the waitlist: join order, moved up REFERRAL_BOOST places per signup that used your code
// and VERIFIED_BOOST places for a verified wallet.
async function queue(env, contact) {
  const me = await env.DB.prepare(
    `SELECT code, created_at, owns_wallet, (SELECT count(*) FROM waitlist w WHERE w.referred_by = waitlist.code AND w.contact != waitlist.contact) AS referrals,
       (SELECT count(*) FROM waitlist w WHERE w.created_at < waitlist.created_at) AS ahead,
       (SELECT count(*) FROM waitlist) AS total
     FROM waitlist WHERE contact = ?1`,
  ).bind(contact).first();
  const verified = me.owns_wallet === 2;
  const position = Math.max(1, me.ahead + 1 - REFERRAL_BOOST * me.referrals - (verified ? VERIFIED_BOOST : 0));
  return { ok: true, code: me.code, referrals: me.referrals, total: me.total, verified, position };
}

// Body is JSON sent as text/plain so the browser skips the CORS preflight on every page view.
async function event(req, env, json) {
  let b;
  try { b = JSON.parse(await req.text()); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!EVENTS.includes(b.type)) return json({ error: 'Unknown event' }, 400);
  const wallet = WALLET.test(b.wallet ?? '') ? b.wallet : null;
  // Free-form extras (traffic source, positions, deposit size, load time…); capped so a bad client can't bloat rows.
  const meta = b.meta && typeof b.meta === 'object' ? JSON.stringify({ ...b.meta, country: req.cf?.country }).slice(0, 1000) : null;
  await env.DB.prepare(
    'INSERT INTO events (type, wallet_hash, fees_kept, fees_usd, pools, ref, meta, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  ).bind(
    b.type, wallet && await hashWallet(wallet), num(b.feesKept), num(b.feesUsd),
    Number.isInteger(b.pools) ? b.pools : null, typeof b.ref === 'string' ? b.ref.slice(0, 32) : null, meta, now(),
  ).run();
  return json({ ok: true });
}
