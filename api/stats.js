// Aggregate numbers for the agent farm's strategist (GET /stats) and the admin page. No wallets, emails or handles.
const OK = "json_extract(meta, '$.error') IS NULL";
const day = n => new Date(Date.now() - n * 864e5).toISOString();

export async function buildStats(env) {
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then(r => r.results);
  const since30 = day(30), since7 = day(7);
  const [daily, sources, campaigns, shares, cards, kept, sizes, waitlist, actions, [verified], crawls] = await Promise.all([
    // One row per day: the whole funnel, including the sharing loop.
    q(`SELECT substr(created_at, 1, 10) AS date,
         sum(type = 'visit') AS visits,
         sum(type = 'visit' AND ref IS NOT NULL) AS visitsFromShares,
         sum(type = 'check' AND ${OK}) AS checks,
         count(DISTINCT CASE WHEN type = 'check' AND ${OK} THEN wallet_hash END) AS walletsChecked,
         sum(type = 'check' AND ${OK} AND json_extract(meta, '$.own')) AS typedInChecks, -- address typed by the visitor, not the example or a shared link; NOT proof of ownership
         sum(type = 'action' AND json_extract(meta, '$.name') = 'owner' AND json_extract(meta, '$.mine')) AS saidMine, -- answered "It's mine", unproven
         sum(type = 'action' AND json_extract(meta, '$.name') = 'verified') AS verifiedOwners, -- signed with the wallet: proven
         sum(type = 'check' AND NOT ${OK}) AS failedChecks,
         sum(type = 'share') AS shares,
         count(DISTINCT CASE WHEN type = 'preview' THEN ref END) AS cardsPosted,
         sum(type = 'click') AS shareClicks,
         sum(type = 'signup') AS signups,
         sum(type = 'signup' AND json_extract(meta, '$.referredBy') IS NOT NULL) AS referredSignups,
         round(avg(CASE WHEN type = 'check' AND ${OK} THEN json_extract(meta, '$.ms') END)) AS avgCheckMs
       FROM events WHERE created_at >= ?1 GROUP BY date ORDER BY date DESC`, since30),
    // Where visits came from (utm_source or referrer host), and what they did after.
    q(`SELECT coalesce(json_extract(meta, '$.from'), 'unknown') AS source, count(*) AS visits
       FROM events WHERE type = 'visit' AND created_at >= ?1 GROUP BY source ORDER BY visits DESC LIMIT 20`, since7),
    q(`SELECT json_extract(meta, '$.campaign') AS campaign, count(*) AS visits
       FROM events WHERE type = 'visit' AND json_extract(meta, '$.campaign') IS NOT NULL AND created_at >= ?1
       GROUP BY campaign ORDER BY visits DESC LIMIT 30`, since7),
    // Sharing loop: card kind → was it posted, where, did people click.
    q(`SELECT json_extract(meta, '$.kind') AS kind, count(*) AS shares FROM events
       WHERE type = 'share' AND created_at >= ?1 GROUP BY kind`, since7),
    q(`SELECT s.ref AS card, json_extract(s.meta, '$.kind') AS kind, s.fees_kept AS feesKept,
         (SELECT group_concat(DISTINCT json_extract(p.meta, '$.bot')) FROM events p WHERE p.type = 'preview' AND p.ref = s.ref) AS postedOn,
         (SELECT count(*) FROM events c WHERE c.type = 'click' AND c.ref = s.ref) AS clicks,
         (SELECT count(*) FROM events v WHERE v.type = 'check' AND v.ref = s.ref) AS checksFromCard
       FROM events s WHERE s.type = 'share' AND s.created_at >= ?1 ORDER BY clicks DESC LIMIT 20`, since7),
    q(`SELECT CASE WHEN fees_kept IS NULL THEN 'too few fees' WHEN fees_kept < 0 THEN 'below 0%'
         WHEN fees_kept < 0.5 THEN '0-49%' WHEN fees_kept < 1 THEN '50-99%' ELSE '100%+' END AS bucket,
         count(DISTINCT wallet_hash) AS wallets FROM events WHERE type = 'check' AND ${OK} AND created_at >= ?1 GROUP BY bucket`, since30),
    q(`SELECT CASE WHEN d IS NULL THEN 'unknown' WHEN d < 1000 THEN 'under $1k' WHEN d < 10000 THEN '$1k-10k'
         WHEN d < 100000 THEN '$10k-100k' ELSE '$100k+' END AS bucket, count(DISTINCT wallet_hash) AS wallets
       FROM (SELECT wallet_hash, json_extract(meta, '$.depositedUsd') AS d FROM events
             WHERE type = 'check' AND ${OK} AND created_at >= ?1) GROUP BY bucket`, since30),
    q(`SELECT count(*) AS total, sum(role = 'copy') AS wantCopy, sum(role = 'lead') AS wantLead, sum(role = 'curious') AS curious,
         sum(owns_wallet AND fees_kept >= 0.5 AND fees_usd >= 500) AS leaderCandidates, sum(owns_wallet = 1) AS saidMineUnverified, sum(owns_wallet = 2) AS verified, sum(fees_usd >= 5000 OR deposited_usd >= 50000) AS bigLps,
         sum(referred_by IS NOT NULL) AS referred FROM waitlist`),
    q(`SELECT json_extract(meta, '$.name') AS action, count(*) AS n FROM events
       WHERE type = 'action' AND created_at >= ?1 GROUP BY action ORDER BY n DESC`, since7),
    q(`SELECT count(*) AS n FROM verified_wallets`),
    q(`SELECT date, pools, wallets_found AS walletsFound, crawled, ranked, skipped, failed, seconds FROM crawl_runs
       ORDER BY date DESC LIMIT 7`),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    notes: 'Ownership has three levels, never mix them: typedInChecks = visitor typed the address themselves (not proof); '
      + 'saidMine = answered "It\'s mine" (unproven); verifiedOwners / waitlist.verified / verifiedWallets = signed with the wallet (proven). '
      + 'daily: last 30 days, newest first. sources, campaigns, shares, cards, actions: last 7 days. buckets: last 30 days, unique wallets. '
      + 'cardsPosted = share cards a platform fetched for a preview (the link was posted); postedOn lists where.',
    daily, sources, campaigns, shares, cards, feesKeptBuckets: kept, depositBuckets: sizes, waitlist: Object.fromEntries(Object.entries(waitlist[0]).map(([k, v]) => [k, v ?? 0])), // SQL sum() of no rows is null actions, verifiedWallets: verified.n, crawls,
  };
}
