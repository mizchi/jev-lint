# Rule candidate brief

You are building and measuring candidate jev-lint rules in ONE family, in your
own directory under `experiments/rule-candidates/<family>/`. Other agents are
doing the same for other families in parallel. Write only inside your
directory. Do not commit. Do not touch `src/`, `rules/`, `corpus/`, `docs/`.

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

```
experiments/rule-candidates/<family>/
  rules.yml            every candidate rule of the family, one file
  corpus/              the labelled corpus, one or more files per language
  labels.json          hand-written, format below
  records/<rule>.json  or one record for the family, from --record
  REPORT.md            the report, format below
```

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

labels.json:

```json
{
  "$default": "clean",
  "experiments/rule-candidates/<family>/corpus/a.ts": [
    { "line": 12, "label": "bad", "rule": "<rule-id>", "reason": "..." },
    { "line": 30, "label": "clean", "rule": "<rule-id>", "reason": "hard clean: ..." }
  ]
}
```

Paths are relative to the repository root. `line` matches within a window of
3; a rule with `subject: enclosing` reports at the top of the function.

## Procedure per rule

1. Write the rule (cookbook shape). Over-match in the matcher; capture what
   the sentence compares; criteria in terms of what the code shows; `note:`
   for exceptions; `at: 0.7  # uncalibrated`.
2. `rules -R <rules.yml> --no-config` -> loads, 0 errors.
3. `check <corpus dir> -R <rules.yml> --no-config --cache none --dry-run
   --show-subjects` -> every intended subject found, captures right, nothing
   unintended. Fix the matcher until this is true. This costs nothing.
4. `gaps <corpus dir> -R <rules.yml> --no-config --cache none` -> read the
   verdict. `rewrite` means go back to subject/state/criteria, not to the
   thesaurus. You may iterate the sentence up to 3 times per rule; record
   each attempt's gap in the report.
5. `calibrate <corpus dir> -R <rules.yml> --labels <labels.json> --repeat 3
   --no-config --cache none --record <records/...json>` -> fitted cutoff,
   precision, recall, decision flips.
6. Write the fitted `at:` into rules.yml and remove the `# uncalibrated`.

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

Then: **Cost**: total requests, tokens and dollars spent, from the tool's
own summaries.

Be honest in the report. A DROP with a clear reason is a good result; a SHIP
on an easy corpus is a bad one.
