// POST /crawl from the daily GitHub Actions crawl (CRAWL_KEY): stores the run and every crawled wallet,
// sent in chunks so one request stays small. Re-sending a day overwrites that day.
import { WALLET, num, now } from './util.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = ['ok', 'skipped', 'failed'];
const int = v => (Number.isInteger(v) ? v : null);

export async function saveCrawl(req, env, json) {
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!DAY.test(b.date ?? '')) return json({ error: 'Invalid date' }, 400);
  const wallets = Array.isArray(b.wallets) ? b.wallets.filter(w => WALLET.test(w.w ?? '') && STATUS.includes(w.status)) : [];
  if (wallets.length > 200) return json({ error: 'Send at most 200 wallets per request' }, 400);

  const stmts = wallets.map(w => env.DB.prepare(
    `INSERT OR REPLACE INTO wallet_days (date, wallet, status, ranked, rank, fees_kept, fees_usd, lp_usd, pnl_usd, deposited_usd,
       pools, positions, open_positions, rows, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
  ).bind(b.date, w.w, w.status, w.ranked ? 1 : 0, int(w.rank), num(w.k), num(w.fees), num(w.lp), num(w.pnl), num(w.dep),
    int(w.pools), int(w.pos), int(w.open), Array.isArray(w.rows) ? JSON.stringify(w.rows) : null,
    typeof w.error === 'string' ? w.error.slice(0, 200) : null));
  const r = b.run;
  if (r && typeof r === 'object') stmts.push(env.DB.prepare(
    `INSERT OR REPLACE INTO crawl_runs (date, pools, wallets_found, crawled, ranked, skipped, failed, seconds, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(b.date, int(r.pools), int(r.walletsFound), int(r.crawled), int(r.ranked), int(r.skipped), int(r.failed), int(r.seconds), now()));
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, saved: wallets.length });
}
