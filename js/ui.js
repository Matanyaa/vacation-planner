// Shared view helpers: small HTML builders and a tiny form binder.
import { esc, setPath, fmtILS, fmtRange } from './util.js';
import { planStatus, summary } from './data.js';

export const opts = (list, value) => list.map((o) => {
  const id = typeof o === 'string' ? o : o.id; const label = typeof o === 'string' ? o : o.label;
  return `<option value="${esc(id)}"${String(id) === String(value ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
}).join('');

export const field = (label, input, hint = '') =>
  `<label class="field"><span>${esc(label)}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;

export const money = (ils, est) => `<span class="money${est ? ' est' : ''}">${fmtILS(ils, est)}</span>`;

export const badge = (status) => `<span class="badge b-${status.id}">${esc(status.label)}</span>`;

export function planCard(p) {
  const s = summary(p);
  const meta = [fmtRange(p.startDate, p.endDate), s.days ? `${s.days} days` : '', `${s.travelers} traveler${s.travelers > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  const ppd = s.days ? fmtILS(s.total / (s.days * s.travelers), s.estimate) + ' /person/day' : '';
  return `<a class="card plan-card" href="#/p/${p.id}">
    <div class="row"><div class="grow"><div class="title">${esc(p.name || 'Untitled')}</div>
      <div class="muted small">${esc((p.destinations || []).join(', '))}</div></div>${badge(planStatus(p))}</div>
    <div class="row end"><div class="muted small grow">${esc(meta)}</div>
      <div class="right">${money(s.total, s.estimate)}${ppd ? `<div class="muted small">${ppd}</div>` : ''}</div></div>
  </a>`;
}

export const empty = (text, cta = '') => `<div class="empty"><p>${text}</p>${cta}</div>`;

/**
 * Binds a form to a mutable draft object. Inputs use name="dotted.path".
 * Elements with data-rr re-render the form on change; [data-act] buttons call actions[act]
 * (return false to skip the re-render).
 */
export function bindForm(form, draft, { render, actions = {}, submit, onInput }) {
  const rr = () => { form.innerHTML = render(); onInput?.(); };
  const setFrom = (t) => {
    if (!t.name || t.type === 'submit') return;
    setPath(draft, t.name, t.type === 'checkbox' ? t.checked : t.value);
  };
  form.addEventListener('input', (ev) => { setFrom(ev.target); onInput?.(); });
  form.addEventListener('change', (ev) => { setFrom(ev.target); if (ev.target.hasAttribute('data-rr')) rr(); else onInput?.(); });
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || !form.contains(b)) return;
    ev.preventDefault();
    const fn = actions[b.dataset.act];
    if (fn && fn(b.dataset, b) !== false) rr();
  });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
  rr();
  return rr;
}
