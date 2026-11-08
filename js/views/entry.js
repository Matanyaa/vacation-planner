// Expense / cost editor. Route: #/e/<planId>/<entryId|new>
import { state, put, remove, newId } from '../store.js';
import { esc, num, today, fmtILS, fmtAmt, fmtRate, confirmDialog, toast, uniq } from '../util.js';
import {
  CATEGORIES, MEALS, GRATUITY_TYPES, PAY_METHODS, entryCost, gratuityItems, comboName, sortCats,
} from '../calc.js';
import { settings, saveSettings, ledger } from '../data.js';
import { officialRate, ensureRate } from '../rates.js';
import { parseKey } from '../wallet.js';
import { field, opts, bindForm } from '../ui.js';

const blank = (plan) => ({
  kind: 'expense', title: '', categories: [], method: '', meal: '', date: plan.startDate || '', endDate: '', place: '',
  amount: '', currency: settings().defaultCurrency, foreignAmount: '', foreignCurrency: '',
  tags: [], gratuities: [], connection: { on: false, legs: [] }, payment: { method: 'none' }, notes: '',
});

function labelsFor(form, cur) {
  return uniq([...ledger().balances.keys()].map(parseKey).filter((k) => k.form === form && (!cur || k.currency === cur)).map((k) => k.label));
}

