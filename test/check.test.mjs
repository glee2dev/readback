// Unit tests ported from vehicle-intelligence/tests/test_check.py — same cases, same verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, flattenTruth, matchClaims, detectExternal, detectRefusal, check, parseSource } from '../src/readback.js';

const STATS = { n_total: 10000, n_matched: 6251, match_pct: 62.5, answerable: true,
  groups: { all: { n_households: 6251, n_matching: 1817, share_pct: 29.1 } },
  answerable_part: { n_matched: 714, groups: { all: { n_households: 714, n_matching: 120, share_pct: 16.8 } } } };
const by = cs => Object.fromEntries(cs.map(c => [c.text, c.status]));

test('extraction kinds and skips', () => {
  const cs = extractClaims('In 2024, 29.1% of 6,251 households (n=1,817) paid about $26k; 3 opportunities; item 2. done. 12.3 percentage points.');
  const kinds = cs.map(c => `${c.text}|${c.kind}`);
  for (const k of ['29.1%|pct', '6,251|count', '$26k|usd', '12.3 percentage points|pts']) assert.ok(kinds.includes(k), k);
  assert.ok(!cs.some(c => c.value === 2024)); assert.ok(!cs.some(c => c.value === 3)); assert.ok(cs.some(c => c.value === 1817));
  assert.ok(!extractClaims('the 40s cluster vs the 50s cluster over a 3-year window').some(c => c.value === 40 || c.value === 50));
});
test('matching tolerance and kinds', () => {
  const s = by(matchClaims(extractClaims('29.1% verified; 29% rounds fine; 30% is a misstatement; 1,817 households; $1,817 is wrong kind'), flattenTruth(STATS)));
  assert.equal(s['29.1%'], 'verified'); assert.equal(s['29%'], 'verified'); assert.equal(s['30%'], 'unverified');
  assert.equal(s['1,817'], 'verified'); assert.equal(s['$1,817'], 'unverified');
});
test('derived difference', () => {
  const cs = matchClaims(extractClaims('a gap of 12.3 percentage points; 1,697 more households'), flattenTruth(STATS));
  assert.equal(cs[0].status, 'derived'); assert.equal(cs[1].status, 'derived');
  assert.match(cs[0].formula, /29\.1 − 16\.8/);
});
test('complement and group share', () => {
  const stats = { answerable: true, n_total: 10000, groups: { all: { n_purchases: 898, share_pct: 64.9, body_type: { compact: 508, sedan: 292 } } } };
  const s = by(matchClaims(extractClaims('Compact: 508 of 898 purchases (56.6%); 35.1% of events did not increase; 9,102 other households'), flattenTruth(stats)));
  assert.equal(s['56.6%'], 'derived'); assert.equal(s['35.1%'], 'derived'); assert.equal(s['9,102'], 'derived');
});
test('external knowledge and refusal', () => {
  assert.equal(detectExternal('Research shows consumers typically buy SUVs; according to the dataset, 29%.').length, 2);
  assert.equal(detectExternal('according to the data, 29%').length, 0);
  assert.equal(detectExternal('The dataset contains no national benchmark, so no comparison is possible.').length, 0);
  assert.equal(detectExternal('The dataset contains no national benchmark.', true).length, 1);
  assert.ok(detectRefusal('This cannot be answered from the dataset because income is recorded only as a bracket.'));
  assert.ok(!detectRefusal('29.1% of households switched.'));
});
test('unanswerable: refusal vs fabrication', () => {
  const un = { answerable: false, n_matched: 1041, n_total: 10000, match_pct: 10.4, groups: {}, answerable_part: { groups: { all: { income_bracket: { lower: 169, upper_middle: 488 } } } } };
  const good = check('This cannot be computed: income is recorded only as a bracket. 488 households are upper_middle.', un);
  const bad = check('Retired owners earn about $48,000 on average, roughly 15% below the national average.', un);
  assert.ok(good.refusal); assert.equal(good.fabricated, 0); assert.equal(good.counts.unverified, 0);
  assert.ok(!bad.refusal); assert.equal(bad.fabricated, 2); assert.ok(bad.external.length >= 1);
});
test('unverified numbers explain themselves', () => {
  const r = check('Mean spend was $9,456.', { mean_spend_usd: 9733 });
  assert.equal(r.claims[0].status, 'unverified'); assert.match(r.claims[0].why, /mean_spend_usd/); assert.match(r.claims[0].candidates[0].reason, /off by 2\.8%/);
});
test('CSV source', () => {
  const src = parseSource('segment,households,share %,avg spend\nall,577,5.8%,"$11,298"\n');
  const r = check('577 households (5.8%) spent $11,298 a year.', src);
  assert.deepEqual(r.claims.map(c => c.status), ['verified', 'verified', 'verified']);
});
