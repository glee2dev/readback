// Parity: the JS check must reach the same verdict as eval/check.py on every claim of every replayed answer.
import fs from 'node:fs';
import { check } from '../src/readback.js';
const PY_NOUNS = ['households?','purchases?','events?','owners?','records?','transactions?','vehicles?','people','respondents?'];
const replay = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const q of replay.queries) for (const [mode, m] of Object.entries(q.modes)) {
  const text = m.output.text || '';
  const sample = mode === 'naive_grounded' && q.sample_stats ? (q.sample_stats.naive_grounded || null) : null;
  const r = check(text, q.stats, { sampleStats: sample, nouns: PY_NOUNS });
  out[`${q.id}/${mode}`] = r.claims.map(c => [c.text, c.status]);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
