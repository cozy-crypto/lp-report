// Shared by every route of the Worker.

export const SITE = 'https://shouldaheld.com';
export const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const now = () => new Date().toISOString();

// Funnel events keep a short hash instead of the wallet, enough to count unique wallets.
export async function hashWallet(wallet) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wallet));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v ?? 0)).toLocaleString('en-US');
export const pct = k => (k == null ? '—' : `${Math.round(k * 100)}%`);
export const kept = k => (k == null ? '—' : k > 1 ? '100%+' : pct(k)); // see format.js on the site
