# jev-lint

[日本語](README-ja.md)

A lint tool that uses [Jev](https://typesafe.ai/) -- a fast classifier that
answers a natural-language question with a calibrated probability instead of
writing text -- to decide what a parser cannot.

This function is wrong, and nothing in your toolchain will say so:

```ts
/** Returns the cart, or null when no cart has this id. */
export function getCart(id: string): Cart {
  const cart = carts.get(id);
  if (!cart) throw new Error(`no cart ${id}`);
  return cart;
}
```

The comment promises `null`. The body throws. The return type is `Cart`, not
`Cart | null`. It type-checks and it lints clean.

A jev-lint rule is one sentence. An [ast-grep](https://ast-grep.github.io)
matcher picks which code to look at, and a model is asked that sentence about
each match -- here, *the comment above this code claims something that is not
true of the code* -- answering with a probability. **The code being judged is
sent to an API**, which is what the key pays for; nothing runs locally except
the matcher.

```bash
export TYPESAFE_API_KEY=...            # https://typesafe.ai
npx -y jev-lint check examples
```

```
examples/cart.ts
     16  flag  The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.89  cutoff 0.56
...
```

0.89 is the model's agreement and 0.56 the cutoff this rule ships with; under
it, nothing is reported. Six findings over two files, for a tenth of a cent;
[what a bigger run costs](docs/cost.md) is measured, not extrapolated.

## What it catches

Forty-eight questions ship, most of them asked in several languages -- 99
rules in all. Roughly:

- **A name against the thing it names.** A function, method, binding, type,
  class, trait or module; an npm script against the command it runs; an sqlc
  query name against its SQL. `applyDiscount` that also saves the cart,
  `isAdmin` bound to a string.
- **A guarantee the name implies.** Whether `safe*` is safe, `pure*` is pure,
  an idempotent-sounding function is idempotent, whether Go's `MustX` panics
  on the failure its name promises.
- **A comment against the code under it.** The doc comment above a
  declaration, a comment inside a block, and a stated failure contract --
  `@throws`, `# Errors`, `Raises:` -- against the body.
- **A test against what it claims.** A test that would pass with the
  behaviour its name claims broken; a failure path no test reaches; a
  snapshot standing in for a behaviour claim; a mock that has replaced the
  subject.
- **A failure that goes quiet.** A `catch` that hides one, an error message
  that does not match its condition, a log level that does not match the
  event.
- **What a shell script does to the machine** that its reader cannot see:
  run code it downloaded, read secrets it was not given, install
  persistence, delete past its own scope, weaken a defence, open a way in,
  take orders from elsewhere, hide what it runs.
- **Whether a document is worth reading.** Slop, filler, padding, vagueness;
  a section that opens with an agenda or ends by previewing the next.
- **A commit message against its diff**, and **a change against the
  instructions the repository wrote for itself** -- the `AGENTS.md` or
  `CLAUDE.md` in its own tree, read as of that change. Only the instructions
  a diff can be held against: "never edit the generated file" is judged,
  "develop test-first" is not.

[RULES.md](RULES.md) is all of them, each with its cutoff and its score on
its own fixtures. What makes them one family is that each holds a claim the
code makes about itself against what the code does -- which is visible only
to a reader who has read both.

It is **not** for anything a compiler, type checker or ESLint already
decides. This kind of model is good at code that contradicts itself and poor
at defects needing knowledge of a specific API, such as `.sort()` defaulting
to lexicographic order -- [measured, with the evidence](docs/deepdive.md).
Keep your existing tools for those.

## Install

Nothing to install to try it; Node 24+ and `npx` are enough. For a project:

```bash
npm install --save-dev jev-lint
npx jev-lint init                      # writes .jev-lint.yaml
npx jev-lint check src --dry-run       # what it would ask, and the price. No request.
```

The key is read from the environment only — `TYPESAFE_API_KEY`, or
`TYPESAFEAI_API_KEY` — and never from the config file, which belongs in
version control and a key does not. Everything that does not ask the model
works without one: `--dry-run` prices a run, `jev-lint rules` lists what
would run, `jev-lint replay` re-scores a recorded run, and CI can lint from
a committed cache with no key at all.

## Using it

| | |
| --- | --- |
| `jev-lint check src` | judge whole files |
| `jev-lint review --base main` | only the lines a diff touched — where findings concentrate, at a fraction of the cost |
| `jev-lint commits --base main` | each commit's message against its diff, and each change against the `AGENTS.md` the repository wrote for itself |
| `jev-lint commits --staged` | the same, on what is about to be committed |
| `jev-lint run typescript/fn-name-promises src` | one rule; `--file mine.yml` for one of your own |
| `jev-lint rules` | every loaded rule: its question, cutoff and file |

The config picks the rules, as ESLint's does. `init` writes every shipped
rule turned on, as a catalogue to prune:

```yaml
files: [src, test]
exclude: [test/fixtures]
rules:
  typescript/fn-name-promises: on
  rust/fn-name-promises: off
  typescript/comment-describes-block: { at: 0.7, severity: error }
```

Use `language/id` for namespaced rules. A bare shipped id still selects every
language with that id, but jev-lint warns because it can enable a language
unintentionally. A flat project rule has no namespace and does not warn.

To silence one finding, or one file, in any comment syntax:

```ts
// jev-lint-ignore-next-line fn-name-promises
// jev-lint-ignore-file
```

A suppressed subject is never sent, so a suppression also saves its tokens.

**In CI and git hooks** — `review --base "$GITHUB_BASE_REF" --format github`
annotates a pull request; `jev-lint init --pre-commit` and `--pre-push` write
hooks. Neither blocks until you raise a rule to `severity: error`, and no
shipped rule has it. See [docs/use-hooks.md](docs/use-hooks.md), which also
covers the exit code that will stop you committing while offline.

## What ships

101 rules under `rules/<language>/<id>/`, and the files you point it at decide
which run. Nothing to select.

| point it at | what runs |
| --- | --- |
| `.ts` `.tsx` `.js` `.jsx` | `typescript/` — 23 rules, first tier |
| `.rs` | `rust/` — 9, first tier |
| `.py` `.go` | `python/` — 14, `go/` — 9 |
| `.mbt` | `moonbit/` — 20, once [the parser is declared](docs/reference.md#a-language-ast-grep-does-not-have-built-in) |
| `.vibe` | `vibe/` — 2, with the [vibe-lang parser](docs/reference.md#vibe-lang) |
| `.sh` `.bash` `.zsh` | `shell/` — 8: what a script does to the machine that its reader cannot see |
| `.md` `.mdx` | `markdown/` — 11 writing rules |
| `package.json`, sqlc `.sql` | `json/` — 1, `text/` — 1 |
| commits | `git/` — 2 |

`typescript` and `rust` are first tier: every rule under them carries
fixtures, expectations and an accepted baseline. The rest are calibrated to
the same bar and not yet promised. [RULES.md](RULES.md) lists all 99 with
their question, cutoff and score on their own fixtures.

Your own rule can target any language ast-grep parses — Java, Kotlin, Swift,
C, C++, C#, Ruby, PHP, Lua, Dart, Scala, Elixir, Haskell, Solidity, HTML,
CSS, YAML — and any other grammar you compile.

## It is not deterministic, and not always right

Measured on this repository, about one finding in five was wrong, and a score
near a cutoff can move by a few hundredths between runs. jev-lint is built
around that rather than pretending otherwise: verdicts are **cached** by the
content of the rule and the code, `--retry 3` decides on the **mean** of
three passes and marks what did not reproduce, `--loose` lists the band under
a cutoff for a reader without making it a finding, and **cutoffs are yours to
fit** — the shipped ones are fitted to this package's corpus, not yours.

Read a finding as a candidate for a human to judge, not a verdict to act on.

## Writing a rule

An ast-grep matcher decides **which code is looked at**; one sentence decides
**whether it is a problem**:

```yaml
id: catch-hides-failure
languages: [TypeScript, Tsx]
rule: { kind: catch_clause }
subject: enclosing          # judge the function around the match, not the clause
ask: This catch block swallows a failure the caller needed to know about.
```

[docs/writing-rules.md](docs/writing-rules.md) is the walkthrough, including
the fixtures and the fitted cutoff a rule ships with.

## For a coding agent

The repository ships a skill — how to run jev-lint, which packs to use, a
cookbook of validated rules, and the calibration procedure:

```bash
npx skills add mizchi/jev-lint --skill jev-lint
```

`--skill jev-lint` matters: the repository also carries `jev-lint-repo`, the
maintainer's skill for changing jev-lint itself. As a Claude Code plugin,
which also installs `/jev-lint:review`, `/jev-lint:commits`,
`/jev-lint:prose` and `/jev-lint:new-rule`:

```
/plugin marketplace add mizchi/jev-lint
/plugin install jev-lint@jev-lint
```

## Documentation

| | |
| --- | --- |
| [RULES.md](RULES.md) | every shipped rule, its cutoff and its fit |
| [docs/reference.md](docs/reference.md) | every flag and field, calibration, batching, limits |
| [docs/use-hooks.md](docs/use-hooks.md) | git hooks and CI |
| [docs/writing-rules.md](docs/writing-rules.md) | writing a rule, and the evals it ships with |
| [docs/cost.md](docs/cost.md) | what a full run costs, measured |
| [docs/deepdive.md](docs/deepdive.md) | everything measured that is still true, and the evidence |
| [docs/internal/architecture.md](docs/internal/architecture.md) | how the code works, for changing it |
| [docs/internal/findings.md](docs/internal/findings.md) | the notebook, in the order it happened, wrong turns included |
| [CHANGELOG.md](CHANGELOG.md) | every release |

## Prior art

The idea of asking a model a lint question comes from
[mizchi/jev-playground](https://github.com/mizchi/jev-playground)'s
`eslint-plugin-jev`. What is different here: relational multi-language
matchers instead of single-node ESLint selectors, a custom runner instead of
ESLint's synchronous per-file callback, diff-scoped review mode, the state
arm as a measured axis rather than a fixed choice, and record/replay so a
threshold is auditable.

Two sibling projects on the same model shaped parts of this one, and are
worth reading beside it:

- [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) — a
  review workflow that screens whole patches and follows the strongest
  signals through `choice` and `score` questions. Its structured criteria,
  its screen-then-classify shape (`--explain`, `--loose`), its test-gap
  screen (the `paired` arm and `tests-cover-failure-paths`) and its diff
  subjects (`jev-lint commits`) were taken from it and measured here;
  `docs/internal/findings.md` §14 says what each measured as.
- [TKY-27/JevSlop](https://github.com/TKY-27/JevSlop) (MIT) — an AI Slop
  Score for note.com articles: eight writing-quality signals and one
  whole-article judgment, each a five-level rubric. The nine rules under
  `rules/markdown/` are those rubrics, verbatim or reversed so that a high
  score always means the defect the rule names, applied to a Markdown file
  as a whole; two rubrics that named amounts rather than defects had to be
  reworded before they separated, and the rule files say how. As JevSlop
  says of itself: a writing characteristic, not an authorship probability.
- [k16shikano's cognitive-rhythm writing norm](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432)
  — a Japanese norm for explanatory prose whose post-writing checks ask the
  question this tool asks of code: does a sentence update the subject, or
  only the document? Three rules under `rules/markdown/` are those checks
  (`section-ends-with-a-preview`, `section-opens-with-an-agenda`,
  `document-abandons-a-question`), two more are candidates with the reason
  they are not shipped, and `/jev-lint:prose` runs them beside the norm's
  mechanical leakage test. They read the norm's genre — articles and
  chapters — and will flag a reference or a findings log for doing what a
  reference does.

MIT.
