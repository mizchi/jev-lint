# skill-to-decision

This private development package turns an extracted skill condition and observed inputs into deterministic decisions and Jev evaluation suites. The first condition is `conventional-changelog/commit-subject-voice`. Its [review rubric and source reference](condition.json) identify the captured skill by SHA-256 and line numbers. The condition is a manual translation.

From the repository root, export the example and inspect the evaluation plan offline:

```sh
work=$(mktemp -d)
just skill-to-decision packages/skill-to-decision/examples/commit-cases.json "$work/suites"
node src/cli.ts eval "$work/suites/evaluation" --repeat 3 --dry-run --no-config --format json
```

The CLI takes a JSON array in the [example format](examples/commit-cases.json) and a new output directory. Each case supplies an ID, family, split, observation and expected verdict with a reason. Family membership and input hashes keep development and evaluation data separate. Only the observation goes into the model fixture. Labels and reasons go into the suite's `expect.yml`.

Use `routeCommit(observation)` for a single unlabelled input. It returns one of three actions:

| Action | Meaning for this condition |
| --- | --- |
| `retain` | The artifact is outside commit-message scope, or a complete English header fails its structural requirements. |
| `observe` | Scope, message or language evidence is missing, or the subject exceeds Jev's text limit. The verdict is unknown. |
| `judge` | The structural checks passed. Imperative voice still needs a semantic judgment. The verdict is unknown. |

The CLI writes these routes to `decisions.json`. The `develop/` and `evaluation/` suites contain only inputs that reached `judge`. An export does not invoke a model.

## Historical compatibility

The example selects twelve original cases from the rulepipe experiment's `benchmarks/skill-expansion.json` and `benchmarks/jev-calibration.json`. The regression reference comes from `experiments/jev/skills-01/manifest.json` and its two archived eval plans. It preserves the original Jev rule ID, `rulepipe-commit-imperative`, and the proposed rubric's uncalibrated threshold, 0.7.

Run `pnpm test skill-to-decision` to compare route decisions and SHA-256 hashes for the emitted YAML and fixtures, then execute the repository's real Jev CLI. The test uses the historical relative directory layout because the path contributes to the token estimate.
