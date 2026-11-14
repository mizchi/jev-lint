# Expanded specification-drift negative cases

This development corpus contains 69 distinct inputs with evaluator-only labels
in `expect.json`. It includes the original 21-case corpus unchanged. The full set
contains 24 implementation defects, five documentation defects, 28 normal or
unrelated controls, eight context requests, and four owner decisions. Three
repetitions produce 207 model judgments, with two questions per HTTP request.

## Executable defects and normal controls

The 24 implementation pairs execute actual synthetic source in child Node
processes. They cover the original six domains plus exact expiry, premature period
access, hours versus days, missing authentication, the wrong authentication source,
zero/exact/negative credit amounts, repeated releases, insufficient payments,
currency restrictions, delivery IDs versus stable event IDs, trial access,
suspension overrides, refunded payments, seconds versus milliseconds, filtering
before pagination, and soft-deleted records.

Each broken fixture must fail its specified assertions and its normal counterpart
must pass. Syntax/runtime errors and unrelated assertion failures do not qualify.
The separate negative-gate suite has 32 mutations and checks the actual CLI exit
code as well as the exact failed rubric axes. See the [control manifest](../negative-controls.json).

## Live loop

All live runs used `jev-1.14.0`, no cache, and the same frozen 69-case input/oracle
digest. No expectation was relabelled after seeing model answers.

| Run | Samples | Rubric / 100 | Result |
| --- | ---: | ---: | --- |
| [Initial](iteration-00.json) | 207 | 98.91 | The missing custom expiry converter was incorrectly accepted in all three repetitions |
| [After dependency clarification](iteration-01.json) | 207 | 100.00 | All checks pass, with no previously passing check regressed |

The improvement requires the relevant definition or behavioral contract before
trusting an application-defined helper. Standard built-ins still use their known
semantics. The [three dependency probes](dependencies/inputs.json) separately
check an absent helper, a correct supplied helper and a misleading helper that
returns the wrong units. Their [nine live judgments](dependencies/verification.json)
all pass, so the fix does not win by refusing every helper.

The negative-gate expansion also exposed nine report mutations that the old
grader accepted: forged candidate/context/prompt IDs, removed/changed ledgers,
hidden ungrounded summaries, contradictory plans and invalid token usage. Replay
now binds provenance to the recorded question manifest and recomputes the full
ledger and coverage. Historical questions remain replayable rather than being
silently judged against the new prompt.

## Commands

```sh
# Deterministic source/label/vector generation; input and oracle remain separate.
just relations-extended-build

# No model key needed: real assertions plus deliberately failing CLI evaluations.
just relations-negative-check

source ~/.profile
just relations-extended-eval --repeat 3 \
  --compare experiments/relations/extended/iteration-00.json

# No network: re-score the recorded outputs with the unchanged labels.
just relations-extended-eval --replay experiments/relations/extended/iteration-01.json \
  --compare experiments/relations/extended/iteration-00.json
```

Inputs and labels are authored in `tools/build-relation-extended.ts`; regenerate
the JSON after edits. Recorded runs retain source quotes, probabilities, prompt
and corpus digests, per-repetition checks and usage. These are development cases,
not a held-out production-accuracy estimate. The three dependency probes were
added as regression controls after investigating the initial missing-helper miss.
