/*
 * readback — read every number in an AI answer back against its source.
 *
 * Port of vehicle-intelligence/eval/check.py, generalised for any domain and extended with
 * the explanation the trace view needs: which rule decided each number, the tolerance used,
 * the arithmetic for derived numbers, and the nearest candidates for numbers with no match.
 *
 *   extractClaims(text, opts)      -> every number the answer asserts, with span and kind
 *   flattenTruth(obj, prefix)      -> every number the source contains, with its path
 *   parseSource(str)               -> JSON object, or a CSV/TSV table turned into one
 *   matchClaims(claims, truth)     -> verified | derived | unverified per claim, with reasons
 *   check(text, source, opts)      -> one report: claims, counts, external phrases, refusal
 *
 * Rules (same as the published experiment):
 *   counts must be near-exact (half a unit, or 0.5% relative)
 *   percentages and money: half a unit at the stated precision, or 1.5% relative ('$26k': 5%)
 *   derived = the difference of two same-kind values, 100 − a share, or count ÷ count × 100
 *   within one group. Nothing else counts.
 * Works in the browser and in Node (ES module, no dependencies).
 */

const NUM = String.raw`(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
export const DEFAULT_NOUNS = ['households?', 'purchases?', 'events?', 'owners?', 'records?', 'transactions?', 'vehicles?', 'people', 'respondents?',
  'customers?', 'users?', 'orders?', 'accounts?', 'rows?', 'items?', 'units?', 'employees?', 'patients?', 'students?', 'companies',
  'company', 'stores?', 'sessions?', 'visits?', 'sales', 'cases?', 'members?', 'subscribers?', 'clients?', 'products?', 'deals?', 'tickets?'];

function patterns(nouns) {
  const N = nouns.join('|');
  return [
    ['usd', new RegExp(String.raw`(?:\$|USD\s?)\s?` + NUM + String.raw`\s?(?<suffix>[kKmM](?![A-Za-z]))?(?!\s?%)`, 'g')],
    ['usd', new RegExp(NUM + String.raw`\s?(?<suffix>[kKmM](?![A-Za-z]))?\s?(?:USD|dollars)\b`, 'g')],
    ['pct', new RegExp(NUM + String.raw`\s?(?:%|percent(?:age)?\b(?!\s+points))`, 'g')],
    ['pts', new RegExp(NUM + String.raw`\s?(?:percentage\s+points?|pts?\b|points?\b)`, 'g')],
    ['count', new RegExp(NUM + String.raw`(?=\s+(?:` + N + String.raw`)\b)`, 'gi')],
    ['plain', new RegExp(String.raw`(?<![\d.,$%])(?<!HH-)(?<!HH‑)(?<!HH–)(?<!HH)` + NUM + String.raw`(?![\d.,%]|s\b|\s?%|\s?(?:k|m)\b|-?year)`, 'gi')],
  ];
}
const YEAR_RANGE = [1980, 2035];
const SMALL_PLAIN_MAX = 12;

const toFloat = (num, suffix) => {
  let v = parseFloat(num.replace(/,/g, ''));
  if (suffix && suffix.toLowerCase() === 'k') v *= 1e3;
  else if (suffix && suffix.toLowerCase() === 'm') v *= 1e6;
  return v;
};
const isInt = v => Number.isInteger(v);

export function extractClaims(text, opts = {}) {
  const taken = []; const claims = [];
  const overlaps = (a, b) => taken.some(([s, e]) => !(b <= s || a >= e));
  for (const [kind, pat] of patterns(opts.nouns || DEFAULT_NOUNS)) {
    for (const m of text.matchAll(pat)) {
      const s = m.index; let e = s + m[0].length;
      if (overlaps(s, e)) continue;
      const num = m.groups.num; const v = toFloat(num, m.groups.suffix);
      if (kind === 'plain' || kind === 'count') {
        if (num.startsWith('0') && num.length > 1) continue;
        if (v >= YEAR_RANGE[0] && v <= YEAR_RANGE[1] && isInt(v) && /\b(?:in|since|before|after|by|from|through|until|of)\s*$/.test(text.slice(Math.max(0, s - 8), s))) continue;
        if (/\bage[sd]?\s*$/i.test(text.slice(Math.max(0, s - 6), s))) continue;
        if (/^\s?(?:×|x\s*\()/.test(text.slice(e, e + 3))) continue;
      }
      if (kind === 'plain') {
        if (v >= YEAR_RANGE[0] && v <= YEAR_RANGE[1] && isInt(v)) continue;
        if (v <= SMALL_PLAIN_MAX && isInt(v)) continue;
        const after = text.slice(e, e + 1);
        if ((after === '.' || after === ')') && v < 20) continue;
      }
      taken.push([s, e]);
      const raw = m[0];
      e = s + raw.trimEnd().length;
      const c = { text: raw.trim(), value: v, kind, start: s, end: e, status: 'unverified', matchedPath: null, matchedValue: null, denominatorStated: null };
      if (kind === 'pct') {
        const sb = Math.max(...['.', '!', '?', '\n'].map(ch => text.lastIndexOf(ch, s - 1))) + 1;
        const ends = ['.', '!', '?', '\n'].map(ch => text.indexOf(ch, e)).filter(i => i !== -1);
        const se = ends.length ? Math.min(...ends) : text.length;
        const w = text.slice(sb, se).toLowerCase();
        c.denominatorStated = /\b(of|among|out of)\b.{0,40}\b(households?|purchases?|events?|owners?|records?|transactions?|segment|cohort|sample|customers?|users?|orders?|rows?)\b|\b(households?|purchases?|events?|owners?|records?|transactions?|customers?|users?|orders?)\b.{0,15}\b(had|have|are|were|hold|switched|bought)\b|n\s?=\s?\d|\d[\d,]*\s?\/\s?\d[\d,]*|\bout of\b/.test(w);
      }
      claims.push(c);
    }
  }
  claims.sort((a, b) => a.start - b.start);
  return claims;
}

/* ── source ─────────────────────────────────────────────────────────────── */
const PCT_HINT = /(pct|percent|share|rate)/i, USD_HINT = /usd/i;
const SKIP_KEYS = new Set(['processing_ms', 'cached', 'window_before_years', 'window_after_years', 'window_years', 'min_count', 'years_observed', 'year', 'age', 'temperature', 'match_pct_of_sample']);

export function flattenTruth(stats, prefix = '') {
  const out = [];
  const walk = (obj, path) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP_KEYS.has(k) || ['filters', 'params', 'of', 'spec'].includes(k)) continue;
        walk(v, path ? `${path}.${k}` : k);
      }
    } else if (Array.isArray(obj)) obj.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (typeof obj === 'number' && Number.isFinite(obj)) {
      const parts = path.split('.'); const tail = parts[parts.length - 1]; const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
      const kind = (PCT_HINT.test(tail) || PCT_HINT.test(parent) || tail.endsWith('_pct')) ? 'pct' : (USD_HINT.test(tail) || parent === 'spend_span') ? 'usd' : 'count';
      out.push({ path, value: obj, kind });
    }
  };
  walk(stats, prefix);
  return out;
}

/* JSON, or a CSV/TSV table: each numeric cell becomes "<row label>.<column>" with a kind guessed from
   the header ("%", "pct", "share", "rate" -> pct; "$", "usd", "revenue", "price", "spend" -> usd). */
export function parseSource(str) {
  const s = (str || '').trim();
  if (!s) return {};
  if (s[0] === '{' || s[0] === '[') return JSON.parse(s);
  const delim = s.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = s.split(/\r?\n/).filter(Boolean).map(l => splitRow(l, delim));
  const head = rows[0]; const obj = {};
  for (const r of rows.slice(1)) {
    const label = (r[0] || '').trim() || `row${Object.keys(obj).length + 1}`;
    const rec = {};
    head.forEach((h, i) => {
      if (i === 0) return;
      const cell = (r[i] || '').trim(); const n = parseNum(cell); if (n === null) return;
      const hk = h.trim(); const lk = hk.toLowerCase();
      let key = hk.replace(/\s+/g, '_');
      if ((/%|pct|percent|share|rate/.test(lk) || /%$/.test(cell)) && !/_pct$/.test(key)) key += '_pct';
      else if ((/\$|usd|revenue|price|spend|cost|amount|sales_value/.test(lk) || /^\$/.test(cell)) && !/usd/i.test(key)) key += '_usd';
      rec[key] = n;
    });
    obj[label.replace(/\./g, '·')] = rec;
  }
  return obj;
}
function splitRow(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === d && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}
function parseNum(cell) {
  const c = cell.replace(/[$€£₩%\s]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(c)) return null;
  return parseFloat(c);
}

/* ── matching ───────────────────────────────────────────────────────────── */
const decimals = t => { const m = t.replace(/,/g, '').match(/\.(\d+)/); return m ? m[1].length : 0; };
export function tolerance(claimVal, claimText, truth, kind = 'pct') {
  const half = 0.5 * 10 ** (-decimals(claimText));
  let tol, rule;
  if ((kind === 'count' || kind === 'plain') && isInt(claimVal)) { tol = Math.max(half, 0.005 * Math.abs(truth)); rule = 'count: within half a unit or 0.5%'; }
  else { tol = Math.max(half, 0.015 * Math.abs(truth)); rule = `${kind === 'usd' ? 'money' : 'share'}: within half a unit at the stated precision or 1.5%`; }
  if (/[kKmM]\b/.test(claimText)) { tol = Math.max(tol, 0.05 * Math.abs(truth)); rule = 'rounded to k/m: within 5%'; }
  return { tol, rule };
}
const close = (v, t, truth, kind) => Math.abs(v - truth) <= tolerance(v, t, truth, kind).tol;
const compatible = (ck, tk) => ck === 'pct' || ck === 'pts' ? tk === 'pct' : ck === 'usd' ? tk === 'usd' : true;
const block = p => p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : p;
const lastKey = p => p.slice(p.lastIndexOf('.') + 1);
const GROUP_RE = /^((?:sample\.)?(?:answerable_part\.)?(?:groups\.[^.[]+))/;
const group = p => { const m = p.match(GROUP_RE); return m ? m[1] : (p.startsWith('sample') ? 'sample' : 'population'); };
const tree = p => p.startsWith('sample') ? 'sample' : 'population';
/* a gauge: where the claim sits relative to the figure it was read against, and the tolerance band */
export function gauge(c, nominal) {
  if (nominal == null || !Number.isFinite(nominal)) return null;
  const { tol, rule } = tolerance(c.value, c.text, nominal, c.kind);
  const base = Math.abs(nominal) || 1;
  return { nominal, value: c.value, tol, rule, devPct: (c.value - nominal) / base * 100, tolPct: tol / base * 100 };
}
const fmt = v => Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(+v.toFixed(2));

export function matchClaims(claims, truth) {
  for (const c of claims) {
    if (c.status === 'ignored') continue;
    let best = null;
    for (const t of truth) if (compatible(c.kind, t.kind) && close(c.value, c.text, t.value, c.kind))
      if (!best || Math.abs(c.value - t.value) < Math.abs(c.value - best.value)) best = t;
    if (best) {
      Object.assign(c, { status: 'verified', matchedPath: best.path, matchedValue: best.value, inputs: [best.path], gauge: gauge(c, best.value),
        why: `${c.text} matches ${best.path} = ${fmt(best.value)} (${tolerance(c.value, c.text, best.value, c.kind).rule})` });
      continue;
    }
    let found = null;
    outer: for (let i = 0; i < truth.length; i++) {
      const a = truth[i];
      for (const b of truth.slice(i + 1)) {
        if (a.kind !== b.kind) continue;
        if (c.kind === 'plain' && a.kind === 'pct') continue;
        if (!compatible(c.kind, a.kind)) continue;
        if (tree(a.path) !== tree(b.path)) continue;
        const sameKey = lastKey(a.path) === lastKey(b.path);
        if (a.kind !== 'count' && !(block(a.path) === block(b.path) || sameKey)) continue;
        const d = Math.abs(a.value - b.value);
        if (d > 0 && close(c.value, c.text, d, c.kind)) {
          const [hi, lo] = a.value >= b.value ? [a, b] : [b, a];
          found = { path: `|${a.path} - ${b.path}|`, value: d, inputs: [hi.path, lo.path], formula: `${fmt(hi.value)} − ${fmt(lo.value)} = ${fmt(d)}` };
          break outer;
        }
      }
    }
    if (!found && c.kind === 'pct')
      for (const t of truth) if (t.kind === 'pct' && t.value > 0 && t.value < 100 && close(c.value, c.text, 100 - t.value, 'pct')) {
        found = { path: `100 - ${t.path}`, value: 100 - t.value, inputs: [t.path], formula: `100 − ${fmt(t.value)} = ${fmt(100 - t.value)}` }; break; }
    if (!found && (c.kind === 'pct' || c.kind === 'plain')) {
      const counts = truth.filter(t => t.kind === 'count');
      outer2: for (const a of counts) for (const b of counts) {
        if (a === b || group(a.path) !== group(b.path) || !b.value || a.value > b.value) continue;
        const v = a.value / b.value * 100;
        if (close(c.value, c.text, v, 'pct')) { found = { path: `${a.path} / ${b.path} * 100`, value: v, inputs: [a.path, b.path], formula: `${fmt(a.value)} ÷ ${fmt(b.value)} × 100 = ${fmt(v)}` }; break outer2; }
      }
    }
    if (found) Object.assign(c, { status: 'derived', matchedPath: found.path, matchedValue: Math.round(found.value * 100) / 100, inputs: found.inputs, formula: found.formula, gauge: gauge(c, found.value),
      why: `${c.text} is not stated in the source, but ${found.formula} from figures that are` });
    else {
      c.status = 'unverified';
      c.candidates = nearest(c, truth);
      const fam = k => k === 'pct' || k === 'pts' ? 'share' : k === 'usd' ? 'usd' : 'n'; // gauge only against the same kind of figure
      const near = c.candidates.find(k => fam(c.kind) === fam(k.kind));
      c.gauge = near ? { ...gauge(c, near.value), against: near.path } : null;
      c.why = c.candidates.length ? `No source figure within tolerance. Closest: ${c.candidates.map(k => `${k.path} = ${fmt(k.value)} (${k.reason})`).join('; ')}`
        : 'No source figure of a compatible kind';
    }
  }
  return claims;
}
function nearest(c, truth) {
  return truth.map(t => {
    const rel = Math.abs(c.value - t.value) / Math.max(Math.abs(t.value), 1e-9);
    const reason = !compatible(c.kind, t.kind) ? `wrong kind: ${c.kind} vs ${t.kind}` : `off by ${(rel * 100).toFixed(1)}%`;
    return { path: t.path, value: t.value, kind: t.kind, rel: compatible(c.kind, t.kind) ? rel : rel + 10, reason };
  }).sort((a, b) => a.rel - b.rel).slice(0, 3).map(({ rel, ...k }) => k);
}

/* ── language ───────────────────────────────────────────────────────────── */
const EXTERNAL = [String.raw`\btypically\b`, String.raw`\bgenerally\b`, String.raw`\bresearch (?:shows|suggests|indicates)\b`, String.raw`\bstudies (?:show|suggest)\b`,
  String.raw`\bindustry (?:average|benchmark|data|norms?|trends?)\b`, String.raw`\bnational(?:ly)? (?:average|rate|figure|data|level)\b`,
  String.raw`\bin the (?:u\.?s\.?|united states|us market)\b`, String.raw`\baccording to\b(?! the (?:data|dataset|records|statistics|json|pipeline))`,
  String.raw`\bbenchmark\b`, String.raw`\bmarket data\b`, String.raw`\bconsumers? (?:tend|usually|often|generally)\b`,
  String.raw`\b(?:it is|it's) (?:well[- ])?known\b`, String.raw`\bcommon(?:ly)? (?:known|observed|seen)\b`, String.raw`\bon average,? (?:people|consumers|americans|households) \b`,
  String.raw`\bcensus\b`, String.raw`\bbls\b`, String.raw`\bfederal\b`, String.raw`\bkelley blue book\b`, String.raw`\bedmunds\b`, String.raw`\bj\.?d\.? power\b`].map(p => new RegExp(p, 'gi'));
