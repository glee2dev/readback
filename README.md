# readback

Every number in an AI answer, read back against the source it should have come from.

An assistant that answers questions over your data writes numbers. Some are in the data, some are one step of arithmetic from it, and some are not there at all. `readback` marks each one — **matched**, **derived**, or **no match** — and shows the reason: the exact source figure it was read against, the arithmetic for derived numbers, or the closest candidates and why they failed.

Open `index.html` (served over http) and pick an example, or paste your own answer and source.

## Rules

| kind | must match the source to within |
|---|---|
| count | half a unit, or 0.5% |
| share, money | half a unit at the stated precision, or 1.5% (5% for figures rounded to k or m) |

**Derived** = not in the source, but one step from figures that are: a difference of two same-kind values, 100 minus a share, or one count over another within the same group. Nothing else counts. Phrases that import outside knowledge ("nationally", "research shows", "according to Kelley Blue Book") are flagged. On a question the data cannot answer, the report says whether the answer refused or made figures up.

## Where it comes from

The check is the one used in [vehicle-intelligence](https://gyunpyolee.com/vehicle-intelligence/): ten questions, three setups, eight runs, five labs, 1,719 numbers checked. This is a JavaScript port with the same verdicts — `npm run parity` compares it with the published Python check on every replayed answer (385 of 385 claims agree).

## Use

```js
import { check } from './src/readback.js';
const report = check(answerText, sourceJsonOrCsv);
report.counts      // { n, verified, derived, unverified }
report.claims[0]   // { text, status, why, inputs, formula, candidates, ... }
```

Source can be a JSON object (any nesting) or a CSV/TSV with a label column. Runs in the browser or Node; no dependencies; nothing is uploaded.

```
npm test          # unit tests (ported from the Python suite)
npm run parity    # needs ../vehicle-intelligence checked out next to this repo
npm run serve     # http://localhost:8000
```

## What it does not do (yet)

It checks the answer against the numbers you give it. It does not check that those numbers were computed correctly from raw data — that is the next layer (bring your own CSV, with a visible data contract).

MIT © Gyunpyo Lee
