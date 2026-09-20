# Rule improvement brief

You are raising the quality of ONE or TWO jev-lint rules that already have
evals. Each rule is a directory -- `rules/<lang>/<id>/` if shipped,
`experiments/rule-candidates/<lang>/<id>/` if not -- holding `rule.yml`,
`fixtures/`, `expect.yml` and `baseline.json`. Write only inside the
directories you were given, plus your report under
`experiments/reports/improve-<id>/REPORT.md`. Do not commit. Do not touch
`src/`, other rule directories, or `docs/`.

## Setup

- Repository: /Users/mz/ghq/github.com/mizchi/jevlint. Run jev-lint as
  `node --experimental-strip-types src/cli.ts <command>`; ast-grep is
  `node_modules/.bin/ast-grep`.
- Before any command that asks the model: `source ~/.profile` in the SAME
  shell command (the key is TYPESAFE_API_KEY; shell state does not persist).
  Always pass `--no-config`. `eval` never uses the cache.
- Read `skills/jev-lint/SKILL.md` and `skills/jev-lint/references/`
  (cookbook.md, calibration.md, rule-fields.md) first. Read your rule's
  `rule.yml` comments: they record what was measured and why the fields are
  what they are. Read `experiments/reports/*/REPORT.md` for your rule if one
  exists.
- Budget: at most $0.60 of requests. `eval <dir> --repeat 3` on a suite of
  30 subjects is about a cent. Price with `check <cases> -R <rule.yml>
  --dry-run` if unsure.

## The bar

A rule is done when, on its own evals at its shipped `at:`, three passes,
decisions on the mean:

- precision 1.00 and recall 1.00,
- at least 8 labelled defects and at least 8 labelled HARD cleans (cases a
  lazy rule would flag: the terse but accurate name, the vague but true
  comment, the conventional exception, the preamble, the section heading),
- headroom of at least 0.10 on both sides of the cutoff (highest clean
  mean to `at`, `at` to lowest defect mean), so the next real file does not
  land on it,
- at most one case whose decision flips between passes, and none within
  0.03 of the cutoff.

If the bar cannot be reached, say precisely which case or class stops it and
why -- API knowledge the model lacks, a claim outside the subject, an
inversion -- and leave that case labelled as what it is. A rule that reports
what it cannot do is worth more than one that hides it.

## What you may change

- `criteria`, `note`, `ask`: the question. Iterate at most 4 times, and
  record each attempt's numbers in the report. Sharpen by naming what a
  violation looks like IN THE CODE and what does not count; never phrase an
  exception in terms of something the subject cannot show.
- The matcher, `subject`, `state`: when the evidence is outside the
  subject, widen; when the model is distracted by what is inside, narrow.
  Measure `state` changes rather than guess (`--arm` is not available in
  eval; edit `state:` and run).
- `at:`: to the fitted midpoint, or above it for headroom on real code.
- `fixtures/` and `expect.yml`: add cases. Real-looking code,
  10-40 lines per case, and NEVER a marker comment (`// DEFECT`, `// CLEAN`,
  `// this is wrong because`) in a case file -- the model reads the file.
  Labels carry the reason. Paths relative to `cases/`, `window: 0` for
  one-per-line subjects, larger only when a `subject: enclosing` rule reports
  at the function's top line.
- Where you can, take defect and hard-clean shapes from real code:
  `experiments/unseen/` holds a recorded run over mizchi/agent-cluster with
  its findings; `/Users/mz/ghq/github.com/mizchi/agent-cluster` is the
  repository (read-only for you). Rewrite, do not copy files wholesale.

## Procedure

1. `eval <dir> --repeat 3 --no-config` -> where it stands. Read every wrong
   case and every flip against the code; decide whether the label, the
   question or the subject is at fault.
2. Change one thing. `eval` again. Record the numbers.
3. Repeat within budget.
4. When done (bar reached, or the reason it cannot be stated):
   `eval <dir> --repeat 3 --accept --no-config` to take the baseline, and
   check `eval <dir> --replay --no-config` passes.
5. Write the report.

## REPORT.md format

- **Rule**: id(s), directory, what it was at the start (P/R/flips/headroom,
  defects/cleans) and at the end.
- **Attempts**: one line per change, with the numbers after it.
- **Cases added**: one line per case, label and the argument.
- **What stops the bar**, if anything: the case, the number, the reason.
- **Unseen check**, if you ran one: what the revised rule does on
  agent-cluster (`check <paths> -R <rule.yml> --no-config --cache none`,
  dry-run first; it is $0.01-0.05 per rule), each finding judged.
- **Cost**: requests, tokens, dollars.