const REFUSAL = [String.raw`cannot be (?:answered|computed|determined|calculated)`, String.raw`can(?:no|')t be (?:answered|computed|determined|calculated)`,
  String.raw`not (?:possible|able) to (?:answer|compute|determine|calculate)`, String.raw`(?:does|do) not (?:contain|include|have|record)`,
  String.raw`(?:is|are) not (?:available|recorded|present|in the data|in the dataset|included)`, String.raw`no (?:such|external|national|numeric|dollar) `,
  String.raw`(?:isn't|is not|aren't|are not) (?:in|part of) (?:the|this) (?:data|dataset|records)`, String.raw`unanswerable`,
  String.raw`(?:only|solely) (?:as|in) (?:a )?(?:bracket|categor)`, String.raw`(?:would|could) (?:be|require) (?:invent|guess|speculat|assum|external)`].map(p => new RegExp(p, 'i'));
const NEGATED = /\b(no|not|cannot|can't|without|lacks?|absent|invented?|unavailable|does not|doesn't|isn't|aren't|would be (?:invent|guess)|is not (?:in|part of|available))\b|question:/i;
const ABBREV = /\b(?:vs|e\.g|i\.e|approx|avg|est|incl|excl|no|cf|ca)\./gi;

export function sentence(text, pos) {
  let masked = text.replace(ABBREV, m => m.slice(0, -1) + ' ');
  masked = masked.replace(/(?<=\d)\.(?=\d)/g, '0');
  const sb = Math.max(...['.', '!', '?', '\n'].map(ch => masked.lastIndexOf(ch, pos - 1))) + 1;
  const ends = ['.', '!', '?', '\n'].map(ch => masked.indexOf(ch, pos)).filter(i => i !== -1);
  return text.slice(sb, ends.length ? Math.min(...ends) : text.length);
}
export function detectExternal(text, includeNegated = false) {
  const hits = [];
  for (const p of EXTERNAL) for (const m of text.matchAll(p)) {
    const neg = NEGATED.test(sentence(text, m.index));
    if (neg && !includeNegated) continue;
    hits.push({ phrase: m[0], start: m.index, end: m.index + m[0].length, negated: neg });
  }
  return hits.sort((a, b) => a.start - b.start);
}
export const detectRefusal = text => REFUSAL.some(p => p.test(text));