export function entryView({ planId, id }) {
  const plan = state.plans.get(planId);
  if (!plan) return null;
  const isNew = id === 'new';
  const existing = isNew ? null : state.entries.get(id);
  if (!isNew && !existing) return null;
  const isTrip = plan.status === 'trip';
  const d = Object.assign(blank(plan), structuredClone(existing || {}));
  d.payment ||= { method: 'none' }; d.connection ||= { on: false, legs: [] }; d.gratuities ||= []; d.tags ||= [];
  const cfg = settings();
  const back = `#/p/${planId}`;

  const render = () => {
    const cats = d.categories;
    const pm = d.payment.method || 'none';
    const cur = (d.currency || 'ILS').toUpperCase();
    const allTags = uniq([...cfg.tags, ...d.tags]);
    const methods = uniq([...cfg.methods, d.method]);
    const giftLabels = labelsFor('gift', cur); const specialLabels = labelsFor('special', cur);
    return `
    ${isTrip ? `<div class="seg">${['expense', 'refund'].map((k) => `<button data-act="kind" data-v="${k}" class="${d.kind === k ? 'on' : ''}">${k === 'expense' ? 'Expense' : 'Refund'}</button>`).join('')}</div>
      ${d.kind === 'refund' ? '<p class="muted small">Refund at the <b>same rate</b> as the original? Just edit the original expense\'s amount instead. Use this for a refund at a different rate.</p>' : ''}` : ''}
    ${field('Title', `<input name="title" value="${esc(d.title)}" placeholder="${esc(cats.length ? comboName(sortCats(cats)) : 'e.g. Hotel Roma')}">`)}
    <div class="field"><span>Categories</span><div class="chips">${CATEGORIES.map((c) => `
      <button data-act="cat" data-id="${c.id}" class="chip${cats.includes(c.id) ? ' on' : ''}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>
      <small class="hint">Pick several for a bundled payment (e.g. cruise fare = Transportation + Sleep + Food).</small></div>
    ${cats.includes('transport') ? `<div class="two">
      ${field('Transport method', `<select name="method"><option value="">—</option>${opts(methods, d.method)}</select>`, '<a href="#/settings">Edit list</a>')}
      <label class="check pad"><input type="checkbox" name="connection.on" data-rr ${d.connection.on ? 'checked' : ''}> Connection</label></div>
      ${d.connection.on ? `<div class="sub card"><div class="muted small">Legs (for the itinerary later). One ticket = one entry; two tickets = two entries, both marked as connection.</div>
        ${d.connection.legs.map((l, i) => `<div class="leg">
          <input name="connection.legs.${i}.from" value="${esc(l.from)}" placeholder="From">
          <input name="connection.legs.${i}.to" value="${esc(l.to)}" placeholder="To">
          <input type="date" name="connection.legs.${i}.date" value="${esc(l.date)}">
          <input name="connection.legs.${i}.ref" value="${esc(l.ref)}" placeholder="Flight / carrier">
          <button class="icon-btn" data-act="delleg" data-i="${i}" aria-label="Remove leg">✕</button></div>`).join('')}
        <button class="btn sm" data-act="addleg">+ Leg</button></div>` : ''}` : ''}
    ${cats.includes('food') ? field('Meal', `<select name="meal"><option value="">—</option>${opts(MEALS, d.meal)}</select>`) : ''}
    <div class="two">${field('Date', `<input type="date" name="date" value="${esc(d.date)}">`)}
      ${field('Until (optional)', `<input type="date" name="endDate" value="${esc(d.endDate)}">`)}</div>
    ${field('Place', `<input name="place" value="${esc(d.place)}" placeholder="City / venue">`)}
    <div class="two amount">
      ${field(d.kind === 'refund' ? 'Refund amount' : (isTrip ? 'Amount paid' : 'Amount'), `<input name="amount" inputmode="decimal" value="${esc(d.amount ?? '')}" placeholder="0">`, isTrip ? 'Final amount actually paid (after discounts)' : 'Rough numbers are fine')}
      ${field('Currency', `<input name="currency" list="curlist" data-rr value="${esc(cur)}" maxlength="3" autocapitalize="characters" ${pm === 'ils' ? 'readonly' : ''}>`)}
    </div>
    <datalist id="curlist">${opts(cfg.currencies, '')}</datalist>
    ${isTrip ? paymentSection(d, pm, cur, giftLabels, specialLabels) : ''}
    ${d.kind !== 'refund' ? `<div class="field"><span>Gratuity add-ons</span>
      ${gratuityItems(d, plan).map((g, i) => `<div class="sub card grat">
        <div class="row"><select name="gratuities.${i}.type" data-rr>${opts(GRATUITY_TYPES, g.type)}</select>
          <button class="icon-btn" data-act="delgrat" data-i="${i}" aria-label="Remove gratuity">✕</button></div>
        ${g.type === 'percent' ? `<input name="gratuities.${i}.pct" inputmode="decimal" value="${esc(g.pct ?? '')}" placeholder="% e.g. 15">`
          : g.type === 'ppd' ? `<div class="two"><input name="gratuities.${i}.amount" inputmode="decimal" value="${esc(g.amount ?? '')}" placeholder="Per person per day (${esc(cur)})">
              <input name="gratuities.${i}.persons" inputmode="numeric" value="${esc(g.persons ?? '')}" placeholder="Persons (${plan.travelers || 1})"></div>
              <div class="two"><input name="gratuities.${i}.days" inputmode="numeric" value="${esc(g.days ?? '')}" placeholder="Days"><span class="muted small center">or</span></div>
              <div class="two"><input type="date" name="gratuities.${i}.from" value="${esc(g.from ?? '')}"><input type="date" name="gratuities.${i}.to" value="${esc(g.to ?? '')}"></div>`
          : `<input name="gratuities.${i}.amount" inputmode="decimal" value="${esc(g.amount ?? '')}" placeholder="Amount (${esc(cur)})">`}
      </div>`).join('')}
      <button class="btn sm" data-act="addgrat">+ Gratuity</button>
      <small class="hint">Counts toward this expense's category, tagged "gratuity".</small></div>` : ''}
    <div class="field"><span>Tags</span><div class="chips">${allTags.map((t) => `<button data-act="tag" data-t="${esc(t)}" class="chip${d.tags.includes(t) ? ' on' : ''}">${esc(t)}</button>`).join('')}</div>
      <div class="row"><input id="newtag" placeholder="New tag" autocomplete="off"><button class="btn sm" data-act="addtag">Add</button></div></div>
    ${field('Notes', `<textarea name="notes" rows="2">${esc(d.notes)}</textarea>`)}
    <div class="preview card" id="preview"></div>
    <button class="btn primary full">Save</button>
    ${!isNew ? '<button class="btn ghost full danger-text" data-act="delete">Delete</button>' : ''}`;
  };

  const updatePreview = (form) => {
    const el = form.querySelector('#preview');
    if (!el) return;
    const tmp = normalize(structuredClone(d));
    const c = entryCost({ ...tmp, id: id === 'new' ? '__new' : id }, plan, ledger());
    const cur = tmp.currency;
    if (cur !== 'ILS') ensureRate(cur, today());
    const lines = [];
    if (c.empty) lines.push('<span class="muted">No amount yet</span>');
    else if (c.missingRate) lines.push(`<span class="warn">No ${esc(cur)} rate yet (offline?)</span>`);
    else {
      lines.push(`<b>${fmtILS(c.ils, c.estimate)}</b>${cur !== 'ILS' && c.rate ? ` <span class="muted small">@ ${fmtRate(c.rate)}</span>` : ''}`);
      if (c.gratIls) lines.push(`<span class="muted small">incl. gratuity ${fmtILS(c.gratIls)}</span>`);
      if (!isTrip && cur !== 'ILS') lines.push('<span class="muted small">Plans use the current rate</span>');
      if (isTrip && WALLETISH.includes(tmp.payment.method) && d.kind !== 'refund') lines.push('<span class="muted small">Exact ₪ comes from the wallet after saving</span>');
    }
    el.innerHTML = lines.join('<br>');
  };

  return {
    title: isNew ? (isTrip ? 'New expense' : 'New cost') : 'Edit', back, tab: 'home',
    html: '<form class="form" id="ef" autocomplete="off"></form>',
    bind(root) {
      const form = root.querySelector('#ef');
      bindForm(form, d, {
        render,
        onInput: () => updatePreview(form),
        actions: {
          kind: ({ v }) => { d.kind = v; },
          cat: ({ id: c }) => { d.categories = d.categories.includes(c) ? d.categories.filter((x) => x !== c) : [...d.categories, c]; },
          tag: ({ t }) => { d.tags = d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t]; },
          addtag: () => {
            const t = form.querySelector('#newtag').value.trim().toLowerCase();
            if (!t) return false;
            if (!d.tags.includes(t)) d.tags.push(t);
            if (!cfg.tags.includes(t)) saveSettings({ tags: [...cfg.tags, t] });
          },
          addgrat: () => { d.gratuities.push({ type: 'fixed' }); },
          delgrat: ({ i }) => { d.gratuities.splice(+i, 1); },
          addleg: () => { d.connection.legs.push({ from: '', to: '', date: d.date || '', ref: '' }); },
          delleg: ({ i }) => { d.connection.legs.splice(+i, 1); },
          pay: ({ v }) => { d.payment = { ...d.payment, method: v }; if (v === 'ils') { if (d.currency !== 'ILS' && d.currency) { d.foreignCurrency = d.currency; d.foreignAmount = d.amount; } d.currency = 'ILS'; } },
          delete: async () => {
            if (await confirmDialog('Delete this entry?', { ok: 'Delete', danger: true })) { remove('entries', id); location.hash = back; }
            return false;
          },
        },
        submit: async () => {
          const data = normalize(structuredClone(d));
          if (data.payment.method === 'gift' && !data.payment.label) { toast('Pick which gift card / credit'); return; }
          if (data.payment.method === 'special' && !data.payment.label) { toast('Name the special account (e.g. "Onboard")'); return; }
          if (!/^[A-Z]{3}$/.test(data.currency)) { toast('Currency must be a 3-letter code'); return; }
          const btn = form.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Saving…';
          const date = data.date || plan.startDate || today();
          const prevSame = existing && existing.currency === data.currency && existing.date === data.date && existing.officialRate && !existing.officialRateEstimate;
          if (!prevSame) {
            const r = await officialRate(data.currency, date);
            data.officialRate = r.rate; data.officialRateEstimate = r.estimate; data.officialRateSource = r.source;
          }
          const eid = isNew ? newId('entries') : id;
          put('entries', eid, { ...(existing || {}), ...data, planId, createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now() });
          if (data.currency !== 'ILS' && !cfg.currencies.includes(data.currency)) saveSettings({ currencies: [...cfg.currencies, data.currency] });
          location.hash = back;
        },
      });
    },
  };
}

const WALLETISH = ['bank', 'cash', 'gift', 'special'];

function paymentSection(d, pm, cur, giftLabels, specialLabels) {
  const p = d.payment; const refund = d.kind === 'refund';
  const methods = PAY_METHODS.filter((m) => !refund || ['ils', 'card', 'bank', 'cash'].includes(m.id));
  let extra = '';
  if (pm === 'ils') {
    extra = `<div class="two">${field('Foreign price (optional)', `<input name="foreignAmount" inputmode="decimal" value="${esc(d.foreignAmount ?? '')}">`, 'If you also know it')}
      ${field('Its currency', `<input name="foreignCurrency" list="curlist" maxlength="3" value="${esc(d.foreignCurrency ?? '')}">`)}</div>`;
  } else if (pm === 'card') {
    extra = field(refund ? '₪ credited' : '₪ charged', `<input name="payment.ilsCharged" inputmode="decimal" value="${esc(p.ilsCharged ?? '')}">`,
      'Leave empty until the charge posts — estimated at the official rate meanwhile. Actual rate = ₪ ÷ amount.');
  } else if (refund && (pm === 'bank' || pm === 'cash')) {
    extra = field('Refund rate (₪ per unit)', `<input name="payment.rate" inputmode="decimal" value="${esc(p.rate ?? '')}">`, 'Empty = official rate of the day. The money returns to the balance at this rate.');
  } else if (pm === 'gift') {
    extra = field('Which gift card / credit', `<input name="payment.label" list="giftlist" value="${esc(p.label ?? '')}">
      <datalist id="giftlist">${opts(giftLabels, '')}</datalist>`, giftLabels.length ? '' : `No ${esc(cur)} gift cards in the wallet yet — add one under Wallet.`);
  } else if (pm === 'special') {
    extra = field('Special account', `<input name="payment.label" list="speclist" value="${esc(p.label ?? '')}" placeholder="e.g. Onboard">
      <datalist id="speclist">${opts(specialLabels, '')}</datalist>`, 'Charges build up here and are settled later from the Wallet.');
  } else if (pm === 'bank' || pm === 'cash') {
    extra = `<small class="hint">Taken from your ${pm} ${esc(cur)} balance at its average rate.</small>`;
  }
  return `<div class="field"><span>${refund ? 'Refunded to' : 'Paid with'}</span>
    <div class="chips">${methods.map((m) => `<button data-act="pay" data-v="${m.id}" class="chip${pm === m.id ? ' on' : ''}">${esc(m.label)}</button>`).join('')}</div></div>${extra}`;
}

function normalize(d) {
  d.currency = (d.currency || 'ILS').toUpperCase().trim();
  if (d.payment?.method === 'ils') d.currency = 'ILS';
  d.amount = num(d.amount);
  d.foreignAmount = num(d.foreignAmount);
  d.foreignCurrency = (d.foreignCurrency || '').toUpperCase().trim();
  d.categories = sortCats(d.categories || []);
  if (!d.categories.includes('transport')) { d.method = ''; d.connection = { on: false, legs: [] }; }
  if (!d.categories.includes('food')) d.meal = '';
  d.connection.legs = (d.connection.legs || []).filter((l) => l.from || l.to || l.ref);
  d.gratuities = d.kind === 'refund' ? [] : (d.gratuities || []).map((g) => ({
    type: g.type || 'fixed', amount: num(g.amount), pct: num(g.pct), persons: num(g.persons), days: num(g.days), from: g.from || '', to: g.to || '',
  }));
  const p = d.payment || { method: 'none' };
  d.payment = { method: p.method || 'none', ilsCharged: num(p.ilsCharged), rate: num(p.rate), label: (p.label || '').trim() };
  d.title = (d.title || '').trim();
  return d;
}
