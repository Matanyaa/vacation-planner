import { state } from '../store.js';
import { auth, signOut } from '../firebase.js';
import { esc, today, fmtRate, promptDialog, toast } from '../util.js';
import { settings, saveSettings, BUILTIN_TAGS } from '../data.js';
import { fetchRate, rateOn } from '../rates.js';
import { APP_VERSION } from '../version.js';
import { field, opts } from '../ui.js';

export function settingsView(_, __, ctx) {
  const s = settings();
  const used = [...new Set([...state.entries.values()].map((e) => e.currency).concat([...state.tx.values()].map((t) => t.currency)).filter((c) => c && c !== 'ILS'))];
  const shown = [...new Set([...used, 'USD', 'EUR'])];
  const list = (kind, items, fixed = []) => `<div class="chips">${items.map((m) => `<span class="chip on">${esc(m)}${fixed.includes(m) ? '' : ` <button class="x" data-del="${kind}" data-v="${esc(m)}" aria-label="Remove ${esc(m)}">✕</button>`}</span>`).join('')}
    <button class="chip add" data-add="${kind}">+ Add</button></div>`;
  const html = `
    <h2 class="section">Transport methods</h2><div class="card">${list('methods', s.methods)}</div>
    <h2 class="section">Tags</h2><div class="card">${list('tags', s.tags, BUILTIN_TAGS)}
      <p class="muted small">"terminal" is built in. "gratuity" is applied automatically to gratuity add-ons.</p></div>
    <h2 class="section">Currencies</h2><div class="card">${list('currencies', s.currencies, ['ILS'])}
      ${field('Default currency for new costs', `<select id="defcur">${opts(s.currencies, s.defaultCurrency)}</select>`)}</div>
    <h2 class="section">Exchange rates today</h2><div class="card list">
      ${shown.map((c) => { const r = rateOn(c, today()); return `<div class="row"><span class="grow">${esc(c)}</span><span>${r ? fmtRate(r.rate) : '—'}</span>
        <span class="muted small rsrc">${r ? esc(r.exact ? r.source : `last known (${r.date})`) : 'not fetched'}</span></div>`; }).join('')}
      <button class="btn sm" data-a="refresh">Refresh rates</button>
      <p class="muted small">Bank of Israel representative rate first; ECB (Frankfurter) and open.er-api as fallbacks. Offline, the last known rate is used and marked as an estimate.</p></div>
    <h2 class="section">App</h2><div class="card">
      <div class="row"><span class="grow">Signed in as ${esc(auth.currentUser?.email || '')}</span><button class="btn sm" data-a="signout">Sign out</button></div>
      <div class="row"><span class="grow">Version ${esc(APP_VERSION)}</span><button class="btn sm" data-a="update">Check for updates</button></div>
      <p class="muted small" id="updstatus"></p></div>`;
  return {
    title: 'Settings', tab: 'settings', live: true, html,
    bind(root) {
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.del; saveSettings({ [k]: s[k].filter((x) => x !== b.dataset.v) });
      }));
      root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
        const k = b.dataset.add;
        let v = await promptDialog(`Add ${k === 'methods' ? 'transport method' : k === 'tags' ? 'tag' : 'currency (3-letter code)'}`, { ok: 'Add' });
        if (!v) return;
        v = k === 'currencies' ? v.toUpperCase() : v.toLowerCase();
        if (k === 'currencies' && !/^[A-Z]{3}$/.test(v)) { toast('Use a 3-letter code, e.g. GEL'); return; }
        if (!s[k].includes(v)) saveSettings({ [k]: [...s[k], v] });
      }));
      root.querySelector('#defcur').addEventListener('change', (e) => saveSettings({ defaultCurrency: e.target.value }));
      root.querySelector('[data-a="refresh"]').addEventListener('click', async () => {
        if (!navigator.onLine) { toast('Offline'); return; }
        const res = await Promise.allSettled(shown.map((c) => fetchRate(c, today())));
        const bad = shown.filter((_, i) => res[i].status === 'rejected');
        toast(bad.length ? `Couldn't fetch: ${bad.join(', ')}` : 'Rates updated');
      });
      root.querySelector('[data-a="signout"]').addEventListener('click', () => signOut());
      root.querySelector('[data-a="update"]').addEventListener('click', () => ctx.checkForUpdate(true));
    },
  };
}
