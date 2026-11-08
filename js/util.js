// Small shared helpers: escaping, dates, number formatting, dialogs, toasts.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());

export function addDays(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Number of calendar days from a to b, counting both ends. null if unknown/invalid. */
export function daysInclusive(a, b) {
  if (!a || !b) return null;
  const n = Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
  return n > 0 ? n : null;
}

export function num(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const SYMBOLS = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
const fmtNum = (n, dec) => n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function fmtILS(n, est = false) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const dec = a < 100 && Math.round(a * 100) % 100 !== 0 ? 2 : 0;
  return (est ? '≈ ' : '') + (n < -0.004 ? '−' : '') + '₪' + fmtNum(a, dec);
}

export function fmtAmt(n, cur) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const dec = Math.round(a * 100) % 100 === 0 ? 0 : 2;
  const sign = n < -0.004 ? '−' : '';
  return SYMBOLS[cur] ? `${sign}${SYMBOLS[cur]}${fmtNum(a, dec)}` : `${sign}${fmtNum(a, dec)} ${cur || ''}`.trim();
}

export const fmtRate = (r) => (r ? (+r).toFixed(4) : '—');

export function fmtDate(s, withYear = true) {
  if (!s) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function fmtRange(a, b) {
  if (!a && !b) return '';
  if (!b || a === b) return fmtDate(a || b);
  if (!a) return '→ ' + fmtDate(b);
  return `${fmtDate(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmtDate(b)}`;
}

/** Read/write nested values by dotted path, e.g. "gratuities.0.amount". */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

export const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ''))];

// ---------- toast ----------
let toastTimer;
export function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- modals (no native alert/confirm/prompt) ----------
export function modal(html, onBind, onDismiss) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = root.firstElementChild;
  const close = () => { root.innerHTML = ''; };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { close(); onDismiss?.(); } });
  onBind?.(backdrop.firstElementChild, close);
  return close;
}

export function confirmDialog(message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    modal(
      `<h3>${esc(title)}</h3><p>${esc(message)}</p>
       <div class="modal-actions"><button class="btn ghost" data-r="0">Cancel</button>
       <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`,
      (m, close) => m.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        close();
        resolve(b.dataset.r === '1');
      }),
      () => resolve(false),
    );
  });
}

export function promptDialog(title, { value = '', placeholder = '', ok = 'Save', label = '' } = {}) {
  return new Promise((resolve) => {
    modal(
      `<h3>${esc(title)}</h3>
       <form class="form" data-f>
         <label class="field">${label ? `<span>${esc(label)}</span>` : ''}
           <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>
         <div class="modal-actions"><button type="button" class="btn ghost" data-r="0">Cancel</button>
         <button class="btn primary">${esc(ok)}</button></div>
       </form>`,
      (m, close) => {
        const f = m.querySelector('[data-f]');
        const input = f.querySelector('input');
        setTimeout(() => { input.focus(); input.select(); }, 30);
        f.addEventListener('submit', (e) => { e.preventDefault(); close(); resolve(input.value.trim() || null); });
        m.querySelector('[data-r="0"]').addEventListener('click', () => { close(); resolve(null); });
      },
      () => resolve(null),
    );
  });
}

/** items: [{id, label, sub}] → resolves chosen id or null */
export function pickDialog(title, items, { empty = 'Nothing here yet.' } = {}) {
  return new Promise((resolve) => {
    modal(
      `<h3>${esc(title)}</h3>
       <div class="pick-list">${items.length ? items.map((it) => `
         <button class="pick" data-id="${esc(it.id)}"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('')
         : `<p class="muted">${esc(empty)}</p>`}</div>
       <div class="modal-actions"><button class="btn ghost" data-r="0">Cancel</button></div>`,
      (m, close) => m.addEventListener('click', (e) => {
        const p = e.target.closest('[data-id]');
        if (p) { close(); resolve(p.dataset.id); return; }
        if (e.target.closest('[data-r]')) { close(); resolve(null); }
      }),
      () => resolve(null),
    );
  });
}
