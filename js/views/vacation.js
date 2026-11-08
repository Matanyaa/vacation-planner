import { state } from '../store.js';
import { esc, promptDialog, confirmDialog, pickDialog, toast, fmtRange } from '../util.js';
import { plansOf, tripOf, libraryPlans, copyPlan, deleteVacation, finalizeVacation } from '../data.js';
import { planCard, empty } from '../ui.js';
import { merge } from '../store.js';

export function vacationView({ id }) {
  const v = state.vacations.get(id);
  if (!v) return null;
  const plans = plansOf(id);
  const trip = tripOf(id);
  const visible = plans.filter((p) => p.status !== 'trip' && !p.hidden);
  const backups = plans.filter((p) => p.status !== 'trip' && p.hidden);
  const compareIds = plans.map((p) => p.id).join(',');

  const html = `
    ${v.finalized ? '<p class="muted small">Finalized — the trip is the vacation. Other plans were erased.</p>' : ''}
    ${trip ? `<h2 class="section">Trip</h2>${planCard(trip)}` : ''}
    ${!v.finalized ? `
      <h2 class="section">Plans</h2>
      ${visible.length ? visible.map(planCard).join('') : (trip ? '' : empty('No plans yet. Build a few options to compare, even rough ones.'))}
      ${backups.length ? `<details class="backups"><summary>Backup plans (${backups.length})</summary>${backups.map(planCard).join('')}</details>` : ''}
      <div class="btn-row">
        <a class="btn primary" href="#/pi/new?v=${id}">+ New plan</a>
        <button class="btn" data-a="fromlib">+ From saved plan</button>
        <a class="btn" href="#/pi/new?v=${id}&trip=1">+ Past / current trip</a>
      </div>
      ${plans.length > 1 ? `<a class="btn ghost full" href="#/compare?ids=${compareIds}">Compare these plans</a>` : ''}
      ${trip ? '<button class="btn ghost full" data-a="finalize">Finalize vacation…</button>' : ''}
    ` : ''}
    <div class="btn-row muted-actions">
      <button class="btn ghost sm" data-a="rename">Rename</button>
      <button class="btn ghost sm danger-text" data-a="delete">Delete vacation</button>
    </div>`;

  return {
    title: v.name, back: '#/', tab: 'home', live: true, html,
    bind(root) {
      const on = (a, fn) => root.querySelector(`[data-a="${a}"]`)?.addEventListener('click', fn);
      on('rename', async () => { const n = await promptDialog('Rename vacation', { value: v.name }); if (n) merge('vacations', id, { name: n }); });
      on('delete', async () => {
        if (await confirmDialog(`Delete "${v.name}" with all its plans and expenses? Wallet transactions are kept.`, { ok: 'Delete', danger: true })) {
          deleteVacation(v); location.hash = '#/';
        }
      });
      on('fromlib', async () => {
        const items = libraryPlans().map((p) => ({ id: p.id, label: p.name, sub: [(p.destinations || []).join(', '), fmtRange(p.startDate, p.endDate)].filter(Boolean).join(' · ') }));
        const pid = await pickDialog('Bring in a saved plan', items, { empty: 'No saved plans yet.' });
        if (pid) { const nid = copyPlan(state.plans.get(pid), { vacationId: id }); toast('Plan added'); location.hash = `#/p/${nid}`; }
      });
      on('finalize', async () => {
        const n = plans.length - 1;
        if (await confirmDialog(`"${trip.name}" becomes the vacation itself.${n ? ` The other ${n} plan${n > 1 ? 's' : ''} will be erased (save any you want to reuse first).` : ''}`, { ok: 'Finalize', danger: n > 0, title: 'Finalize vacation?' })) {
          finalizeVacation(v); toast('Vacation finalized');
        }
      });
    },
  };
}
