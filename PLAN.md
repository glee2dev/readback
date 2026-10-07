# readback — plan

## v0.1 (this commit)
- [x] JS port of the check with explanations (rule, tolerance, arithmetic, nearest candidates)
- [x] Parity with the Python check: 385/385 claims on the replayed run
- [x] Unit tests ported from the Python suite (8/8)
- [x] Factory floor: three production lines (A no data, B raw records, C pipeline) run the same question; each number is a crate; one QC gate; crates sorted into matched / derived / no match
- [x] Inspector: answer redlined, hand-drawn wire from each number to the source figure it was read against; candidates and reasons for numbers with no match
- [x] Check your own: paste answer + source (JSON or CSV), runs in the browser
- [x] Deep links: `#q07-b` opens question 7 on line B

## v0.2
- [ ] Shareable report for pasted answers (encoded in the link, still nothing uploaded)
- [ ] Batch mode (CLI): a folder of answers + sources → one summary table, exit code for CI
- [ ] Source extraction from common shapes (pandas `describe()`, SQL result tables, markdown tables)
- [ ] Publish on gyunpyolee.com/readback; link from the case study

## v0.3+
- [ ] Bring your own CSV (spec: working-notes/specs/byoc-v1.md): profile, data contract, row accounting
- [ ] Full 3D floor only if the 2.5D one earns attention

## Content
- [ ] Sketch explainer for the launch: "what readback found in N answers"
- [ ] Run it on public AI answers over public data; publish what it catches
