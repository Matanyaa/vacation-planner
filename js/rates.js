// Official exchange rates (₪ per 1 unit of foreign currency), cached in Firestore
// at users/{uid}/rates/{YYYY-MM-DD} = { USD: {rate, source, fetchedAt}, ... } so
// they're available offline and on every device.
//
// Source chain:
//   1. Bank of Israel representative rate (SDMX series RER_<CUR>_ILS)
//   2. Frankfurter (ECB reference rates; historical; covers ILS + ~30 majors)
//   3. open.er-api.com (latest only; covers almost everything, e.g. GEL)
import { state, merge } from './store.js';
import { today, addDays } from './util.js';

const inflight = new Map();
const failed = new Set();
let boiOk = null; // null = untested this session, false = unreachable

const clampDate = (d) => { const t = today(); return !d || d > t ? t : d; };

/** Synchronous lookup from cache. Exact date if present, else nearest earlier, else nearest later. */
export function rateOn(cur, date) {
  if (!cur || cur === 'ILS') return { rate: 1, exact: true, source: 'ILS' };
  date = clampDate(date);
  const hit = state.rates.get(date)?.[cur];
  if (hit?.rate) return { ...hit, exact: true, date };
  let best = null; let bestDate = null;
  for (const [d, obj] of state.rates) {
    const r = obj[cur];
    if (!r?.rate) continue;
    const better = !best
      || (d <= date && (bestDate > date || d > bestDate))
      || (d > date && bestDate > date && d < bestDate);
    if (better) { best = r; bestDate = d; }
  }
  return best ? { ...best, exact: false, date: bestDate } : null;
}

/** Today's rate from cache; kicks off a background fetch if today's isn't cached yet. */
export function currentRate(cur) {
  const r = rateOn(cur, today());
  if (!r?.exact) ensureRate(cur, today());
  return r;
}

export function ensureRate(cur, date) {
  if (!cur || cur === 'ILS') return;
  date = clampDate(date);
  if (state.rates.get(date)?.[cur]) return;
  const k = `${cur}|${date}`;
  if (inflight.has(k) || failed.has(k) || !navigator.onLine) return;
  fetchRate(cur, date).catch(() => failed.add(k));
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * Official rate for a currency on a date, for logging on a transaction.
 * Returns {rate, estimate, source}; estimate=true means "last known rate, not that day's".
 */
export async function officialRate(cur, date) {
  if (!cur || cur === 'ILS') return { rate: 1, estimate: false, source: 'ILS' };
  date = clampDate(date);
  const hit = state.rates.get(date)?.[cur];
  if (hit?.rate) return { rate: hit.rate, estimate: false, source: hit.source };
  if (navigator.onLine) {
    try {
      const r = await withTimeout(fetchRate(cur, date), 7000);
      return { rate: r.rate, estimate: !!r.latestOnly && date !== today(), source: r.source };
    } catch { /* fall through to cache */ }
  }
  const near = rateOn(cur, date);
  return near ? { rate: near.rate, estimate: true, source: near.source } : { rate: null, estimate: true, source: null };
}

export function fetchRate(cur, date) {
  date = clampDate(date);
  const k = `${cur}|${date}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    const errors = [];
    for (const src of [fromBOI, fromFrankfurter, fromErApi]) {
      try {
        const r = await src(cur, date);
        if (r?.rate > 0) {
          merge('rates', date, { [cur]: { rate: r.rate, source: r.source, fetchedAt: Date.now(), ...(r.latestOnly ? { latestOnly: true } : {}) } });
          return r;
        }
      } catch (e) { errors.push(e); }
    }
    throw new Error(`No rate for ${cur} on ${date}`);
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

// ---------- sources ----------

async function fromBOI(cur, date) {
  if (boiOk === false || cur === 'JPY') throw new Error('skip BOI');
  const url = `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${cur}_ILS`
    + `?startPeriod=${addDays(date, -10)}&endPeriod=${date}&format=csv`;
  try {
    const res = await withTimeout(fetch(url), 5000);
    if (!res.ok) throw new Error('BOI ' + res.status);
    const rows = (await res.text()).trim().split(/\r?\n/).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '')));
    const head = rows.shift().map((h) => h.toUpperCase());
    const ti = head.findIndex((h) => h.includes('TIME_PERIOD'));
    const vi = head.findIndex((h) => h.includes('OBS_VALUE'));
    if (ti < 0 || vi < 0) throw new Error('BOI format');
    const obs = rows.filter((r) => r[ti] && r[ti] <= date && +r[vi] > 0).sort((a, b) => (a[ti] < b[ti] ? -1 : 1));
    if (!obs.length) throw new Error('BOI empty');
    boiOk = true;
    return { rate: +obs[obs.length - 1][vi], source: 'Bank of Israel' };
  } catch (e) {
    if (boiOk !== true && (cur === 'USD' || cur === 'EUR')) boiOk = false;
    throw e;
  }
}

async function fromFrankfurter(cur, date) {
  const when = date === today() ? 'latest' : date;
  const res = await withTimeout(fetch(`https://api.frankfurter.dev/v1/${when}?base=${cur}&symbols=ILS`), 6000);
  if (!res.ok) throw new Error('frankfurter ' + res.status);
  const j = await res.json();
  if (!j?.rates?.ILS) throw new Error('frankfurter: no ILS');
  return { rate: j.rates.ILS, source: 'ECB (Frankfurter)' };
}

let erCache = null;
async function fromErApi(cur) {
  if (!erCache || Date.now() - erCache.at > 3 * 3600e3) {
    const res = await withTimeout(fetch('https://open.er-api.com/v6/latest/ILS'), 6000);
    if (!res.ok) throw new Error('er-api ' + res.status);
    const j = await res.json();
    if (j.result !== 'success') throw new Error('er-api failed');
    erCache = { at: Date.now(), rates: j.rates };
  }
  const per = erCache.rates[cur];
  if (!per) throw new Error('er-api: unknown currency');
  return { rate: 1 / per, source: 'open.er-api (latest)', latestOnly: true };
}
