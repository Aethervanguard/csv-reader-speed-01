[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aethervanguard/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Aethervanguard/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Fast CSV Reader

An entry for the make.fun bounty
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121):
read broken CSV files faster — byte-identical answers to the house
`csv-reader` 1.0.0 reference, at roughly 5× its speed on the practice
set (and ~2× end-to-end through the driver).

## How it works

`solve.js` exports `run(input)`, the exact `csv-reader` 1.0.0 contract:
BOM stripping, LF/CRLF records, stray-CR / `quote_junk` /
`unterminated_quote` / `short_row` / `long_row` errors with the same
`{code, line, row}` — verified identical to the reference on the full
practice set, 23,000 fuzz cases and 65 targeted edge cases.

Speed comes from structure, not shortcuts:

- **Bulk path:** a record with no quotes is split once (`String.split`
  in C++) and its array is used directly as the row — no per-field
  loop, no copies.
- **Memoised scans:** the next `"`, `\r` and `\n` are each found once
  per position and only ever move forward; a quoted field reuses the
  record-end scan instead of re-scanning.
- **Quoted-field fast path:** a closing quote is found with one
  `indexOf`; content with no doubled quotes, CR or LF is sliced, not
  walked. Only genuinely broken fields fall back to the slow
  character-by-character parser, which mirrors the reference exactly.
- **No extra allocation:** errors are only built for records that
  actually have them; the driver is the house `main.ts` unchanged
  (including `setFlagsFromString('--no-incremental-marking')`).

## Files

- `solve.js` — the parser (`run(input)`).
- `main.ts` — the house driver: reads `/input/cases.json`, writes
  `/output/answers.json`.

## Local validation

```
node test.mjs   # practice set: identical to reference, ~5x faster run()
node fuzz.mjs   # differential fuzz vs reference
node edge.mjs   # targeted edge cases
node bench.mjs  # end-to-end driver benchmark vs baseline
```
