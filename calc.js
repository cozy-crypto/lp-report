// Pure math for the honest LP report.

export const num = v => Number(v) || 0;
const unit = (amount, usd) => (amount > 0 ? usd / amount : undefined);

// USD price of each token when a closed position was exited, from that position's own withdrawals.
// A token never paid out was fully swapped away, so price had crossed the range edge (prices are Y per X).
// ponytail: the range edge is a bound, not the exact exit price; exact needs pool OHLCV at close time.
export function exitPrices(pos) {
  let x = unit(pos.withdrawn.x, pos.withdrawnUsd.x);
  let y = unit(pos.withdrawn.y, pos.withdrawnUsd.y);
  if (x === undefined && y !== undefined) x = pos.maxPrice * y;
  if (y === undefined && x !== undefined) y = x / pos.minPrice;
  return { x, y };
}

// LP result vs simply holding the deposited tokens, in USD. Closed positions are valued at their
// exit prices (later market moves are not LP skill), open ones at today's prices.
// Fees are taken in USD when earned: Meteora's per-token fee amounts mix in reward tokens.
// A token with no price (dead or delisted) counts as worth 0.
export function vsHodlUsd(pos, today) {
  const px = pos.open ? today : exitPrices(pos);
  const dx = pos.withdrawn.x + pos.balance.x - pos.deposited.x;
  const dy = pos.withdrawn.y + pos.balance.y - pos.deposited.y;
  return dx * (px.x ?? 0) + dy * (px.y ?? 0) + pos.feesUsd;
}

// Share of earned fees left after price-move costs: 1 = kept all fees, 0 = all eaten, < 0 = lost more than earned.
// ponytail: undefined under $1 of fees; a cent of fees and a lucky exit would otherwise read as 900%.
export const MIN_FEES_USD = 1;
export const feesKept = (lpResult, fees) => (fees >= MIN_FEES_USD ? lpResult / fees : undefined);

// pools: [{ address, name, today: {x, y}, positions: [...] }] → per-pool rows, best first, plus totals.
// PnL in dollars splits into the market (what holding the same tokens would have done) and liquidity (vsHodl).
export function summarize(pools) {
  const rows = pools.map(p => {
    const sum = f => p.positions.reduce((s, q) => s + f(q), 0);
    const open = p.positions.some(q => q.open);
    return {
      address: p.address, name: p.name, open,
      vsHodl: sum(q => vsHodlUsd(q, p.today)),
      feesUsd: sum(q => q.feesUsd), depositedUsd: sum(q => q.depositedUsd), pnlUsd: sum(q => q.pnlUsd),
      priced: !open || (p.today.x !== undefined && p.today.y !== undefined),
    };
  }).filter(r => r.depositedUsd > 0)
    .map(r => ({ ...r, feesKept: feesKept(r.vsHodl, r.feesUsd) }))
    .sort((a, b) => b.vsHodl - a.vsHodl);
  const total = k => rows.reduce((s, r) => s + r[k], 0);
  const vsHodl = total('vsHodl'), feesUsd = total('feesUsd'), pnlUsd = total('pnlUsd');
  return {
    rows,
    vsHodl, feesUsd, pnlUsd, depositedUsd: total('depositedUsd'),
    marketUsd: pnlUsd - vsHodl,
    priceCostUsd: vsHodl - feesUsd,
    feesKept: feesKept(vsHodl, feesUsd),
    unpriced: rows.filter(r => !r.priced).length,
  };
}
