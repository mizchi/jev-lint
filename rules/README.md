# The shipped rules

One directory per language, one directory per rule under it: `rules/<lang>/<id>/rule.yml` is one rule in one language, `fixtures/` holds the cases that prove it, `expect.yml` says what each case is and why, `baseline.json` is the accepted run. `jev-lint eval` runs them. The same id under `typescript/` and `rust/` is one rule in two languages; the sentence is a copy, and the loader warns if the copies drift.

`typescript` (which admits TypeScript, Tsx, JavaScript and Jsx) and `rust` are the first tier: every rule under them has fixtures, an expect file and a baseline, and the test suite checks it. `javascript/` holds the one rule whose matcher is JavaScript-specific; `json/` holds the `package.json` rule. Other languages may be added at a lower bar and are listed as uncalibrated until they have a baseline.

The notes below were the headers of the packs these rules shipped in before the split; the measurements they cite are recorded in `docs/`.

## naming



## comments



## guarantees



## tests



## messages



## config


