import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
let n = 0, bad = 0; for (const k of Object.keys(b)) { n += b[k].length; if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { bad++; console.log('mismatch', k); } }
console.log(`${Object.keys(b).length} answers, ${n} claims, ${bad} mismatched`); process.exit(bad ? 1 : 0);
