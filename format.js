// Number formatting shared by the receipt (app.js) and the leaderboard (top.js).
export const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
export const signed = v => (v >= 0 ? '+' : '') + usd(v);
export const pct = k => (k == null ? '—' : `${Math.round(k * 100)}%`);
// Fees kept above 100% means liquidity beat holding by more than its fees: a price bet that paid off, not fee
// skill. The exact ratio (1843%) only says how small the fees were, so it's shown as 100%+.
export const kept = k => (k == null ? '—' : k > 1 ? '100%+' : pct(k));
export const tone = v => (v >= 0 ? 'good' : 'bad');
