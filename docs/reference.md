# Reference

Everything the [README](../README.md) leaves out: every flag, every rule field,
the calibration procedure in full, the batching axis, and what was measured on
real code. [deepdive.md](deepdive.md) has the evidence behind the numbers;
[internal.md](internal.md) is for changing the code.

## Commands and flags

```bash
jev-lint check src                  # judge whole files
jev-lint review --base main         # judge only what the diff touched
jev-lint review                     # ...or what is uncommitted, including untracked files

jev-lint gaps corpus                # per-rule separation -- on a LABELED corpus
jev-lint calibrate corpus --labels corpus/labels.json --repeat 3 --record run.json
jev-lint rules                      # what loaded, and every validation error
jev-lint replay run.json            # re-score a recorded run under new cutoffs, free
jev-lint replay run.json --labels corpus/labels.json   # ...and re-fit them, free
jev-lint init                       # write a .jev-lint.yaml to start from

jev-lint check src --dry-run        # plan and price it without asking anything
```

**Review mode is the one to reach for in CI.** It scans only the changed files
and keeps only the matches whose subject overlaps a changed line. Measured on a
one-function diff in this repository's corpus: **2 requests, 3,460 input tokens,
$0.00015, 0.6 seconds**, with 3 subjects judged and 28 skipped as outside the
diff. It is also where the rules earn their keep — findings concentrate in
freshly written code, because old names have already been argued over.

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

Exit codes: `0` clean, `1` findings, `2` configuration error, `3` requests
failed and nothing was reported.

