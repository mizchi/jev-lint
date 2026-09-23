# Dogfood: ts-fuzzing, pkspec, and vite-plugin-moonbit (2026-09-24)

## Scope and method

This pass extends the [vlmkit and chaosbringer report](dogfood-vlmkit-chaosbringer-2026-09-24.md)
to three more `mizchi` repositories. The checked revisions were
`ts-fuzzing@230af34`, `pkspec@41a72c2`, and `vite-plugin-moonbit@5f4bdf0`.
Each was scanned in a detached worktree with a temporary, untracked
`.jev-lint.yaml`; none of the target repositories was changed. The configs
selected rules by full `language/id`, used the file grouping axis and shipped
cutoffs, and limited the roots to source, tests, and package metadata. The
MoonBit runs used the locally built grammar pinned to
`moonbitlang/tree-sitter-moonbit@5435c307c6cf2ef0d508a99047b06f35a4308444`.

We ran `check --dry-run --json --cache none`, then a live
`check --json --cache none --record <path>` with `jev-1.13.0`. The key was
loaded from the shell environment. Raw records and temporary configs are not
committed. `replay` of each final record reproduced its finding count.
These are one-pass results, not calibrated precision or recall estimates.

The TypeScript run excludes `test/fixtures`: an initial pass included 61
fixture subjects and produced three findings on the fixture components.
Fixture code is deliberately unusual and is not the target of this review.
The figures below use the refined scope.

## Measurements

| Repository | Languages answered | Subjects | Planned requests | Planned cost | Findings | Missing | Degraded batches | Unpaired subjects | Live calls | Accounted cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ts-fuzzing | TypeScript / JavaScript / JSON | 902 | 147 | $0.040 | 24 | 0 | 0 | 57 | 147 | $0.035 |
| pkspec | MoonBit | 4,584 | 288 | $0.205 | 50 | 0 | 8 | 80 | 288 | $0.172 |
| vite-plugin-moonbit | TypeScript / JavaScript / MoonBit / JSON | 225 | 19 | $0.012 | 12 | 0 | 0 | 2 | 19 | $0.010 |

Planned cost is the dry-run estimate; accounted cost is the CLI's model-token
accounting, not an invoice. The 8 degraded pkspec batches were all in
`src/cmd/pkspec/spec_cmds.mbt`: the state budget reduced `located` to
`local`, but each subject still received a verdict. The commands exited 1
because findings crossed their cutoffs, not because the run crashed. The
selected rules had no missing verdicts or API errors.

The mixed vite-plugin-moonbit run answered 20 MoonBit subjects and found no
MoonBit violations; all 12 findings were in TypeScript. This small MoonBit
slice says little about MoonBit rule quality. pkspec gave the MoonBit pack a
larger real-code exercise.

## jev-lint defect found and fixed

The paired arm recognized `*_test.mbt` but not MoonBit's colocated
`*_wbtest.mbt` spelling. As a result, the first pkspec plan treated
`tests-cover-failure-paths` as silent and dropped 106 public-function subjects
as unpaired. A regression test now creates `download.mbt` beside
`download_wbtest.mbt` and checks discovery and pairing. It failed before the
change and passed after `isTestFile` recognized the whitebox suffix.

On the same pkspec revision, the corrected plan admitted 26 more subjects
(4,558 to 4,584), cut the unpaired count from 106 to 80, and made
`moonbit/tests-cover-failure-paths` active. The corrected live pass found
three cases for that rule, including `diff_json`'s malformed-JSON returns in
`conformance/src/differ.mbt:16`, `eval_module_to_json`'s error branch in
`src/config/config.mbt:34`, and the usage or unknown-command errors in
`src/adaptershim/shim.mbt:66`. The associated whitebox test files cover
ordinary inputs but have no matching bad-input assertion for those paths.

The remaining 80 unpaired subjects are reported, not scored clean. MoonBit
tests can exercise several source files in one package without matching each
file's name, and the current name/import pairing heuristic cannot prove those
relationships. A future pairing change should carry concrete symbol or call
evidence rather than pairing every same-directory test by proximity.

## Manual review of selected findings

The cases below were chosen to expose both useful findings and likely rule
errors. They are not a random sample of the 86 findings.

| Repository | Rule and source | Review |
| --- | --- | --- |
| ts-fuzzing | `typescript/test-name-verifies-claim`, `test/framework-renderers.test.ts:54` | Valid: the test promises Vue cleanup after `setupApp` throws but only asserts the rejection; cleanup could regress while it passes. |
| ts-fuzzing | `typescript/test-name-verifies-claim`, `test/fuzz-core.test.ts:287` | Valid: the “default maxCases” test asserts a positive case count and internal count equality, not the default bound. |
| pkspec | `moonbit/tests-cover-failure-paths`, `conformance/src/differ.mbt:16` | Valid in the paired evidence: `diff_json` returns named errors for malformed input, while `differ_wbtest.mbt` only exercises valid JSON in its DiffJSON cases. |
| pkspec | `moonbit/test-name-verifies-claim`, `src/executor/executor_wbtest.mbt:97` | Valid: the test title promises sibling capture isolation, but its assertions only check the aggregate outcome and step ordering. |
| vite-plugin-moonbit | `typescript/catch-hides-failure`, `src/index.ts:1786` | Valid: a declaration-generation exception is logged, then the watch path still prints build success, commits success diagnostics, and triggers HMR. |
| vite-plugin-moonbit | `typescript/tests-cover-failure-paths`, `src/manifest.ts:33` | Valid: `readMoonManifest` returns null after a read or parse failure, while `test/manifest.test.ts` tests readable fixtures and no failure case. |
| pkspec | `moonbit/snapshot-only-behaviour-claim`, `src/adaptershim/shim_wbtest.mbt:30` | Likely false positive: the short inline JSON literal itself pins field order and omitted fields; the rule's own exception allows an inline literal that is the named outcome. |
| vite-plugin-moonbit | `typescript/test-name-verifies-claim`, `test/ts-bridge-tree-shake.test.mjs:205` | Likely false positive: the test stashes the installed bridge package, points the generator root at an absent path, and asserts successful build by letting the command throw on failure. |

`typescript/pure-name-is-pure` also flagged `parseMembers` in
`vite-plugin-moonbit/src/manifest.ts:87`. This looks consistent with the
rule: its body reads manifests and warns, although its name sounds like a
computation from the path argument. It is a naming/API design observation,
not evidence of a runtime failure.

The false-positive candidates need repeat passes and a labeled fixture before
changing a rule or cutoff. In particular, the MoonBit snapshot rule's note
already describes the exception that the `encode_case` example appears to
meet. No shipped rule or cutoff was changed in this pass.

## Coverage limits and next checks

Four selected MoonBit rules were silent in pkspec after the pairing fix:
`idempotent-name`, `log-level-matches-event`, `log-message-matches-event`,
and `trait-name-describes-methods`. The selected files contained no matching
constructs for them. The mixed vite-plugin-moonbit run also had silent
MoonBit rules; its parser did load and answer 20 other subjects. A silent
rule is no evidence of either correctness or failure.

For the next dogfood pass, label a representative group below and above each
cutoff, rerun borderline findings with `--retry 3`, and test pairing on a
MoonBit package whose whitebox tests exercise several source files. The
current findings are review leads for the target repositories, not fixes
made to those repositories.
