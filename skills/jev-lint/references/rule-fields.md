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
| `criteria` | `noul` only | `{true: ..., false: ...}`, nested under `criteria` |
| `at` | cutoff | 0–3 for `score`, 0–1 for `noul` |
| `subject` | `node` (default), `enclosing`, `file` | what code is judged |
| `state` | `bare`, `local`, `located` (default), `graph`, `full` | what the model also sees |
| `note` | | context the model reads before answering, never shown in a finding. `criteria` *define* the two answers; `note` scopes them — which cases are out of bounds, which conventions count as honoured |
| `axis` | `file` or `rule` | pin the batching axis; the scheduler will not overrule it |
| `severity` | `hint`, `info`, `warning` (default), `error` | what `--format github` annotates; only `error` is rendered as an error. Earn it first |
| `message` | | shown in the finding instead of `ask`, for a friendlier wording |
| `unsureBelow` | 0–1 | `score` only: a confidence under it words the finding as a question |
| `constraints` / `utils` | | ast-grep's, passed through unchanged; part of the rule's identity for the cache |
| `docs` / `tags` | | free text, for your own reports |

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

## `subject`: what the question is about

The most common way a rule fails is being asked about code that cannot contain
the answer — then every answer lands mid-scale, which looks like a threshold
problem and is not one.

- `node` — the matched node, whole: a matched `function_declaration` is the
  entire function including its body. Right for "this `fetch` has no timeout"
  and for anything where the claim and the evidence are both inside the node.
- `enclosing` — the containing function. Right for "this `catch` hides a
  failure", where the predicate needs the body around the match.
- `file` — the module, presented as an **outline**: its path, its public items,
  its imports. The only way to ask "is this module named for what it contains",
  because a file's text never mentions its own path.

## `state`: what else the model sees

One state per file carries every question for that file, which is the entire
cost argument: the file is sent once and each extra question costs only its own
text.

| arm | carries | cost |
| --- | --- | --- |
| `bare` | the matched code and the file's name | cheapest, and the only arm immune to unrelated edits in the same file |
| `local` | + each match's enclosing function, deduplicated | — |
| `located` | + the whole file source | — |
| `graph` | + path identity, imports, symbol table with each symbol's signature and call edges; **no source** | small at any file size |
| `full` | source and graph | hits the 32Ki state budget soonest |

**This is not a quality knob.** More context is not better; it is a choice of
which error you would rather have. The rule that works:

> Give the question the least context that still contains the answer.

Measured, and load-bearing: `var-name-describes-value` is **not separable at any
cutoff** on `bare` and fully separable on `located`, because `const
timeoutSeconds = 5000` is only wrong if you know 5000 is milliseconds, and that
is visible where the binding is *used*. So forcing `--arm bare` to save money
destroys the rules the shipped packs were calibrated on. When you cannot tell
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
rule fails the whole scan — so those need two matchers. Share the sentence with
a YAML anchor rather than copying it, since copies drift and a drifted copy is a
cache that never hits:

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

Anchors are scoped to one YAML document, which is why a rule file may be a
*list* of rules as well as a `---` stream.

