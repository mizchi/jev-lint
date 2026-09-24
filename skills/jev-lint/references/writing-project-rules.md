# Writing rules in your own repository

The Claude skill tells an agent how to work; it does not install a jev-lint
rule. Create rule YAML in the repository being reviewed, under
`.jev-lint/rules/`. Do not put it in `.claude/skills/` or the installed
package's `rules/`. Those directories have different jobs.

Start with a claim the code makes about itself: a name against a body, a
comment against the next declaration, a test title against its assertion, or
a documented constraint against a diff. If a compiler or conventional linter
can settle the question, use that tool instead. Use the nearest validated
example in [cookbook.md](cookbook.md), then choose the environment below.

## Shared project setup

A flat file is enough for a first experiment. Keep a rule that you intend to
rely on in a suite with examples and an accepted baseline:

```text
.jev-lint.yaml
.jev-lint/rules/typescript/acme-handler-name/
  rule.yml
  fixtures/handlers.ts
  expect.yml
  baseline.json
```

`.jev-lint/rules/` loads alongside the packaged rules. A project config with
`rules:` runs only the rules it turns on, so enable your new id there:

```yaml
# .jev-lint.yaml
files: [src]
rules:
  typescript/acme-handler-name: on
```

Use a distinct id; a copy with a packaged id is a duplicate. The directory
name is a namespace, not the `languages:` field: a TypeScript rule can list
`[TypeScript, Tsx, JavaScript, Jsx]`. For an isolated experiment, `-R <file>`
selects that rule instead of the packs and local directory for one run.
Without a custom parser, add `--no-config` to keep the repository's `rules:`
and `files:` out of that experiment.

## Built-in code grammars

For TypeScript, JavaScript, Rust, Python, Go, and other ast-grep grammars,
write a matcher for **candidates**, then a sentence for the claim. Inspect
the real syntax tree before naming a node kind or field:

```bash
npx -y @ast-grep/cli run -l ts -p 'function $NAME($$$ARGS) { $$$BODY }' --debug-query=ast src
```

For example, a rule can match every function declaration and ask whether the
name describes the body:

```yaml
# .jev-lint/rules/typescript/acme-handler-name/rule.yml
id: acme-handler-name
languages: [TypeScript, Tsx]
kind: noul
rule:
  kind: function_declaration
  has: { field: name, pattern: $NAME }
subject: node
state: bare
ask: This function's name promises behavior its body does not provide.
criteria:
  "true": The body contradicts the behavior promised by the name.
  "false": The body provides the behavior promised by the name.
threshold: 0.7  # uncalibrated
```

The example's cutoff is a placeholder, not a value to ship. Pick `subject`
and `state` so the model sees both sides of the claim; use `located` if the
file's surrounding code is needed, or `paired` if the evidence is in related
tests. [rule-fields.md](rule-fields.md) explains those choices.

## A project with its own grammar

Compile the tree-sitter grammar into a library and declare it in the target
repository's `.jev-lint.yaml`. The library path is relative to that config:

```yaml
languages:
  moonbit:
    libraryPath: parsers/moonbit.dylib
    extensions: [mbt]
    expandoChar: _
files: [src]
rules:
  moonbit/acme-test-contract: on
```

