import { state, merge } from '../store.js';
import { esc, fmtILS, fmtAmt, fmtDate, fmtRange, confirmDialog, pickDialog, toast } from '../util.js';
import {
  entriesOf, summary, planStatus, choosePlan, unchoosePlan, copyPlan, deletePlan, vacations, tripOf,
} from '../data.js';
import { catIcon, comboName, entryCats, totalAmount, payLabel, catName } from '../calc.js';
import { money, badge, empty } from '../ui.js';
import { today } from '../util.js';

export function planView({ id }) {
  const p = state.plans.get(id);
  if (!p) return null;
  const v = p.vacationId ? state.vacations.get(p.vacationId) : null;
  const s = summary(p);
  const st = planStatus(p);
  const entries = entriesOf(id);
  const isTrip = p.status === 'trip';
  const per = (div) => (div ? fmtILS(s.total / div, s.estimate) : '—');

  const entryRow = (e) => {
    const c = s.byEntry.get(e.id);
    const cats = entryCats(e);
    const amt = totalAmount(e, p);
    const bits = [
      e.date ? fmtDate(e.date, false) + (e.endDate && e.endDate !== e.date ? ' – ' + fmtDate(e.endDate, false) : '') : '',
      e.method && cats.includes('transport') ? e.method : '',
      e.meal || '',
      e.connection?.on ? `connection · ${(e.connection.legs || []).length} legs` : '',
      isTrip ? payLabel(e.payment?.method || 'none').split(' (')[0] : '',
    ].filter(Boolean).join(' · ');
    const tags = [...(e.tags || []), ...((e.gratuities || []).length ? ['+gratuity'] : [])];
    return `<a class="entry${e.kind === 'refund' ? ' refund' : ''}" href="#/e/${id}/${e.id}">
      <div class="icons">${cats.map(catIcon).join('')}</div>
      <div class="grow"><div class="title">${e.kind === 'refund' ? '↩ ' : ''}${esc(e.title || comboName(cats))}</div>
        <div class="muted small">${esc(bits)}</div>
        ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}</div>
      <div class="right">${c.empty ? '<span class="muted">—</span>' : money(c.ils, c.estimate)}
        ${!c.empty && (e.currency || 'ILS') !== 'ILS' ? `<div class="muted small">${fmtAmt(amt, e.currency)}</div>` : ''}</div>
    </a>`;
  };

  const back = p.library ? '#/library' : `#/v/${p.vacationId}`;
  const actions = [];
  if (!p.library) {
    if (!isTrip) actions.push('<button class="btn primary" data-a="choose">Choose as the trip</button>');
    else if (!v?.finalized) actions.push('<button class="btn" data-a="unchoose">Back to planning</button>');
    actions.push('<button class="btn" data-a="dup">Duplicate</button>');
  } else {
    actions.push('<button class="btn primary" data-a="use">Use in a vacation…</button>');
  }
  actions.push('<button class="btn" data-a="save">Save for reuse</button>');

  const html = `
    <div class="card info">
      <div class="row"><div class="grow"><div class="muted small">${esc((p.destinations || []).join(', ') || 'No destination yet')}</div>
        <div>${esc(fmtRange(p.startDate, p.endDate) || 'No dates yet')}${s.days ? ` · ${s.days} days` : ''} · ${s.travelers} traveler${s.travelers > 1 ? 's' : ''}</div></div>
        ${badge(st)}</div>
      <a class="small" href="#/pi/${id}">Edit details</a>
    </div>
    <div class="card totals">
      <div class="big">${money(s.total, s.estimate)}</div>
      <div class="grid4">
        <div><small>Per person</small>${per(s.travelers)}</div>
        <div><small>Per day</small>${per(s.days)}</div>
        <div><small>Per person / day</small>${per(s.days && s.days * s.travelers)}</div>
      </div>
      ${s.estimate ? `<p class="muted small">≈ includes estimates${isTrip ? ' (unpaid items, unsettled charges or offline rates)' : ' (current exchange rates)'}.</p>` : ''}
      ${s.missing ? '<p class="warn small">Some foreign amounts have no exchange rate yet — connect to the internet to fetch them.</p>' : ''}
    </div>
    ${s.byCombo.length ? `<h2 class="section">By category</h2><div class="card list">${s.byCombo.map((g) => `
      <div class="row"><span class="grow">${g.cats.map(catIcon).join('')} ${esc(comboName(g.cats))}${g.cats.length > 1 ? ' <span class="muted small">(bundled)</span>' : ''}</span>${money(g.ils, g.estimate)}</div>`).join('')}</div>` : ''}
    ${s.byTag.length ? `<h2 class="section">By tag</h2><div class="card list">${s.byTag.map(([t, ils]) => `
      <div class="row"><span class="grow"><span class="tag">${esc(t)}</span></span>${money(ils, false)}</div>`).join('')}</div>` : ''}
    <h2 class="section">${isTrip ? 'Expenses' : 'Costs'} <span class="muted small">${entries.length}</span></h2>
    ${entries.length ? `<div class="entries">${entries.map(entryRow).join('')}</div>` : empty('Nothing here yet.')}
    <a class="btn primary full" href="#/e/${id}/new">+ Add ${isTrip ? 'expense' : 'cost'}</a>
    <div class="btn-row">${actions.join('')}</div>
    <div class="btn-row muted-actions"><button class="btn ghost sm danger-text" data-a="delete">Delete ${p.library ? 'saved plan' : st.label.toLowerCase()}</button></div>`;

  return {
    title: p.name || 'Untitled', back, tab: 'home', live: true, html,
    bind(root) {
      const on = (a, fn) => root.querySelector(`[data-a="${a}"]`)?.addEventListener('click', fn);
      on('choose', async () => {
        const cur = tripOf(p.vacationId);
        const msg = cur ? `"${cur.name}" is currently the trip — it becomes a hidden backup plan (its payments stop counting in the wallet).` : 'Other plans become hidden backups. You can still go back to planning.';
        if (await confirmDialog(msg, { ok: 'Choose', title: `Make "${p.name}" the trip?` })) { choosePlan(p); toast('This is now the trip'); }
      });
      on('unchoose', async () => {
        if (await confirmDialog('The trip goes back to being a plan. Its wallet payments stop counting until it is chosen again.', { ok: 'Back to planning' })) unchoosePlan(p);
      });
      on('dup', () => { const nid = copyPlan(p, { vacationId: p.vacationId, name: `${p.name} (copy)` }); location.hash = `#/p/${nid}`; });
      on('save', () => { copyPlan(p, { library: true }); toast('Saved to "Saved plans"'); });
      on('use', async () => {
        const items = vacations().filter((x) => !x.finalized).map((x) => ({ id: x.id, label: x.name }));
        const vid = await pickDialog('Add to which vacation?', items, { empty: 'No open vacations.' });
        if (vid) { const nid = copyPlan(p, { vacationId: vid }); location.hash = `#/p/${nid}`; }
      });
      on('delete', async () => {
        if (await confirmDialog(`Delete "${p.name}" and its ${entries.length} entries?`, { ok: 'Delete', danger: true })) {
          deletePlan(p); location.hash = back;
        }
      });
    },
  };
}

