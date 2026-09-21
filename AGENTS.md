# Contributing to jev-lint

This file is the standard this repository holds its own changes to. It is
also, deliberately, the input `jev-lint commits` judges a diff against —
so an instruction here should be one a reader can check against a change,
not a sentiment. Vague entries are worse than absent ones.

## Rules

- A rule lives at `rules/<lang>/<id>/rule.yml`, with `fixtures/` beside it,
  an `expect.yml` labelling them, and the accepted `baseline.json`. A rule
  file anywhere else has no fixtures and no tier, and that is a different
  thing.
- A rule ships with a cutoff that was fitted, and the `at:` carries a
  comment naming the run it came from, what the defects answered, where the
  cleans topped out, and the pass-to-pass spread. A guessed cutoff is
  written `at: 0.7  # uncalibrated` and does not ship that way.
- `baseline.json` is committed; `last.json` is not — `.gitignore` already
  says so. A rule whose `rule.yml` changes and whose `baseline.json` does
  not is a rule whose numbers no longer describe it.
- The same `id` under two language directories carries the same `ask:`,
  `criteria:` and `note:`. Change one and change the other, or say in
  `divergent:` why that language's failure is shaped differently.
- Never write a rule a compiler, type checker or conventional linter can
  decide. Those belong to the existing tools.

## Secrets

- The API key lives in the environment: `TYPESAFE_API_KEY` or
  `TYPESAFEAI_API_KEY`. `apiKey:` in `.jev-lint.yaml` is a hard error,
  because that file is in version control.
- No key, token or credential is ever written into a tracked file, a
  fixture, a test, or a commit message.

## Comments

- A comment carries what a reader cannot recover from the code: the
  decision, the measurement, the reason the obvious version is wrong.
  Nothing restates the code.
- A comment that stopped being true is a defect, not untidiness. This
  package ships a rule that finds them; it must not carry them. A change
  that makes a nearby comment false fixes that comment in the same commit.
- A number in a comment is one a reader can re-derive. Say what was
  measured and against what, not just the result.

## Tests

- One test file per module under test, `test/<module>.test.ts`, and a new
  one is registered in `test/test.ts`'s `files` array or it never runs.
- Tests assert behaviour, not the shape of the implementation. A test that
  would still pass with the behaviour its name claims broken is a defect.
- A failure path gets a test. This tool can break a build, so every way it
  can fail has to land on "no verdict" rather than on an exception.
- New behaviour arrives with a test in the same commit.

## Commits and branches

- `npm run ci` — typecheck, tests, build, `eval --replay` — passes before
  a push.
- A commit message describes its diff, including the part the subject line
  does not name: a changed default, a deleted test, a new dependency, a
  second unrelated change.
- Documentation, comments and commit messages are in English. `README-ja.md`
  is the translation of `README.md`, not a separate document.

## Code

- Node 20 or later, ESM (`"type": "module"`). Tests run from source under
  `--experimental-strip-types`; there is no build step to run them.
- No runtime dependencies. The published package installs nothing.
- `dist/` is built, never committed.
