// Wallet ownership: the site asks the wallet app (Phantom, Solflare, Backpack…) to sign a plain-text message;
// no transaction, nothing is approved. We check the Ed25519 signature against the wallet address itself.
import { WALLET, now } from './util.js';

const FRESH_MS = 10 * 60e3; // a signed message is accepted for 10 minutes after it was issued
export const verifyMessage = (wallet, issuedAt) => 'shouldaheld.com wants you to prove you own this Solana wallet.\n\n'
  + `Wallet: ${wallet}\nIssued at: ${issuedAt}\n\nSigning is free. It does not send a transaction or give access to your funds.`;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function verifyWallet(req, env, json) {
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const { wallet, issuedAt, signature } = b ?? {};
  if (!WALLET.test(wallet ?? '')) return json({ error: 'Invalid wallet' }, 400);
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age < FRESH_MS && age > -120e3)) return json({ error: 'The signature expired, try again' }, 400);
  let ok = false;
  try {
    const pub = base58(wallet);
    if (pub.length !== 32) return json({ error: 'Invalid wallet' }, 400);
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(signature), new TextEncoder().encode(verifyMessage(wallet, issuedAt)));
  } catch { ok = false; }
  if (!ok) return json({ error: "The signature doesn't match this wallet" }, 400);

  const meta = JSON.stringify({ app: typeof b.app === 'string' ? b.app.slice(0, 32) : null, country: req.cf?.country });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO verified_wallets (wallet, verified_at, meta) VALUES (?1, ?2, ?3) ON CONFLICT(wallet) DO UPDATE SET verified_at = excluded.verified_at')
      .bind(wallet, now(), meta),
    env.DB.prepare('UPDATE waitlist SET owns_wallet = 2 WHERE wallet = ?1').bind(wallet),
    env.DB.prepare("INSERT INTO events (type, meta, created_at) VALUES ('action', ?1, ?2)").bind(JSON.stringify({ name: 'verified', app: b.app ?? null, country: req.cf?.country }), now()),
  ]);
  return json({ ok: true, verified: true });
}

export const isVerified = (env, wallet) => env.DB.prepare('SELECT 1 FROM verified_wallets WHERE wallet = ?1').bind(wallet).first().then(Boolean);

// Public list for the leaderboard's ✓ badges: owners chose to prove these wallets on the site.
export async function verifiedList(env) {
  const { results } = await env.DB.prepare('SELECT wallet FROM verified_wallets').all();
  return Response.json(results.map(r => r.wallet), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }, // a fresh ✓ shows within a minute
  });
}
