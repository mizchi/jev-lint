# Rule fields

Every field a jev-lint rule can carry, and how to choose the three that
decide whether a rule works: `rule`, `subject`, `state`. Recipes that put
them together are in [cookbook.md](cookbook.md).

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
| `rule` | required | the ast-grep matcher, any rule key ast-grep accepts (`pattern`, `kind`, `regex`, `nthChild`, `all`/`any`/`not`, `has`/`inside`/`follows`/`precedes`, `matches`). **Write it to over-match.** |
| `ask` | required | the predicate, one sentence |
| `language` / `languages` | required | one grammar, or several, by ast-grep's names: `Bash`, `C`, `Cpp`, `CSharp`, `Css`, `Dart`, `Elixir`, `Go`, `Haskell`, `Html`, `Java`, `JavaScript`, `Json`, `Jsx`, `Kotlin`, `Lua`, `Php`, `Python`, `Ruby`, `Rust`, `Scala`, `Solidity`, `Swift`, `Tsx`, `TypeScript`, `Yaml` |
| `kind` | `score` (default) or `noul` | see below |
| `criteria` | `noul` only | `{true: ..., false: ...}`, nested under `criteria`. Each branch is a sentence, or a mapping `{what, examples?, not_for?}` — see below |
| `at` | cutoff | 0–3 for `score`, 0–1 for `noul` |
| `loose` | | floor of the `--loose` band, strictly under `at`. Default: half of `at`. `jev-lint eval` prints each rule's `cleanTop`, the highest a labelled-clean subject reached; a floor just above it lists only what the rule has never seen clean |
| `subject` | `node` (default), `enclosing`, `file`, `commit`, `block` | what code is judged. `commit` and `block` have no matcher: `commit` is `language: Git`, its subjects the commits `jev-lint commits` lists; `block` is `language: Text`, its subjects the blocks of a text file split at every line matching `split:` |
| `split` | `block` only | a regex matched at the start of each line; its named groups (`(?<NAME>\w+)`) are the captures. A block runs from its header to the line before the next |
| `extensions` | `block` only | the files the rule reads, by extension (`[sql]`) |
| `state` | `bare`, `local`, `paired`, `located` (default), `graph`, `full` | what the model also sees |
| `note` | | context the model reads before answering, never shown in a finding. `criteria` *define* the two answers; `note` scopes them — which cases are out of bounds, which conventions count as honoured |
| `axis` | `file` or `rule` | pin the batching axis; the scheduler will not overrule it |
| `severity` | `hint`, `info`, `warning` (default), `error` | what `--format github` annotates; only `error` is rendered as an error. Earn it first |
| `message` | | shown in the finding instead of `ask`, for a friendlier wording |
| `unsureBelow` | 0–1 | `score` only: a confidence under it words the finding as a question |
| `constraints` / `utils` | | ast-grep's, passed through unchanged; part of the rule's identity for the cache |
| `docs` / `tags` | | free text, for your own reports |
| `explain` | | a mapping of label → description, two or more. With `--explain`, each of this rule's **findings** is asked a follow-up `choice` — which label best names why the statement holds — and the label is printed on the finding. Never part of the verdict question; adding it retires no cached verdict |

An unknown field is a validation error, so a typo cannot quietly do nothing.

## `score` or `noul`

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


## `subject`: what the question is about

The most common way a rule fails is being asked about code that cannot contain
the answer — then every answer lands mid-scale, which looks like a threshold
problem and is not one.

- `node` — the matched node, whole: a matched `function_declaration` is the
  entire function including its body. Right for "this `fetch` has no timeout"
  and for anything where the claim and the evidence are both inside the node.
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
  matching `split:` (an sqlc query file at each `-- name: GetUser :one`).
  No matcher, `language: Text`, `state: bare` or `located`; the header's
  named groups are the captures. Runs under `check` and `review` over the
  files whose extension the rule names. Shipped: `text/query-name-describes-sql`.
  Shape:

  ```yaml
  id: query-name-describes-sql
  language: Text
  subject: block
  split: "^-- name: (?<NAME>\\w+) :(?<KIND>\\w+)"
  extensions: [sql]
  state: located
  ask: This query's name ($NAME) misdescribes the SQL under it.
  ```

