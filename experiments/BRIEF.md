# Rule candidate brief

You are building and measuring candidate jev-lint rules in ONE family. Each
candidate is its own directory under `experiments/rule-candidates/<rule-id>/`;
the family's report goes under `experiments/reports/<family>/`. Other agents
are doing the same for other families in parallel. Write only in those
places. Do not commit. Do not touch `src/`, `rules/`, `docs/`.

## Setup

- Repository: /Users/mz/ghq/github.com/mizchi/jevlint (jev-lint's own source).
- Run jev-lint as `node --experimental-strip-types src/cli.ts <command>` from
  the repository root. ast-grep is `node_modules/.bin/ast-grep`.
- Before any command that asks the model: `source ~/.profile` in the SAME
  shell command (the key is TYPESAFE_API_KEY, set there; shell state does not
  persist between commands). Always pass `--no-config --cache none`.
- Read `skills/jev-lint/SKILL.md` and its `references/` first. The cookbook
  and calibration.md are the procedure. `references/rule-fields.md` has the
  language names and every field.
- Budget: at most $0.50 of requests for your family. A calibrate over a
  30-subject corpus with `--repeat 3` is about a cent; you have room, but
  `--dry-run` before every paid run and stop if a run would exceed $0.10.

## Layout you produce

A candidate is a rule directory, the same shape a shipped rule has, so that
promoting it is a `git mv`:

```
experiments/rule-candidates/<rule-id>/
  rule.yml             the candidate rule (every language variant)
  evals/cases/         the labelled cases, one or more files per language
  evals/labels.json    hand-written, paths relative to cases/, format below
  evals/baseline.json  written by `jev-lint eval <dir> --accept`
experiments/reports/<family>/REPORT.md   the report, format below
```

One directory per rule. A family of several candidates is several
directories and one report.

## Corpus rules (these are where candidates die, so read them)

- Per rule: at least 8 subjects the matcher finds, of which at least 3 are
  labelled `bad` and at least 3 are HARD clean cases -- clean code that a lazy
  rule would flag: the terse but accurate name, the vague but true comment,
  the conventional exception. An easy corpus produces a cutoff that fails on
  the first real file. `thin` from `gaps` is not a pass.
- Every `bad` case is one specific, defensible defect, with the reason in the
  label. "Code quality" has no referee; a label is an argument.
- Do not put `// DEFECT` / `// CLEAN` markers above declarations if any rule
  in your family reads comments -- they contaminate the subject. Write
  labels.json by hand instead.
- Realistic code, not toy. Names and bodies of the kind found in a real
  service or CLI. 10-40 lines per case is fine.

evals/labels.json:

```json
{
  "$default": "clean",
  "a.ts": [
    { "line": 12, "label": "bad", "rule": "<rule-id>", "window": 0, "reason": "..." },
    { "line": 30, "label": "clean", "rule": "<rule-id>", "window": 0, "reason": "hard clean: ..." }
  ]
}
```

Paths are relative to `evals/cases/`. `window: 0` for subjects that sit one
per line; a rule with `subject: enclosing` reports at the top of the
function, so give it the distance to the statement you labelled.

## Procedure per rule

1. Write `rule.yml` (cookbook shape). Over-match in the matcher; capture what
   the sentence compares; criteria in terms of what the code shows; `note:`
   for exceptions; `at: 0.7  # uncalibrated`.
2. `rules -R <dir> --no-config` -> loads, 0 errors.
3. `check <dir>/evals/cases -R <dir>/rule.yml --no-config --cache none
   --dry-run --show-subjects` -> every intended subject found, captures
   right, nothing unintended. Fix the matcher until this is true. Free.
4. `gaps <dir>/evals/cases -R <dir>/rule.yml --no-config --cache none` ->
   read the verdict. `rewrite` means go back to subject/state/criteria, not
   to the thesaurus. Up to 3 attempts at the sentence per rule; record each
   attempt's gap in the report.
5. `eval <dir> --repeat 3 --no-config` -> precision, recall and flips at the
   rule's `at:`, the fitted cutoff beside them. Write the fitted `at:` into
   rule.yml, remove `# uncalibrated`, and `eval <dir> --repeat 3 --accept
   --no-config` to take the baseline.

## REPORT.md format

For the family: one paragraph on what the family is for and what jev does
here that a linter cannot.

Per rule, a section with exactly these headings:

- **Rule**: the final YAML (complete, as in rules.yml)
- **Corpus**: subjects found / bad / clean, and one line per bad case saying
  what the defect is
- **Attempts**: one line per sentence/criteria/subject/state attempt, with
  the `gaps` verdict, gap width and head for each
- **Fit**: fitted cutoff, precision, recall, tp/fp/fn, decision flips across
  the 3 passes, max spread
- **Verdict**: one of SHIP (separates with headroom >= 0.10, no flips),
  COOKBOOK (separates but thin corpus or narrow headroom; worth a recipe,
  not a shipped cutoff), DROP (does not separate after 3 attempts) -- and
  the one sentence of why
- **What I would change**: matcher, subject, state, or corpus, if anything

A candidate that ships is `git mv experiments/rule-candidates/<id> rules/<id>`;
its baseline comes with it.

Then: **Cost**: total requests, tokens and dollars spent, from the tool's
own summaries.

Be honest in the report. A DROP with a clear reason is a good result; a SHIP
on an easy corpus is a bad one.
