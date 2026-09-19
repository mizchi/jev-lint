---
name: jev-lint-repo
description: "Use when changing jev-lint ITSELF — editing src/, the shipped rules and their evals under rules/<id>/, or the recorded runs in docs/data/. Complements the user-facing `jev-lint` skill (which this repository also loads) with the maintainer loop: labels, arms measurement, CI, replay. Not for using jev-lint on another project."
---

# Maintaining jev-lint

The user-facing skill (`skills/jev-lint/`, symlinked into `.claude/skills/`)
is the contract; this file is what is different when the repository is
jev-lint's own. Read `docs/internal.md` before editing `src/`.

## The loop

```bash
npm test                                   # no key, no network
npm run ci                                 # typecheck, test, build, eval --replay
node --experimental-strip-types src/cli.ts eval rules/<id> --repeat 3   # one rule's evals, then --accept
node --experimental-strip-types src/cli.ts check --dry-run    # self-lint plan, via .jev-lint.yaml
node --experimental-strip-types src/cli.ts review --base main --retry 3
```

`.jev-lint.yaml` here points at `src`, `tools`, `test/test.ts` and
`package.json`, and deliberately not at `rules/*/evals/cases`, which hold the
labelled defects.

## Rules and their evals

- A rule is `rules/<id>/rule.yml` with its cases in `rules/<id>/evals/`:
  `cases/`, `labels.json` (paths relative to `cases/`, `window: 0` for
  one-per-line subjects), `baseline.json` (accepted) and `last.json`.
  `jev-lint eval rules/<id> --repeat 3` runs it; `--accept` promotes the
  run; `npm run ci` ends in `jev-lint eval --replay`, which fails on a case
  that was right when accepted and is wrong now, or on a rule whose question
  changed since its baseline. The case files carry NO `// DEFECT` /
  `// CLEAN` markers: those sat inside the file the model was shown, and the
  fits they produced were better than the rules (six fell when they came
  out). Editing a case file means shifting the labels below the edit; the
  test suite fails on a label no subject sits on.
- Each suite labels only its own rule. `tools/arms.ts` and
  `tools/grouping.ts` run every rule over every suite's cases
  (`evalCorpus`), where another rule's answer on a suite's file is clean by
  default -- a defect for rule A in rule B's cases is B's false positive
  until labelled.
- A fixture file named for the rule it exercises carries
  `// jev-lint-ignore-file module-name-describes-contents` on line 1, above
  its imports, so the module rule does not judge a name that was never a
  claim about the exports.
- A new rule goes through `experiments/rule-candidates/BRIEF.md`: its own
  cases with hard cleans, `gaps`, `calibrate --repeat 3 --record`, a report
  with a verdict, and one pass over an unseen repository before it enters
  `rules/<id>/` with its evals and an accepted baseline.
- Any change to a shipped rule's `ask`, `criteria`, `note`, matcher,
  `subject` or `state` is a new question: `jev-lint eval --replay` refuses
  the old baseline until you run `jev-lint eval rules/<id> --repeat 3`,
  read the result, and `--accept` it. Commit the baseline with the rule.
- `tools/arms.ts` measures every arm per rule over every suite's cases
  (five arms, two passes, about twenty cents). Re-run it after changing a matcher or splitting a rule; the
  shipped `state:` choices are measurements, not preferences.
- Figures quoted in `README.md`, `docs/reference.md` and `docs/deepdive.md`
  are measured. Change the measurement and the figure together, or neither.

## Plugin

The repository root is a Claude Code plugin (`.claude-plugin/plugin.json`,
`skills/`, `commands/`). Every YAML block in
`skills/jev-lint/references/cookbook.md` must load and match
`test/fixtures/cookbook/`; `npm test` asserts it. A new recipe needs its code
shape added to the fixture.
