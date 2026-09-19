---
description: Write a new jev-lint rule for a convention you describe, validate that it loads and matches, and stop before spending
argument-hint: "<the convention, in a sentence>"
---

Write a jev-lint rule for this convention: $ARGUMENTS

Follow the jev-lint skill, `references/cookbook.md` in particular. Do it in
this order and do not skip the validation.

1. **Decide whether this is a jev-lint rule at all.** If a compiler, type
   checker or conventional linter can decide it, say so and stop — the model
   is measurably poor at exactly those. If the convention is about taste with
   no claim to check against ("well named", "too complex"), say what claim it
   could be rewritten around, and ask.
2. **Pick the nearest cookbook recipe** and say which one and why. Identify
   the claim (a name, a comment, a title, a type) and what in the code should
   honour it; that is what the matcher captures and what the sentence asks.
3. **Find the node kinds** with `npx -y @ast-grep/cli run -l <lang> -p '<a
   snippet of the code shape>' --debug-query=ast .` rather than guessing. A
   kind absent from the grammar fails the whole scan.
4. **Write the rule** to `rules/<id>.yml` (create `rules/` if absent; note
   that doing so switches the project off the packaged packs — say so, and
   offer to copy them in). Over-match in the matcher. Write `criteria` in
   terms of what the code in front of the model shows. Put exceptions in
   `note:`. Guess `at:` and say it is a guess.
5. **Validate without spending:**
   - `npx -y jev-lint rules -R rules/<id>.yml` — must load with 0 errors
   - `npx -y jev-lint check <paths> -R rules/<id>.yml --dry-run --cache none`
     — must find subjects on code that contains the case; if it finds none,
     fix the matcher, not the sentence
6. **Stop and report**: the rule, the subject count and price from the dry
   run, and the next command to run with a key
   (`jev-lint check <one file> -R rules/<id>.yml --retry 3`). Do not run the
   paid step unless asked. Say that the cutoff is a guess until it is fitted
   per `references/calibration.md`.
