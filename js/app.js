import { auth, onAuthStateChanged, signIn } from './firebase.js';
import { state, start, stop, onChange, setErrorHandler, merge } from './store.js';
import { esc, toast } from './util.js';
import { setRateProvider } from './calc.js';
import { rateOn, currentRate, officialRate } from './rates.js';
import { APP_VERSION } from './version.js';
import { homeView, libraryView } from './views/home.js';
import { vacationView } from './views/vacation.js';
import { planView, planInfoView } from './views/plan.js';
import { entryView } from './views/entry.js';
import { walletView, txView } from './views/wallet.js';
import { compareView } from './views/compare.js';
import { settingsView } from './views/settings.js';

setRateProvider((cur, date) => (date ? rateOn(cur, date) : currentRate(cur)));
setErrorHandler((e) => { console.error(e); toast(e.code === 'permission-denied' ? 'Permission denied — are the Firestore rules deployed?' : `Error: ${e.message || e}`); });

const ROUTES = [
  [/^$/, homeView],
  [/^library$/, libraryView],
  [/^v\/([^/]+)$/, vacationView, ['id']],
  [/^p\/([^/]+)$/, planView, ['id']],
  [/^pi\/([^/]+)$/, planInfoView, ['id']],
  [/^e\/([^/]+)\/([^/]+)$/, entryView, ['planId', 'id']],
  [/^wallet$/, walletView],
  [/^tx\/([^/]+)$/, txView, ['id']],
  [/^compare$/, compareView],
  [/^settings$/, settingsView],
];

const root = document.getElementById('app');
let current = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path, q: new URLSearchParams(qs || '') };
}

const TABS = [['home', '#/', 'Trips', '🧳'], ['wallet', '#/wallet', 'Wallet', '👛'], ['compare', '#/compare', 'Compare', '⚖️'], ['settings', '#/settings', 'Settings', '⚙️']];

function render({ keepScroll = false } = {}) {
  if (!state.ready) return;
  const { path, q } = parseHash();
  let view = null;
  for (const [re, fn, names = []] of ROUTES) {
    const m = path.match(re);
    if (m) { const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])); view = fn(params, q, ctx); break; }
  }
  if (!view) view = { title: 'Not found', back: '#/', html: '<p class="muted">This item no longer exists.</p><a class="btn" href="#/">Home</a>' };
  current = view;
  const y = window.scrollY;
  root.innerHTML = `
    <header class="top"><div class="bar">
      ${view.back ? `<a class="back" href="${view.back}" aria-label="Back">‹</a>` : '<span class="logo">🌍</span>'}
      <h1>${esc(view.title)}</h1><div class="actions">${view.actions || ''}</div></div>
      <div id="offline" class="offline" ${navigator.onLine ? 'hidden' : ''}>Offline — changes sync when you're back online</div></header>
    <main>${view.html}</main>
    <nav class="tabs">${TABS.map(([id, href, label, icon]) => `<a href="${href}" class="${view.tab === id ? 'on' : ''}"><span>${icon}</span>${label}</a>`).join('')}</nav>`;
  view.bind?.(root, () => render({ keepScroll: true }));
  window.scrollTo(0, keepScroll ? y : 0);
}

onChange(() => { if (current?.live) render({ keepScroll: true }); });
window.addEventListener('hashchange', () => render());
const setOffline = () => { const el = document.getElementById('offline'); if (el) el.hidden = navigator.onLine; };
window.addEventListener('online', () => { setOffline(); sweepEstimatedRates(); });
window.addEventListener('offline', setOffline);

// ---------- auth ----------
function signInScreen(msg = '') {
  root.innerHTML = `<div class="signin"><div class="logo-big">🌍</div><h1>Vacation Planner</h1>
    <p class="muted">Plan by cost, compare options, track real spending in ₪.</p>
    <button class="btn primary" id="gsign">Sign in with Google</button>
    ${msg ? `<p class="warn small">${esc(msg)}</p>` : ''}<p class="muted small">${esc(APP_VERSION)}</p></div>`;
  document.getElementById('gsign').addEventListener('click', async () => {
    try { await signIn(); } catch (e) { signInScreen(e.code === 'auth/unauthorized-domain' ? 'This domain is not authorized in Firebase Auth settings.' : (e.message || String(e))); }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { stop(); current = null; signInScreen(); return; }
  root.innerHTML = '<div class="loading">Loading…</div>';
  await start(user.uid);
  render();
  sweepEstimatedRates();
});

// Entries/transactions saved offline used the last known rate. Replace with that day's rate once online.
let sweeping = false;
async function sweepEstimatedRates() {
  if (sweeping || !navigator.onLine || !state.ready) return;
  sweeping = true;
  try {
    for (const e of state.entries.values()) {
      if (!e.officialRateEstimate || !e.currency || e.currency === 'ILS') continue;
      const r = await officialRate(e.currency, e.date || state.plans.get(e.planId)?.startDate);
      if (r.rate && !r.estimate) merge('entries', e.id, { officialRate: r.rate, officialRateEstimate: false, officialRateSource: r.source });
    }
    for (const t of state.tx.values()) {
      if (!t.ratesEstimate) continue;
      const rates = { ...(t.rates || {}) }; let ok = true;
      for (const c of [t.currency, t.fromCurrency, t.toCurrency, t.sourceCurrency]) {
        if (!c || c === 'ILS') continue;
        const r = await officialRate(c, t.date);
        if (r.rate && !r.estimate) rates[c] = r.rate; else ok = false;
      }
      merge('tx', t.id, { rates, ratesEstimate: !ok });
    }
  } finally { sweeping = false; }
}

// ---------- updates: prompt, never auto-refresh ----------
async function checkForUpdate(manual = false) {
  const status = document.getElementById('updstatus');
  try {
    const res = await fetch(`./version.json?_=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    if (version === APP_VERSION) { if (manual && status) status.textContent = `Up to date (${APP_VERSION}).`; return; }
    if (!manual && sessionStorage.getItem('vp-dismissed') === version) return;
    const b = document.getElementById('update-banner');
    b.hidden = false;
    b.querySelector('[data-u="reload"]').onclick = async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
      location.reload();
    };
    b.querySelector('[data-u="later"]').onclick = () => { b.hidden = true; sessionStorage.setItem('vp-dismissed', version); };
    if (status) status.textContent = '';
  } catch {
    if (manual && status) status.textContent = "Couldn't check — you may be offline.";
  }
}
const ctx = { checkForUpdate };
checkForUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
