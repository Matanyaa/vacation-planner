// Compare any mix of plans and trips (any vacation, saved plans, past trips).
import { state } from '../store.js';
import { esc, fmtILS, fmtRange } from '../util.js';
import { vacations, plansOf, libraryPlans, entriesOf, ledger, planStatus } from '../data.js';
import { CATEGORIES, BASES, compare, applyBasis, comboName, catIcon } from '../calc.js';
import { badge, empty } from '../ui.js';

const LS = 'vp-compare';
const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(LS, JSON.stringify({ ids: [...s.ids], cats: s.cats, basis: s.basis })); } catch { /* private mode */ } };
let sel = null;

export function compareView(_, q) {
  if (!sel) { const s = load(); sel = { ids: new Set(s.ids || []), cats: s.cats || [], basis: s.basis || 'total', picking: false }; }
  if (q.get('ids')) { sel.ids = new Set(q.get('ids').split(',')); sel.picking = false; save(sel); history.replaceState(null, '', '#/compare'); }
  for (const id of [...sel.ids]) if (!state.plans.has(id)) sel.ids.delete(id);

  const groups = [
    ...vacations().map((v) => ({ name: v.name, plans: plansOf(v.id) })),
    { name: 'Saved plans', plans: libraryPlans() },
  ].filter((g) => g.plans.length);
  const items = [...sel.ids].map((id) => state.plans.get(id)).map((plan) => ({ plan, entries: entriesOf(plan.id) }));
  const picking = sel.picking || items.length < 2;

  const picker = `<div class="card picker">${groups.length ? groups.map((g) => `<div class="pgroup"><div class="muted small">${esc(g.name)}</div>
    ${g.plans.map((p) => `<label class="check"><input type="checkbox" data-pid="${p.id}" ${sel.ids.has(p.id) ? 'checked' : ''}>
      <span class="grow">${esc(p.name)} <span class="muted small">${esc(fmtRange(p.startDate, p.endDate))}</span></span>${badge(planStatus(p))}</label>`).join('')}</div>`).join('')
    : '<p class="muted">No plans yet.</p>'}
    ${items.length >= 2 ? '<button class="btn primary full" data-a="done">Compare</button>' : '<p class="muted small">Pick at least two.</p>'}</div>`;

  let table = '';
  if (!picking) {
    const res = compare(items, sel.cats, ledger());
    if (!sel.cats.length) res.rows = res.rows.filter((r) => r.values.some((v) => Math.abs(v) > 0.005));
    const cell = (v, i, est) => {
      const c = res.cols[i]; const x = applyBasis(v, sel.basis, c.summary.days, c.summary.travelers);
      return `<td class="${est ? 'est' : ''}">${x == null ? '<span class="muted">no dates</span>' : fmtILS(x, est)}</td>`;
    };
    const min = Math.min(...res.totals.map((v, i) => applyBasis(v, sel.basis, res.cols[i].summary.days, res.cols[i].summary.travelers) ?? Infinity));
    const notes = res.rows.filter((r) => r.merged && r.notes.length);
    table = `<div class="table-wrap"><table class="cmp">
      <thead><tr><th></th>${res.cols.map((c) => `<th><a href="#/p/${c.plan.id}">${esc(c.plan.name)}</a><div class="muted small">${c.summary.days ? `${c.summary.days}d` : '—'} · ${c.summary.travelers}p</div></th>`).join('')}</tr></thead>
      <tbody>${res.rows.map((r) => `<tr><th>${r.cats.map(catIcon).join('')} ${esc(comboName(r.cats))}${r.merged ? '<sup>*</sup>' : ''}</th>${r.values.map((v, i) => cell(v, i, r.estimates[i])).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th>${res.totals.map((v, i) => {
        const x = applyBasis(v, sel.basis, res.cols[i].summary.days, res.cols[i].summary.travelers);
        return `<td class="${x === min && res.cols.length > 1 ? 'best' : ''}">${x == null ? '—' : fmtILS(x, res.totalEst[i])}</td>`;
      }).join('')}</tr></tfoot></table></div>
      ${notes.length ? `<div class="card notes small"><b>* Merged categories</b>${notes.map((r) => `<p>${esc(comboName(r.cats))} are shown together because some payments cover several of them, so they can't be split fairly:
        ${r.notes.map((n) => `<br>· "${esc(n.title)}" in ${esc(n.plan)} (${esc(comboName(n.cats))})`).join('')}</p>`).join('')}</div>` : ''}
      <button class="btn ghost full" data-a="pick">Change what's compared</button>`;
  }

  const html = `
    <div class="seg wrap">${BASES.map((b) => `<button data-basis="${b.id}" class="${sel.basis === b.id ? 'on' : ''}">${esc(b.label)}</button>`).join('')}</div>
    <div class="chips cats"><button class="chip${!sel.cats.length ? ' on' : ''}" data-cat="">All</button>${CATEGORIES.map((c) => `<button class="chip${sel.cats.includes(c.id) ? ' on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>
    ${picking ? picker : table}
    ${!groups.length ? empty('Create plans in a vacation to compare them.') : ''}`;

  return {
    title: 'Compare', tab: 'compare', live: true, html,
    bind(root, rerender) {
      const upd = () => { save(sel); rerender(); };
      root.querySelectorAll('[data-basis]').forEach((b) => b.addEventListener('click', () => { sel.basis = b.dataset.basis; upd(); }));
      root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
        const c = b.dataset.cat;
        sel.cats = !c ? [] : sel.cats.includes(c) ? sel.cats.filter((x) => x !== c) : [...sel.cats, c];
        upd();
      }));
      root.querySelectorAll('[data-pid]').forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) sel.ids.add(cb.dataset.pid); else sel.ids.delete(cb.dataset.pid);
        sel.picking = true; upd();
      }));
      root.querySelector('[data-a="done"]')?.addEventListener('click', () => { sel.picking = false; upd(); });
      root.querySelector('[data-a="pick"]')?.addEventListener('click', () => { sel.picking = true; upd(); });
    },
  };
}
