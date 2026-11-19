# Advisory evaluation

Five architecture screens, one reviewer instruction per reported match. Node 24, classic TypeScript 5.9.3 for collection, Jev model `jev-1.14.0`. Detector scores and hint judgments are separate measurements. The hint itself is never included in a detector question.

1. Each shipped suite contains a concealed defect, a plausible false alarm and an unrelated change paired with the clean example. Three live passes per case supplied the per-rule cutoffs. Another three passes per case produced the accepted baselines. The case-review rule from the development checkout checked the five bundles in three passes and flagged none. That checkout built the bundles with `jev-lint rule-cases rules/text/<id> --output <id>.jevcases`.
2. The normal CLI loaded the five rules by their shipped names. On the 15 fixtures it reported five leads, all with hints, and exited 0. The vlmkit manifest produced 88 subjects at the pinned revision and its historical comparison, with six additional contracts marked insufficient. The final run answered all 88 and returned 18 nonblocking candidates. The historical bridge and its current counterpart scored 0.63 and 0.34 at the Liskov cutoff of 0.53. These are source-based judgments.
3. Seven reported matches were paired with the generic instruction “Review the relevant code before making a change.” Five came from the defect fixtures. Two came from vlmkit, including a false alarm on the documented fields of `DEFAULT_INSETS`. The separate reviewer question asked for a feasible check and an observable distinction that could confirm or dismiss the concern. Candidate labels were kept outside the question. At the fixed 0.70 cutoff, the first instructions passed six of seven cases. The information-hiding instruction for the false alarm scored 0.68–0.69. Its revision tells the reader to look up the consumer-facing type and dismiss the finding if the keys and meanings match. It scored 0.88–0.90 on the same case. All seven final instructions passed in all three repeats; all seven generic controls stayed below the cutoff. The detector still flagged the false alarm at 0.83.
4. These are a small development set and model judgments of actionability. They do not estimate production precision or time saved for a human reviewer.

## Reproduce

Run `pnpm run eval:advisories` for the offline check of the shipped questions, thresholds, instruction text and all three rounds of recorded hint scores. `jev-lint replay` on either detector run uses its recorded instructions. To rerun the hint experiment, generate the pinned vlmkit input following [the collector guide](../../docs/advisories.md), then run the following from this repository.

```sh
root=$PWD
work=$(mktemp -d)
node experiments/advisory/prepare-hints.mjs "$evidence" "$work/after"
node experiments/advisory/prepare-hints.mjs "$evidence" "$work/before" before
cd "$work/after"
node "$root/src/cli.ts" check . -R "$root/experiments/advisory/hint-review.yml" --dry-run --no-config --cache none
node "$root/src/cli.ts" calibrate . -R "$root/experiments/advisory/hint-review.yml" --no-config --cache none --labels labels.json --repeat 3 --model jev-1.14.0 --record "$work/review.json"
```

`input-*.json` and `fixtures-*.json` are the detector records before and after revising the instruction. `hints-before.json` and `hints-after.json` contain the reviewer scores and exact text of each question's evidence. The vlmkit excerpts in the experiment are MIT licensed, copyright 2026 mizchi.

## Module and history rules

We also ran six module and two Git rules at the original 0.70 cutoff. Each of the eight suites has three labeled fixtures, a live three-pass baseline, and a case-review record. All 24 fixture cases matched the labels on every pass. The baseline replay and the hint check exercise different questions.

| Checkout (revision) | Module judgments | Module advisories | Commit judgments | Commit advisories |
| --- | ---: | ---: | ---: | ---: |
| mizchi/crater (`6a1c6a84`) | 2,862 | 58 | 40 | 0 |
| mizchi/vlmkit (`468888c5`) | 2,178 | 9 | 40 | 0 |

The corpus contains 630 crater modules and 433 vlmkit modules. Each history run covers the 20 commits ending at the pinned revision. The vlmkit history run initially lacked 30 answers on 15 oversize commits. `retry-history.mjs` retried just the missing pairs with explicitly truncated evidence. The original answers and retry are separate records. Treat these 30 labels as judgments of partial diffs.

The follow-up experiment uses the eight defect fixtures plus crater's public renderer counters and vlmkit's exported auth-state reset. Each candidate was paired with the generic instruction under the same rubric and cutoff as the architecture experiment. The first hints passed 9/10 examples in every round. The Hyrum hint on auth-state scored 0.68–0.69. The revision asks the reviewer to import the binding through a published path and compare what a second caller sees before and after the reset. All ten revised hints passed in all three rounds and all generic controls stayed below cutoff. Auth-state scored 0.88–0.90 for actionability. The detector itself moved from 0.71 to 0.68 on a separate live recheck, below the reporting cutoff. The paired experiment holds the original candidate selection fixed to compare the two instructions.

For offline verification, run `just advisory-replay` in jev-lint. `module-hints.json` and `module-hints-before.json` hold the score and exact input for every example and control. The Git and module detector records store each candidate's file or SHA, rule and score. crater excerpts carry the Apache 2.0 license in `LICENSE.crater`.

To reproduce the live module runs use the companion mizchi/skills checkout with the Node dependencies installed. Set `skills`, `crater`, and `vlmkit` to those checkouts and `work` to a new temporary directory. Check out crater at `6a1c6a840f72a129d8254b65ee5f743e59107bad` with a clean worktree. vlmkit's generator loads `468888c59ff07097892993b1e304882271a4a861` directly from Git. From the jev-lint root:

```sh
root=$PWD
node "$skills/tools/refactor-audit/moon-workspace.mjs" "$crater" "$work/crater"
node "$skills/tools/refactor-audit/vlmkit-data/inputs.mjs" "$vlmkit" "$work/vlmkit"
for repo in crater vlmkit; do
  (cd "$work/$repo" && node "$root/src/cli.ts" check . --config "$root/advisory/modules.yml" --model jev-1.14.0 --cache none --record "$work/$repo-modules.json")
done
(cd "$crater" && node "$root/src/cli.ts" commits 6a1c6a84~20..6a1c6a84 --config "$root/advisory/history.yml" --model jev-1.14.0 --cache none --record "$work/crater-history.json")
(cd "$vlmkit" && node "$root/src/cli.ts" commits 468888c5~20..468888c5 --config "$root/advisory/history.yml" --model jev-1.14.0 --cache none --record "$work/vlmkit-history.json")
# If the history record has missing answers:
node experiments/advisory/retry-history.mjs "$vlmkit" "$work/vlmkit-history.json" "$work/vlmkit-history-retry.json"
node experiments/advisory/module-hints.mjs "$work/crater" "$work/vlmkit" "$work/hints"
(cd "$work/hints" && node "$root/src/cli.ts" calibrate . -R "$root/experiments/advisory/hint-review.yml" --no-config --cache none --repeat 3 --labels labels.json --model jev-1.14.0 --record "$work/module-hints.json")
```

## Teacher data

`teacher.jsonl` contains 34 deterministic JSON Lines, the final shipped and generic hints for 17 evidence cases. Each row includes the exact reviewer input, its SHA-256, the originating record and subject, model, cutoff, three scores and the majority label `actionable`. This is a weak label for the usefulness of an instruction. The sample was used during development. Use `pairId` to keep both variants of a case together when splitting by evidence. Run `just advisory-teacher /tmp/new-teacher.jsonl` to regenerate it from recorded answers, or `just advisory-replay` to verify the shipped file byte for byte.
