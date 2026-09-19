---
name: jev-lint-repo
description: "Use when changing jev-lint ITSELF — editing src/, the shipped packs in rules/, the labelled corpus under corpus/, or the recorded runs in docs/data/. Complements the user-facing `jev-lint` skill (which this repository also loads) with the maintainer loop: labels, arms measurement, CI, replay. Not for using jev-lint on another project."
---

# Maintaining jev-lint

The user-facing skill (`skills/jev-lint/`, symlinked into `.claude/skills/`)
is the contract; this file is what is different when the repository is
jev-lint's own. Read `docs/internal.md` before editing `src/`.

## The loop

```bash
npm test                                   # no key, no network
npm run ci                                 # labels:check, typecheck, test, build, replay:ci
node --experimental-strip-types src/cli.ts check --dry-run    # self-lint plan, via .jev-lint.yaml
node --experimental-strip-types src/cli.ts review --base main --retry 3
```

`.jev-lint.yaml` here points at `src`, `tools`, `test` and deliberately not
`corpus/`, which holds the labelled defects.

## Rules and corpus

- Labels live in `corpus/labels.hand.json` (file, line, `bad`/`clean`,
  rule, window, reason); `corpus/build-labels.ts` merges every
  `corpus/**/labels.hand.json` into the generated `corpus/labels.json`, and
  `--check` fails CI if that is stale. Never edit the generated JSON by hand.
  The corpus files carry NO `// DEFECT` / `// CLEAN` markers any more: those
  sat inside the file the model was shown, and the fits they produced were
  better than the rules (six fell when they came out). The builder still
  reads markers if it finds any; do not add them. Editing a corpus file
  means shifting the hand labels below the edit.
- A fixture file named for the rule it exercises carries
  `// jev-lint-ignore-file module-name-describes-contents` on line 1, above
  its imports, so the module rule does not judge a name that was never a
  claim about the exports.
- A new rule goes through `experiments/rule-candidates/BRIEF.md`: its own
  corpus with hard cleans, `gaps`, `calibrate --repeat 3 --record`, a report
  with a verdict, and one pass over an unseen repository before it enters
  `rules/`. Cross-rule labels matter: the whole corpus is judged by every
  pack, so a new corpus file needs labels for the existing rules it trips.
- Any change to a shipped rule's `ask`, `criteria`, `note`, matcher,
  `subject` or `state` is a new question: re-run
  `calibrate corpus --labels corpus/labels.json --repeat 3 --record` and
  commit the record under `docs/data/`. Replay must still pass.
- `tools/arms.ts` measures every arm per rule (four arms, two passes, about
  two cents). Re-run it after changing a matcher or splitting a rule; the
  shipped `state:` choices are measurements, not preferences.
- Figures quoted in `README.md`, `docs/reference.md` and `docs/deepdive.md`
  are measured. Change the measurement and the figure together, or neither.

## Plugin

The repository root is a Claude Code plugin (`.claude-plugin/plugin.json`,
`skills/`, `commands/`). Every YAML block in
`skills/jev-lint/references/cookbook.md` must load and match
`test/fixtures/cookbook/`; `npm test` asserts it. A new recipe needs its code
shape added to the fixture.
