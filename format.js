// Number formatting shared by the receipt (app.js) and the leaderboard (top.js).
export const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
export const signed = v => (v >= 0 ? '+' : '') + usd(v);
export const pct = k => (k == null ? '—' : `${Math.round(k * 100)}%`);
export const tone = v => (v >= 0 ? 'good' : 'bad');
