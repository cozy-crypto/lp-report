// Our own cookieless analytics, shared by the receipt (app.js) and the leaderboard (top.js). No IPs, no cookies.
export const BACKEND = location.hostname === 'localhost' ? 'http://127.0.0.1:8788' : 'https://api.shouldaheld.com';
export const params = new URLSearchParams(location.search);
export const REF = /^[A-Za-z0-9]{10}$/.test(params.get('r') ?? '') ? params.get('r') : null; // came from a shared card

// Waitlist referral code from ?j=, kept for later visits in this browser (per-viewer convenience, may be unavailable).
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
if (/^[a-z0-9]{6}$/.test(params.get('j') ?? '')) store.set('referredBy', params.get('j'));
export const referredBy = store.get('referredBy');
// First traffic source this browser came from, so a signup days later still credits the post that brought it.
// Short form for our own posts: ?x=pin means utm_source=x, utm_campaign=pin.
const campaign = params.get('x') || params.get('utm_campaign');
const source = (params.get('x') && 'x') || params.get('utm_source') || (document.referrer && !document.referrer.startsWith(location.origin) && new URL(document.referrer).hostname) || 'direct';
if (!store.get('firstSource')) store.set('firstSource', source);
export const firstSource = store.get('firstSource') ?? source;
// Our own devices: open the site once with ?internal=1 (undo with ?internal=0) and nothing from this browser is counted.
if (params.get('internal')) store.set('internal', params.get('internal') === '1' ? '1' : '');
export const internal = store.get('internal') === '1';

// Sent as text/plain to skip the CORS preflight; failures are ignored.
export const track = (type, data = {}) => internal ? Promise.resolve() : fetch(`${BACKEND}/event`, {
  method: 'POST', keepalive: true, body: JSON.stringify({ type, ref: REF, ...data }),
}).catch(() => {});

export const action = (name, meta = {}) => track('action', { meta: { name, page: location.pathname, ...meta } });

export const trackVisit = page => track('visit', {
  meta: {
    page, from: source, firstSource, campaign, content: params.get('utm_content'),
    referredBy: params.get('j'), mobile: matchMedia('(max-width: 640px)').matches, lang: navigator.language,
  },
});