| flag | |
| --- | --- |
| `-R, --rules <path>` | rule file or directory, repeatable, loaded in place of the packaged packs and `.jev-lint/rules/` for this run |
| `-r, --retry <n>` | ask everything n times and decide on the mean (default 1) — see [Asking more than once](#asking-more-than-once) |
| `-c, --cache <path>` | verdict cache (default `.jev-lint/baseline.json`, relative to the config's directory; `none` to disable) |
| `--at <rule=n>` | override one cutoff, repeatable |
| `--unsure-below <n>` | confidence under which a finding is worded as a question |
| `--arm <name>` | override every rule's state arm: `bare`, `local`, `located`, `graph`, `full` |
| `--group <how>` | `file` (default), `rule`, `auto` — see [Batching](#batching) |
| `--rule-batch-cap <n>` | subjects per rule-axis request (default 32) |
| `--explain` | after the verdicts, ask each finding which of its rule's `explain:` labels names why; one extra request per batch with findings — see [Rule fields](#rule-fields) |
| `--loose [n]` | also list the band under each cutoff — at or over the rule's `loose:` floor, else half its cutoff — for a reader, closest to the cutoff first, at most n. Never a finding: not counted, never fails, and costs no request — see [A second line for a reader](#a-second-line-for-a-reader) |
| `--explain-schedule` | print the axis chosen per rule, and why |
| `--base <ref>` / `--staged` | what `review` diffs against: the merge base with `ref`, or the index (what a commit will contain: no untracked files, no unstaged edits) |
| `--fail-on <severity>` | exit 1 only for a finding at or above `hint`, `info`, `warning`, `error`; default: any finding |
| `init --pre-commit` | write a hook running `review --staged --fail-on error`; refuses to overwrite an existing hook without `--force` |
| `run <rule> [paths...]` | `check` with one rule: a shipped id (every language that has it), `lang/<id>` (one), or a project rule when no shipped one has the id; an unknown id names the nearest. `--file <rules.yml>` uses that file's rules instead — all of them, or the one `<rule>` names in it. Every `check` flag applies |
| `commits [range]` | judge each non-merge commit's message against its diff with the `subject: commit` rules; the range is a positional (`main..HEAD`), else `--base <ref>`, else `@{upstream}..HEAD`. Findings are `<sha>:1`, named by short sha and subject line in every format. `--retry`, `--loose`, `--explain` and the cache apply; the cache keys on message and diff together |
| `commits --squash [range] --message-file <path\|->` | the whole range as one change — the diff from its merge base — judged against that message: a pull request's description (`gh pr view --json title,body -q '.title+"\n\n"+.body' \| jev-lint commits --squash main..HEAD --message-file -`), a changelog entry. `--message <text>` inline. One subject, named by the range |
| `init --pre-push` | write a hook running `commits '@{upstream}..HEAD' --fail-on error`; steps aside with no key or no upstream |
| `eval [dirs...]` | in a checkout of this repository, or over your own rule directories: run every `rules/<lang>/<id>/` suite (`--repeat n`, default 3), score at the shipped cutoff, compare with the baseline; `--accept` makes the run the baseline, `--accept-last` promotes the previous run without asking, `--replay` re-scores every baseline at the current cutoffs with no request and fails on a regression or a changed question |
| `--repeat <n>` / `--labels <path>` | `calibrate`: re-ask n times, fit against labels |
| `--record <path>` | write a replayable run record — do this for anything you will quote |
| `--force` | ignore cached verdicts |
| `--dry-run` | plan and price without asking anything |
| `--show-missing` | list subjects that got no verdict |
| `--show-subjects` | with `--dry-run`: list every subject with its line, node kind and captures |
| `--format <fmt>` / `--json` | `pretty`, `json`, `github`; `--json` is `--format json`, and holds for every command |
| `--concurrency <n>` / `--batch-size <n>` | default 32 and 256; the client also paces its input tokens against the server's rate limit, see `JEV_LINT_TOKENS_PER_SECOND` |
| `--model <id>` | Jev model |
| `--quiet` / `--no-color` | |

| `--config <path>` | config file (default: the nearest `.jev-lint.yaml`, searching upwards — any spelling of it is recognised: with or without the dot, with or without the hyphen, `.yaml` or `.yml`; two spellings in one directory are an error, exit 2, since jev-lint will not guess which is in force); `--no-config` ignores it |
| `--base-url <url>` | the API endpoint, for a proxy or a self-hosted deployment |

Environment: **`TYPESAFE_API_KEY`** (required for anything that asks), with
`TYPESAFEAI_API_KEY` accepted as a fallback; `TYPESAFE_BASE_URL`,
`JEV_LINT_MODEL`, `JEV_LINT_AST_GREP`; `JEV_LINT_TOKENS_PER_SECOND` and
`JEV_LINT_TOKEN_BURST` (defaults 200000 and 1200000), the client's mirror of
the server's input-token rate limit, which it paces itself against and
adjusts on a 429 -- raise them if your key has a higher limit and a large
run's summary says `paced to` a rate under it.

Two lines of output are never noise. **`N rules matched nothing`** is the only
place a dead matcher is visible — check it before trusting a clean run. On a
one-language repository expect a line first naming the languages it saw
no file of (`no files for python (11 rules), go (9), rust (7)`) — those
rules are idle, not silent — and then only the silent rules of the
languages it did see; on a TypeScript-only repository that is
`javascript/comment-describes-declaration`, which exists because JavaScript
has no type declarations to match, plus whatever TypeScript rule found no
node. **`N without a verdict`** means
requests failed, and a run with failures never reads as a clean repository.

### Pricing a run: `--dry-run`

`--dry-run` plans a run and prices it without a request: the batches, the
tokens each would carry, the total, and -- when more than one rule is
loaded -- a table per rule, dearest first, of its subjects, the requests it
is in, its tokens and their price, and its share of the plan. A rule's
questions are its own; a batch's state, which travels once for every
subject in it, is charged to each rule in proportion to the subjects it
put there, so the shares sum to the plan. Which rule to drop, or to `run`
alone, is a decision the total alone cannot inform.

### Structured output: `--json`

`--json` (`--format json`) makes every command print one JSON document on
stdout and nothing else there; what a reader would be told -- a config in
use, a rule that failed to load, a baseline accepted -- goes to stderr.
The exit code is the same as for text.

| command | document |
| --- | --- |
| `check`, `review`, `commits`, `run` | `findings`, `review` (the `--loose` band), `stats` (`byRule`, `byFile`), `degraded`, `silentRules`, `idleLanguages`, `ignored`, `unpaired`, `retry`, `spent`, `errors` |
| any of those with `--dry-run` | `dryRun: true`, `subjects`, `cached`, `requests`, `tokens`, `usd`, `batches`, `byRule` (the price per rule), `commits`, `subjectList` with `--show-subjects`, `ignored`, `unpaired`, `excluded`, `idleLanguages`, `silentRules` |
| `replay` | as `check`, plus `gaps` |
| `gaps` | `gaps` (the rows of the table), `stats`, `cached`, `spent` |
| `calibrate` | `passes`, `gaps`, `stability` (with `--repeat`), `fits` (with `--labels`), `spent` |
| `eval` | `suites[]` with `ok`, `score`, `diff`, `changedDrafts`, `recorded`, `passes`; `failed`. With `--dry-run`, each suite's `plan` |
| `eval --compare` | `suite`, `a`, `b` (each with `rules`), `changedDrafts`, `diff` |
| `rules` | `rules[]` with `id`, `languageDir`, `languages`, `kind`, `subject`, `state`, `cutoff`, `loose`, `severity`, `ask`, `note`, `explain`, `uncalibrated`, `source`; `errors`, `warnings` |
| `init` | `wrote`, and `keySet` or `hook` |

A `review` with no changed file is an empty document of the usual shape,
not a line of prose.

### Leaving a path out: `--exclude`

`--exclude <path>` (repeatable), or `exclude:` in the config, names a path
under the roots whose files are never subjects: fixtures with planted
defects, vendored code, a generated directory. The walk still passes
through it -- an excluded test file can still be a `paired` arm's evidence
-- but nothing in it is judged, and the run's last line counts what was
left out. The flag replaces the config's list rather than adding to it.

### Reading a long report: `--summary`

`--summary` adds two lines after the findings: the count by rule, and by
file with the subjects judged there, densest first. On a whole tree the
list reads by its clusters -- eight `catch-hides-failure` findings that
were one idiom in six modules, sixteen `tests-cover-failure-paths` that
were one test file too big to excerpt -- and the two lines are where they
show. `--format json` carries the same as `stats.byRule` and
`stats.byFile`.

### Silencing a finding

```ts
// jev-lint-ignore-next-line
export function summarize(rows: Row[]): Total { … }

// jev-lint-ignore-next-line fn-name-promises, var-name-describes-value
const x = compute();

// jev-lint-ignore-file comment-describes-block
```

`jev-lint-ignore-next-line` covers the line after it; `jev-lint-ignore-file`
covers the file wherever it appears in it. Both take an optional list of rule
ids, comma- or space-separated, and silence every rule when given none. Any
comment syntax works — `//`, `#`, `/* */`, `--`, `<!-- -->` — because the marker
is matched in the file's text rather than its parse tree.

Two things follow from that, and both are deliberate:

- **A marker has to be the first thing on its line**, after whitespace and a
  comment opener. A string containing the same text is not a marker, which is
  what stops a test fixture from silencing the file it is written in.
- **A suppressed subject is never sent**, so a suppression is also the cheapest
  way to quiet a rule. It is therefore reported: every run prints how many
  subjects were skipped and how many files were suppressed whole, for the same
  reason it prints which rules matched nothing. A suppression that names a rule
  id no rule answers to is called out too — a typo there silences nothing while
  looking like it did.

### Asking more than once

```bash
jev-lint check src --retry 3      # or -r 3
```

The answers are not deterministic, and near a cutoff that matters: measured on
this repository, per-subject spread across passes has a median of 0.010 and a
p90 of 0.050, but a maximum of 0.300 — enough to cross one. `--retry n` asks
everything n times, **decides on the mean**, and reports how many passes agreed:

```
     72  flag       This binding's name misdescribes the value it is bound to.
         var-name-describes-value  0.95  cutoff 0.61  arm located  3/3 passes
     88  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.57  cutoff 0.54  arm bare  1/3 passes
         did not reproduce in every pass (spread 0.24) -- decide this one by hand
```

`3/3` and `1/3` are different claims, and the second is the one
[not to automate](#anything-near-a-cutoff-belongs-to-a-human). Note two things:

- **The verdict cache is bypassed above 1.** A cached answer reproduces itself,
  which would measure nothing.
- **Only the asking repeats.** The matcher and the planner run once, so every
  pass sends identical states and question ids — which is what makes the
  answers comparable. It also means n passes cost n times the tokens.

## Rule fields

A jev-lint rule is an ast-grep rule plus `ask:`.

```yaml
- id: fetch-timeout
  languages: [TypeScript, Tsx]
  # Everything ast-grep understands works here unchanged: pattern, kind, regex,
  # all/any/not, the relational inside/has/follows/precedes, utils, constraints.
  rule:
    pattern: fetch($$$ARGS)
  ask: fetch must always be given a timeout, such as AbortSignal.timeout.
  # Context for the model, never shown in the finding. Exceptions go here.
  note: not a violation if it is inside a retry wrapper that already sets one.
  at: 2.0
```

| field | | |
| --- | --- | --- |
| `rule` | required | the ast-grep matcher. **Write it to over-match.** |
| `ask` | required | the predicate, one sentence |
| `language` / `languages` | required | one grammar, or several |
| `kind` | `score` (default) or `noul` | see below |
| `criteria` | `noul` only | `{true: ..., false: ...}`, nested under `criteria`. Each branch is a sentence, or a mapping `{what, examples?, not_for?}` — see below |
| `at` | cutoff | 0–3 for `score`, 0–1 for `noul` |
| `loose` | | floor of the `--loose` band, strictly under `at`. Default: half of `at`. `jev-lint eval` prints each rule's `cleanTop`, the highest a labelled-clean subject reached; a floor just above it lists only what the rule has never seen clean |
| `subject` | `node` (default), `enclosing`, `file`, `commit`, `block` | what code is judged. `commit` and `block` have no matcher: `commit` is `language: Git`, its subjects the commits `jev-lint commits` lists, the message judged and the diff the state; `block` is `language: Text`, its subjects the blocks of a text file split at every line matching `split:` |
| `split` | `block` only | a regex matched at the start of each line; its named groups (`(?<NAME>\w+)`) are the captures. A block runs from its header to the line before the next. Left out, the whole file is one block — a document judged as a whole — cut at 48,000 characters with the cut declared |
| `extensions` | `block` only | the files the rule reads, by extension (`[sql]`); no grammar claims them, so the rule has to say |
| `state` | `bare`, `local`, `paired`, `located` (default), `graph`, `full` | what the model also sees |
| `note` | | context for the model only |
| `axis` | `file` or `rule` | pin the batching axis; the scheduler will not overrule it |
| `severity` | `hint`, `info`, `warning` (default), `error` | `error` fails a build; earn it first |
| `levels` | `score` only | the rule's own ordered rubric, clean to worst, two or more strings, in place of the shared four-level scale; `at` then runs 0..levels-1 and a finding's level is numbered. The `rules/markdown/` rules are five-level rubrics from JevSlop |
| `explain` | | a mapping of label → description, two or more. With `--explain`, each of this rule's **findings** is asked a follow-up `choice` — which label best names why the statement holds — and the label is printed on the finding. Never part of the verdict question; adding it retires no cached verdict |

### `score` or `noul`

Choose by what the answer means, not by preference.

**`score`** for an ordered conclusion — *how badly* this breaks the rule — on a
fixed four-level scale: `not-applicable`, `satisfied`, `arguable`, `violation`.
Level 0 is how the model says "your matcher caught something this rule was not
written about", which is cheaper to read in a report than to prevent by
hand-tightening a matcher. A score also returns a **confidence**, which is what
lets an uncertain verdict be routed to a human instead of dropped.

**`noul`** for an independent predicate — *whether* something holds. Returns a
bare probability and no confidence, and gets its own cutoff. Its `criteria`
**must** be nested under `criteria:`; a flat `{true, false}` returns HTTP 200
with the criteria silently discarded, so the schema rejects it before it can
reach the wire.

Asking an ordered conclusion as a `choice` is the mistake this avoids: the
ordering is thrown away, adjacent levels split the probability mass, and the
result arrives as a low confidence indistinguishable from real uncertainty.

A branch of `criteria` is usually one sentence. It may instead be a mapping
of `what` (the defining sentence), `examples` (a list) and `not_for` (what
the branch is not about), which is the shape the vendor's own review
workflow sends and the API reads as JSON. Measured on `fn-name-promises`
(74 subjects, both grammars, three passes each way): the two shapes give the
same decisions at the shipped cutoffs, class gaps within 0.02 of each other,
and no subject moved more than 0.06 — the pass-to-pass spread. So the
mapping is a way of writing the same criterion, not a better criterion; use
it when a list of examples reads more clearly than a sentence with seven
clauses, and expect about 6% more input tokens for it.


`explain` is the one place a `choice` is used, and it is used **after** the
verdict, not for it. With `--explain`, every reported finding of a rule that
declares labels is asked one more question against the same state: which
label best names why the statement holds. Nothing under a cutoff is asked,
so the cost is one request per batch that produced findings. Read the label
as a reading aid with its confidence beside it: on the `fn-name-promises`
corpus, 10 of 13 labels matched the label's own reason, and the three that
did not came back at 0.20, 0.26 and 0.53 — overlapping options splitting the
mass, which is exactly why a choice never decides a verdict here.


### `subject`: what the question is about

The most common way a rule fails is being asked about code that cannot contain
the answer — then every answer lands mid-scale, which looks like a threshold
problem and is not one.

- `node` — the matched node. Right for "this `fetch` has no timeout".
- `enclosing` — the containing function. Right for "this `catch` hides a
  failure", where the predicate needs the body around the match.
- `file` — the module, presented as an **outline**: its path, its public items
  with their signatures, its private items, its imports. A symbol declared
  inside another (a method, a helper closed over by the function that uses
  it) is listed indented under its container, not as a sibling of it. The
  outline is capped at 16,000 characters — every export is kept, the private
  list is cut from the end and says how many it left out — so a module of
  any size gets a verdict. The only way to ask "is this module named for
  what it contains", because a file's text never mentions its own path.
- `commit` — a commit: its message is the subject, its diff the state.
  No matcher, `language: Git`, `state: bare`. Only `jev-lint commits` runs
  these rules; `check` and `review` leave them off duty. The one shipped is
  `git/commit-message-describes-diff`, whose fixtures are
  `fixtures/<case>/{message, before/, after/}` — each case becomes one
  commit on its own branch of a throwaway repository when the eval runs.
- `block` — a block of a text file no grammar parses, split at every line
  matching `split:`: an sqlc query file at each `-- name: GetUser :one`.
  No matcher, `language: Text`, `state: bare` or `located`; the header's
  named groups are the captures and the block is the subject's text. Runs
  under `check` and `review` beside the ast-grep rules, over the files whose
  extension the rule names. The one shipped is `text/query-name-describes-sql`.

### `state`: what else the model sees

One state per file carries every question for that file, which is the entire
cost argument: the file is sent once and each extra question costs only its own
text.

| arm | carries | cost |
| --- | --- | --- |
| `bare` | the matched code and the file's name | cheapest, and the only arm immune to unrelated edits in the same file |
| `local` | + each match's enclosing function, deduplicated | — |
| `paired` | + the enclosing function, and **excerpts of the tests related to the file** (`related_tests`); no whole file. The one arm whose evidence is in another file | up to ~2,500 tokens of excerpt per file; a subject whose file has no related test is dropped and counted as `unpaired` |
| `located` | + the whole file source | — |
| `graph` | + path identity, imports, symbol table with each symbol's signature and call edges; **no source** | small at any file size |
| `full` | source and graph | hits the 32Ki state budget soonest |

`paired` is different in kind from the others: its evidence is in **another
file**. A test file is related when its name contains the module's stem
(`cart.ts` ↔ `cart.test.ts`, `test/cart.test.ts`, `__tests__/cart.spec.ts`)
or when it imports the module — the second is what pairs a repository whose
tests all live in one file, and a name match outranks an import. One hop
of imports is followed: a test that drives an entry point (`main.ts`, an
`index`) which imports the module is that module's test too. One hop and
not a walk, since two hops from a test reach most of a tree. Of the
related files, the four that name the most of what is being asked about
travel — the subjects' own names first, then the module's other exports —
and the excerpt budget (8,000 characters for one subject in the file,
2,000 more per further subject, 32,000 at most) is split among them by
that same relevance. What travels of each is an excerpt: the lines that
name those symbols, a little context around each, and the title of the
test they sit in, the regions a lower-priority keyword alone matched
dropped first when the file's share runs out; `…` marks a cut. The state
says they are excerpts. A file with no related test yields no subject on
this arm — the runner drops those and prints how many, because "no test
reaches this path" with no tests in the state is true of everything and
says nothing. The excerpts are in the verdict key: a test added or a
better excerpt is a new question, and the old verdict is not reused.


**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured twice, and the second measurement corrects the first. On the
marker-free corpus (`docs/data/arms.json`, 2026-09-20, five arms, two
passes, $0.21) the arm makes a difference a reader can see for **one** rule:
`test-mocks-subject`, whose evidence is a `vi.mock` at the top of the file,
loses recall on `bare` (0.8) and `graph` (0.6) and separates on `located`.
For every other rule the five arms land within 0.05 of each other in class
separation, and the declared arm is within noise of the best. The earlier
story — that `var-name-describes-value` needed the file because `const
timeoutSeconds = 5000` is only wrong where the binding is used — was the
corpus marker talking: with it gone that case answers 0.22 at every arm, and
the rule does not separate at any. So the choice of arm is not a quality
knob, and it is also, on this evidence, rarely a separation knob: pick the
cheapest arm whose state holds the evidence, and measure when the evidence
lives outside the node. The evidence and the numbers are in
[docs/deepdive.md](deepdive.md#2-state-the-arm-is-not-a-quality-knob).

### Matcher captures are the sharpest state available

A rule that captures `$NAME` and `$TITLE` has told the question exactly which
two things it is comparing, and they reach the model by name. "Does this body do
what `$NAME` promises" is answerable; "is this well named" is not. This is why
the naming pack captures names rather than relying on the model to find the same
pair in the text — and why the comment rules use `follows:` with a pattern,
which propagates its capture into metavariables, so `$DOC` names the claim and
the matched node is the code.

### A test, in any framework: `matches: jev-test-call`

Two matchers are built in for the ECMAScript grammars, because every rule
about a test needs the same one and a framework a rule does not know is a
test it never asks about:

```yaml
rule:
  matches: jev-test-call     # $TITLE, $BODY: it / test and their x/f prefixes with any chain
                             # of .only .skip .concurrent .fails .fixme .skipIf(..) .if(..)
                             # .each(..) ...; test(name, { options }, fn) from node:test and
                             # t.test(...) subtests; Deno.test("x", fn), Deno.test({ name, fn }),
                             # Deno.test(function x() {}); bun's test.if(cond)("x", fn)
rule:
  matches: jev-suite-call    # $TITLE, $BODY: describe / suite / context with their modifiers,
                             # Playwright's test.describe(.serial|.parallel|...), and a
                             # node:test test whose body opens subtests
```

A call with no function to judge (`it.todo("x")`, a `RegExp.test`) is not
a test, and `test.step` is a step of one. Vitest in-source tests, under
`if (import.meta.vitest)` in the module itself, match like any other; for
the `paired` arm such a module is its own related test, excerpted as that
block. A rule's own `utils:` entry of the same name replaces the built-in.

The five shipped test rules use these, and the container probe that names
the statements inside a test uses the same definition, so the question
carries the test's whole address: `inside: suite \`cart\` > suite
\`removeItem\`` for an `it("leaves the others")` two describes deep,
which is the only reading under which that title claims anything. The
path is part of the verdict's cache key on every arm.

### One sentence, several grammars

`languages: [TypeScript, Tsx]` works when the matcher is valid in both. Rust and
TypeScript spell the same structural idea with different node kinds, and
ast-grep **rejects** a kind absent from the target grammar — and one rejected
rule fails the whole scan — so those need two matchers. In the shipped
layout that is two directories with one id, each with its own matcher,
state, cutoff and fixtures:

```
rules/typescript/fn-name-promises/rule.yml    rule: { kind: function_declaration, ... }
rules/rust/fn-name-promises/rule.yml          rule: { kind: function_item, ... }
```

The sentence is a copy, and copies drift; `jev-lint rules` warns when the
two copies of an id differ in `ask`, `criteria`, `note` or `explain`. A
language directory admits only its own grammars (`typescript` admits the
ECMAScript four), so a Rust kind cannot land in the TypeScript file. The
identity of a rule is `(language, id)`: findings, `jev-lint-ignore` and
`--at <id>=n` name the id and apply to every language, and `--at
rust/<id>=n` names one.

Outside that layout a rule file may still be a *list* of rules or a `---`
stream, and YAML anchors still work within one document.

## Calibrating

**Read the gap before you touch a threshold.** `jev-lint gaps` sorts each rule's
answers and reports the largest step between neighbours:

| verdict | what to do |
| --- | --- |
| `works` | nothing. Any cutoff inside the gap gives the same answers. |
| `move` | set the cutoff to `suggest`. The rule discriminates; the threshold is misplaced. |
| `rewrite` | the answers are not separated. **No cutoff helps.** Rewrite the sentence — and first check it is not asking for something the subject cannot show. |
| `silent` | the matcher never fired. Loosen it; this is the only place that is visible. |
| `thin` | under 6 matches. Not a pass. |

**`gaps` is for a labeled corpus, not for your repository.** A gap needs two
classes and real code is ~99.8% clean, so on real source it prints `rewrite` for
every rule that fires, which means nothing. There, read the per-rule **median**
and the **headroom** — see [What to expect](#what-to-expect).

Then fit against labels:

```bash
jev-lint calibrate src --labels labels.json --repeat 3 --record run.json
```

`--repeat` re-asks and reports which subjects changed *decision* between
passes. A rule can have a wobbly score and a perfectly stable decision, if the
wobble happens far from the cutoff — that is the good case. **A decision sitting
inside the wobble band should not be automated; route it to a person.**

Cutoffs are **per rule, never shared**. Same-shaped questions have been measured
answering their own defect class anywhere between 0.20 and 0.94; the quiet ones
are not broken, they simply never reach a common threshold.

Re-gating is free — `jev-lint replay` re-scores a recorded run under new cutoffs
with zero requests, and with `--labels` re-fits them too — so record anything
you will quote. A cutoff is a claim about a specific set of answers, and whoever
holds the record can re-derive it without an API key. Without that,
recalibrating silently rewrites history.

### The corpus is the investment

The thresholds shipped in `rules/*.yml` are fitted to `corpus/`, which makes them
an opinion about that corpus and a starting point on your code. Build your own:
label defects as comments next to the code (`// DEFECT (rule-id): reason`) and
let `corpus/build-labels.ts` derive the JSON, so line numbers cannot drift.

And make sure it contains the **hard** clean cases. The first version of this
corpus had clean cases that were all trivially clean, topping out at 0.36
against a defect band starting at 0.92 — which made a cutoff of 0.61 look safe
by a wide margin, until the first unseen function produced a false positive at
0.69. A hole for a class the corpus does not contain is invisible from inside
the corpus, however good the numbers look.

## Batching

The state can be built two ways, and the choice is not free.

- **`--group file`** (default) — one state per file: its source, then every
  match in it. The source is amortised over the matches.
- **`--group rule`** — one state per rule: only what the matcher caught, from
  anywhere. No file is ever sent whole. Note what this does and does not carry:
  the `local` arm attaches a match's enclosing function only when the match is a
  *fragment* inside one, so a rule whose subject is already a whole function
  gets no context at all and is effectively on `bare`.
- **`--group auto`** — cost both per rule before asking anything, and pick.
  `--explain-schedule` prints what it decided and why.

Planned on real repositories with `--dry-run`, both packs, at the shipped cap:
the rule axis is **3.3× fewer requests and 15.5% fewer tokens on tokio**, 2.6×
and 5.0% on vue. Since the API prices tokens, it buys **latency and rate-limit
headroom, not money**.

Three consequences before you switch it on:

1. **It costs a little accuracy.** On the corpus the two axes disagree on 1.4%
   of decisions, and the residue after refitting is one fewer true positive and
   two more false positives out of 276. One rule
   (`rust/fn-name-promises`) has **no separating cutoff at all** on the rule
   axis, because a rule-axis state spans files and so cannot carry one.
2. **A cutoff belongs to an axis.** Switching means re-fitting — `jev-lint replay
   <record> --labels <labels>` does that for free — and the rule-axis numbers
   are not shippable today, because a rule carries one `at:`, so they have to be
   passed with `--at`.
3. **It invalidates the whole verdict cache**, since the axis is part of the key.
   That breaks the commit-the-cache workflow below until the next full run.

So the accurate axis is the default, the cheap one is opt-in, and the scheduler
refuses to move a rule on a file-bearing arm. Pin any rule you calibrated with
`axis: file`. Full numbers in
[docs/deepdive.md](deepdive.md#4-the-batching-axis).

## The shipped packs

The mechanical list — every rule, its configuration, its fixtures and its
precision and recall at the shipped cutoff, re-derived from the accepted
baselines — is [RULES.md](../RULES.md), written by `tools/rules-md.ts`
(`npm run rules:md`; `npm run rules:md:check` fails when it is stale, and
so does `npm test`). What follows is the prose.

65 rules under `rules/<lang>/<id>/`, each with its fixtures beside it,
grouped here by what they ask. Which languages each exists in:

| rule | typescript | rust | python | go | other |
| --- | --- | --- | --- | --- | --- |
| `fn-name-promises` | ✓ | ✓ | ✓ | ✓ | |
| `var-name-describes-value` | ✓ | ✓ | ✓ | ✓ | |
| `test-name-describes-code` | ✓ | ✓ | ✓ | | |
| `test-name-verifies-claim` | ✓ | ✓ | | ✓ | |
| `module-name-describes-contents` | ✓ | ✓ | ✓ | ✓ | |
| `module-naming-consistent` | ✓ | | | | |
| `type-name-describes-shape` | ✓ | | | | |
| `comment-describes-declaration` | ✓ | ✓ | ✓ | | javascript |
| `comment-describes-block` | ✓ | ✓ | ✓ | | |
| `doc-errors-match-body` | ✓ | ✓ | ✓ | | |
| `safe-name-is-safe` | ✓ | | ✓ | ✓ | |
| `idempotent-name` | ✓ | | ✓ | ✓ | |
| `pure-name-is-pure` | ✓ | | ✓ | ✓ | |
| `catch-hides-failure` | ✓ | | | | |
| `must-name-panics` | | | | ✓ | |
| `test-mocks-subject` | ✓ | | | | |
| `snapshot-only-behaviour-claim` | ✓ | | | | |
| `describe-names-subject` | ✓ | | | | |
| `tests-cover-failure-paths` | ✓ | | ✓ | ✓ | |
| `log-level-matches-event` | ✓ | | ✓ | | |
| `log-message-matches-event` | ✓ | | | | |
| `error-message-matches-condition` | ✓ | | | | |
| `script-name-does` | | | | | json |
| `commit-message-describes-diff` | | | | | git |
| `query-name-describes-sql` | | | | | text |

`typescript` and `rust` are first tier; `python` and `go` were ported on
2026-09-20 from the TypeScript rules with the sentence copied and the
matcher, state, cutoff and fixtures their own (reports under
`experiments/reports/i-python` and `j-go`), and the families that did not
separate there — Python's `test-name-verifies-claim`; Go's two comment
rules, `test-name-describes-code` and `log-level-matches-event` — are
candidates under `experiments/rule-candidates/<lang>/` with the reason.
The notes the former packs shipped with are in `rules/README.md`.

**Naming** — does the code do what it calls itself?

| rule | asks |
| --- | --- |
| `fn-name-promises` | does this function's body do what its name promises? |
| `var-name-describes-value` | does this binding's name describe the value bound to it? |
| `test-name-describes-code` | does this test's code do what its name says? |
| `test-name-verifies-claim` | would it still pass if the named behaviour broke? |
| `module-name-describes-contents` | is this module named for what it contains? |
| `module-naming-consistent` | do this module's exports name the same kind of operation with the same words? |
| `type-name-describes-shape` | does this type's name describe its members, judged against how the file builds and uses it? |

`module-naming-consistent` is the one rule that reads a convention off the
file instead of being told it: the outline carries every export's signature,
so four synonyms for one lookup are visible in one state, and a sync `get`
beside an async `fetch` is not a mismatch because the signatures say why.
It ships at `severity: info`. Its sibling `sibling-deviates` — one export
breaks a pattern the rest follow — separates only as a `score` and only for
signature-level deviations, and stays in `experiments/reports/e-file-consistency/`.

The two test rules are **nested, not orthogonal** — a test that exercises the
wrong case also fails to establish its name — which is why both fire on the
wrong-case class and only one fires on weak assertions.

**Comments** — is the comment still true?

| rule | asks |
| --- | --- |
| `comment-describes-declaration` | does the comment above this declaration still hold? |
| `comment-describes-block` | does a comment inside a body describe the lines under it? |
| `doc-errors-match-body` | does the doc's failure contract (`@throws`, `Raises:`, `# Errors` / `# Panics`) match what the body throws, raises, returns or panics on? |

A comment is a claim in the one notation nothing checks. Deliberately *not*
asked: style, redundancy, whether a comment should exist. One axis only — is the
claim false. A vague or redundant comment is not a defect.

**Guarantees** — a name that makes a specific promise

| rule | names | asks |
| --- | --- | --- |
| `safe-name-is-safe` | `safe*`, `try*`, `*OrNull`, `*OrDefault`, `*OrUndefined` | does a failure of the kind the name absorbs still escape as a throw or rejection? |
| `idempotent-name` | `ensure*`, `upsert*`, `setup*`, `install*`, `register*` | does a second call leave a different result from the first? |
| `pure-name-is-pure` | `compute*`, `calculate*`, `derive*`, `format*`, `to*`, `parse*` | does the body reach outside itself: mutate an argument, write its own result into a cache that outlives the call, read the clock, the environment or a random source, even only on a fallback path? |
| `catch-hides-failure` | any function NOT named `safe*`, `try*`, `maybe*`, `*OrNull`, `*OrDefault`, `*OrUndefined`, `*OrElse` (the exclusion is in the matcher) | does a `catch` return a default, an empty value or nothing, or only log, while the name or return type promises a result? |

These are narrower cousins of `fn-name-promises`, and the narrowing is the
point: on the corpus behind this pack, `fn-name-promises` at its cutoff flags
0 of the 22 labelled defects, 16 of which sit under 0.30 inside its clean
band.

`pure-name-is-pure` is the one that needed a second revision. Its first
counted a lazily loaded wasm module as I/O and was wrong on all six of its
findings on an unseen repository. The criteria now separate acquiring a
dependency (not an effect) from caching the function's own result (an
effect), and say one read on any path is enough; on the same repository the
revision found six impurities, all real — `parse*` functions defaulting a
field to `new Date()`, `process.env` or `randomUUID()`. It ships at
`severity: info` because its unseen clean band tops 0.05 under the cutoff.
The family also built `guard-name-guards` (`validate*`/`sanitize*`), which
separates on four defects and is not shipped on that count. Reports in
`experiments/reports/b-guarantee-names/`.

**Tests** — tests that cannot verify their name, by construction

| rule | asks |
| --- | --- |
| `test-mocks-subject` | is the behaviour the title claims performed by a stub, with the assertion reading the stub's canned value back? |
| `snapshot-only-behaviour-claim` | does the title claim a property (an ordering, a hidden row, a branch) that a whole-render snapshot does not isolate? |
| `describe-names-subject` | does a `describe("X")` block's title name the function, module or behaviour the tests inside it exercise? |
| `tests-cover-failure-paths` | does this exported function declare a failure path — a throw, a rejection, an error result, a guard that refuses an input — that none of the related tests reaches? |

Both need `state: located`: a `vi.mock` at the top of the file is what makes
the first answerable, and on `bare` its two top-of-file cases fall from 0.6 to
0.3. `test-mocks-subject`'s cutoff is 0.30, low because its defect band is
quiet (0.42–0.64): a mocked subject reads as a mild claim. A third candidate,
`test-asserts-on-mock`, separated as well and was dropped because
`test-name-verifies-claim` already reports every one of its cases.

`tests-cover-failure-paths` is the one rule on the `paired` arm and the
reason that arm exists: its evidence is the tests, which are in another
file. Exported functions only — a private helper's failure path is
exercised through whatever export calls it. On its evals (27 subjects, 7
defects, 11 hard cleans, 3 passes) it separates at 0.88–0.95 against a
clean band topping at 0.36, cutoff 0.68, no flips. On this repository's
own `src/` the first run was a continuum with seven subjects over 0.70,
four of them right; the one wrong one — a fallback `return captured` read
as a failure path — is named in the note now. A file with no related test
yields no subject; the report says how many. See findings §14.

**Messages** — messages for a human reader

| rule | asks |
| --- | --- |
| `log-level-matches-event` | does the level of this `logger.<level>(...)` call match the severity of the code path it sits on? |
| `log-message-matches-event` | does its message describe the event on that path? |
| `error-message-matches-condition` | does a `throw`'s message describe the condition the guarding `if` checked? Test doubles (`Fake*`, `Mock*`, `Stub*`) are excluded in the matcher |

Siblings not shipped, in `experiments/reports/c-human-messages/`:
`assertion-message-matches` — its first revision's four unseen findings were
all test stubs throwing a simulated failure on a call counter; the second
keeps those out by matcher and by criteria and produces zero unseen
findings, but sits 0.06 over a nested-guard clean that flips one pass in
three, so it stays a recipe — and `ui-message-honest` (needs `subject:
enclosing`; measured before the promoted-subject key was fixed, so worth
re-measuring).

**Config** — names in configuration files

| rule | asks |
| --- | --- |
| `script-name-does` | does this `package.json` script's name describe the command it runs? |

**Commits** — the message against the diff

| rule | asks |
| --- | --- |
| `commit-message-describes-diff` | does the message claim something the diff does not do, or does the diff do something material the message does not mention? |

The one rule with no matcher, run by `jev-lint commits`. Sixteen cases —
seven messages that lie (a fix that adds a feature, a removal that only
deprecates, a "no behaviour change" over a changed timeout, a rename that
changes the contract, a test added and another deleted, a fix attributed
to the wrong cause, a flag plus `strict: false`), nine clean of which seven
are hard (a terse subject over a large faithful move, an "also" body, a
mechanical rename, an honest refactor, intent over mechanism, a version
bump alongside, a revert) — separate at 0.65 with 0.30 of headroom above
the clean top and no flips. On this repository's own commits its first
unseen run found one true finding: a docs commit whose `git add -A` had
swept in 1,700 lines of two other agents' half-built rule candidates.
Report: `experiments/reports/k-commits`.

**Queries** — `text/query-name-describes-sql`: does an sqlc query's
`-- name: GetUserByEmail :one` describe the SQL under it? The first
`subject: block` rule. Sixteen queries — six defects (a `ByEmail` over a
`WHERE` on id, a `Latest` over `ORDER BY … ASC`, a `Count` tagged `:many`
returning rows, a `Get` that deletes, `Invoices` over the orders table, an
`Active` with no filter) at 0.91–0.96, nine cleans topping at 0.30 —
separate at 0.61 with no flips. One corpus correction is in the rule file:
a soft-delete `DeleteUser` read as misnamed while an identical
`SoftDeleteUser` sat beside it, which was the corpus contradicting itself.

**Writing** — `markdown/`, eight `score` rules ported from
[JevSlop](https://github.com/TKY-27/JevSlop), each a five-level rubric over
a Markdown file as a whole (`subject: block` with no `split`): does the
document read as filler, vague, generic, formulaic, padded, lacking
firsthand evidence, incoherent, or as slop overall (the ninth,
`document-repeats-itself`, separates but on four defects and is a
candidate). JevSlop's "higher is better" axes are reversed so that every
rule here means the same thing by a high score; two of them — firsthand
evidence and coherence — had rubrics that named amounts ("Central …
None", "Coherent.") and the model read the amount, not the defect, until
each level was reworded as a statement about the document. On unseen
technical documents nothing fires; a reference with no narrator sits at
"some" firsthand evidence, which is a description, not a defect. Not the class the rest of this tool is built
for — a document makes no contract with itself the way a name does — and
shipped at `severity: info` for that reason; a writing characteristic, not
an authorship probability.

Beside them, three `noul` rules from k16shikano's
[cognitive-rhythm writing norm](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432)
for Japanese explanatory prose, which *are* this tool's class: does a
sentence update the subject, or only the document?
`section-ends-with-a-preview` and `section-opens-with-an-agenda`, one
subject per Markdown section with the document in view, and
`document-abandons-a-question` (a question, an invited assumption or a
promise never returned to), one subject per document. The norm's four
exceptions — an objection quoting the misreading it rejects, the sentence
that poses a question and the one that returns it, a request at a
boundary, the opening and closing of an invented example — are the hard
cleans. The general form, `section-narrates-itself`, is a candidate: at
0.60 it reaches precision and recall 0.95, and the two that cross are the
norm's own short punchy form of narration against its exception for an
invented example's frame, 0.02 apart after three sentences.
`address-outside-boundaries` separates with 0.06 of headroom and is a
candidate too. On this repository's own documents every finding was a
correct reading of the norm applied to a genre it is not for — a findings
log's navigational preface, a reference's "read the twelve as…" — so use
them on articles and chapters. `/jev-lint:prose` runs both families and
the norm's leakage test, which is a grep and not a model question.

**Go only** — `must-name-panics`: a `Must*` function promises to panic on
the failure its name names; does it return it, log it, or swallow it in a
deferred recover instead? The inverse of `safe-name-is-safe`, which is why
it is its own rule.

The matcher is the whole `"name": "command"` pair under `scripts`, so the
claim and the evidence are one node and `bare` is the arm. Siblings not
shipped: `workflow-step-name` (GitHub Actions `name:` versus `run:`, separates
by one subject's width) and `openapi-summary-matches-schema` (no unseen code
to meet); both in `experiments/reports/a-config-names/`, with nine
things about matching YAML and JSON in ast-grep that the skill now states.

### What the cutoffs are worth

On a one-language repository every other language's rules are idle, and
the report says so in one line rather than listing them as silent.

Of the 65, **56 reach precision 1.00 and recall 1.00 at their shipped cutoffs
on their own fixtures** (`rules/*/*/baseline.json`, three passes each,
decisions on the mean; `jev-lint eval --replay` re-derives every number below
with no request). Read that with the positive counts beside them: per rule,
31, 17, 13, 12, 12, 11, 10, 10, 10, 10, 9, 9, 6, 6, 6, 5, 5, 5, 4, 4, 2, 2, 1
labelled defects — 200 in all, against 113 before the improvement round of
2026-09-20, in which six agents each took one or two rules, added hard cases
drawn from real code, and rewrote criteria until the rule separated or the
reason it could not was named. The two `module-name-describes-contents`
rules still have one defect each and ship at `severity: info`;
`javascript/comment-describes-declaration` has two.

Three do not, each by one labelled defect the rule file names:

| rule | at the shipped cutoff | the one it misses |
| --- | --- | --- |
| `var-name-describes-value` | recall 0.92 | `flat = normalizeRule(bad)` holding a rejection: the claim is about the branch of a union result, visible only in the assertions after it |
| `rust/var-name-describes-value` | recall 0.90 | a field taken under another field's name, answering 0.10–0.87 on identical input across runs |
| `comment-describes-block` | recall 0.92 | a comment true of the sort it sits above and false only together with the loop after it (0.52); parked at 0.75 over the band that big test files still produce, since the arm steps down to `local` there and a test callback has no container to promote to |

What the round moved, besides the counts: `fn-name-promises` from 0.82 to
0.55 — the old cutoff had been fitted to outrageous defects only, and the
real ones added from a worker and a queue landed at 0.50–0.74 under it;
`test-name-describes-code` from an "inversion" no cutoff repaired to
1.00/1.00, because the inverted case was a label error (a test whose body
calls no sort is not "about the right thing weakly", it is about something
the code never touches); `comment-describes-block` from recall 0.5 to 0.92
once its root cause was found — a statement inside a `test(...)` callback
has no named container, so `subject: enclosing` could not promote it and
the model was judging one line and its comment; and every rule's clean band
has hard cases in it that the first corpus did not have.

**The corpus is marker-free, and was not.** Until 2026-09-20 every labelled
defect in the original thirteen files sat under a comment of the form
`// DEFECT (rule-id): named seconds, holds milliseconds`, from which
`corpus/labels.json` was generated. Those lines were inside the files the
`located` arm sends, and for a `subject: enclosing` rule inside the subject.
Stripping them (the labels now live in `corpus/labels.hand.json`) moved the
fits: `comment-describes-declaration` from 0.74 to 0.54, `comment-describes-block`
from a clean 1.00/1.00 to one defect under the real-code clean band,
`var-name-describes-value` from 1.00/1.00 to recall 0.67. The four packs built
later were marker-free from the start, by a brief that said so, and did not
move. The count above is the count after.

`test-name-verifies-claim` briefly joined it. On its original four defects
the rule separated at 0.53 with room to spare; the tests pack added eleven
defects and three hard cleans whose titles claim nothing ("matches the
snapshot", "renders") over a snapshot assertion, and the rule read those at
0.69–0.77, inside its defect band: precision 0.93 at any cutoff. The fix was
in the criteria, not the cutoff. Telling the false branch that a snapshot
establishes a snapshot claim, and a call assertion an interaction claim, put
the three cleans at 0.40 and under and the fourteen defects at 0.53 and
over. It ships at 0.52.

Two rules that did not separate before do now. `comment-describes-block` and
its Rust twin shipped "NOT CALIBRATED" because a clean case tied a defect in
the same function at 0.94. It was not the rule: a `subject: enclosing` rule
keyed its verdicts on the enclosing function, so two matches in one function
got one answer. With the match in the key both variants reach 1.00/1.00, on
two defects each, at `severity: info` until the corpus has more.

The cutoffs were refit twice on 2026-09-19: once after a fix to what the
model is shown (an ast-grep bookkeeping capture had been going out beside the
real ones on a quarter of the subjects), once after the promoted-subject fix
and the merge of the four new packs' corpora. Between the two, `fn-name-promises`
moved 0.76 → 0.86 as its clean band rose with 45 more named functions in the
corpus, and no other shipped rule moved by more than 0.08. The measurements
below that quote a cutoff were made at the earlier values, and say which.
Read the 17 as "these rules separate the classes in a corpus the author and
five agents wrote", against the baseline that **a tool reporting nothing at
all scores about 89% accuracy on that corpus** — most of its 988 subjects are
clean — at zero recall.
Accuracy is the wrong number on a set that imbalanced; the precision and recall
pair with the raw counts is the honest one.

## What to expect

The figures in this section are from `docs/data/self-lint-after.json`,
recorded 2026-09-19 12:34 at the cutoffs shipped then; the [README's cost
table](../README.md#what-a-full-run-costs) has a later full pass, and the
current cutoffs are in `rules/`. Run on this repository's own TypeScript —
`src`, `tools`, `test` — the shipped packs were **1,403 subjects, 67
requests, 1.12M input tokens, $0.047 and under five seconds** of wall clock.
That is roughly **3 cents per 1,000 subjects**, and `--dry-run` quotes about
9% high, so treat it as a bound rather than a price.

Over several rounds it found, in 8,132 lines of TypeScript, **22 sites worth
changing**:

| what it caught | sites |
| --- | --- |
| comments that had become false | 3 |
| tests that did not verify the behaviour their own names claimed | 7 |
| bindings named for their input rather than their value | 12 |

Those are individual sites, not independent discoveries — the twelve bindings
are one defect made twelve times, and a single round's findings were 11, of
which 9 were real. Nothing there is what a compiler, a linter or coverage
reports; coverage called every one of those tests covered. Details, including
two worth quoting, are in
[docs/deepdive.md](deepdive.md#6-accuracy-on-real-code).

### About one finding in five was wrong

**Read every finding against the code before believing it.** In one round, 11
findings were reported and I judged 9 real and 2 wrong.

Three caveats on that number, because it is the most quotable one here and the
weakest: it is **one round**, on **one repository**, judged by the person who
wrote both the rules and the code. It is a self-assessment, not a measurement
against labels — the only labelled accuracy figures anywhere in this project are
the corpus ones above. Treat it as an order of magnitude and nothing finer.

What it is enough to establish is the posture: **this generates candidates for a
human to judge, not verdicts to act on.**

When you disagree with a finding it is usually one of three things, and only the
third means the tool is wrong:

1. **The rule is right and the code is wrong** — most often, in this experience.
2. **The rule is right and the *name* is wrong.** A test called "no batch
   exceeds the ceiling" whose body legitimately exempts one-subject batches is
   not a weak test; it is a name that overclaims.
3. **The rule is wrong.** Then add the case to your corpus as a labeled clean
   example and refit. A false positive that is not in the corpus will come back.

### Headroom predicts your next false positive

After fixing the nine, three passes over identical code report **2 findings
each**, and the three-pass mean leaves **3 of 1,403 subjects** over their
cutoff — two of them by less than 0.01. The useful diagnostic is not that count
but the distance from the highest *clean* answer to the cutoff:

| rule | subjects | median | highest clean | cutoff | headroom |
| --- | --- | --- | --- | --- | --- |
| `test-name-describes-code` | 94 | 0.09 | 0.28 | 0.95 | +0.67 |
| `fn-name-promises` | 151 | 0.13 | 0.49 | 0.76 | +0.27 |
| `comment-describes-block` | 149 | 0.20 | 0.75 | 0.97 | +0.22 |
| `comment-describes-declaration` | 95 | 0.14 | 0.62 | 0.83 | +0.21 |
| `test-name-verifies-claim` | 94 | 0.16 | 0.44 | 0.54 | +0.10 |
| `module-name-describes-contents` | 19 | 0.18 | 0.55 | 0.62 | +0.07 |
| `var-name-describes-value` | 801 | 0.10 | 0.55 | 0.61 | **+0.06** |

`jev-lint` prints those two columns itself, and the table above is one free
command — no API key, the three recorded passes averaged:

```bash
jev-lint replay docs/data/self-lint-after.json
```

The two rules at the bottom of the table hold the entire residue. That is what a
corpus-fitted cutoff does: it sits where the corpus's clean band ended, and real
code's clean band goes higher. Those two are the rules to refit first on your
own code.

### A second line for a reader

`--loose` is the two-stage shape: the model as a cheap screen with a low
line for recall, and a reader — a person, or an agent running
`/jev-lint:review` — behind it for precision. The screen costs nothing
extra, because it is the same answers cut at a second line; the reader is
the expensive stage, which is why the band is capped and ranked.

The default floor is half the cutoff, and it is a measurement rather than a
guess. On the 24 shipped rules' own evals, no defect a rule can see answers
under half its cutoff (the one that does is the `var-name-describes-value`
miss its rule file already names), and about one clean subject in twenty
answers over it — so the band holds everything the rule would ever catch
and asks a reader for one look per twenty subjects. A rule that has
measured its own clean band can set `loose:` just above it; `jev-lint eval`
prints that number as `cleanTop`.

What the band is **not** is a threshold to fail on. A ratio of the score is
the wrong shape for that: the noise is additive (a few hundredths, rarely
0.3) and the signal is a level shift across a fitted cutoff, so "half the
score" fails a build on a clean subject that moved from 0.06 to 0.12 and
passes one where a planted lie moved a file's mean from 0.14 to 0.21.
Measured on this repository: a function rewritten to always return `true`
and write a file went from 0.09 to 0.95 under `fn-name-promises`, its
unchanged neighbours moved by at most 0.03 — and one unchanged helper that
exists to feed it moved 0.13 → 0.42, which is the `located` arm reading a
changed file. Fail on the cutoff, with `--retry 3` and its `passes`; read
the band.

### Anything near a cutoff belongs to a human

Per subject, pass-to-pass spread is a median of 0.010 and a p90 of 0.050 — but
the maximum is 0.300, which is enough to cross a cutoff. So **average three
passes before deciding anything near a cutoff**, and note that averaging is not
the same as reporting less: here the per-pass count is a stable 2 while the
three-pass mean names 3, because two subjects sit within 0.01 of their cutoff
from either side. A decision that close is not a verdict; route it to a
person.

Two honest notes about that residue:

- **Some of it was a bug in this tool, not in the rules — and I published "no
  describable pattern" before finding it.** A subject over 900 characters on an
  arm that carries no file source was asked about with **no code in the question
  at all**: 111 of this repository's subjects, 8% of them, concentrated in
  exactly the long test bodies the residue consisted of. Fixing it dropped the
  per-pass residue from 3–4 findings to a stable 2 and tripled
  `test-name-verifies-claim`'s headroom. It did *not* rescue
  `comment-describes-block`, the rule most affected, which still does not
  separate. So the first explanation of a residue is worth distrusting,
  including this one.
- **What is left has no pattern I can name.** The obvious hypothesis — that
  compound or universal test names read as under-verified whatever the body does
  — is refuted: grouping all 94 `test-name-verifies-claim` subjects by how many
  claims their name makes gives flat means of 0.18–0.23. The unglamorous
  explanation is the one that fits: a cutoff fitted where the corpus's clean
  band ended, against a real clean band that goes higher.
- **It runs in both directions.** Before those fixes the highest
  `comment-describes-declaration` answer here was 0.76 against a 0.83 cutoff —
  a **missed** defect, and a real one: a doc comment separated from its function
  by an interface declaration, so it documented the wrong thing and claimed a
  null return the function never makes. The cutoff missed it by 0.07. Fixing it
  is why that rule's highest clean answer is 0.63 in the table above.

So: **expect to refit on your own code.** That is not a disclaimer, it is the
documented procedure, and `replay --labels` makes it free once you have a
record.

## How it behaves when things go wrong

A review tool that can break a build is worse than no review tool, so every
failure path lands on "no verdict":

- A failed request, an unusable answer, a missing or corrupt cache: no finding,
  and the count of missing verdicts is reported in every format. **A run with
  failures never reads as a clean repository.**
- A malformed rule is dropped with a reason, printed loudly. A rule that
  silently failed to load looks exactly like a rule that found nothing.
- A file whose **source** is too large for the 32Ki state budget steps down to a
  leaner arm, and says it did. A file with many *matches* is split instead —
  that is not a loss of context and is not reported as one.
- `max_tokens_exceeded` halves the question set and retries. That rescues a
  request over budget and **cannot rescue a state over budget**, since every half
  still carries the same state, so the planner packs to a margin under each
  budget. An over-budget state loses its verdicts, and they are counted.

The verdict cache is **trusted input**: anything that can edit it can silence a
rule or invent a finding. Keep it next to your rule files in review, not in a
build-artifact directory. Commit it and CI lints without an API key and
reviewers see the verdicts you saw; leave it ignored and CI pays for a fresh
pass each run. Changing a **cutoff** invalidates nothing, by design, so
recalibration is free; changing a rule's *sentence*, its matcher, its arm, or
the batching axis invalidates the verdicts that depended on them.

## Limits

- **Not deterministic.** The cache is what makes two runs agree, which is why it
  is not merely a speed optimisation.
- **The matcher fails silently.** Over-match on purpose; the "N rules matched
  nothing" line is the only place a dead matcher shows up.
- **No editor integration, no autofix.** The economy comes from batching across
  a whole rule set with one state per file, and a linter's rule callback is
  synchronous and per-file. There is no seam for it.
- **The within-file call graph is a name-occurrence test**, not a resolved one.
  It is only ever shown to the model, never used to decide anything.
- **`severity: warning` by default, deliberately.** A probabilistic reviewer
  that can fail a build is a probabilistic reviewer that gets switched off.
- **The cutoffs are fitted to small evals.** 320 labelled fixtures, 467
  labelled defects across 65 rules, one to thirty-one per rule. Expect to refit; see
  [What to expect](#what-to-expect).
- **No accuracy was ever measured on a large repository.** The tokio and vue
  figures above are planning cost only. Do not quote precision from them.

## The config

`.jev-lint.yaml` (any spelling of it), found by searching upwards; a flag
of the same name beats a setting in it. Since 0.5 it picks the rules, as
ESLint's does:

```yaml
files: [src, test]              # what `check` looks at with no path given
exclude: [test/fixtures]        # under those, never judged
rules:                          # only these run
  fn-name-promises: on          # the rule's own severity and cutoff
  rust/fn-name-promises: off    # one language of the id
  comment-describes-block: { at: 0.7, severity: error, loose: 0.4 }
  my-rule: warning              # a severity: on, at that severity
cache: .jev-lint/baseline.json  # the default; `none` disables
```

A rule is named by its id, which is every language that has it, or by
`lang/id`, which is one and wins over the bare id for that language. The
value is `on`, `off`, a severity (`hint`, `info`, `warning`, `error`) or a
mapping of `severity`, `at` and `loose`. A name that matches no loaded rule
is an error, exit 2 -- a misspelt id that ran nothing would look like a
clean rule. A config with no `rules:` runs nothing and says what to write;
with no config at all, every loaded rule runs and the run says so.

The rules load from the package's own packs and, when the directory
exists, `.jev-lint/rules/` beside the config: a flat `*.yml` there, or the
shipped layout `<language>/<id>/rule.yml` with `fixtures/`, `expect.yml`
and `baseline.json` beside it, which `jev-lint eval` finds on its own. A
rule of one's own with a shipped id is a duplicate and the loader says so;
turn the shipped one off instead. `-R <dir>` loads a directory in place of
both, for one run.

### A language ast-grep does not have built in

ast-grep parses 26 grammars; anything else is a tree-sitter parser you
compile and declare. `languages:` in the config says the same thing
ast-grep's own `customLanguages` does, and jev-lint writes it an
`sgconfig.yml` of its own per run:

```yaml
languages:
  moonbit:
    libraryPath: parsers/moonbit.dylib   # resolved from this file's directory
    extensions: [mbt]
    expandoChar: _
```

```bash
git clone --depth 1 https://github.com/moonbitlang/tree-sitter-moonbit
cd tree-sitter-moonbit && tree-sitter build --output ../parsers/moonbit.dylib
```

Four things decide whether it works, each measured on MoonBit:

- **The name is the name.** A rule's `language:` must be the key here,
  spelled the same way; ast-grep answers `Cannot parse rule` for
  `MoonBit` against a `moonbit:` key. jev-lint normalises case for you,
  and emits the declaration's spelling.
- **`expandoChar` or no patterns.** Where `$VAR` is not valid syntax, a
  `pattern:` with a metavariable parses to an ERROR node and matches
  nothing, silently. With `expandoChar: _`, `pattern: "fn $NAME() -> Int
  { 1 }"` matches and `$NAME` captures. A rule written as `kind:` plus
  `has:` needs none of this.
- **Fields may not exist.** MoonBit's grammar declares none, so
  `has: { field: name, ... }` matches nothing there; `has: { kind:
  function_identifier, stopBy: end, pattern: $NAME }` is the way to
  capture a name.
- **Rules for it may ship.** `rules/moonbit/` is in the package: nineteen
  ports -- every rule of this tool that a MoonBit file can carry -- each
  fitted on its own fixtures. They load
  anywhere -- `rules`, `eval --replay` and RULES.md read rules without
  scanning -- and a run with no `languages:` naming the parser drops them
  and says which language it dropped, rather than reporting a language's
  worth of nothing. In a checkout of this repository,
  `npm run parsers:moonbit` builds the library and
  `jev-lint eval rules/moonbit --config docs/moonbit.jev-lint.yaml` runs
  their suites.
- **Structure is per grammar.** `subject: enclosing`, the `graph` arm and
  the `paired` arm need to know what a container is. jev-lint ships those
  probes for `moonbit` (moonbitlang/tree-sitter-moonbit: functions,
  impls, structs, enums, traits, types, and `test "…" { }` as a test).
  A different grammar under that name will fail the scan with a named
  ast-grep error rather than pass silently. Any other declared language
  runs on `bare` and `located`, which need no probes.

The verdict cache is `.jev-lint/baseline.json`, relative to the config's
directory, and is meant to be committed: a run over the same commit answers
from it, and CI lints from it with no API key. It is trusted input --
anything that can edit it can silence a rule or invent a finding.

## Upgrading from 0.4

- **The config selects the rules.** `paths:` is `files:`; `rules:` is a
  mapping of rule id to `on` / `off` / a severity / `{ severity, at, loose
  }`, not a list of directories; `at:` moved under each rule. Each of the
  old keys is refused with the new spelling, exit 2, rather than read as
  something else. `jev-lint init --force` writes a config with every
  shipped rule on.
- **`./rules/` is nothing to the tool.** A project's own rules live in
  `.jev-lint/rules/` and add to the shipped set; they are selected by id
  like any other. A directory of rules for one run is `-R <dir>`.
- **The cache moved** to `.jev-lint/baseline.json`. `.jev-lint-cache.json`
  is not read; a run that finds it says to delete it.

## Upgrading from 0.2

- **Rule ids lost their language suffix.** `fn-name-promises-rust` is
  `rust/fn-name-promises`; the plain id names every language. A
  `jev-lint-ignore fn-name-promises-rust` comment now suppresses nothing,
  and the "names a rule that does not exist" line says what to write
  instead. `--at fn-name-promises-rust=n` is `--at rust/fn-name-promises=n`.
- **Your own rule files are unchanged**: a flat `rules/*.yml` loads as it
  did. Only rules placed as `rules/<lang>/<id>/rule.yml` get the language
  directory's checks and fixtures; `labels.json` there is `expect.yml`.
- **The committed verdict cache is dropped once, and says so.** 0.3.1
  keys a verdict on the context the arm shows and not on the subject's
  text alone; the cache file carries its own schema now, and one written
  before loads as "written for schema jev-lint-2 … its N verdict(s) …
  are dropped". One warm run rewrites it. Commit the rewritten file.
- **The npm package carries the rules, not their fixtures.** `rules/**/
  rule.yml` and `RULES.md` ship; `fixtures/`, `expect.yml` and
  `baseline.json` stay in the repository, which is where `jev-lint eval`
  is for. The package is a fifth of its 0.3.2 size (0.4.0), and RULES.md is the
  record of every shipped rule's fit.
- **A `check` walks the tree for tests and `.sql` files** once each per
  run, for the `paired` arm and the `subject: block` rule, skipping
  `node_modules` and the usual build directories. On a repository with
  neither there is nothing to find and the walk is the only cost.

## Layout

```
src/            the tool: scan -> state -> questions -> gate -> report
rules/          the shipped rules: rules/<language>/<id>/{rule.yml, fixtures/, expect.yml, baseline.json}
                typescript/ and rust/ are first tier and always calibrated; javascript/ and json/ hold what only fits there
corpus/         the labeled corpus the cutoffs are fitted to
tools/          the experiments: arms.ts, grouping.ts
docs/data/      recorded runs, each replayable with no API key
test/test.ts    the suite, no API key needed
```

`docs/internal.md` has the module-by-module map.

