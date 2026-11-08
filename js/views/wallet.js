// Wallet: balances per currency + form, and wallet transactions.
import { state, put, remove, newId } from '../store.js';
import { esc, num, today, fmtILS, fmtAmt, fmtRate, fmtDate, confirmDialog, toast, uniq } from '../util.js';
import { ledger, txList, settings, saveSettings } from '../data.js';
import { FORMS, TX_TYPES, txLabel, keyOf, parseKey, formLabel } from '../wallet.js';
import { officialRate } from '../rates.js';
import { field, opts, bindForm, empty, money } from '../ui.js';

function txSummary(t, r) {
  const a = (n, c) => fmtAmt(num(n), (c || '').toUpperCase());
  switch (t.type) {
    case 'existing': return `${a(t.amount, t.currency)} ${formLabel(t.form).toLowerCase()}`;
    case 'atm': return `${a(t.amount, t.currency)} cash for ${fmtILS(num(t.ils))}`;
    case 'buy': return `${a(t.amount, t.currency)} for ${fmtILS(num(t.ils))}`;
    case 'exchange': return `${a(t.fromAmount, t.fromCurrency)} → ${a(t.toAmount, t.toCurrency)}${r?.rate ? ` · ₪ cost ${fmtILS(r.cost)}` : ''}`;
    case 'gift': return `${a(t.amount, t.currency)} · ${esc(t.label)}`;
    case 'settle': return `${a(t.amount, t.currency)} of ${esc(t.label)} via ${t.source === 'ils' ? '₪' : t.source}${r?.cost != null ? ` (${fmtILS(r.cost)})` : ''}`;
    case 'offtrip': return `${a(t.amount, t.currency)} from ${formLabel(t.form).toLowerCase()}${r ? ` · ${fmtILS(r.ils + r.estIls)}` : ''}`;
    case 'adjust': return `set to ${a(t.actual, t.currency)}${r?.diff ? ` (${r.diff > 0 ? '+' : ''}${fmtAmt(r.diff, t.currency)} ≈ ${fmtILS(r.valueIls)})` : ''}`;
    default: return '';
  }
}

