// Wallet ledger engine (pure). Replays wallet transactions and trip payments in date
// order to produce balances per currency+form with average rates, and the ₪ cost of
// every trip expense paid from a balance.
//
// Rules (from the spec):
// - Money coming in changes a balance's average rate; spending removes money at the
//   average and doesn't change it.
// - Spending beyond what's there creates an unsettled debt (negative bank balance,
//   special account charges). Debts are estimated at the official rate of the charge
//   day until money comes in, which settles them FIFO at the incoming money's rate.
import { num } from './util.js';
import { totalAmount, WALLET_METHODS } from './calc.js';

export const FORMS = [
  { id: 'cash', label: 'Cash' },
  { id: 'bank', label: 'Bank' },
  { id: 'gift', label: 'Gift card / credit' },
  { id: 'special', label: 'Special account' },
];
export const formLabel = (id) => FORMS.find((f) => f.id === id)?.label || id;

export const keyOf = (form, cur, label = '') =>
  `${form}|${(cur || '').toUpperCase()}|${form === 'gift' || form === 'special' ? (label || '').trim() : ''}`;
export function parseKey(k) { const [form, currency, label] = k.split('|'); return { form, currency, label }; }
export function keyLabel(k) {
  const { form, currency, label } = parseKey(k);
  return `${formLabel(form)} · ${currency}${label ? ` · ${label}` : ''}`;
}

export const TX_TYPES = [
  { id: 'existing', label: 'Existing money', hint: 'Cash or bank money not yet in the app. Valued at the official rate on the day it\'s logged.' },
  { id: 'atm', label: 'ATM withdrawal', hint: 'Log the ₪ actually charged to your account.' },
  { id: 'buy', label: 'Buy foreign currency (bank)', hint: 'Enter the ₪ you paid; the bank\'s rate follows from it.' },
  { id: 'exchange', label: 'Exchange between currencies', hint: 'The new money\'s ₪ cost comes from the money given up.' },
  { id: 'gift', label: 'Gift card / credit received', hint: 'Valued at the official rate on the date received. Applied only against actual charges.' },
  { id: 'settle', label: 'Settle a special account', hint: 'Pay off accumulated charges (e.g. cruise onboard account).' },
  { id: 'offtrip', label: 'Off-trip spending', hint: 'Money used outside any trip. Removed at the balance\'s average rate.' },
  { id: 'adjust', label: 'Correct a balance', hint: 'For forgotten transactions: enter the real amount. The difference is valued at the official rate today and not counted against any trip.' },
];
export const txLabel = (id) => TX_TYPES.find((t) => t.id === id)?.label || id;

const EPS = 1e-9;

/**
 * @param {{tx: object[], entries: object[], plans: Map, rateOf?: (cur,date)=>({rate}|null)}} input
 * @returns {{balances: Map, entries: Map, tx: Map, warnings: string[]}}
 */
