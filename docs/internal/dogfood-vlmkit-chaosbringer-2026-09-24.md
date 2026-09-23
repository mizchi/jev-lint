# Dogfood: vlmkit and chaosbringer (2026-09-24)

## Scope and method

The local `jev-lint` checkout was run over `mizchi/vlmkit` and
`mizchi/chaosbringer` with `check --dry-run --json --cache none`. The target
repositories now contain explicit rule selections and `just jev-plan` /
`just jev-check` recipes. The recipes use this sibling checkout because the
published 0.6.5 package still has the cross-language rule attribution defect
described below. The MoonBit grammar is pinned to
`moonbitlang/tree-sitter-moonbit@5435c307c6cf2ef0d508a99047b06f35a4308444` and built
locally; its platform-specific library is ignored by Git.

The first pass was a dry run. After loading the key from the local shell
profile, the selected configurations were also judged with `jev-1.13.0`,
`--cache none`, and `--record`. The key and raw records are not committed.

## Execution plan

| Repository | Rule selection | Subjects | Requests | Estimated input tokens | Estimated cost |
| --- | --- | ---: | ---: | ---: | ---: |
| vlmkit | all shipped rules | 53,427 | 3,327 | 64,386,703 | $2.70 |
| vlmkit | selected rules | 13,739 | 1,655 | 16,231,642 | $0.68 |
| chaosbringer | all shipped rules | 17,173 | 1,317 | 22,130,734 | $0.93 |
| chaosbringer | selected rules | 4,616 | 619 | 5,231,445 | $0.22 |

The estimates are `--dry-run` output, not billed costs. The full vlmkit
plan's most expensive rule was `var-name-describes-value`: 21,284 subjects,
about $1.06. It is disabled for TypeScript in the selected configuration and
retained for MoonBit, where it matched 284 subjects. The selected plans also
count 94 and 20 subjects, respectively, that the paired arm cannot ask because
it found no related test file. That is reported, not silently treated as a
clean answer.

## Defect found in jev-lint

`collectSubjects` mapped ast-grep matches back to rules by bare `id`. The same
id appears under multiple language directories. The last loaded rule therefore
claimed matches from the others, including its own question, cutoff, state,
and language directory. The initial vlmkit plan said MoonBit was idle even
though a single `.mbt` file produced 169 subjects. A Red test with one
TypeScript and one Python rule sharing an id reproduced the attribution error;
the runner now keys that map by ast-grep's full per-language rule id. The test
is Green, and `npm run ci` passes: 386 tests and 99 replay suites.

After the fix, the full vlmkit plan assigned 1,021 `.mbt` subjects to MoonBit
rules. Fifteen of the 20 MoonBit rules matched at least one subject. The five
silent rules found no matching construct in the selected files:
`idempotent-name`, `log-level-matches-event`, `log-message-matches-event`,
`safe-name-is-safe`, and `trait-name-describes-methods`.

## Matcher quality finding

In vlmkit's MoonBit code, 188 of the 239 subjects for
`comment-describes-declaration` captured only `///|`, the empty separator
that precedes declarations. It carries no claim for the model to check. The
vlmkit configuration turns off that MoonBit rule for the first pass while
keeping its TypeScript version on. The rule's matcher should distinguish a
separator from a substantive comment; changing the shipped rule requires a
fresh fitted baseline, so this run did not alter the rule or its cutoff.

## Target-repository finding

The vlmkit instructions and LLM client comment claimed there was no
`api.openai.com` client or `OPENAI_API_KEY` anywhere in the repository. The
existing image-generation client reads that key and calls the OpenAI Images
API. The instructions, code comment, and configuration guide now scope the
OpenRouter guidance to the LLM client and identify the separate image client.
The associated Vitest file passed (4 tests). This contradiction was found by
manual inspection of matched comments, not by a Jev verdict.

## Live measurement

| Repository | Answered subjects | Findings | Missing verdicts | Degraded batches | Unpaired subjects | API calls | Measured cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vlmkit | 13,739 | 458 | 0 | 9 | 94 | 1,655 | $0.611 |
| chaosbringer | 4,616 | 137 | 16 | 4 | 20 | 617 | $0.194 |