Put the rule at `.jev-lint/rules/moonbit/acme-test-contract/rule.yml` and use
`language: moonbit`, matching the declared key. Node kinds and fields come
from **that grammar**, not from TypeScript examples. MoonBit has no named
fields, so use a descendant matcher such as
`has: { kind: function_identifier, stopBy: end, pattern: $NAME }` instead of
`field: name`. `expandoChar: _` makes metavariable patterns parse where `$`
is not valid source syntax. A different custom grammar needs its own tree
inspection and matcher; most have only `bare` and `located` state support.
See [the custom parser reference](../../../docs/reference.md#a-language-ast-grep-does-not-have-built-in).

Keep the config active when validating this rule: `--no-config` would also
remove its parser declaration. Use `-R <rule-file> --config .jev-lint.yaml`
when its `rules:` selects only this rule. If the project selects other rules,
use a temporary config containing the same `languages:` declaration and only
the new id; otherwise the missing selected ids are validation errors.

## Text files without a code grammar

Use `language: Text` and `subject: block` for a document divided by
recognizable headers, such as sqlc queries. There is no ast-grep matcher;
`split:` starts a subject at every matching line, and named regex groups
become captures:

```yaml
id: acme-query-name
language: Text
subject: block
extensions: [sql]
split: "^-- name: (?<NAME>\\w+) :(?<KIND>\\w+)"
kind: noul
state: located
ask: This query's name ($NAME) misdescribes the SQL under it.
criteria:
  "true": The named operation or filter contradicts the SQL in this block.
  "false": The name describes the SQL in this block.
threshold: 0.7  # uncalibrated
```

With no `split:`, the whole matching file is one block. Set `extensions:`
so unrelated files do not become subjects. See the shipped
`text/query-name-describes-sql` rule for a measured example.
For a document with a fixed basename, add `filenames: [AGENTS.md]` so the
rule does not scan every Markdown file. `split: "^#{1,6}\\s+"` makes each
heading section a subject; `state: located` also supplies the whole file
when the judgment needs definitions or other sections.

## Git history and staged changes

Use `language: Git` and `subject: commit` to judge a commit message against
its diff. Use `subject: change` to judge a diff against the repository's own
`AGENTS.md`, or `CLAUDE.md` when absent. Neither has a matcher. `jev-lint commits
--base main` runs both kinds on commits; `jev-lint commits --staged` runs
change rules on the index before a commit message exists. `check` and
`review` do not run these rules.

Place the rule under `.jev-lint/rules/git/<id>/rule.yml`, enable `git/<id>`
in the config. To run a `subject: change` rule during pre-commit, select it
under `hooks.precommit.rules`; `extends: true` also keeps the top-level
selection, while `extends: false` uses only the hook's rules. A project can
use this for a rule about whether a Vitest or Playwright snapshot change is
supported by the implementation diff. A change subject currently requires
AGENTS.md or CLAUDE.md in the staged tree, preferring AGENTS.md. A `subject: commit` rule waits for a
commit message and has no staged subject. Commit fixtures use
`fixtures/<case>/{message,before/,after/}`; `expect.yml` labels the resulting
subject. Ask only about facts visible in the diff
and its supplied instructions. The shipped `git/commit-message-describes-diff`
and `git/diff-follows-instructions` rules show both forms.

## Validate and fit the rule

For a built-in grammar, validate one rule without a request or cached answer:

```bash
jev-lint rules -R .jev-lint/rules/typescript/acme-handler-name/rule.yml --no-config
jev-lint check src -R .jev-lint/rules/typescript/acme-handler-name/rule.yml --no-config --cache none --dry-run --show-subjects
```

The dry run should list the intended subjects and captures. Zero subjects
on code that contains the case means the matcher or file selection needs
work. For a custom grammar, retain `--config .jev-lint.yaml`; for Git rules,
use `commits --base <ref> --dry-run` or `commits --staged --dry-run`. Then
label defects and difficult clean cases in `fixtures/` and `expect.yml`,
run `jev-lint eval <rule-directory> --repeat 3`, inspect the separation and
pass-to-pass spread, fit `threshold:`, and accept the run as `baseline.json`. The
[calibration guide](calibration.md) gives the general fixture format and commands.
An API key belongs in the environment, never in `.jev-lint.yaml` or a
fixture.

To adapt a packaged rule, either use `extends:` to keep its matcher and
override selected fields, or copy its directory under `.jev-lint/rules/`
with a new id. A change to `ask`, `criteria`, `note`, `rule`, `subject`, or
`state` asks a new question: add local examples and refit the cutoff. A
cutoff override alone can stay in `.jev-lint.yaml`; see
[using-shipped-rules.md](using-shipped-rules.md).