/* ── one report ─────────────────────────────────────────────────────────── */
export function check(text, source, opts = {}) {
  const stats = typeof source === 'string' ? parseSource(source) : (source || {});
  const sample = opts.sampleStats || null;
  let truth = sample ? flattenTruth(sample, 'sample') : flattenTruth(stats);
  if (opts.given) truth = truth.concat(flattenTruth(opts.given, 'given'));
  const claims = matchClaims(extractClaims(text, opts), truth);
  for (const c of claims)
    if (c.status === 'unverified' && c.kind === 'pct' && c.value === 0 && /\b0 (?:households?|purchases?|events?|owners?|transactions?)\b/.test(sentence(text, c.start)))
      Object.assign(c, { status: 'derived', matchedPath: 'empty_bucket', why: 'a 0% share of an empty bucket' });
  for (const c of claims) if ((c.kind === 'count' || c.kind === 'plain') && c.value === 0) Object.assign(c, { status: 'ignored', why: 'zero asserts nothing' });
  const first = new Map();
  for (const c of claims) {
    if (c.status === 'ignored') continue;
    const key = ({ pts: 'pct', plain: 'count' }[c.kind] || c.kind) + '|' + c.value;
    if (first.has(key)) {
      const f = first.get(key);
      if (f.status === 'unverified' && c.status !== 'unverified') Object.assign(f, { status: c.status, matchedPath: c.matchedPath, matchedValue: c.matchedValue, inputs: c.inputs, formula: c.formula, why: c.why, gauge: c.gauge, candidates: undefined });
      c.repeatOf = f.start; c.status = 'ignored'; c.why = 'repeat of an earlier mention';
    } else first.set(key, c);
  }
  const extAll = detectExternal(text, true);
  const answerable = stats.answerable !== false;
  const counted = claims.filter(c => c.status !== 'ignored');
  const n = counted.length, nv = counted.filter(c => c.status === 'verified').length, nd = counted.filter(c => c.status === 'derived').length;
  return {
    claims, truth, external: extAll.filter(h => !h.negated), negated: extAll.filter(h => h.negated),
    counts: { n, verified: nv, derived: nd, unverified: n - nv - nd },
    groundingRate: n ? Math.round((nv + nd) / n * 1000) / 1000 : null,
    answerable, refusal: answerable ? null : detectRefusal(text),
    fabricated: answerable ? null : counted.filter(c => c.status === 'unverified' && (c.kind === 'usd' || c.kind === 'pct')).length,
    status: !text.trim() ? 'empty' : (n === 0 ? 'declined' : 'answered'),
  };
}
