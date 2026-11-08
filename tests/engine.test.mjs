// Run: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { runLedger, keyOf } from '../js/wallet.js';
import { entryCost, compare, gratuityTotal, setRateProvider, planSummary } from '../js/calc.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const trip = { id: 'T', status: 'trip', travelers: 2, startDate: '2026-07-01', endDate: '2026-07-10' };
const plans = new Map([['T', trip]]);

// 1. Average rate: buy $100 @3.0, buy $100 @4.0 → avg 3.5; spend $50 → ₪175, avg unchanged.
{
  const tx = [
    { id: 'a', type: 'buy', date: '2026-06-01', currency: 'USD', amount: 100, ils: 300, createdAt: 1 },
    { id: 'b', type: 'buy', date: '2026-06-02', currency: 'USD', amount: 100, ils: 400, createdAt: 2 },
  ];
  const entries = [{ id: 'e1', planId: 'T', amount: 50, currency: 'USD', date: '2026-07-02', payment: { method: 'bank' }, officialRate: 3.7, createdAt: 3 }];
  const L = runLedger({ tx, entries, plans });
  const b = L.balances.get(keyOf('bank', 'USD'));
  close(b.amount, 150, 'balance'); close(b.avgRate, 3.5, 'avg');
  close(entryCost(entries[0], trip, L).ils, 175, 'entry cost');
}

// 2. Negative bank balance: estimate at official rate, then settled by buying currency.
{
  const entries = [{ id: 'e1', planId: 'T', amount: 100, currency: 'EUR', date: '2026-07-02', payment: { method: 'bank' }, officialRate: 4.0, createdAt: 1 }];
  let L = runLedger({ tx: [], entries, plans });
  let c = entryCost(entries[0], trip, L);
  close(c.ils, 400, 'estimated'); assert.equal(c.estimate, true);
  const tx = [{ id: 'b', type: 'buy', date: '2026-07-05', currency: 'EUR', amount: 150, ils: 630, createdAt: 2 }]; // 4.2
  L = runLedger({ tx, entries, plans });
  c = entryCost(entries[0], trip, L);
  close(c.ils, 420, 'settled'); assert.equal(c.estimate, false);
  close(L.balances.get(keyOf('bank', 'EUR')).amount, 50, 'remaining');
}

// 3. Special account: charges settled by card + gift card.
{
  const tx = [
    { id: 'g', type: 'gift', date: '2026-05-01', currency: 'USD', label: 'Cruise credit', amount: 50, rates: { USD: 3.6 }, createdAt: 1 },
    { id: 's1', type: 'settle', date: '2026-07-10', currency: 'USD', label: 'Onboard', amount: 50, source: 'gift', sourceLabel: 'Cruise credit', createdAt: 4 },
    { id: 's2', type: 'settle', date: '2026-07-10', currency: 'USD', label: 'Onboard', amount: 150, source: 'card', ils: 570, createdAt: 5 },
  ];
  const entries = [
    { id: 'x', planId: 'T', amount: 120, currency: 'USD', date: '2026-07-03', payment: { method: 'special', label: 'Onboard' }, officialRate: 3.7, createdAt: 2 },
    { id: 'y', planId: 'T', amount: 80, currency: 'USD', date: '2026-07-04', payment: { method: 'special', label: 'Onboard' }, officialRate: 3.7, createdAt: 3 },
  ];
  const L = runLedger({ tx, entries, plans });
  // FIFO: x gets $50 gift (₪180) + $70 card @3.8 (₪266) = 446; y gets $80 @3.8 = 304
  close(entryCost(entries[0], trip, L).ils, 446, 'x'); close(entryCost(entries[1], trip, L).ils, 304, 'y');
}

// 4. Exchange: cash $ → cash € carries ₪ cost.
{
  const tx = [
    { id: 'a', type: 'atm', date: '2026-06-01', currency: 'USD', amount: 200, ils: 740, createdAt: 1 },
    { id: 'x', type: 'exchange', date: '2026-06-02', fromForm: 'cash', fromCurrency: 'USD', fromAmount: 100, toForm: 'cash', toCurrency: 'EUR', toAmount: 90, createdAt: 2 },
  ];
  const L = runLedger({ tx, entries: [], plans });
  const eur = L.balances.get(keyOf('cash', 'EUR'));
  close(eur.ils, 370, 'eur cost'); close(L.balances.get(keyOf('cash', 'USD')).avgRate, 3.7, 'usd avg kept');
}

// 5. Gratuity per person per day; refund at a different rate.
{
  const e = { id: 'c', amount: 1000, currency: 'USD', gratuities: [{ type: 'ppd', amount: 16, from: '2026-07-01', to: '2026-07-07' }, { type: 'percent', pct: 10 }] };
  close(gratuityTotal(e, trip), 16 * 2 * 7 + 100, 'gratuity');
  const r = { id: 'r', planId: 'T', kind: 'refund', amount: 20, currency: 'USD', payment: { method: 'card', ilsCharged: 70 } };
  close(entryCost(r, trip, null).ils, -70, 'refund');
}

// 6. Plans use current rate; comparison merges bundled categories transitively.
{
  setRateProvider((cur) => (cur === 'EUR' ? { rate: 4, exact: true } : null));
  const A = { id: 'A', name: 'Cruise', status: 'plan', travelers: 2, startDate: '2026-08-01', endDate: '2026-08-07' };
  const Bp = { id: 'B', name: 'Land', status: 'plan', travelers: 2, startDate: '2026-08-01', endDate: '2026-08-04' };
  const ea = [{ id: '1', categories: ['transport', 'sleep'], amount: 1000, currency: 'EUR' }, { id: '2', categories: ['sleep', 'food'], amount: 100, currency: 'EUR' }, { id: '3', categories: ['attractions'], amount: 50, currency: 'ILS' }];
  const eb = [{ id: '4', categories: ['food'], amount: 300, currency: 'ILS' }, { id: '5', categories: ['transport'], amount: 900, currency: 'ILS' }];
  close(planSummary(A, ea, null).total, 4450, 'plan total');
  const cmp = compare([{ plan: A, entries: ea }, { plan: Bp, entries: eb }], ['food'], null);
  assert.equal(cmp.rows.length, 1);
  assert.deepEqual(cmp.rows[0].cats, ['transport', 'food', 'sleep']);
  assert.deepEqual(cmp.rows[0].values, [4400, 1200]);
}

console.log('All engine tests passed');
