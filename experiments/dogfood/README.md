# Converge dogfood, 2026-09-24

## Scope

Reviewed `mizchi/converge@373b0b0d2217065f4209202d39ca89c4e7bfc73a`
under `src/`, `component/`, `examples/`, and `AGENTS.md`, and
`mizchi/converge_audit@30d9ff2a8edae271938ccb03d50f2e2745fbed72`
under `src/`, `examples/`, and `AGENTS.md`. Both working trees were clean and
were left unchanged. A temporary config declared the local MoonBit parser;
all 101 shipped rules were loaded. The runs used `jev-1.13.0`, file grouping,
the shipped cutoffs, and no verdict cache. The raw records contain rule
metadata, paths, line numbers, and scores, rather than source text or an API
key. The JSON results also hold finding messages.

## Initial runs

| Repository | Subjects | Findings | Missing | Degraded batches | Unpaired | Requests | Accounted cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| converge | 3,190 | 68 | 0 | 0 | 62 | 225 | $0.1131 |
| converge_audit | 17,947 | 502 | 2 | 47 | 326 | 1,144 | $0.6907 |

The two missing answers concern module rules on the 9,517-line
`examples/cf-game-audit/src/index.ts`; they are not clean verdicts. These are
one-pass counts, not precision or recall estimates. The records are the
before-change snapshot:

- `converge-2026-09-24/{record,result}.json`
- `converge_audit-2026-09-24/{record,result}.json`

`jev-lint replay <record.json> --json` reproduces 68 and 502 findings with no
API requests.

## Measured corrections

**MoonBit benchmark cases.** Of the original `test-name-verifies-claim`
findings, 19 in converge and 60 in converge_audit were `test "bench: ..."`
cases with an `@bench.T` parameter. They time an operation and make no
correctness assertion; asking whether an assertion proves the title was the
wrong question. Every case, path, line, and original score is in
`bench-exclusion-2026-09-24.json` as `out_of_scope`. The rule now excludes
titles beginning `bench:`. A Red/Green matcher test covers the exclusion and
keeps the nine existing correctness cases. The refreshed three-pass baseline
has three true positives, no false positives or negatives, no decision flips,
clean scores topping at 0.51, and defects starting at 0.87 under the retained
0.62 cutoff. Dry runs with only this rule change remove exactly 19 and 60
subjects from the respective repositories. The 79 removed subjects had all
been findings in the initial runs.

**Same-package MoonBit tests.** `converge_audit/src/audit/policy.mbt:62`
was reported at 0.92 for lacking failure-path tests. Its six `Refused`
branches are exercised in `src/audit/audit_test.mbt:44-78`. The previous
name/import pairing omitted that file. MoonBit pairing now accepts a test in
the same package when its code calls one of the source file's named
functions; mentions in comments and string literals do not count, and a
nested package is separate. A targeted rerun scored this case 0.63; three
more passes scored 0.62, 0.64, and 0.65, below the 0.68 cutoff. The labelled
case and evidence are in `converge_audit-2026-09-24/annotations.json`.
The targeted run and three-pass record are in that directory too. The
four-case shipped rule suite still has two true positives, two true
negatives, and no decision flips over three passes.

## Full reruns after the corrections

Both repositories were reviewed again at the same pinned revisions and file
scopes, with all shipped rules, no verdict cache, and the updated rule and
pairing code. The records are `after-record.json` and `after-result.json` in
each repository's directory. Both replay to the same finding counts without
API requests.

| Repository | Subjects | Findings | Missing in main run | Degraded batches | Unpaired | Requests | Accounted cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| converge | 3,179 | 47 | 0 | 0 | 54 | 232 | $0.1132 |
| converge_audit | 18,176 | 467 | 2 | 47 | 37 | 1,198 | $0.7025 |

The subject count is 11 lower in converge: 19 benchmarks were excluded and
eight failure-path subjects gained related-test evidence. In converge_audit it
is 229 higher: 60 benchmarks were excluded and 289 failure-path subjects
gained related-test evidence. Thirty of those 289 new subjects were findings.
The previously labelled false positive at `src/audit/policy.mbt:62` scored
0.62 in the full rerun, below its 0.68 cutoff.

The same two module questions on the 9,517-line
`examples/cf-game-audit/src/index.ts` hit the API token limit in the main
converge_audit run. A focused follow-up with only those two rules and
`--group rule` answered both on the same graph arm: 0.33 for
`module-name-describes-contents` (cutoff 0.65) and 0.41 for
`module-naming-consistent` (cutoff 0.60). Neither is a finding. Its record and
result are `converge_audit-2026-09-24/missing-rule-group-{record,result}.json`.
That completes the 21,355 extracted subjects across both repositories. Another
91 potential failure-path subjects had no related test evidence and were
reported as unpaired rather than judged. The follow-up adds two requests and
$0.0007 to the above cost. The full run and follow-up together cost $0.8163
over 1,432 requests.

The total finding count fell from 570 to 514. This is a comparison of two
one-pass runs, not a measured change in precision: 79 original findings were
excluded as out-of-scope benchmarks, newly paired subjects entered the run,
and some unchanged subjects crossed cutoffs between passes. The raw records
retain the individual scores for separating those effects.

The largest groups in the reruns are `test-name-verifies-claim` (19) in
converge, and `tests-cover-failure-paths` (174) and
`var-name-describes-value` (143) in converge_audit. Of all 514 findings, 135
sit less than 0.05 above their rule's cutoff (14 and 121 respectively).
These are review candidates, not labelled defects.

## Review TUI prototype

From this repository, run:

```sh
node --experimental-strip-types tools/review-tui.ts
```

`tui.json` names both pinned runs and their local checkouts. The TUI shows
file-level finding counts and the most frequent reported rule, then every
answer in a selected file, including answers below a cutoff. The two focused
follow-up answers replace the missing values. Source excerpts come from
`git show` at the pinned revision, so a changed working tree cannot silently
change what a reviewer sees. The TUI never calls Jev.

Use Up/Down or `j`/`k` to move, Enter to inspect a file, Tab to switch
repositories, `f` to cycle Findings / Near cutoff / All answers / Unlabeled
findings, `/` to search, and `r` to filter by rule. In a file, `[` and `]`
scroll the source excerpt; `1` marks Defect, `2` Clean, `3` Unsure, and `0`
clears the label. Esc returns to files and `q` quits. Labels are saved after
each decision in the ignored `viewer-labels.local.json`. Press `e` to export
the selected repository's explicit Defect/Clean decisions to a native
`jev-lint --labels` file; Unsure remains unlabeled. The UI does not invent a
single 0–100 quality score across differently calibrated rules.
Red marks findings or human-labelled defects, yellow marks scores near a
cutoff or Unsure, green marks human-labelled clean cases, and cyan marks the
source range. The selected row is reversed as well as marked with `>`; `!`
and `~` retain their meanings without color. Set `NO_COLOR=1` for plain text.

## Remaining measurement

The three-pass targeted run over 154 `src/audit` failure-path subjects had
three decisions flip and 11 scores within 0.05 of the cutoff. Keep the rule
at warning level and inspect those cases before relying on it as a gate.
More same-package matches need labels: a call-shaped mention is stronger than
directory proximity, but it is still a heuristic rather than resolved symbol
identity. Label a sample of both reported and non-reported subjects, including
hard clean cases near each cutoff, before quoting precision or changing other
cutoffs. The 47 degraded batches on the giant TypeScript file persist. The
focused follow-up recovers the two missing answers, but the main file-grouped
run still cannot answer them; the graph payload on a module of this size needs
separate investigation.