export function runLedger({ tx, entries, plans, rateOf }) {
  const events = [];
  for (const t of tx) events.push({ date: t.date || '0000-00-00', order: t.createdAt || 0, t });
  for (const e of entries) {
    const p = plans.get(e.planId);
    if (!p || p.status !== 'trip') continue;
    if (!WALLET_METHODS.includes(e.payment?.method)) continue;
    if (!(totalAmount(e, p) > 0)) continue;
    events.push({ date: e.date || p.startDate || '0000-00-00', order: e.createdAt || 0, e, p });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

  const bal = new Map(); const entryRes = new Map(); const txRes = new Map(); const warnings = [];
  const B = (k) => { if (!bal.has(k)) bal.set(k, { key: k, amount: 0, ils: 0, debts: [] }); return bal.get(k); };
  const resOf = (ref) => {
    const m = ref.type === 'entry' ? entryRes : txRes;
    if (!m.has(ref.id)) m.set(ref.id, { ils: 0, estIls: 0 });
    return m.get(ref.id);
  };
  const credit = (ref, ils, est = 0) => { if (!ref) return; const r = resOf(ref); r.ils += ils; r.estIls += est; };
  const off = (obj, cur, date) => {
    if (!cur || cur === 'ILS') return 1;
    return obj.rates?.[cur] ?? (obj.currency === cur ? obj.officialRate : null) ?? rateOf?.(cur, date)?.rate ?? 0;
  };

  function inflow(k, amt, ils) {
    if (!(amt > 0)) return;
    const b = B(k); const unit = ils / amt; let rem = amt;
    while (rem > EPS && b.debts.length) {
      const d = b.debts[0]; const pay = Math.min(d.amount, rem);
      credit(d.ref, pay * unit);
      d.amount -= pay; rem -= pay;
      if (d.amount <= EPS) b.debts.shift();
    }
    b.amount += rem; b.ils += rem * unit;
  }
  function outflow(k, amt, ref, date, offRate) {
    const b = B(k);
    if (ref) resOf(ref);
    const take = Math.min(b.amount, amt); let ils = 0;
    if (take > EPS) {
      ils = (b.ils * take) / b.amount;
      b.ils -= ils; b.amount -= take;
      if (b.amount < EPS) { b.amount = 0; b.ils = 0; }
    }
    credit(ref, ils);
    const debt = amt - take;
    if (debt > EPS) b.debts.push({ amount: debt, ref, date, offRate });
    return { ils, debt };
  }

  for (const ev of events) {
    if (ev.e) {
      const { e, p } = ev; const amt = totalAmount(e, p); const cur = (e.currency || 'ILS').toUpperCase();
      const m = e.payment.method; const k = keyOf(m, cur, e.payment.label);
      const ref = { type: 'entry', id: e.id };
      if (e.kind === 'refund') {
        const r = num(e.payment.rate) ?? off(e, cur, ev.date);
        inflow(k, amt, amt * r);
        resOf(ref).ils = amt * r;
      } else {
        const before = B(k).amount;
        outflow(k, amt, ref, ev.date, off(e, cur, ev.date));
        if (m === 'gift' && before < amt - EPS) warnings.push(`Gift card "${e.payment.label || cur}" doesn't cover "${e.title || 'an expense'}".`);
      }
      continue;
    }
    const t = ev.t; const ref = { type: 'tx', id: t.id }; const cur = (t.currency || '').toUpperCase(); const amt = num(t.amount) || 0;
    switch (t.type) {
      case 'existing': { const ils = amt * off(t, cur, t.date); inflow(keyOf(t.form || 'cash', cur), amt, ils); resOf(ref).ils = ils; break; }
      case 'atm': { const ils = num(t.ils) || 0; inflow(keyOf('cash', cur), amt, ils); resOf(ref).ils = ils; break; }
      case 'buy': { const ils = num(t.ils) || 0; inflow(keyOf('bank', cur), amt, ils); resOf(ref).ils = ils; break; }
      case 'gift': { const ils = amt * off(t, cur, t.date); inflow(keyOf('gift', cur, t.label), amt, ils); resOf(ref).ils = ils; break; }
      case 'exchange': {
        const fc = (t.fromCurrency || '').toUpperCase(); const fa = num(t.fromAmount) || 0; const ta = num(t.toAmount) || 0;
        const o = outflow(keyOf(t.fromForm || 'cash', fc), fa, ref, t.date, off(t, fc, t.date));
        const cost = o.ils + o.debt * off(t, fc, t.date);
        inflow(keyOf(t.toForm || 'cash', t.toCurrency), ta, cost);
        Object.assign(resOf(ref), { cost, rate: ta ? cost / ta : null, estimate: o.debt > EPS });
        break;
      }
      case 'settle': {
        let cost;
        if (t.source === 'ils' || t.source === 'card') cost = num(t.ils) || 0;
        else {
          const sc = (t.sourceCurrency || cur).toUpperCase(); const sa = num(t.sourceAmount) ?? amt;
          const o = outflow(keyOf(t.source, sc, t.sourceLabel), sa, ref, t.date, off(t, sc, t.date));
          cost = o.ils + o.debt * off(t, sc, t.date);
        }
        inflow(keyOf('special', cur, t.label), amt, cost);
        Object.assign(resOf(ref), { cost, rate: amt ? cost / amt : null });
        break;
      }
      case 'offtrip': outflow(keyOf(t.form || 'cash', cur, t.label), amt, ref, t.date, off(t, cur, t.date)); break;
      case 'adjust': {
        const k = keyOf(t.form || 'cash', cur, t.label); const b = B(k);
        const net = b.amount - b.debts.reduce((s, d) => s + d.amount, 0);
        const diff = (num(t.actual) ?? net) - net; const r = off(t, cur, t.date);
        if (diff > EPS) inflow(k, diff, diff * r);
        else if (diff < -EPS) outflow(k, -diff, null, t.date, r);
        Object.assign(resOf(ref), { diff, valueIls: diff * r });
        break;
      }
      default: break;
    }
  }

  for (const b of bal.values()) {
    b.debtAmount = 0; b.debtEst = 0;
    for (const d of b.debts) {
      const est = d.amount * (d.offRate || 0);
      credit(d.ref, 0, est);
      b.debtAmount += d.amount; b.debtEst += est;
    }
    b.net = b.amount - b.debtAmount;
    b.avgRate = b.amount > EPS ? b.ils / b.amount : null;
  }
  return { balances: bal, entries: entryRes, tx: txRes, warnings };
}
