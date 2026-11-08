// Pure cost calculations: categories, gratuity, per-entry ₪ cost, plan totals, comparison.
// No Firebase imports, so it can be unit-tested in Node. Current rates are injected
// via setRateProvider().
import { num, daysInclusive } from './util.js';

export const CATEGORIES = [
  { id: 'transport', name: 'Transportation', icon: '✈️' },
  { id: 'food', name: 'Food', icon: '🍽️' },
  { id: 'sleep', name: 'Sleep', icon: '🛏️' },
  { id: 'attractions', name: 'Attractions', icon: '🎟️' },
  { id: 'insurance', name: 'Insurance', icon: '🛡️' },
  { id: 'visa', name: 'Visa / documents', icon: '🛂' },
  { id: 'connectivity', name: 'Connectivity', icon: '📶' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️' },
  { id: 'other', name: 'Other', icon: '📦' },
];
export const CAT_IDS = CATEGORIES.map((c) => c.id);
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

const catIndex = (id) => { const i = CAT_IDS.indexOf(id); return i < 0 ? 99 : i; };
export const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name || id;
export const catIcon = (id) => CATEGORIES.find((c) => c.id === id)?.icon || '•';
export const sortCats = (cats) => [...new Set(cats)].sort((a, b) => catIndex(a) - catIndex(b));
export const entryCats = (e) => { const c = (e.categories || []).filter((x) => CAT_IDS.includes(x)); return c.length ? sortCats(c) : ['other']; };
export const comboName = (cats) => cats.map(catName).join(' + ');

/** rateProvider(cur, date?) → {rate, exact} | null. date omitted = current rate. */
let rateProvider = () => null;
export function setRateProvider(fn) { rateProvider = fn; }

export const planDays = (p) => daysInclusive(p.startDate, p.endDate);
export const travelersOf = (p) => Math.max(1, num(p?.travelers) || 1);

export const GRATUITY_TYPES = [
  { id: 'fixed', label: 'Fixed amount' },
  { id: 'percent', label: '% of the expense' },
  { id: 'ppd', label: 'Per person per day' },
];

export function gratuityItems(e, plan) {
  const base = num(e.amount) || 0;
  return (e.gratuities || []).map((g) => {
    let value = 0;
    if (g.type === 'percent') value = (base * (num(g.pct) || 0)) / 100;
    else if (g.type === 'ppd') {
      const persons = num(g.persons) ?? travelersOf(plan);
      const days = num(g.days) ?? daysInclusive(g.from, g.to) ?? 0;
      value = (num(g.amount) || 0) * persons * days;
    } else value = num(g.amount) || 0;
    return { ...g, value };
  });
}
export const gratuityTotal = (e, plan) => gratuityItems(e, plan).reduce((s, g) => s + g.value, 0);
/** Amount in the entry's own currency, including gratuity add-ons. */
export const totalAmount = (e, plan) => (num(e.amount) || 0) + gratuityTotal(e, plan);

export const WALLET_METHODS = ['bank', 'cash', 'gift', 'special'];
export const PAY_METHODS = [
  { id: 'none', label: 'Not paid yet (estimate)' },
  { id: 'ils', label: 'Paid in ₪ (no conversion)' },
  { id: 'card', label: 'Card — standalone charge' },
  { id: 'bank', label: 'Card — from bank balance' },
  { id: 'cash', label: 'Cash' },
  { id: 'gift', label: 'Gift card / credit' },
  { id: 'special', label: 'Special account (e.g. onboard)' },
];
export const payLabel = (id) => PAY_METHODS.find((m) => m.id === id)?.label || id;

/**
 * ₪ cost of one entry.
 * - Plans: foreign amounts at the current rate (plans never touch the wallet).
 * - Trips: by payment method; wallet methods take their cost from the ledger.
 * Returns {ils, estimate, rate, gratIls, empty?, missingRate?}. Refunds are negative.
 */
export function entryCost(e, plan, ledger) {
  const amt = totalAmount(e, plan);
  const sign = e.kind === 'refund' ? -1 : 1;
  const grat = gratuityTotal(e, plan);
  if (!amt) return { ils: 0, estimate: false, empty: num(e.amount) == null, rate: null, gratIls: 0 };
  const cur = e.currency || 'ILS';
  const isTrip = plan?.status === 'trip';
  const pm = isTrip ? (e.payment?.method || 'none') : 'none';
  let ils = null;
  let estimate = false;
  const official = () => {
    if (cur === 'ILS') return 1;
    if (e.officialRate) { if (e.officialRateEstimate) estimate = true; return e.officialRate; }
    const r = rateProvider(cur, e.date);
    if (r) { estimate = true; return r.rate; }
    return null;
  };

  if (pm === 'none') {
    if (cur === 'ILS') ils = amt;
    else {
      const r = rateProvider(cur);
      if (r) { ils = amt * r.rate; if (!r.exact) estimate = true; }
    }
    if (isTrip) estimate = true; // unpaid trip item
  } else if (pm === 'ils') {
    ils = amt;
  } else if (pm === 'card') {
    const charged = num(e.payment?.ilsCharged);
    if (charged != null) ils = charged;
    else { const r = official(); if (r != null) ils = amt * r; estimate = true; }
  } else if (e.kind === 'refund') {
    const r = num(e.payment?.rate) ?? official();
    if (r != null) ils = amt * r;
  } else {
    const res = ledger?.entries.get(e.id);
    if (res) { ils = res.ils + res.estIls; if (res.estIls > 1e-9) estimate = true; }
    else { const r = official(); if (r != null) ils = amt * r; estimate = true; }
  }
  if (ils == null) return { ils: null, estimate: true, missingRate: true, rate: null, gratIls: 0 };
  return { ils: sign * ils, estimate, rate: ils / amt, gratIls: (sign * ils * grat) / amt };
}

export function planSummary(plan, entries, ledger) {
  let total = 0; let estimate = false; let missing = false; let gratIls = 0;
  const byEntry = new Map(); const byCombo = new Map(); const byTag = new Map();
  for (const e of entries) {
    const c = entryCost(e, plan, ledger);
    byEntry.set(e.id, c);
    if (c.missingRate) missing = true; else total += c.ils;
    if (c.estimate) estimate = true;
    gratIls += c.gratIls || 0;
    const cats = entryCats(e);
    const k = cats.join('+');
    const g = byCombo.get(k) || { cats, ils: 0, estimate: false, count: 0 };
    g.ils += c.ils || 0; g.estimate ||= c.estimate; g.count++;
    byCombo.set(k, g);
    for (const t of e.tags || []) byTag.set(t, (byTag.get(t) || 0) + (c.ils || 0));
  }
  if (gratIls) byTag.set('gratuity', (byTag.get('gratuity') || 0) + gratIls);
  return {
    total, estimate: estimate || missing, missing, byEntry,
    byCombo: [...byCombo.values()].sort((a, b) => b.ils - a.ils),
    byTag: [...byTag.entries()].sort((a, b) => b[1] - a[1]),
    days: planDays(plan), travelers: travelersOf(plan),
  };
}

export const BASES = [
  { id: 'total', label: 'Total' },
  { id: 'person', label: 'Per person' },
  { id: 'day', label: 'Per day' },
  { id: 'ppd', label: 'Per person / day' },
];
export function applyBasis(v, basis, days, travelers) {
  if (v == null) return null;
  if (basis === 'person') return v / travelers;
  if (basis === 'day') return days ? v / days : null;
  if (basis === 'ppd') return days ? v / (travelers * days) : null;
  return v;
}

/**
 * Compare plans/trips by category. Categories linked by bundled payments in ANY
 * compared item are merged (transitively) for all of them.
 * items: [{plan, entries}], selectedCats: array of ids (empty/null = all).
 */
export function compare(items, selectedCats, ledger) {
  const parent = {};
  CAT_IDS.forEach((c) => { parent[c] = c; });
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const links = [];
  for (const { plan, entries } of items) {
    for (const e of entries) {
      const cats = entryCats(e);
      if (cats.length < 2) continue;
      for (let i = 1; i < cats.length; i++) {
        const a = find(cats[0]); const b = find(cats[i]);
        if (a !== b) { if (catIndex(a) < catIndex(b)) parent[b] = a; else parent[a] = b; }
      }
      links.push({ cats, title: e.title || '(untitled)', plan: plan.name });
    }
  }
  const groups = new Map();
  for (const c of CAT_IDS) { const r = find(c); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
  const sel = selectedCats?.length ? new Set(selectedCats) : null;

  const cols = items.map(({ plan, entries }) => {
    const summary = planSummary(plan, entries, ledger);
    const byRoot = new Map(); const estRoot = new Set();
    for (const e of entries) {
      const r = find(entryCats(e)[0]);
      const c = summary.byEntry.get(e.id);
      byRoot.set(r, (byRoot.get(r) || 0) + (c.ils || 0));
      if (c.estimate) estRoot.add(r);
    }
    return { plan, summary, byRoot, estRoot };
  });

  const rows = [];
  for (const [root, cats] of groups) {
    if (sel && !cats.some((c) => sel.has(c))) continue;
    rows.push({
      root, cats, merged: cats.length > 1,
      notes: cats.length > 1 ? links.filter((l) => find(l.cats[0]) === root) : [],
      values: cols.map((c) => c.byRoot.get(root) || 0),
      estimates: cols.map((c) => c.estRoot.has(root)),
    });
  }
  const totals = cols.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0));
  const totalEst = cols.map((_, i) => rows.some((r) => r.estimates[i]));
  return { rows, cols, totals, totalEst };
}