export function walletView() {
  const L = ledger();
  const bals = [...L.balances.values()].filter((b) => b.amount > 1e-6 || b.debtAmount > 1e-6);
  const groups = FORMS.map((f) => ({ f, list: bals.filter((b) => parseKey(b.key).form === f.id).sort((a, b) => b.ils - a.ils) })).filter((g) => g.list.length);
  const totalIls = bals.reduce((s, b) => s + b.ils, 0);
  const debtIls = bals.reduce((s, b) => s + b.debtEst, 0);

  const balRow = (b) => {
    const { currency, label } = parseKey(b.key);
    return `<div class="bal"><div class="grow"><b>${fmtAmt(b.net, currency)}</b>${label ? ` <span class="muted">· ${esc(label)}</span>` : ''}
        <div class="muted small">${b.amount > 1e-6 ? `avg ${fmtRate(b.avgRate)} · ${fmtILS(b.ils)}` : ''}
        ${b.debtAmount > 1e-6 ? `<span class="warn">unsettled ${fmtAmt(b.debtAmount, currency)} ≈ ${fmtILS(b.debtEst)} at official rate</span>` : ''}</div></div></div>`;
  };
  const txs = txList();
  const html = `
    <div class="card totals"><div class="big">${fmtILS(totalIls)}</div>
      <div class="muted small">held, at average cost${debtIls ? ` · <span class="warn">≈ ${fmtILS(debtIls)} unsettled</span>` : ''}</div></div>
    ${L.warnings.length ? `<div class="card warnbox">${L.warnings.map((w) => `<div class="small">⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${groups.length ? groups.map((g) => `<h2 class="section">${esc(g.f.label)}</h2><div class="card list">${g.list.map(balRow).join('')}</div>`).join('')
      : empty('The wallet is empty. Log money you already have, an ATM withdrawal or a currency purchase.')}
    <a class="btn primary full" href="#/tx/new">+ Transaction</a>
    <h2 class="section">Transactions</h2>
    ${txs.length ? `<div class="entries">${txs.map((t) => `<a class="entry" href="#/tx/${t.id}"><div class="grow">
        <div class="title">${esc(txLabel(t.type))}</div><div class="muted small">${fmtDate(t.date)} · ${txSummary(t, L.tx.get(t.id))}</div>
        ${t.note ? `<div class="muted small">${esc(t.note)}</div>` : ''}</div></a>`).join('')}</div>` : '<p class="muted small">None yet. Trip payments from balances appear inside each trip.</p>'}`;
  return { title: 'Wallet', tab: 'wallet', live: true, html };
}

export function txView({ id }) {
  const isNew = id === 'new';
  const existing = isNew ? null : state.tx.get(id);
  if (!isNew && !existing) return null;
  const cfg = settings();
  const L = ledger();
  const d = Object.assign({ type: 'existing', date: today(), form: 'cash', currency: 'USD', amount: '', note: '' }, structuredClone(existing || {}));
  const labels = (form) => uniq([...L.balances.keys()].map(parseKey).filter((k) => k.form === form).map((k) => k.label));
  const cur = (name, v) => `<input name="${name}" list="curlist" maxlength="3" data-rr value="${esc((v || '').toUpperCase())}" autocapitalize="characters">`;
  const amt = (name, v, ph = '') => `<input name="${name}" inputmode="decimal" value="${esc(v ?? '')}" placeholder="${esc(ph)}">`;
  const formSel = (name, v, list = ['cash', 'bank']) => `<select name="${name}" data-rr>${opts(FORMS.filter((f) => list.includes(f.id)), v)}</select>`;
  const balHint = (form, c, label) => {
    const b = L.balances.get(keyOf(form, c, label));
    return b ? `Balance now: ${fmtAmt(b.net, (c || '').toUpperCase())}${b.avgRate ? ` @ avg ${fmtRate(b.avgRate)}` : ''}` : '';
  };

  const render = () => {
    const t = TX_TYPES.find((x) => x.id === d.type);
    let body = '';
    switch (d.type) {
      case 'existing':
        body = `<div class="two">${field('Form', formSel('form', d.form))}${field('Currency', cur('currency', d.currency))}</div>${field('Amount', amt('amount', d.amount))}`; break;
      case 'atm':
        body = `<div class="two">${field('Amount withdrawn', amt('amount', d.amount))}${field('Currency', cur('currency', d.currency))}</div>
          ${field('₪ actually charged', amt('ils', d.ils), 'Including fees — check your bank statement')}`; break;
      case 'buy':
        body = `<div class="two">${field('Amount bought', amt('amount', d.amount))}${field('Currency', cur('currency', d.currency))}</div>
          ${field('₪ paid', amt('ils', d.ils))}${num(d.ils) && num(d.amount) ? `<p class="muted small">Bank rate: ${fmtRate(num(d.ils) / num(d.amount))}</p>` : ''}`; break;
      case 'exchange':
        body = `<div class="sub card"><b class="small">Gave</b><div class="two">${field('From', formSel('fromForm', d.fromForm || 'cash'))}${field('Currency', cur('fromCurrency', d.fromCurrency))}</div>
            ${field('Amount', amt('fromAmount', d.fromAmount), balHint(d.fromForm || 'cash', d.fromCurrency))}</div>
          <div class="sub card"><b class="small">Got</b><div class="two">${field('Into', formSel('toForm', d.toForm || 'cash'))}${field('Currency', cur('toCurrency', d.toCurrency))}</div>
            ${field('Amount', amt('toAmount', d.toAmount))}</div>`; break;
      case 'gift':
        body = `${field('Name', `<input name="label" value="${esc(d.label ?? '')}" placeholder="e.g. Cruise onboard credit">`, 'Restricted to a specific use')}
          <div class="two">${field('Value', amt('amount', d.amount))}${field('Currency', cur('currency', d.currency))}</div>`; break;
      case 'settle': {
        const specials = labels('special');
        body = `${field('Special account', `<input name="label" list="speclist2" data-rr value="${esc(d.label ?? '')}"><datalist id="speclist2">${opts(specials, '')}</datalist>`, balHint('special', d.currency, d.label))}
          <div class="two">${field('Amount settled', amt('amount', d.amount))}${field('Currency', cur('currency', d.currency))}</div>
          ${field('Paid with', `<select name="source" data-rr>${opts([{ id: 'card', label: 'Card (₪ charged)' }, { id: 'ils', label: 'Paid in ₪' }, { id: 'bank', label: 'Bank balance' }, { id: 'cash', label: 'Cash' }, { id: 'gift', label: 'Gift card / credit' }], d.source || 'card')}</select>`)}
          ${['card', 'ils'].includes(d.source || 'card') ? field('₪ charged', amt('ils', d.ils))
            : `${d.source === 'gift' ? field('Gift card', `<input name="sourceLabel" list="giftlist2" value="${esc(d.sourceLabel ?? '')}"><datalist id="giftlist2">${opts(labels('gift'), '')}</datalist>`) : ''}
               <div class="two">${field('Source amount', amt('sourceAmount', d.sourceAmount, 'same as settled'))}${field('Source currency', cur('sourceCurrency', d.sourceCurrency || d.currency))}</div>`}`;
        break;
      }
      case 'offtrip':
        body = `<div class="two">${field('From', formSel('form', d.form, ['cash', 'bank', 'gift']))}${field('Currency', cur('currency', d.currency))}</div>
          ${d.form === 'gift' ? field('Gift card', `<input name="label" value="${esc(d.label ?? '')}">`) : ''}
          ${field('Amount', amt('amount', d.amount), balHint(d.form, d.currency, d.label))}`; break;
      case 'adjust':
        body = `<div class="two">${field('Balance', formSel('form', d.form, ['cash', 'bank', 'gift', 'special']))}${field('Currency', cur('currency', d.currency))}</div>
          ${['gift', 'special'].includes(d.form) ? field('Name', `<input name="label" data-rr value="${esc(d.label ?? '')}">`) : ''}
          ${field('Real amount now', amt('actual', d.actual), balHint(d.form, d.currency, d.label))}`; break;
      default: break;
    }
    return `${field('Type', `<select name="type" data-rr>${opts(TX_TYPES, d.type)}</select>`, esc(t?.hint || ''))}
      ${field('Date', `<input type="date" name="date" value="${esc(d.date)}">`)}
      ${body}
      <datalist id="curlist">${opts(cfg.currencies, '')}</datalist>
      ${field('Note', `<input name="note" value="${esc(d.note ?? '')}">`)}
      ${existing?.rates ? `<p class="muted small">Official rate${Object.keys(existing.rates).length > 1 ? 's' : ''}: ${Object.entries(existing.rates).map(([c, r]) => `${c} ${fmtRate(r)}`).join(', ')}${existing.ratesEstimate ? ' (estimate — will update when online)' : ''}</p>` : ''}
      <button class="btn primary full">Save</button>
      ${!isNew ? '<button class="btn ghost full danger-text" data-act="delete">Delete</button>' : ''}`;
  };

  return {
    title: isNew ? 'New transaction' : txLabel(d.type), back: '#/wallet', tab: 'wallet',
    html: '<form class="form" id="tf" autocomplete="off"></form>',
    bind(root) {
      const form = root.querySelector('#tf');
      bindForm(form, d, {
        render,
        actions: {
          delete: async () => {
            if (await confirmDialog('Delete this transaction? Balances and trip costs will be recalculated.', { ok: 'Delete', danger: true })) { remove('tx', id); location.hash = '#/wallet'; }
            return false;
          },
        },
        submit: async () => {
          const t = clean(d);
          const curs = uniq([t.currency, t.fromCurrency, t.toCurrency, t.sourceCurrency]).filter((c) => c !== 'ILS');
          if (curs.some((c) => !/^[A-Z]{3}$/.test(c))) { toast('Currencies must be 3-letter codes'); return; }
          if (['gift', 'settle'].includes(t.type) && !t.label) { toast('Give it a name'); return; }
          const btn = form.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Saving…';
          const rates = {}; let estimate = false;
          for (const c of curs) {
            const prev = existing?.date === t.date && existing?.rates?.[c] && !existing.ratesEstimate ? existing.rates[c] : null;
            if (prev) { rates[c] = prev; continue; }
            const r = await officialRate(c, t.date);
            if (r.rate) rates[c] = r.rate;
            if (r.estimate) estimate = true;
          }
          put('tx', isNew ? newId('tx') : id, { ...t, rates, ratesEstimate: estimate, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() });
          const newCurs = curs.filter((c) => !cfg.currencies.includes(c));
          if (newCurs.length) saveSettings({ currencies: [...cfg.currencies, ...newCurs] });
          location.hash = '#/wallet';
        },
      });
    },
  };
}

const FIELDS = {
  existing: ['form', 'currency', 'amount'], atm: ['currency', 'amount', 'ils'], buy: ['currency', 'amount', 'ils'],
  exchange: ['fromForm', 'fromCurrency', 'fromAmount', 'toForm', 'toCurrency', 'toAmount'],
  gift: ['label', 'currency', 'amount'],
  settle: ['label', 'currency', 'amount', 'source', 'ils', 'sourceLabel', 'sourceAmount', 'sourceCurrency'],
  offtrip: ['form', 'currency', 'label', 'amount'], adjust: ['form', 'currency', 'label', 'actual'],
};
const NUMS = ['amount', 'ils', 'fromAmount', 'toAmount', 'sourceAmount', 'actual'];
const CURS = ['currency', 'fromCurrency', 'toCurrency', 'sourceCurrency'];

function clean(d) {
  const t = { type: d.type, date: d.date || today(), note: (d.note || '').trim() };
  for (const k of FIELDS[d.type] || []) {
    let v = d[k];
    if (NUMS.includes(k)) v = num(v);
    else if (CURS.includes(k)) v = (v || '').toUpperCase().trim();
    else v = typeof v === 'string' ? v.trim() : v;
    t[k] = v;
  }
  if (t.type === 'exchange') { t.fromForm ||= 'cash'; t.toForm ||= 'cash'; }
  if (t.type === 'settle') { t.source ||= 'card'; if (!['card', 'ils'].includes(t.source)) t.sourceCurrency ||= t.currency; }
  if (t.form == null && ['existing', 'offtrip', 'adjust'].includes(t.type)) t.form = 'cash';
  return t;
}
