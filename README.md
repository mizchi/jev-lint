# jev-lint

[日本語](README-ja.md)

A linter for the things a linter could never check: whether a function does
what its name says, whether a comment is still true, whether a test verifies
what it claims.

Rules ship for **TypeScript, JavaScript, Rust, Python and Go**, plus
Markdown, `package.json`, sqlc `.sql` files and git commits. Your own rule
can target any language ast-grep parses -- Java, Kotlin, Swift, C, C++,
C#, Ruby, PHP, Lua, Dart, Scala, Elixir, Haskell, Solidity, Bash, HTML,
CSS, JSON, YAML -- since the matcher is ast-grep's, and any other grammar
you compile: a tree-sitter parser declared in the config, [MoonBit
included](docs/reference.md#a-language-ast-grep-does-not-have-built-in).

[`examples/cart.ts`](examples/cart.ts) is thirty-eight lines with three
lies in it: a doc comment that promises `null` above a body that throws, an
`isEmpty` that returns a string, an `applyDiscount` that also saves the
cart. [`examples/cart.test.ts`](examples/cart.test.ts) has a test that
would pass with its claim broken. Nothing a type checker minds.

```bash
$ export TYPESAFE_API_KEY=...
$ npx -y jev-lint check examples
```

```
examples/cart.test.ts
     17  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.91  cutoff 0.62  arm bare

examples/cart.ts
     16  flag       The failure contract stated in the documentation on this function -- what it says the function throws, raises, rejects with, panics on, or returns in place of a result when something goes wrong, and under what condition -- is contradicted by the body.
         doc-errors-match-body  0.94  cutoff 0.56  arm located
     16  flag       The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.91  cutoff 0.56  arm located
     16  flag       This function ($NAME) has a failure path of its own that none of the related tests reaches.
         tests-cover-failure-paths  0.92  cutoff 0.68  arm paired
     16  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.56  cutoff 0.55  arm located
     22  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.73  cutoff 0.55  arm located
     30  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.78  cutoff 0.55  arm located

no files for go (9 rules), javascript (1 rule), json (1 rule), markdown (11 rules), python (12 rules), rust (8 rules), text (1 rule)
7 rule(s) matched nothing: typescript/catch-hides-failure, typescript/comment-describes-block, typescript/idempotent-name, typescript/log-level-matches-event, typescript/log-message-matches-event, typescript/pure-name-is-pure, typescript/safe-name-is-safe
  A matcher that misses is invisible everywhere else -- check these before trusting a clean run.

7 finding(s), 37 subject(s), 0 cached
7 request(s), 28,613 input tokens, $0.00120, 745 ms (4549 ms of requests)
```

Each finding is one rule's sentence, held against one piece of code, with
the model's agreement (0.91) over the cutoff the rule ships with (0.62) and
what it was shown (`bare`: the test alone; `located`: with its file;
`paired`: with the tests that exercise it). Line 16 is the comment lie,
seen by four rules from four sides — the comment, its failure contract,
the name, and the tests that never reach the throw. Nothing clean was
flagged. The run cost a tenth of a cent.

## What it reviews

Conventional lint decides things a parser can decide. The conventions teams
actually argue about in review are not like that:

- **A name that drifted from its implementation.** `applyDiscount` that also
  saves the cart; `isAdmin` bound to a string; a test called `rejects an
  expired token` that never passes one.
- **A comment that became a lie.** A doc comment separated from its function
  by a later refactor, still claiming a `null` return the function no longer
  makes.
- **Design consistency.** Whether this module is named for what it contains,
  whether `catch` blocks hide failures, whether a `fetch` has a timeout unless
  it sits inside a retry wrapper that sets one.

All of these are visible only to a reader who understands both the contract
the code declares about itself and the body. jev-lint asks a model that
question, one sentence at a time, and reports what comes back over a cutoff.

It is **not** for anything a compiler, a type checker or ESLint already
decides. A model of this kind is measurably good at code that contradicts
itself and measurably poor at defects that need knowledge of a specific API,
such as `.sort()` defaulting to lexicographic order. Keep your existing tools
for those.

## How it works

A rule is an [ast-grep](https://ast-grep.github.io) matcher plus one sentence.
This is the shipped `fn-name-promises`, abridged:

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul                # a yes/no predicate with its own cutoff
  rule:
    kind: function_declaration
    has: { field: name, pattern: $NAME }
  ask: >-
    The body of this function does something materially different from what
    its name promises.
  criteria:
    "true": >-
      Someone who read only the name and the parameter list would be wrong
      about what this function does: it changes state when the name says it
      only reads, it can fail when the name promises a value, it handles a
      narrower case than the name claims, or it does substantial work the
      name does not mention.
    "false": >-
      The name and parameter list describe what the body actually does.
  state: located
  at: 0.55
```

The matcher is exact, free and runs locally; it decides **which code is looked
at** — every named function — and hands over `$NAME`. The sentence decides
**whether it is a problem**, and is answered by [Jev](https://typesafe.ai), a
model built to score a statement about a piece of text rather than to chat.
No parser can say whether `applyDiscount` also saves the cart; a reader who
sees the name and the body can, and so can the model, with the file for
context. `state: located` is that file, `kind: noul` says the answer is a
probability that the statement holds, and `at: 0.55` is the cutoff fitted to
a labelled corpus.

What makes that affordable is batching. The matches in a file travel together
in a request that carries the file once and each question only as its own
text, packed under a token budget the planner measures before sending.
`--dry-run` prints the plan and the price for your code without sending
anything. What one full pass over this repository costs is in
[What a full run costs](#what-a-full-run-costs).

## What it is not

It is not deterministic, and it is not always right. Measured on this
repository, about one finding in five was wrong, and a score near a cutoff can
move by a few hundredths between runs. jev-lint is built around that rather
than pretending otherwise:

- **Verdicts are cached** by the content of the rule and the code, so two runs
  over the same commit agree, and CI can lint from a committed cache with no
  API key at all.
- **`--retry 3`** asks everything three times, decides on the mean, and marks
  the findings that did not reproduce in every pass as ones to decide by hand.
  Retries are cheap: the matcher and the plan run once and only the asking
  repeats.
- **`--loose`** lists what answered under a cutoff but over half of it — a
  band that, on the shipped rules' own evals, holds every defect a rule can
  see and one clean subject in twenty — for a reader, never as a finding. It
  costs no request. `/jev-lint:review` reads that band after the findings.
- **Cutoffs are yours to fit.** `jev-lint gaps` shows whether a rule separates
  clean code from defects at all; `jev-lint calibrate --labels` fits the cutoff
  to code you have labelled; `jev-lint replay` re-scores a recorded run under
  new cutoffs for free. The shipped cutoffs are a starting point, fitted to
  this package's corpus and not to yours.

Read a finding as a candidate for a human to judge, not a verdict to act on.

## Quick start

```bash
export TYPESAFE_API_KEY=...            # https://typesafe.ai
npx -y jev-lint check src --dry-run    # what it would ask, and the price. No request.
npx -y jev-lint check src              # ask it
```

Nothing to install for that. Node 20+. `check` loads every shipped rule —
65 of them, under `rules/<language>/<id>/` — and the files you point it
at decide which run: a `.ts` file meets the TypeScript rules, a `.md` file
the Markdown ones, and a language no file belongs to is listed as idle at
the end of the run. Nothing to select.

### What ships, and what it runs on

| point it at | what runs | asks, for example |
| --- | --- | --- |
| `.ts` `.tsx` `.js` `.jsx` | `typescript/` — 21 rules, first tier | does this function do what its name promises; is the comment above it still true; would this test still pass if its claim were broken; does `catch` hide a failure |
| `.rs` | `rust/` — 9, first tier | the same for functions, comments, tests, bindings; `# Errors` / `# Panics` against the body; whether a trait's name describes its methods |
| `.py` | `python/` — 12 | ports of the TypeScript rules; `Raises:` against the body |
| `.go` | `go/` — 9 | ports, plus `must-name-panics`: does `MustX` panic on the failure its name promises |
| `.mbt` | `moonbit/` — 20 | every rule of this tool that a MoonBit file can carry: the naming rules, the guarantees, the comments, the failure contract, the log lines, the tests and their snapshots. MoonBit is not a grammar ast-grep has built in: [declare the parser](docs/reference.md#a-language-ast-grep-does-not-have-built-in) and these run; without it they are skipped and the run says so |
| `package.json` | `json/` — 1 | does a script's name describe the command it runs |
| `.sql` (an sqlc catalog) | `text/` — 1 | does `-- name: GetUserByEmail` describe the SQL under it |
| `.md` `.mdx` | `markdown/` — 11 | is this document slop, filler, vague, padded (JevSlop's eight signals, scored 0–4); does a section end by previewing the next, open with an agenda, abandon a question it raised |
| commits — `jev-lint commits` | `git/` — 1 | does this commit's message describe its diff |

Every rule is one question about a claim the code makes about itself, and
[RULES.md](RULES.md) lists all 65 with the question, the cutoff, and how
each scores on its own fixtures. The two first-tier languages carry the
release bar: every rule under `typescript/` and `rust/` has fixtures,
expectations and an accepted baseline. The rest are calibrated to the same
bar and not yet promised.

```bash
npx -y jev-lint check src                    # the code rules, whichever languages are there
npx -y jev-lint check docs README.md         # the markdown rules, on prose
npx -y jev-lint commits --base main          # each commit's message against its diff
npx -y jev-lint review --base main           # only the lines the branch touched
npx -y jev-lint rules                        # every loaded rule: its question, cutoff, file
```

A finding is read as the ones [at the top of this page](#jev-lint): the
line, the rule's sentence, the model's agreement against the cutoff the
rule ships with, and the arm — what it was shown. A score under the cutoff
is not a finding and is not printed; `--loose` prints the band just under
it, for a reader.

### One rule, or your own

```bash
npx -y jev-lint run fn-name-promises src        # one shipped rule, every language that has it
npx -y jev-lint run rust/fn-name-promises src   # ...or one language
npx -y jev-lint run --file myrule.yml src       # a rule file of your own, nothing else loaded
```

### For a project

```bash
npm install --save-dev jev-lint
npx jev-lint init                     # writes .jev-lint.yaml: files, and every rule on
```

The config picks the rules, as ESLint's does. `init` lists every shipped
rule turned on; delete or turn off what you do not want, override what you
do:

```yaml
files: [src, test]
exclude: [test/fixtures]
rules:
  fn-name-promises: on
  rust/fn-name-promises: off          # one language of the id
  comment-describes-block: { at: 0.7, severity: error }
  my-rule: warning                    # from .jev-lint/rules/
```

An id names the rule in every language that has it, `lang/id` one. With a
config and no `rules:`, nothing runs and the run says so; with no config at
all, every shipped rule runs. The API key is read from the environment only,
never from that file; `apiKey:` in it is an error. The verdict cache is
`.jev-lint/baseline.json`, meant to be committed: a run over the same commit
answers from it, and CI can lint from it with no key. `-R <dir>` loads a
directory in place of the shipped set and `.jev-lint/rules/`, for one run.

### Commits

A commit message is a claim and its diff is the body — the same class of
defect, in the one place a repository writes a claim about every change.

```bash
npx -y jev-lint commits --base main   # does each message describe its diff?
npx -y jev-lint commits               # the commits not yet pushed (@{upstream}..HEAD)
npx jev-lint init --pre-push          # a hook that runs that before every push
gh pr view --json title,body -q '.title + "\n\n" + .body' \
  | npx -y jev-lint commits --squash main..HEAD --message-file -   # the PR description against the whole branch
```

One subject per non-merge commit: the message is judged, the diff (capped,
with the stat kept whole and the cut declared) is what it is judged
against. The shipped rule is `git/commit-message-describes-diff`: the
message names a fix, a removal or a "no behaviour change" the diff does not
carry out, or the diff changes a default, drops a test or adds a dependency
the message never mentions. A terse subject line, an "also" in the body, a
lockfile beside the change, a revert of the exact inverse: not findings.

### For a coding agent

The repository ships a skill — how to run jev-lint, which shipped packs to
use, a cookbook of sixteen validated rules, and the calibration procedure —
so an agent can add jev-lint to a project or write a rule for it without
reading this README. Two agents that had never seen the tool each wrote a
working rule from the skill alone on their first try; the gaps they reported
are folded into it.

As a Claude Code plugin, which also installs `/jev-lint:review`,
`/jev-lint:commits`, `/jev-lint:prose` and `/jev-lint:new-rule`:

```
/plugin marketplace add mizchi/jev-lint
/plugin install jev-lint@jev-lint
```

As a skill for Claude Code, Codex, Cursor and the other agents the
[skills](https://skills.sh) CLI knows, into the current project:

```bash
npx skills add mizchi/jev-lint --skill jev-lint
```

`--skill jev-lint` matters: the repository also carries `jev-lint-repo`, the
maintainer's skill for changing jev-lint itself, which is not what a user
wants.

**Review the diff, not the tree.** Review mode judges only the lines a diff
touched, which is where the findings concentrate anyway, and costs a
fraction of a cent. In CI:

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

And before each commit:

```bash
jev-lint init --pre-commit      # writes .git/hooks/pre-commit
```

The hook runs `jev-lint review --staged --fail-on error`: only what the
commit contains, every finding printed, and the commit blocked only by a rule
with `severity: error`. No shipped rule has it, so out of the box the hook
is a reviewer that talks and never refuses; raise a rule to `error` once it
has earned that on your code. Without an API key in the environment it steps
aside. An existing hook is not overwritten; the one line to add to it is
printed instead.

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed. With `--format github` a finding is annotated as a `warning` unless
its rule says `severity: error`, and no shipped rule does: a probabilistic
reviewer that can fail a build is one that gets switched off. Raise it per
rule once the rule has earned it on your code.

To silence one finding, or one file:

```ts
// jev-lint-ignore-next-line fn-name-promises
export function summarize(rows: Row[]): Total { … }

// jev-lint-ignore-file
```

A suppressed subject is never sent, so a suppression also saves its tokens.

Two lines of output are never noise. **`N rules matched nothing`** is the only
place a matcher that matches nothing is visible: in the run at the top of
this page, seven TypeScript rules found no `catch`, no log call, no `safe*`
name in the two files, and that is what the list says (a language with no
files at all is the `no files for` line before it, not a miss). **`N
without a verdict`** means requests failed, and a run with failures never
reads as a clean repository.

Every flag, and the config file's precedence, is in
[docs/reference.md](docs/reference.md#commands-and-flags).

## What a full run costs

This repository lints itself: `.jev-lint.yaml` points the shipped packs at
`src`, `tools`, `test` and `package.json`, and excludes `test/fixtures`,
which holds planted defects. One full pass, all 23
rules, nothing cached, on a laptop over a home connection, recorded in
`docs/data/self-lint-2026-09-20.json`:

| | |
| --- | --- |
| subjects judged | 2,307 |
| requests | 79, up to 32 in flight |
| input tokens | 2,158,047 |
| output tokens | 44,236 |
| price | $0.0906 |
| wall clock | 5.1 s (54.7 s of request time, summed; 3.6–5.1 s across five runs) |
| model | `jev-1.13.0`, 2026-09-20 |
| findings | 6 |

That is 3.9 cents per 1,000 subjects. `--dry-run` on the same tree estimated
2,458,269 input tokens, 13.9% above what the server billed, so a dry run is a
bound to budget against rather than a quote. A `review` of one commit's diff
is a different order: the three commits behind the outline cap and the
sibling-deviates clause reviewed at 255,822 tokens, $0.011, in 8 s.

The wall clock is not the request time divided by the concurrency. The
server prices and limits input tokens — a bucket of about 1.6M refilling at
200–250k a second, answered with a bare 429 when it runs dry — and this run
is 2.15M, so the client paces itself against a mirror of that bucket and
sends up to 32 requests at once inside it. At the old fixed concurrency of 4
the same run took 9.6 s; past 32 the server's own latency grows with what it
is holding and the wall time stops falling.

Of the six findings, two are what the rule says they are: `computeCalls`,
named as a computation, assigns `calls` and `calledBy` onto every symbol of
the entry it is given, and `toRecord` reads the clock. The other four sit
within 0.17 of their cutoffs — a doc comment, a binding holding a path or
null, two test bindings — and are arguable. Earlier passes over the same
tree caught a test whose name promised "exactly one batch" while its body
only counted placements, a counter named `passed` holding a number, a comment
that counted "four places" above a function that tried seven, and a
`labels` that held the path to the labels; all fixed. `jev-lint replay
docs/data/self-lint-2026-09-20.json` reproduces the table with no API key.

## Rules

The full list, with every rule's cutoff, state, fixtures and its precision
and recall at the shipped cutoff, is [RULES.md](RULES.md), generated from
`rules/` by `npm run rules:md` and checked by the test suite.

65 rules ship in `rules/`, one directory per language and one per rule
under it, each with the cases that prove it, used when the project has no
`rules/` directory of its own. Two languages are first tier — `typescript`
(21 rules, admitting TypeScript, Tsx, JavaScript and Jsx) and `rust` (8) —
and every rule under them carries fixtures, expectations and an accepted
baseline. `python` (12) and `go` (9) are second tier: ported from the
TypeScript rules with the same sentence, calibrated to the same bar, not
yet promised. `javascript` (1) and `json` (1) hold what only fits there,
`git` (1) holds the commit-message rule, `text` (1) the sqlc query rule, and
`markdown` (11) the writing rules: eight quality signals ported from
JevSlop and three checks from the cognitive-rhythm writing norm (see Prior
art). The same id under several
languages is one rule in several languages, and the loader warns if the
copies of its sentence drift. Grouped here by what they ask, naming the
TypeScript rule; the table in `docs/reference.md` says which languages
each exists in:

**Naming** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would this test still pass if the behaviour its name claims were broken? |
| `module-name-describes-contents` | is this module named for what it contains? |
| `module-naming-consistent` | do this module's exports name the same kind of operation with the same words? |
| `type-name-describes-shape` | does this type's name describe its members, as the file builds and uses it? (`UserId` that is a session; `Config` that is a list of errors) |
| `trait-name-describes-methods` (Rust, MoonBit) | does a trait's name describe what its methods do — the capability an implementer gains? (`Comparable` whose one method renders; `Named` that also sorts and serialises) |

**Guarantees** — the name makes a specific promise; does the body keep it?

| rule | asks |
| --- | --- |
| `safe-name-is-safe` | `safe*` / `try*` / `*OrNull`: does a failure still escape as a throw? |
| `idempotent-name` | `ensure*` / `upsert*` / `register*`: does a second call do something different from the first? |
| `pure-name-is-pure` | `compute*` / `format*` / `parse*` / `to*`: does the body reach outside itself — mutate an argument, write a cache, read the clock or the environment? |
| `catch-hides-failure` | the inverse: a `catch` in a function *not* named `safe*` / `try*` / `*OrNull` that returns a default, an empty value or nothing while the name or return type promises a result |

On the corpus behind this pack, `fn-name-promises` flags none of the 22
labelled defects at its cutoff — the narrower promise separates where the
general question does not.

**Tests** — tests that cannot verify their name, by construction

| rule | asks |
| --- | --- |
| `test-mocks-subject` | is the behaviour the title claims performed by a stub, with the assertion reading the stub back? |
| `snapshot-only-behaviour-claim` | does the title claim a property that a whole-render snapshot does not isolate? |
| `describe-names-subject` | does a `describe("X")` block's title name what the tests inside it exercise? |
| `tests-cover-failure-paths` | does this exported function have a failure path — a throw, a rejection, an error result, a guard — that none of the file's related tests reaches? The one rule on the `paired` arm, which carries excerpts of those tests |

A test is recognised in the shape every framework writes it — jest, vitest
(in-source included), node:test with its options object and `t.test`
subtests, Playwright's `test.describe`, `Deno.test` in its three forms,
bun's `test.if` — by one built-in matcher (`matches: jev-test-call`), and
the question carries the test's address: `suite \`cart\` > suite
\`removeItem\`` for an `it("leaves the others")` two describes deep.

**Comments** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |
| `doc-errors-match-body` | does the doc's failure contract — JSDoc `@throws`, a docstring's `Raises:`, rustdoc's `# Errors` / `# Panics` — match what the body throws, raises, returns or panics on? Nothing else checks that it is *true* |

**Messages** — messages for a human, versus what the code does

| rule | asks |
| --- | --- |
| `log-level-matches-event` | does this log call's level match the severity of the path it sits on? |
| `log-message-matches-event` | does its message describe the event on that path? (`"cache hit"` in the miss branch; `"deleted %d rows"` logging the candidate count) |
| `error-message-matches-condition` | does a thrown error's message describe the condition the branch checked? (`"user not found"` from a permission check) |

**Config** — names in configuration files (ast-grep parses JSON and YAML)

| rule | asks |
| --- | --- |
| `script-name-does` | does this `package.json` script's name describe the command it runs? |
| `commit-message-describes-diff` | does this commit's message describe its diff? (`jev-lint commits`; `--squash` for a PR description against the branch) |
| `query-name-describes-sql` | does an sqlc query's `-- name:` describe the SQL under it? The first rule over a file no grammar parses: `subject: block` splits the file at each header |
| `must-name-panics` (Go only) | does a `Must*` function panic on the failure its name promises to panic on, rather than return it? |

Deliberately not asked anywhere: style, redundancy, whether something should
exist. One axis only — is the claim false.

On their own evals, 56 of the 65 rules reach precision and recall 1.00 at
their shipped cutoffs; the nine that do not each miss one labelled defect
the rule cannot see, and the rule file says which. The evals are small —
467 labelled defects across the 65, one to thirty-one per rule — and they
are marker-free: an earlier version carried `// DEFECT: named seconds, holds
milliseconds` above each defect, inside the file the model was shown, and
the fits it produced were better than the rules. `jev-lint eval --replay`
re-derives every number with no request. The full table, with what the
packs found on this repository's own code and on an unseen one, is in
[docs/reference.md](docs/reference.md#the-shipped-packs). Twenty-one more
rules were built and measured the same way and are not shipped; they live
in `experiments/rule-candidates/<lang>/` under the same layout, each with
the report that says why.

## Adding your rule

A rule is a YAML file. Put it in `.jev-lint/rules/` — flat
(`.jev-lint/rules/mine.yml`) or, if you want fixtures and a baseline beside
it, in the layout the shipped rules use:
`.jev-lint/rules/<language>/<id>/rule.yml` — and name it in the config's
`rules:` like any shipped one. Everything ast-grep
understands works in `rule:` unchanged — `pattern`, `kind`, `regex`,
`all`/`any`/`not`, `inside`/`has`, `utils`, `constraints`:

```yaml
id: catch-hides-failure
languages: [TypeScript, Tsx]
rule:
  kind: catch_clause
subject: enclosing          # judge the function around the match, not the clause
ask: This catch block swallows a failure the caller needed to know about.
note: logging and rethrowing is fine; returning a default silently is not.
severity: info
```

Three decisions shape whether a rule works, and each is a field:

| field | choices | the question it answers |
| --- | --- | --- |
| `rule` | any ast-grep matcher | which code is looked at. **Over-match on purpose**: a node the matcher misses is never asked about, and the model saying "irrelevant" is cheaper than a tight matcher |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged. The most common failure is asking about code that cannot contain the answer; a `catch` clause alone cannot show whether the failure mattered |
| `state` | `bare`, `local`, `paired`, `located` (default), `graph`, `full` | what else the model sees. Not a quality knob: the least context that still contains the answer. `paired` adds excerpts of the file's related tests, for a question whose evidence is in them |

Capture names when the rule is about a name. `has: { field: name, pattern:
$NAME }` hands `$NAME` to the model by name, and "does this body do what
`$NAME` promises" is a sharper question than "is this well named".

Then check it does something:

```bash
jev-lint rules                                      # loaded, or the validation error
jev-lint check src --dry-run --show-subjects        # which nodes it found, with captures
jev-lint check src --at catch-hides-failure=2 --retry 3   # a score runs 0-3
```

### Evals: the cases a rule ships with

A cutoff is fitted, not chosen, and a rule is only as good as the cases it
is measured on. Each rule directory carries them, under its language:

```
rules/typescript/catch-hides-failure/
  rule.yml                 one language; a Rust twin goes under rules/rust/
  fixtures/handlers.ts     code that reads like real code -- no markers in it
  expect.yml               fixtures/handlers.ts: [{ line: 12, label: bad, window: 0, reason: "..." }]
  baseline.json            the accepted run: answers, cutoffs, the rule's draft hash
```

The language directory admits only its own grammars (`typescript` admits
the ECMAScript four), so one language's matcher cannot land in another's
file. The same id under two languages is one rule in two languages: it
shares the id in findings and `--at`, and the loader warns if the two
copies of the sentence drift. Two languages are first tier — `typescript`
and `rust` — and every shipped rule under them has fixtures, an expect
file and an accepted baseline; a rule under any other language directory
may ship without a baseline and is listed as uncalibrated.

Expectations live in `expect.yml` and never in the code: a `// DEFECT: named seconds,
holds milliseconds` above a case is inside the file the model is shown, and
the fit then measures the label instead of the rule — which is how this
repository's own corpus once claimed 22 rules at 1.00/1.00 and had 17.
Put in the hard clean cases, the ones a lazy rule would flag.

```bash
jev-lint eval rules/typescript/catch-hides-failure --repeat 3   # ask 3 times, score at the shipped cutoff
jev-lint eval rules/typescript/catch-hides-failure --accept     # ...and make that run the baseline
jev-lint eval --replay                                 # every rule, no requests: the CI gate
```

The score is at the rule's **shipped** cutoff on the mean of the passes —
does the rule as it ships still get its cases right — with the fitted cutoff
printed beside it, not used. `--replay` re-scores every baseline at the
current cutoffs without a request and fails on a case that was right when
the baseline was accepted and is wrong now, or on a rule whose sentence,
criteria, matcher, subject or state changed since: those answers were to a
different question, and the eval has to be run and accepted again. This
repository's `npm run ci` ends in it.

Every field, `score` versus `noul`, the state arms with their measurements,
and sharing one sentence across grammars are in
[docs/reference.md](docs/reference.md#rule-fields).

## Further reading

[CHANGELOG.md](CHANGELOG.md) has every release; [RULES.md](RULES.md) every
shipped rule with its fit.

| | |
| --- | --- |
| [docs/reference.md](docs/reference.md) | every flag and field, calibration in full, the batching axis, what to expect on real code, limits |
| [docs/deepdive.md](docs/deepdive.md) | everything measured that is still true, and the evidence for it |
| [docs/internal.md](docs/internal.md) | how the code works, for changing it |
| [docs/findings.md](docs/findings.md) | the notebook, in the order it happened, including the wrong turns |

## Prior art

The idea of asking a model a lint question comes from
[mizchi/jev-playground](https://github.com/mizchi/jev-playground)'s
`eslint-plugin-jev`. What is different here: relational multi-language matchers
instead of single-node ESLint selectors, a custom runner instead of ESLint's
synchronous per-file callback, diff-scoped review mode, the state arm as a
measured axis rather than a fixed choice, and record/replay so a threshold is
auditable.

Two sibling projects on the same model shaped parts of this one, and are
worth reading beside it:

- [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) — a
  review workflow that screens whole patches and follows the strongest
  signals through `choice` and `score` questions. Its structured criteria,
  its screen-then-classify shape (`--explain`, `--loose`), its test-gap
  screen (the `paired` arm and `tests-cover-failure-paths`) and its diff
  subjects (`jev-lint commits`) were taken from it and measured here;
  `docs/findings.md` §14 says what each measured as.
- [TKY-27/JevSlop](https://github.com/TKY-27/JevSlop) (MIT) — an AI Slop
  Score for note.com articles: eight writing-quality signals and one
  whole-article judgment, each a five-level rubric. The nine rules under
  `rules/markdown/` are those rubrics, verbatim or reversed so that a high
  score always means the defect the rule names, applied to a Markdown file
  as a whole; two rubrics that named amounts rather than defects had to be
  reworded before they separated, and the rule files say how. As JevSlop
  says of itself: a writing characteristic, not an authorship probability.
- [k16shikano's cognitive-rhythm writing norm](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432)
  — a Japanese norm for explanatory prose whose post-writing checks ask
  the question this tool asks of code: does a sentence update the subject,
  or only the document? Three rules under `rules/markdown/` are those
  checks (`section-ends-with-a-preview`, `section-opens-with-an-agenda`,
  `document-abandons-a-question`), two more are candidates with the reason
  they are not shipped, and `/jev-lint:prose` runs them beside the norm's
  mechanical leakage test. They read the norm's genre — articles and
  chapters — and will flag a reference or a findings log for doing what a
  reference does.

MIT.
