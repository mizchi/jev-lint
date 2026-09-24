---
description: Write a new jev-lint rule for a convention you describe, validate that it loads and matches, and stop before spending
argument-hint: "<the convention, in a sentence>"
---

Write a jev-lint rule for this convention: $ARGUMENTS

Follow the jev-lint skill's `references/writing-project-rules.md` for the
target repository's language and `references/cookbook.md` for a validated
matcher. Do it in this order and do not skip validation.

1. **Decide whether this is a jev-lint rule at all.** If a compiler, type
   checker or conventional linter can decide it, say so and stop — the model
   is measurably poor at exactly those. If the convention is about taste with
   no claim to check against ("well named", "too complex"), say what claim it
   could be rewritten around, and ask.
2. **Pick the nearest cookbook recipe** and say which one and why. Identify
   the claim (a name, a comment, a title, a type) and what in the code should
   honour it; that is what the matcher captures and what the sentence asks.
3. **Find the node kinds** for a code rule with `npx -y @ast-grep/cli run -l
   <lang> -p '<a snippet of the code shape>' --debug-query=ast .` rather
   than guessing. A kind absent from the grammar fails the whole scan.
   For Text, choose `split:` and `extensions:` instead; for Git, choose
   `subject: commit` or `subject: change` without a matcher.
4. **Write the rule** in the target repository at `.jev-lint/rules/<id>.yml`
   or `.jev-lint/rules/<language>/<id>/rule.yml` with fixtures and a baseline
   beside it. Enable its id in `.jev-lint.yaml` if the config has `rules:`.
   Project rules load alongside the packaged rules. For a custom grammar,
   declare its parser in that config and inspect its node kinds and fields.
   Over-match in the matcher. Write `criteria` in terms of the evidence the
   model sees. Put exceptions in `note:`. Mark a guessed `threshold:` as
   `# uncalibrated`.
5. **Validate without spending:**
   - `npx -y jev-lint rules -R <rule-file> --no-config` — must load with 0 errors
   - `npx -y jev-lint check <paths> -R <rule-file> --no-config --dry-run --cache none --show-subjects`
     — must find subjects on code that contains the case; if it finds none,
     fix the matcher, not the sentence
   - For a custom grammar, replace `--no-config` with `--config .jev-lint.yaml`
     so its parser declaration remains active; that config must select only
     this rule when `-R` is used. For Git rules, use `commits
     --staged --dry-run` or `commits --base <ref> --dry-run`.
6. **Stop and report**: the rule, the subject count and price from the dry
   run, and the next command to run with a key
   (`jev-lint check <one file> -R <rule-file> --retry 3`). Do not run the
   paid step unless asked. Say that the cutoff is a guess until it is fitted
   per `references/calibration.md`.