## `state`: what else the model sees

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
tests all live in one file. What travels is an excerpt: the lines of each
related test that name the module's exported symbols, a little context
around each, and the title of the test they sit in; `…` marks a cut. The
state says they are excerpts. A file with no related test yields no subject
on this arm — the runner drops those and prints how many, because "no test
reaches this path" with no tests in the state is true of everything and
says nothing. The cache does not key on the tests any more than `located`
keys on the file: adding a test later does not retire a verdict, and
`--force` is the escape hatch.


**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured: `var-name-describes-value` is not separable on `bare` and is
closer on `located`, because a boolean name on a string or a plural on one
item reads differently once the file shows how the binding is used. (An
earlier version of this paragraph used `const timeoutSeconds = 5000` as the
example; the corpus was then handing the model a label, and without it that
case is not found at any arm — 5000 being milliseconds is API knowledge.)
So forcing `--arm bare` to save money weakens the rules the shipped packs
were calibrated on. When you cannot tell
which arm a new rule needs, measure: run `calibrate` once per arm with
`--arm <name>` on your labelled corpus and compare the gap reports. The
evidence behind the shipped choices is in the jev-lint repository's
`docs/deepdive.md`.

## Matcher captures are the sharpest state available

A rule that captures `$NAME` and `$TITLE` has told the question exactly which
two things it is comparing, and they reach the model by name: the sentence is
sent verbatim, and beside it goes `matcher_captured: {NAME: "isExpired"}`, so
`$NAME` written in `ask:` is a reference the model resolves. Captures
propagate from any depth of `has:` / `inside:` / `follows:` sub-rules, not
only from the top-level pattern; `--dry-run --show-subjects` prints what was
captured for each subject. "Does this body do
what `$NAME` promises" is answerable; "is this well named" is not. This is why
the naming pack captures names rather than relying on the model to find the same
pair in the text — and why the comment rules use `follows:` with a pattern,
which propagates its capture into metavariables, so `$DOC` names the claim and
the matched node is the code.

## One sentence, several grammars

`languages: [TypeScript, Tsx]` works when the matcher is valid in both. Rust and
TypeScript spell the same structural idea with different node kinds, and
ast-grep **rejects** a kind absent from the target grammar — and one rejected
rule fails the whole scan — so those need two matchers.

In the shipped layout that is two directories with one id, each with its
own matcher, state, cutoff and fixtures:

```
rules/typescript/fn-name-promises/rule.yml    rule: { kind: function_declaration, ... }
rules/rust/fn-name-promises/rule.yml          rule: { kind: function_item, ... }
```

The sentence is a copy, and `jev-lint rules` warns when the two copies of
an id differ in `ask`, `criteria`, `note` or `explain`. A language
directory admits only its own grammars (`typescript` admits the ECMAScript
four). The identity of a rule is `(language, id)`: findings,
`jev-lint-ignore` and `--at <id>=n` apply to every language; `--at
rust/<id>=n` to one.

In a flat rule file (`rules/mine.yml`, or one passed with `-R`) a rule file
may be a *list* of rules or a `---` stream, and a YAML anchor shares the
sentence within one document:

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  rule: { kind: function_declaration, has: { field: name, pattern: $NAME } }
  ask: &fn_ask The body of this function does something materially different from what its name promises.
  criteria: &fn_criteria
    "true": ...
    "false": ...
- id: fn-name-promises-rust
  language: Rust
  rule: { kind: function_item, has: { field: name, pattern: $NAME } }
  ask: *fn_ask
  criteria: *fn_criteria
```

