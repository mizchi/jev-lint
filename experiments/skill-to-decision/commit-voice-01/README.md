# Commit voice evaluation, 2026-11-19

The experiment evaluates the four possible outcomes of the skill condition: pass, fail, unknown and not applicable. The corpus combines the twelve [historical cases](../../../packages/skill-to-decision/examples/commit-cases.json) with [sixteen additional hand-labelled cases](boundary-cases.json). Each split has six historical and eight new observations. The new inputs, expected routes and verdicts were fixed before the first model run. The historical evaluation inputs had been used in an earlier experiment. These are small synthetic regression sets.

| Run | Cutoff | End-to-end agreement | Jev agreement | Requests | Input tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Development before](develop-before.json) | 0.700 | 11/14 | 9/11 | 33 | 27,630 |
| [Development after](develop-after.json) | 0.395 | 14/14 | 10/10 | 30 | 25,131 |
| [Frozen evaluation](evaluation.json) | 0.395 | 14/14 | 8/8 | 24 | 20,217 |

The initial implementation at `e961dda` sent a period followed by spaces to Jev, which correctly identified the imperative but missed the structural defect. It also treated a whitespace-only artifact name as out of scope. The patch trims trailing header whitespace before checking punctuation and treats a blank artifact as unobserved. A third miss was a noun phrase, “a faster cache lookup”, whose mean defect score fell below 0.7.

Each semantic input received three fresh answers from `jev-1.14.0`. The revised development inputs had a maximum single clean score of 0.15 and a minimum single defect score of 0.64. Their midpoint gave the [frozen cutoff](frozen.json). The evaluation verdict uses the mean of the three scores. Eight semantic subjects were answered in full, and none crossed the cutoff between runs. The six remaining verdicts came from static routing, including two unknowns and two out-of-scope observations. The evaluation labels also agree at 0.7, so this sample does not establish that 0.395 improves held-out accuracy. The exporter continues to emit the historical rubric for byte-compatible replay.

The three runs used 87 requests and 72,978 input tokens. The Jev CLI estimated USD 0.003065076 from usage. The linked JSON records contain the per-case routes, predictions, repeated scores, rule draft and reported usage.

## Repeat on the current checkout

From the repository root, use Node 24+, jq and an environment configured for the Jev API. Each invocation below that runs `jev-lint eval` sends the selected synthetic observations to Jev. A new directory keeps each attempt and its records separate.

```sh
set -eu
exp=experiments/skill-to-decision/commit-voice-01
work=$(mktemp -d)
jq -s 'add' packages/skill-to-decision/examples/commit-cases.json "$exp/boundary-cases.json" > "$work/cases.json"
just skill-to-decision "$work/cases.json" "$work/suites"

# The CLI can return 1 after writing a completed run with classification errors.
eval_split() {
  split=$1
  shift
  result=0
  node src/cli.ts eval "$work/suites/$split" --model jev-1.14.0 --repeat 3 \
    --no-config --format json "$@" > "$work/$split-run.json" || result=$?
  [ "$result" -le 1 ] && [ -s "$work/suites/$split/text/rulepipe-commit-imperative/last.json" ]
}

eval_split develop
node "$exp/score.mjs" fit "$work/cases.json" "$work/suites" develop > "$work/frozen.json"
cutoff=$(jq -r .threshold "$work/frozen.json")
node "$exp/score.mjs" score "$work/cases.json" "$work/suites" develop "$cutoff" > "$work/development.json"
eval_split evaluation --threshold "rulepipe-commit-imperative=$cutoff"
node "$exp/score.mjs" score "$work/cases.json" "$work/suites" evaluation "$cutoff" > "$work/evaluation.json"
jq '{threshold, correct, total, semanticCorrect, semanticTotal, flips, routeErrors}' "$work/evaluation.json"
```

Fitting uses development labels only. If the clean and defect ranges overlap, the scorer records the overlap and uses the fixed fallback of 0.7. A missing model score yields an unknown verdict when scoring and prevents fitting. For further tuning, keep this evaluation record and reserve new cases for the next held-out comparison.
