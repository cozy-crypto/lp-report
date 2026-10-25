// Share links: the site uploads the receipt card it drew, gets r.shouldaheld.com/<id> back,
// and that page carries the card as its X preview before sending visitors to the report.
import { SITE, WALLET, num, now, hashWallet, esc, usd, pct } from './util.js';

const ID = /^[A-Za-z0-9]{10}$/;
const MAX_PNG = 400_000;

export async function saveCard(req, env, json, base) {
  const q = new URL(req.url).searchParams;
  const wallet = q.get('wallet') ?? '';
  if (!WALLET.test(wallet)) return json({ error: 'Invalid wallet' }, 400);

  // Only accept the 1200×630 PNG the site draws (width and height sit in the IHDR chunk).
  // ponytail: anyone can still upload some 1200×630 PNG via curl; render cards server-side if that gets abused.
  const png = new Uint8Array(await req.arrayBuffer());
  const view = new DataView(png.buffer);
  const isCard = png.length > 24 && png.length < MAX_PNG && view.getUint32(0) === 0x89504e47
    && view.getUint32(16) === 1200 && view.getUint32(20) === 630;
  if (!isCard) return json({ error: 'Invalid card' }, 400);

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const feesKept = num(Number.parseFloat(q.get('k'))), lpUsd = num(Number.parseFloat(q.get('lp')));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO cards (id, wallet, fees_kept, lp_usd, png, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, wallet, feesKept, lpUsd, png, now()),
    env.DB.prepare('INSERT INTO events (type, wallet_hash, fees_kept, ref, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind('share', await hashWallet(wallet), feesKept, id, now()),
  ]);
  return json({ url: `${base}/${id}` });
}

export async function sharePage(env, id, base) {
  const card = ID.test(id) && await env.DB.prepare('SELECT wallet, fees_kept, lp_usd FROM cards WHERE id = ?1').bind(id).first();
  if (!card) return Response.redirect(SITE, 302);
  const target = `${SITE}/?wallet=${card.wallet}&r=${id}`;
  const title = card.fees_kept == null
    ? `Liquidity earned me ${usd(card.lp_usd)} after price moves`
    : `I kept ${pct(card.fees_kept)} of my LP fees after price moves`;
  const desc = 'Your PnL includes the market. See what providing liquidity actually earned you.';
  const image = `${base}/${id}.png`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — Shoulda Held?</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(`${base}/${id}`)}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@shouldaheld">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><a href="${esc(target)}">See the receipt</a></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

export async function cardImage(env, id) {
  const card = ID.test(id) && await env.DB.prepare('SELECT png FROM cards WHERE id = ?1').bind(id).first();
  if (!card) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(card.png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
