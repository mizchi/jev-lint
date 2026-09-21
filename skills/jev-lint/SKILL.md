---
name: jev-lint
description: "Use when running jev-lint, adding it to a repository or its CI, choosing which of its shipped rule packs to use, writing a new jev-lint rule (an ast-grep matcher plus one sentence a model judges), or calibrating a rule's cutoff. Triggers: `jev-lint`, `.jev-lint.yaml`, a `.jev-lint/rules/*.yml` or `rules/*.yml` file with `ask:` in it, questions like 'lint whether function names match their bodies' or 'find comments that are no longer true', and any request to check code for something a conventional linter cannot decide. Also use it before claiming a jev-lint rule 'works' — this skill defines what that requires."
---

# jev-lint

A linter whose rules are sentences. An [ast-grep](https://ast-grep.github.io)
matcher decides **which code is looked at**; one sentence decides **whether it
is a problem**; a model ([Jev](https://typesafe.ai)) answers the sentence for
every match, batched per file. It finds what no parser can: a function whose
body does something other than its name promises, a comment that became false,
a test that would pass if the behaviour it names were broken.

| | who does it | how it fails |
| --- | --- | --- |
| `rule:` | ast-grep — exact, free, local | **silently**: a node it misses is never asked about |
| `ask:` | the model, once per match | loudly: every answer is visible in `jev-lint gaps` |

Knowing which half you are working on is most of the job.

## Non-negotiables

1. **Never write a rule a compiler, type checker or conventional linter can
   decide.** The model is good at code that *contradicts a contract it declares
   about itself* and measurably poor at defects needing knowledge of a specific
   API (that `.sort()` is lexicographic). Those belong to the existing tools.
2. **Never ask for something the matched code cannot show.** The most common
   way a rule fails, and it looks exactly like a threshold problem: every answer
   lands mid-scale and no cutoff separates. Check `subject` and `state` before
   touching the wording.
3. **Never put a threshold in the sentence.** The cutoff is `at:`; baking it
   into the question means every recalibration rewrites the question.
4. **The API key lives in the environment** (`TYPESAFE_API_KEY`), never in
   `.jev-lint.yaml`, which belongs in version control. `apiKey:` in the file
   is a hard error.
5. **A finding is a candidate for a human, not a verdict.** Measured on real
   code about one finding in five was wrong. Read each against the code.
6. **Record any run you draw a conclusion from** (`--record r.json`).
   `jev-lint replay r.json` re-scores it under new cutoffs with no API key,
   so a cutoff stays auditable.

## Which task is this?

| you want to | read |
| --- | --- |
| run it, add it to CI, tune output | this file, next section |
| use the rules that ship with it, pick some, adjust a cutoff | [references/using-shipped-rules.md](references/using-shipped-rules.md) |
| write a rule for a convention of your own | [references/cookbook.md](references/cookbook.md), then validate as below |
| know what every field means, `score` vs `noul`, the `state` arms | [references/rule-fields.md](references/rule-fields.md) |
| fit a cutoff, build a rule's evals, judge whether a rule works | [references/calibration.md](references/calibration.md) |
| judge commit messages against their diffs | `jev-lint commits`, below |
| install it as a git hook, and know what blocks a commit | [../../docs/use-hooks.md](../../docs/use-hooks.md) |

## Running it

```bash
export TYPESAFE_API_KEY=...            # or TYPESAFEAI_API_KEY
npx -y jev-lint check src --dry-run    # plan and price. Makes NO request.
npx -y jev-lint check src              # judge whole files
npx -y jev-lint run fn-name-promises src        # one shipped rule; rust/<id> for one language
npx -y jev-lint run --file myrule.yml src       # a rule file of your own, and nothing else
npx -y jev-lint review --base main     # judge only what the diff touched
npx -y jev-lint commits --base main    # judge each commit's message against its diff
npx -y jev-lint init                   # write .jev-lint.yaml: files, and every shipped rule on
npx -y jev-lint rules                  # what loaded, and every validation error
```

Run `--dry-run` first, always: it prints subject count, request count and the
price without spending anything. Then `review`, not `check`, for anything
routine — review mode keeps only matches whose subject overlaps a changed line,
which is where findings concentrate and costs a fraction of a cent.

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github   # in CI
jev-lint init --pre-commit      # hook: review --staged --fail-on error, on every commit
jev-lint init --pre-push        # hook: commits @{upstream}..HEAD --fail-on error, before every push
jev-lint check src --retry 3                                 # decide on the mean of 3 passes
jev-lint check src --at fn-name-promises=0.8                 # override one cutoff for one run
jev-lint check src -R my-rules.yml -R rules                  # rule sources, repeatable
```

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed. Any finding exits 1 unless `--fail-on <severity>` raises the bar;
`--format github` annotates `warning` unless the rule says `severity:
error`, and no shipped rule does. The pre-commit hook `init --pre-commit`
writes uses `--fail-on error`, so no *finding* blocks a commit until a rule
has earned `error`; without a key in the environment it steps aside. **Exit
3 does block it**, though: git fails a hook on any non-zero exit, so a
failed request -- offline, an expired key, a rate-limit storm -- stops the
commit rather than letting it through unreviewed. Whether that is the right
trade, and the hook body that lets 3 through, are in
[../../docs/use-hooks.md](../../docs/use-hooks.md). `--staged` reviews what the commit will contain: no untracked files,
no unstaged edits, though a partially staged file is judged as it is on disk.
When paths are configured or given, `review` scans only the changed files
under them, never the whole tree.

**Settings**: `.jev-lint.yaml` (or `jev-lint.yaml`, `.jevlint.yml`, any spelling; two in one directory is an error), nearest one searching upwards, a flag beats
it. `languages:` declares a grammar ast-grep does not have built in (a
tree-sitter parser compiled to a dynamic library — see
[the reference](../../docs/reference.md#a-language-ast-grep-does-not-have-built-in);
MoonBit is measured there). `files:` there lets `jev-lint check` take no argument; `rules:` picks the
rules, ESLint-style — `fn-name-promises: on`, `rust/fn-name-promises: off`,
`comment-describes-block: { at: 0.7, severity: error }` — from the shipped
packs and the project's own `.jev-lint/rules/`; a config with no `rules:`
runs nothing. Unknown keys are errors. A `-R` run inside a repository that
has a config still merges that config — its `rules:`, its `files:` — so pass
**`--no-config`** when testing a rule in isolation, and **`--cache none`** so
no earlier verdict is reused (the cache is `.jev-lint/baseline.json`; `-c
<path>` names another).

**Two output lines that are never noise:**

- **`N rules matched nothing`** — the only place a dead matcher is visible.
  On a TypeScript-only repository the seven Rust variants land here; anything
  else there is a matcher to look at.
- **`N without a verdict`** — requests failed. A run with failures never reads
  as a clean repository.

**Silencing** — any comment syntax, first thing on its line:

```ts
// jev-lint-ignore-next-line fn-name-promises, var-name-describes-value
// jev-lint-ignore-file
```

A suppressed subject is never sent, so it also saves its tokens; every run
prints how many were skipped, and calls out a suppression naming a rule id
that does not exist.

**`--retry n`** asks everything n times and decides on the mean, printing
`3/3 passes` or `1/3 passes` per finding. Use it near a cutoff: pass-to-pass
spread has a median of 0.01 but a maximum of 0.30. It bypasses the verdict
cache and costs n times the tokens. (`-r` is retry; `-R` is rules.)

## Writing a rule: the loop

A rule is YAML in a file under `.jev-lint/rules/` (or anywhere, passed with `-R`), named in the config's `rules:` like a shipped one.
Start from the nearest recipe in [references/cookbook.md](references/cookbook.md);
every recipe there is validated to load and to match.

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  rule:
    kind: function_declaration
    has: { field: name, pattern: $NAME }     # capture what the sentence is about
  ask: >-
    The body of this function does something materially different from what
    its name promises.
  criteria:
    "true": >-
      Someone who read only the name and the parameter list would be wrong
      about what this function does.
    "false": >-
      The name and parameter list describe what the body actually does.
  state: located
  at: 0.55
```

Work in this order, and do not skip a step because the rule "looks right":

1. **Over-match in the matcher.** Its job is to find candidates cheaply; the
   sentence judges. A matcher hand-tightened to avoid false positives misses
   silently. Capture the things the sentence compares (`$NAME`, `$TITLE`,
   `$DOC`): "does the body do what `$NAME` promises" is answerable, "is this
   well named" is not.
2. **Pick `subject` so it can contain the answer**: `node` (the match),
   `enclosing` (its function), `file` (the module as an outline). Then pick
   `state`, the least context that still contains the answer — `bare`,
   `local`, `paired`, `located` (default, the whole file), `graph`, `full`.
   Neither is a quality knob; see [rule-fields.md](references/rule-fields.md).
   Rule of thumb: if the matched node already holds both sides of the
   comparison (a test's title and body, a docstring and its function), start
   at `bare` or `local`; if the answer depends on how the thing is *used* (a
   binding's unit, a function's callers), `located`; if the answer is in the
   file's **tests** (does any test reach this path), `paired` — the one arm
   that reaches into another file, and a file with no related test then
   yields no subject rather than a guess.
3. **Choose `kind`.** `noul` for a yes/no predicate with `criteria` describing
   what true and false look like *in the code itself* — this is what every
   shipped rule uses. `score` for an ordered "how badly", 0–3, with a
   confidence. Never phrase an exception in terms of something the subject
   cannot show ("unless the caller needs it"). Until it is fitted, write
   `at: 0.7` for a `noul` or `at: 2.0` for a `score` with a comment saying
   `# uncalibrated`; the sentence is sent verbatim, and captures travel
   beside it as `matcher_captured`, so `$NAME` in `ask:` is a reference the
   model resolves, not text that is substituted.
4. **Validate, without spending anything:**

   ```bash
   npx -y jev-lint rules -R .jev-lint/rules/my-rule.yml --no-config       # loaded? or the exact validation error
   npx -y jev-lint check src -R .jev-lint/rules/my-rule.yml --no-config --cache none --dry-run --show-subjects
   ```

   The dry run lists, per file, how many subjects the matcher found;
   `--show-subjects` lists each one with its line, node kind and captures
   (`$NAME="isExpired"`), which is how you check that the matcher found the
   four predicates and not the loader, and that the capture holds a name and
   not a whole declaration. Zero subjects on code that contains the case is
   a matcher problem, not a model problem. An ast-grep error naming a node
   kind means that kind does not exist in that grammar — one rejected rule
   fails the whole scan.
5. **Ask, on a few files, with `--retry 3` and an `--at` you guess**, and read
   every finding against the code. Then, if the rule will be kept, give it
   fixtures: `.jev-lint/rules/<lang>/<id>/fixtures/` with a handful of defects and the
   hard clean cases, `expect.yml` beside them, and `jev-lint eval
   .jev-lint/rules/<lang>/<id> --repeat 3 --accept` — see
   [references/calibration.md](references/calibration.md). A rule ships
   with a fitted `at:` and an accepted baseline, not a guess.

Two grammars, one rule: Rust and TypeScript spell the same idea with
different node kinds, so the rule lives twice, `rules/typescript/<id>/` and
`rules/rust/<id>/`, same id, each with its own matcher, state, cutoff and
fixtures. The sentence is a copy; the loader warns when the copies drift,
so edit both -- or, when a language's failures are shaped differently and
the sentence cannot be the same one, declare the reason in `divergent:`
and the warning stands down.

## Judging the output

When you disagree with a finding it is one of three things, and only the third
means the tool is wrong:

1. **The rule is right and the code is wrong.** Most often. Fix the code.
2. **The rule is right and the *name* is wrong.** A test called "no batch
   exceeds the ceiling" whose body legitimately exempts one-subject batches is
   a name that overclaims. Fix the name.
3. **The rule is wrong.** Add the case to the rule's `fixtures/` as a
   labelled clean example in `expect.yml`, run the eval, and refit. A false positive that
   is not in the evals comes back.

Do not chase the tail: editing a file moves the `located` state for every
subject in it, so a fix can move unrelated verdicts. Fix what you agree with,
re-measure with `--retry 3`, and record the residue rather than iterating
against noise.