The cost is the CLI's accounting of model tokens, not an invoice. The
`--fail-on` default made both commands exit 1 because they found violations;
neither exited on an exception. In chaosbringer, two requests covering 16
subjects in `drivers/field-values.ts` and `drivers/payloads.ts` received an
HTML 403 from a proxy or firewall. Those subjects are counted as missing,
not clean. The degraded batches fell from `located` to `local` at the state
budget. Neither repository hit the API rate limit.

Of vlmkit's answered subjects, 782 were MoonBit and eight MoonBit findings
crossed their rule cutoffs. `module-name-describes-contents` reported three,
`type-name-describes-shape` three, and `fn-name-promises` two. The low finding
rate does not establish recall without labeled negative samples.

### Manual spot check

This is a deliberately small, case-selected review, not a precision estimate:

| Repository | Rule and source | Review |
| --- | --- | --- |
| vlmkit | `typescript/test-name-verifies-claim`, `packages/vlmkit-anim/src/compile.test.ts:31` | Valid: the determinism test compares `compileScene(scene)` with itself, so it can pass for a nondeterministic implementation. |
| vlmkit | `typescript/fn-name-promises`, `src/manifest-cli.test.ts:264` | Valid: `readFileSyncOrEmpty` throws on a missing file instead of returning an empty value. |
| vlmkit | `moonbit/fn-name-promises`, `visual_json.mbt:54` | Valid: `is_likely_page_surface` returns a `String` across the JSON boundary, despite its predicate name. |
| chaosbringer | `typescript/test-name-verifies-claim`, `packages/server-faults/src/adapters/adapters.test.ts:262` | Valid: a test named “propagates errors via next(err)” exercises a 503 response and never asserts `next(err)`. |
| chaosbringer | `typescript/comment-describes-declaration`, `packages/chaosbringer/src/shard.ts:167` | Valid: the comment says this function handles the flag pair, but `parseShardArg` only accepts the `i/N` string. |
| vlmkit | `typescript/type-name-describes-shape`, `packages/vlmkit-anim/src/compile/annotate.ts:1060` | False positive: `Anchor = "start" | "end" | "middle"` names exactly the alignment values it holds. |
| vlmkit | `moonbit/module-name-describes-contents`, `measure_json.mbt:1` | False positive: the file contains measurement policies across the JSON boundary, as its name and opening comment say. |
| vlmkit | `moonbit/fn-name-promises`, `grid_ratio.mbt:24` | Likely false positive: `grid_all_equal` returns true for fewer than two widths, the usual vacuous meaning of “all equal.” |

The two clear false positives reproduced in all three extra passes:
`measure_json.mbt` averaged 0.637 (spread 0.01, cutoff 0.55), and `Anchor`
averaged 0.653 (spread 0.09, cutoff 0.42). These need rule or state review,
not an uncalibrated cutoff change. The 595 total findings remain largely
unlabeled; do not infer aggregate precision from this table.

### Tool defect found by replaying the live run

`replay` initially returned 453 vlmkit findings, five fewer than the live
458. All five were MoonBit findings with IDs also present in TypeScript.
The record held bare IDs, and replay looked rules up by bare ID, so it applied
the TypeScript cutoff to those MoonBit answers. Its gap table also combined
both languages' answers under each bare ID: for `fn-name-promises` it showed
4,171 matches in each of two rows, rather than 183 MoonBit matches and 3,988
TypeScript matches. Retry and calibration merges used the same ambiguous key.

The follow-up fix records and carries `language/id` through replay, retries,
gaps, stability, and cutoff fitting. Replaying a local copy of the live record
with its answers given their known language keys returned all 458 findings;
the two `fn-name-promises` gap rows then counted 183 and 3,988 matches.
Legacy records with ambiguous bare IDs now fail without a verdict instead of
silently borrowing another language's cutoff.

## Next measurement

Hand-label the remaining findings and a sample below each cutoff, grouped by
rule and language. Rerun borderline cases with `--retry 3` before changing a
cutoff. The shipped fixture replay and this case-selected spot check do not
measure real-repository precision or recall.
