import { esc, promptDialog, fmtRange } from '../util.js';
import { vacations, plansOf, tripOf, libraryPlans, createVacation, summary } from '../data.js';
import { money, empty, planCard } from '../ui.js';

export function homeView() {
  const vs = vacations();
  const lib = libraryPlans().length;
  const card = (v) => {
    const plans = plansOf(v.id); const trip = tripOf(v.id);
    let line; let total = '';
    if (trip) {
      const s = summary(trip);
      line = `${v.finalized ? '' : 'Trip: '}${esc(trip.name)} · ${esc(fmtRange(trip.startDate, trip.endDate))}`;
      total = money(s.total, s.estimate);
    } else {
      line = plans.length ? `${plans.length} plan${plans.length > 1 ? 's' : ''}` : 'No plans yet';
    }
    return `<a class="card" href="#/v/${v.id}"><div class="row"><div class="grow">
      <div class="title">${esc(v.name)}</div><div class="muted small">${line}</div></div>${total}</div></a>`;
  };
  return {
    title: 'Vacations', tab: 'home', live: true,
    actions: '<button class="btn primary sm" data-a="newv">+ Vacation</button>',
    html: `${vs.length ? vs.map(card).join('') : empty('No vacations yet. Start one — e.g. "Summer 2027".', '<button class="btn primary" data-a="newv">Create a vacation</button>')}
      <a class="card link-card" href="#/library"><div class="row"><div class="grow"><div class="title">📚 Saved plans</div>
      <div class="muted small">Plans saved for reuse in future vacations</div></div><span class="pill">${lib}</span></div></a>`,
    bind(root) {
      root.querySelectorAll('[data-a="newv"]').forEach((b) => b.addEventListener('click', async () => {
        const name = await promptDialog('New vacation', { placeholder: 'Summer 2027', ok: 'Create' });
        if (name) location.hash = `#/v/${createVacation(name)}`;
      }));
    },
  };
}

export function libraryView() {
  const lib = libraryPlans();
  return {
    title: 'Saved plans', back: '#/', tab: 'home', live: true,
    html: lib.length ? lib.map((p) => planCard(p)).join('') : empty('Nothing saved yet. Open any plan and choose "Save for reuse".'),
  };
}