// Plan details editor (also used to create plans). Route: #/pi/<id|new>?v=<vacationId>&trip=1
import { createPlan } from '../data.js';
import { field } from '../ui.js';

export function planInfoView({ id }, q) {
  const isNew = id === 'new';
  const p = isNew ? { vacationId: q.get('v'), name: '', destinations: [], startDate: '', endDate: '', travelers: 2 } : state.plans.get(id);
  if (!p) return null;
  const asTrip = q.get('trip') === '1';
  const back = isNew ? `#/v/${p.vacationId}` : `#/p/${id}`;
  const html = `<form class="form" id="pf">
    ${field('Name', `<input name="name" required value="${esc(p.name)}" placeholder="${asTrip ? 'Rome, May 2025' : 'Greek islands cruise'}">`)}
    ${field('Destination(s)', `<input name="destinations" value="${esc((p.destinations || []).join(', '))}" placeholder="Athens, Santorini">`, 'Comma-separated')}
    <div class="two">${field('Start', `<input type="date" name="startDate" value="${esc(p.startDate)}">`)}
    ${field('End', `<input type="date" name="endDate" value="${esc(p.endDate)}">`)}</div>
    ${field('Travelers', `<input type="number" name="travelers" min="1" step="1" inputmode="numeric" value="${esc(p.travelers ?? 2)}">`)}
    ${isNew ? `<label class="check"><input type="checkbox" name="template" checked> Start from template (flights out/back + accommodation)</label>
      ${asTrip ? '<p class="muted small">Created directly as the trip — for one already happening or in the past.</p>' : ''}` : ''}
    <button class="btn primary full">${isNew ? `Create ${asTrip ? 'trip' : 'plan'}` : 'Save'}</button>
  </form>`;
  return {
    title: isNew ? (asTrip ? 'New trip' : 'New plan') : 'Plan details', back, tab: 'home', html,
    bind(root) {
      root.querySelector('#pf').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const info = {
          name: f.get('name').trim(),
          destinations: f.get('destinations').split(',').map((x) => x.trim()).filter(Boolean),
          startDate: f.get('startDate'), endDate: f.get('endDate'),
          travelers: Math.max(1, parseInt(f.get('travelers'), 10) || 1),
        };
        if (info.startDate && info.endDate && info.endDate < info.startDate) { toast('End date is before the start date'); return; }
        if (isNew) {
          const nid = createPlan({ ...info, vacationId: p.vacationId }, { template: f.get('template') === 'on', asTrip });
          location.hash = `#/p/${nid}`;
        } else {
          merge('plans', id, info);
          location.hash = back;
        }
      });
    },
  };
}
