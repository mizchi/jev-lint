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

No `TYPESAFE_API_KEY` or `TYPESAFEAI_API_KEY` was available. These are matcher,
cost, and integration measurements. There are no model verdicts on either
repository, so they establish neither finding precision nor recall.

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

## Next measurement

With an API key in the environment, run `just jev-check` in each target
repository, retain a JSON record, and hand-label every reported finding plus
a sample below the cutoff. Rerun borderline cases with `--retry 3` before
changing a cutoff. Compare those labels by rule and language; the shipped
fixture replay alone is not evidence of real-repository precision.
