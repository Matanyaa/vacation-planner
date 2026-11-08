// Domain helpers on top of the store: lookups, settings, ledger cache, and the
// plan lifecycle (create, choose, finalize, save-for-reuse, delete).
import { state, put, merge, batch, newId, version } from './store.js';
import { runLedger } from './wallet.js';
import { planSummary } from './calc.js';
import { rateOn } from './rates.js';
import { today } from './util.js';

export const DEFAULT_METHODS = ['flight', 'cruise', 'train', 'bus', 'rental car', 'taxi', 'ferry', 'metro'];
export const BUILTIN_TAGS = ['terminal', 'gratuity'];
export const DEFAULT_TAGS = ['terminal', 'offer-discount'];
export const DEFAULT_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'GEL', 'CHF', 'CZK', 'HUF', 'PLN', 'TRY', 'THB', 'JPY', 'AED', 'CAD', 'AUD'];

export function settings() {
  const s = state.meta.get('settings') || {};
  return {
    methods: s.methods || DEFAULT_METHODS,
    tags: [...new Set([...BUILTIN_TAGS.filter((t) => t !== 'gratuity'), ...(s.tags || DEFAULT_TAGS)])],
    currencies: s.currencies || DEFAULT_CURRENCIES,
    defaultCurrency: s.defaultCurrency || 'ILS',
  };
}
export const saveSettings = (patch) => merge('meta', 'settings', patch);

const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || byCreated(a, b);

export const vacations = () => [...state.vacations.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
export const plansOf = (vid) => [...state.plans.values()].filter((p) => p.vacationId === vid && !p.library).sort(byCreated);
export const libraryPlans = () => [...state.plans.values()].filter((p) => p.library).sort(byCreated);
export const tripOf = (vid) => plansOf(vid).find((p) => p.status === 'trip');
export const entriesOf = (pid) => [...state.entries.values()].filter((e) => e.planId === pid).sort(byDate);
export const txList = () => [...state.tx.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));

let ledgerCache = null; let ledgerVer = -1;
export function ledger() {
  if (ledgerVer !== version()) {
    ledgerCache = runLedger({ tx: [...state.tx.values()], entries: [...state.entries.values()], plans: state.plans, rateOf: rateOn });
    ledgerVer = version();
  }
  return ledgerCache;
}
export const summary = (plan) => planSummary(plan, entriesOf(plan.id), ledger());

export function planStatus(p) {
  if (p.library) return { id: 'saved', label: 'Saved' };
  if (p.status === 'trip') {
    const v = state.vacations.get(p.vacationId);
    if (v?.finalized) return { id: 'final', label: 'Trip' };
    return { id: 'trip', label: p.endDate && p.endDate < today() ? 'Past trip' : 'Trip' };
  }
  return p.hidden ? { id: 'backup', label: 'Backup' } : { id: 'plan', label: 'Plan' };
}

// ---------- lifecycle ----------

export function createVacation(name) {
  const id = newId('vacations');
  put('vacations', id, { name, finalized: false, createdAt: Date.now() });
  return id;
}

/** New plan, optionally pre-filled from the template (dates, flights, sleep). */
export function createPlan(info, { template = true, asTrip = false } = {}) {
  const id = newId('plans'); const now = Date.now();
  const ops = [{ op: 'put', c: 'plans', id, data: { ...info, status: asTrip ? 'trip' : 'plan', hidden: false, library: !!info.library, createdAt: now } }];
  if (asTrip && info.vacationId) {
    for (const p of plansOf(info.vacationId)) if (p.status === 'trip') ops.push({ op: 'merge', c: 'plans', id: p.id, data: { status: 'plan', hidden: true } });
    for (const p of plansOf(info.vacationId)) if (p.status !== 'trip' && !p.hidden) ops.push({ op: 'merge', c: 'plans', id: p.id, data: { hidden: true } });
  }
  if (template) {
    const cur = settings().defaultCurrency;
    const base = { planId: id, currency: cur, tags: [], gratuities: [], payment: { method: 'none' }, kind: 'expense' };
    const tpl = [
      { title: 'Flight out', categories: ['transport'], method: 'flight', date: info.startDate || '' },
      { title: 'Flight back', categories: ['transport'], method: 'flight', date: info.endDate || '' },
      { title: 'Accommodation', categories: ['sleep'], date: info.startDate || '', endDate: info.endDate || '' },
    ];
    tpl.forEach((t, i) => ops.push({ op: 'put', c: 'entries', id: newId('entries'), data: { ...base, ...t, amount: null, createdAt: now + i + 1 } }));
  }
  batch(ops);
  return id;
}

/** Copy a plan + its entries (wallet payment details are stripped; copies are plans). */
export function copyPlan(plan, { vacationId = null, library = false, name } = {}) {
  const id = newId('plans'); const now = Date.now();
  const { id: _, createdAt, hidden, status, ...rest } = plan;
  const ops = [{ op: 'put', c: 'plans', id, data: { ...rest, name: name || plan.name, vacationId, library, status: 'plan', hidden: false, copiedFrom: plan.id, createdAt: now } }];
  entriesOf(plan.id).forEach((e, i) => {
    const { id: __, planId, payment, kind, ...er } = e;
    if (kind === 'refund') return;
    ops.push({ op: 'put', c: 'entries', id: newId('entries'), data: { ...er, planId: id, kind: 'expense', payment: { method: 'none' }, createdAt: now + i + 1 } });
  });
  batch(ops);
  return id;
}

const planDeleteOps = (p) => [
  ...entriesOf(p.id).map((e) => ({ op: 'remove', c: 'entries', id: e.id })),
  { op: 'remove', c: 'plans', id: p.id },
];
export const deletePlan = (p) => batch(planDeleteOps(p));
export function deleteVacation(v) {
  batch([...plansOf(v.id).flatMap(planDeleteOps), { op: 'remove', c: 'vacations', id: v.id }]);
}

/** Make a plan the vacation's trip; every other plan becomes a hidden backup. */
export function choosePlan(plan) {
  const ops = plansOf(plan.vacationId).filter((p) => p.id !== plan.id)
    .map((p) => ({ op: 'merge', c: 'plans', id: p.id, data: { status: 'plan', hidden: true } }));
  ops.push({ op: 'merge', c: 'plans', id: plan.id, data: { status: 'trip', hidden: false } });
  batch(ops);
}
export function unchoosePlan(plan) {
  batch(plansOf(plan.vacationId).map((p) => ({ op: 'merge', c: 'plans', id: p.id, data: { hidden: false, ...(p.id === plan.id ? { status: 'plan' } : {}) } })));
}
/** The trip becomes the vacation; all other plans are erased. */
export function finalizeVacation(v) {
  const trip = tripOf(v.id);
  if (!trip) return;
  batch([
    ...plansOf(v.id).filter((p) => p.id !== trip.id).flatMap(planDeleteOps),
    { op: 'merge', c: 'vacations', id: v.id, data: { finalized: true, tripId: trip.id } },
  ]);
}
