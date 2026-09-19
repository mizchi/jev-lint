# Cookbook

Recipes for rules of your own, each one a complete YAML block that loads and
matches. Copy the nearest one, change the sentence and the criteria, keep the
shape. Every field is explained in [rule-fields.md](rule-fields.md); how to
fit `at:` is in [calibration.md](calibration.md).

The question behind every recipe is the same: **what does this code claim
about itself, and does the body honour the claim?** A name is a claim. A
comment is a claim. A test title is a claim. A type name is a claim. Rules
about claims work; rules about taste ("is this well named") do not, and rules
about facts a parser can check belong to a parser.

## Before writing: find the node kinds

The matcher names tree-sitter node kinds, and a kind absent from the grammar
fails the whole scan. Print the kinds of a code shape by giving ast-grep a
**concrete snippet** of it as the pattern — real names, no metavariables,
since `$X` is not an identifier in every grammar and shows up as `ERROR`
nodes in Python:

```bash
npx -y @ast-grep/cli run -l ts -p 'try { a() } catch (e) { return null }' --debug-query=ast .
npx -y @ast-grep/cli run -l ts -p 'export const isAdmin = (u) => u.role === "admin"' --debug-query=ast .
npx -y @ast-grep/cli run -l python -p 'def charge(c, amount):
    """Doc."""
    return c' --debug-query=ast .
```

The output is the tree with each node's kind and its *field* names
(`name:`, `value:`, `body:`), which is what `has: { field: ... }` refers to.
The second command shows that `export const f = () => ...` nests
`export_statement > lexical_declaration > variable_declarator` with fields
`name` and `value`; the third shows a Python docstring is
`function_definition > body: block > expression_statement > string`.

Kinds the recipes below use:

| TypeScript / JavaScript | Rust | what |
| --- | --- | --- |
| `function_declaration`, `method_definition`, `arrow_function`, `function_expression` | `function_item` | functions |
| `variable_declarator` (inside `lexical_declaration`) | `let_declaration` | bindings; the name is field `name` (TS) / `pattern` (Rust), the initializer is field `value` |
| `interface_declaration`, `type_alias_declaration`, `class_declaration` | `struct_item`, `enum_item`, `trait_item`, `impl_item` | type-level declarations |
| `comment` | `line_comment`, `block_comment` | comments; `follows:` reaches the one above a node |
| `catch_clause`, `throw_statement`, `call_expression`, `return_statement` | `attribute_item` (e.g. `#[test]`) | statements and calls |
| `program` | `source_file` | the file, for `subject: file` |

`$NAME` in a pattern captures one node; `$$$ARGS` captures a sequence. A
capture is handed to the model by name, so capture what the sentence talks
about. Captures propagate from inside `has:` / `inside:` / `follows:` at any
depth.

### YAML and JSON

ast-grep parses both (`language: Yaml`, `language: Json`), and a `name:` in
them is a claim like any other. Six things a rule author needs that took a
day to find:

- YAML wraps every container's contents in a `block_node`:
  `block_sequence_item > block_node > block_mapping`. `inside:` and `has:`
  stop at the neighbour by default, so `inside: {kind: block_sequence_item}`
  on a `block_mapping` matches nothing. Nest through `block_node`, or use
  `stopBy: end`.
- A key is matched by text: `has: {field: key, regex: "^name$"}`. In JSON the
  key node is a `string` **including its quotes**, so the regex is
  `'^"scripts"$'` and the capture arrives quoted.
- A YAML block scalar (`>-`, `|`) captures as raw source, indicator line and
  indentation included, not the folded value.
- Two `has:` keys in one mapping is a YAML duplicate-key error. Wrap them in
  `all:`. Every claim-versus-evidence rule needs two.
- `enclosing`, `local`, `graph` and `subject: file` have no structure to work
  with in these grammars; `subject: node` with `bare` or `located` are the
  real choices. Match the node that holds both the claim and the evidence
  (the whole `"name": "command"` pair, the whole step mapping).
- Subjects are one per line, so labels need `"window": 0`; the default window
  of 3 lets a `bad` label claim its neighbours.

The shipped `script-name-does` in `rules/config.yml` is the worked example.

### Narrowing a capture by its text

A convention about a *family* of names — predicates, handlers, hooks —
narrows the matcher on the captured text. `regex` inside the same `has:`
applies to the node that `pattern` captured:

```yml
- has:
    field: name
    pattern: $NAME
    regex: "^(is|has|can|should)([A-Z0-9_]|$)"
```

`constraints: { NAME: { regex: "..." } }` at the rule's top level does the
same for a capture made anywhere in the rule. Recipe 2 is the worked example.

## Validate every recipe the same way

```bash
npx -y jev-lint rules -R rules/mine.yml --no-config                     # loaded, or the exact error
npx -y jev-lint check src -R rules/mine.yml --no-config --cache none --dry-run --show-subjects
npx -y jev-lint check src/one-file.ts -R rules/mine.yml --no-config --cache none --retry 3
```

`--show-subjects` prints every subject with its line, node kind and
captures, so a count of 4 can be checked against the four nodes you meant.
`--no-config` keeps the repository's `.jev-lint.yaml` — its `at:`, its
`paths:` — out of the test. Zero subjects on code that contains the case is
a matcher problem. Findings that all sit mid-scale are a `subject`/`state`
problem, not a wording one.

---

## 1. A function's name versus its body

The recipe every other one is a variation of. Capture the name; ask whether
the body honours it; give the model the file so it can see how the function
is used.

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: located
  at: 0.86
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: { field: name, pattern: $NAME }
      - all:
          - kind: method_definition
          - has: { field: name, pattern: $NAME }
      - all:
          - kind: variable_declarator
          - has: { field: name, pattern: $NAME }
          - has:
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: &fn_ask >-
    The body of this function does something materially different from what
    its name promises.
  criteria: &fn_criteria
    "true": >-
      Someone who read only the name and the parameter list would be wrong
      about what this function does: it returns a different kind of thing than
      the name suggests, it changes state when the name says it only reads or
      checks, it can fail or return nothing when the name promises a value, it
      handles only a narrower case than the name claims, or it does substantial
      work the name does not mention at all.
    "false": >-
      The name and parameter list describe what the body actually does. Someone
      who read only them would not be surprised by the body, even if a longer
      or more specific name could be imagined.

- id: fn-name-promises-rust
  language: Rust
  kind: noul
  subject: node
  state: located
  at: 0.66
  rule:
    all:
      - kind: function_item
      - has: { field: name, pattern: $NAME }
  ask: *fn_ask
  criteria: *fn_criteria
```

Why: `criteria."true"` lists what a mismatch *looks like in the code* —
wrong return kind, hidden mutation, narrower case — so the model has
something to check rather than a mood to report. The `"false"` branch
explicitly forgives terse names; without that line every short name reads as
a weak violation. Two grammars, one sentence, shared by anchor.

The third arm is looser than it looks: `has: { any: [arrow_function, ...] }`
without `field: value` matches any declarator that *contains* an arrow, so
`const ready = items.every(i => i.ok)` is asked about as a function. For this
rule that is the intended over-match — the model answers "not a function,
name fits" cheaply. Add `field: value` when the rule's sentence only makes
sense for a binding that *is* a function, as recipe 2 does.

## 2. A family of names: predicates

The same recipe narrowed to names that make a specific promise. `is*`,
`has*`, `can*`, `should*` claim a yes-or-no answer and nothing else; a
`hasPermission` that also writes an audit record breaks the claim.

```yaml
- id: predicate-name-answers
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: located
  at: 0.7        # uncalibrated
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &predicate_name
              field: name
              pattern: $NAME
              regex: "^(is|has|can|should)([A-Z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *predicate_name
      - all:
          - kind: variable_declarator
          - has: *predicate_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function is named as a yes-or-no question ($NAME) but its body does
    not simply answer that question.
  criteria:
    "true": >-
      The body does something other than compute and return the answer to the
      question the name asks: it returns something that is not a boolean, it
      writes to state, logs, records or performs I/O on the way to the answer,
      it throws where the name promises a plain yes or no, or the value it
      returns answers a different question than the name asks.
    "false": >-
      The body reads what it needs, computes the answer to the question the
      name asks, and returns it as a boolean or a Promise of one, with no other
      effect. Calling other predicates is fine; a terse name or a long
      expression is not a violation.
  note: >-
    Only this function's body is judged. A helper it calls is assumed to do
    what its own name says unless the file shows otherwise.
```

Why `regex` in the `has:` rather than in the sentence: the family is a
matcher concern — a parser can decide whether a name starts with `is` — and
only the promise is the model's. `$NAME` in `ask:` is a reference: the
sentence is sent as written, and the captured name travels beside it.

## 3. A type's name versus its shape

Same recipe at the type level. `timeoutMs: string`, a `User` that is really a
session, a `Config` that is a list of errors.

```yaml
- id: type-name-describes-shape
  languages: [TypeScript, Tsx]
  kind: noul
  subject: node
  state: located
  at: 0.7
  rule:
    all:
      - any:
          - kind: interface_declaration
          - kind: type_alias_declaration
      - has: { field: name, pattern: $NAME }
  ask: >-
    This type's name misdescribes the shape it declares.
  criteria:
    "true": >-
      The name states a thing, unit, cardinality or role that the members do
      not match: a singular name for a collection type or the reverse, a name
      naming one concept while the members describe another, a member whose
      declared type contradicts the unit or kind its own name states, or a name
      so different from the members that a reader would look for a different
      type.
    "false": >-
      The members are what the name says they are. A name that is generic,
      abbreviated, or could be more specific is not a mismatch.
```

Why `located`: whether `Config` misdescribes its members is sometimes only
visible where it is constructed. Why no Rust twin here: write one with
`struct_item` / `enum_item` and `has: { field: name, pattern: $NAME }` if you
need it, sharing the sentence by anchor.

## 4. A binding's name versus its value

```yaml
- id: var-name-describes-value
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: located
  at: 0.62
  rule:
    all:
      - kind: variable_declarator
      - has: { field: name, pattern: $NAME }
      - has: { field: value, pattern: $VALUE }
      - not:
          has:
            any:
              - kind: arrow_function
              - kind: function_expression
  ask: >-
    This binding's name misdescribes the value it is bound to.
  criteria:
    "true": >-
      The name states a type, unit, shape, quantity or meaning that the
      initializer does not produce: a plural name bound to a single item or a
      singular name bound to a collection, a name that reads as a boolean bound
      to something that is not one, a name naming one unit while the value is
      in another, or a name describing a different thing entirely from what the
      initializer computes.
    "false": >-
      The name is an accurate description of what the initializer produces,
      even if it is terse or a clearer name could be imagined.
```

Why the `not:` — function-valued bindings are recipe 1's subject, and asking
both rules about the same node produces two findings for one defect. Why
`located` and not `bare`: `const timeoutSeconds = 5000` is only wrong if you
can see that 5000 is passed somewhere expecting milliseconds. Measured: this
rule does not separate at any cutoff on `bare`.

## 5. A test's title versus what it does, and whether it proves it

Two rules on one matcher, because they fail differently: a test can be about
the right thing and still not establish it.

```yaml
- id: test-name-describes-code
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: bare
  at: 0.93
  rule: &test_matcher
    any:
      - pattern: it($TITLE, $BODY)
      - pattern: test($TITLE, $BODY)
      - pattern: it($TITLE, $BODY, $TIMEOUT)
      - pattern: test($TITLE, $BODY, $TIMEOUT)
      - pattern: it.each($CASES)($TITLE, $BODY)
  ask: >-
    The code in this test does something other than what its name says it does.
  criteria:
    "true": >-
      Reading the name and then the code, they are about different things: the
      code exercises a different operation, input or case than the name states,
      it expects the opposite outcome to the one the name implies, or the name
      refers to something the code never touches at all.
    "false": >-
      The code is about the thing the name says: the operation it calls, the
      input it sets up and the outcome it expects are the ones the name
      describes. Whether it establishes that thing convincingly is a separate
      question.

- id: test-name-verifies-claim
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: bare
  at: 0.53
  rule: *test_matcher
  ask: >-
    This test would still pass if the behaviour its name claims were broken.
  criteria:
    "true": >-
      The body does not establish what the name claims: it asserts nothing at
      all, it asserts something that would hold whether or not the named
      behaviour worked, it checks an incidental property such as a length or a
      type instead of the named behaviour itself, or it never sets up the case
      the name is about.
    "false": >-
      The body contains at least one assertion that would fail if the named
      behaviour were broken.
```

Why `bare`: the matcher already captures both sides of the comparison,
`$TITLE` and `$BODY`, so the file adds nothing — and `bare` is the arm an
unrelated edit elsewhere in the file cannot disturb, which keeps the cache
warm. For Rust, match `function_item` that `follows:` an `attribute_item`
with `regex: "test"` and capture the function name as the title.

## 6. A comment above a declaration that is no longer true

`follows:` with a `pattern` propagates its capture, so `$DOC` names the claim
and the matched node is the code it is about.

```yaml
- id: comment-describes-declaration
  languages: [TypeScript, Tsx]
  kind: noul
  subject: node
  state: located
  at: 0.75
  rule:
    any:
      - all:
          - any:
              - kind: function_declaration
              - kind: class_declaration
              - kind: method_definition
              - kind: interface_declaration
              - kind: type_alias_declaration
          - follows:
              kind: comment
              pattern: $DOC
      # An exported declaration's comment sits above the `export`, not above
      # the declaration itself.
      - all:
          - any:
              - kind: function_declaration
              - kind: class_declaration
              - kind: interface_declaration
              - kind: type_alias_declaration
          - inside:
              kind: export_statement
              follows:
                kind: comment
                pattern: $DOC
  ask: >-
    The comment above this code claims something that is not true of the code.
  criteria:
    "true": >-
      A specific claim the comment makes is contradicted by the code: it names
      a different operation, direction, ordering or unit than the code uses,
      it states a return value or guarantee the code does not provide, it
      describes a side effect the code does not perform or omits one it does,
      it gives a count, limit or default that differs from the code's, or it
      refers to a parameter, field or function that the code no longer has.
    "false": >-
      Every specific claim the comment makes holds for the code below it. A
      comment that is vague, redundant, or says less than it could is not a
      false comment -- only a claim that is actually wrong counts here.
  note: >-
    Judge only claims the code in front of you can confirm or contradict. A
    comment about a caller's obligations, about performance, or about history
    is not checkable here and is not a violation.
```

Why the `note`: without it, "callers must hold the lock" reads as a claim the
function fails to honour. The note is context for the model and never
appears in a finding. Deliberately one axis — is the claim false — and never
style; a rule that also asks "should this comment exist" stops separating.

### 6b. A docstring *inside* the node (Python)

Python, Elixir and Rust's `#[doc]` put the claim inside the declaration
rather than above it, so `follows:` finds nothing. Reach into the body: the
docstring is the first statement, a bare string expression.

```yaml
- id: docstring-true
  language: Python
  kind: noul
  subject: node
  state: local
  at: 0.7        # uncalibrated
  rule:
    all:
      - kind: function_definition
      - has: { field: name, pattern: $NAME }
      - has: { field: parameters, pattern: $PARAMS }
      - has:
          field: body
          has:
            kind: expression_statement
            nthChild: 1
            has: { kind: string, pattern: $DOC }
  ask: >-
    This function's docstring claims something that is not true of the
    function: a parameter it documents is not one the function takes, or the
    return or error behaviour it describes is not what the body does.
  criteria:
    "true": >-
      A specific claim in the docstring is contradicted by the signature or
      body: it documents a parameter under a name the parameter list does not
      have, or with a unit or meaning the body does not use; it states a
      return value or type the body does not return; it says the function
      returns a sentinel such as None on failure when the body raises instead,
      or says it raises when the body returns; or it names an exception the
      body cannot raise or omits one it explicitly raises.
    "false": >-
      Every specific claim the docstring makes about parameters, return value
      and errors holds for the signature and body. A docstring that is terse,
      leaves parameters undocumented, or says less than it could is not false.
  note: >-
    Judge only claims the signature and body in front of you can confirm or
    contradict. A claim about performance, history, or a caller's obligations
    is not checkable here and is not a violation.
```

Why `nthChild: 1`: a string that is the second statement is not a docstring.
Why three captures: `$DOC` is the claim, `$PARAMS` and `$NAME` are what it is
checked against, and all three propagate from inside nested `has:`. Why
`local`: the node holds both sides of the comparison; the file adds nothing
but cost. Written from this cookbook by an agent that had never seen the
tool, validated on its first try — the recipe exists because the shape was
the part that took the work.

## 7. A TODO that describes work already done

Cheap, and it finds real rot. The comment is the subject; the function around
it is the evidence.

```yaml
- id: todo-already-done
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: enclosing
  state: bare
  at: 0.7
  severity: info
  rule:
    kind: comment
    regex: "\\b(TODO|FIXME|HACK)\\b"
  ask: >-
    This TODO comment describes work that the code around it has already done,
    or a problem the code no longer has.
  criteria:
    "true": >-
      The comment asks for something -- handle a case, remove a workaround,
      add a check, replace an approach -- that the surrounding code visibly
      already does, or it describes a limitation the surrounding code does not
      have.
    "false": >-
      The work the comment asks for is not done in the surrounding code, or the
      comment is about something outside this code and cannot be judged here.
```

Why `subject: enclosing`: a comment alone cannot show whether its work is
done. `enclosing` judges the containing function and still reports at the
comment's line. A top-level comment has no enclosing function and is judged
alone — expect those to read as "cannot be judged here".

## 8. A `catch` that swallows a failure

A convention rule where the answer needs the whole function: whether
returning `null` from a `catch` is a bug depends on what the function
promised its caller.

```yaml
- id: catch-hides-failure
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: enclosing
  state: local
  at: 0.7
  rule:
    kind: catch_clause
  ask: >-
    This catch block hides a failure the function's caller needed to know
    about.
  criteria:
    "true": >-
      The catch block neither rethrows, returns an error value the signature
      admits, nor reports through a channel the function is documented to use;
      it returns a default, an empty value or nothing, or only logs, and the
      function's name or return type promises a real result.
    "false": >-
      The failure is propagated, converted into a value the caller can
      distinguish from success, or the function's name and signature make it
      clear that failures are absorbed here on purpose.
  note: >-
    A function named try*, *OrNull, *OrDefault, or returning an optional or a
    Result-like type has declared that it absorbs failure; that is not hiding.
```

Why `local` rather than `located`: the enclosing function is the answer, and
its name is in it. The file would add cost and the chance that an unrelated
edit moves the verdict. Why a `note` naming the conventions: it stops the
model from flagging every `tryParse`.

## 9. An error message that does not describe the failure

```yaml
- id: error-message-describes-failure
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: enclosing
  state: local
  at: 0.7
  rule:
    any:
      - pattern: throw new Error($MSG)
      - pattern: throw new $TYPE($MSG)
      - pattern: throw new $TYPE($MSG, $$$REST)
  ask: >-
    The message given to this error misdescribes the condition that raises it.
  criteria:
    "true": >-
      The message names a different cause, value, operation or expectation
      than the condition guarding the throw actually checks, states a fact the
      surrounding code contradicts, or is a copy of another error's message in
      the same function that describes a different case.
    "false": >-
      The message describes the condition that leads to the throw. A message
      that is short, generic or lacks detail is not wrong, only unhelpful.
```

Why: a wrong error message is a false claim that survives every test that
only checks the throw. `$MSG` is captured so the sentence is about a specific
string; `enclosing` provides the guard condition.

## 10. A module named for something other than what it contains

The only rule that needs the file as its subject and the graph as its state:
a file's text never mentions its own path, and the outline — path, exports,
imports — is enough.

```yaml
- id: module-name-describes-contents
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: file
  state: graph
  at: 0.62
  severity: info
  rule:
    kind: program
  ask: >-
    This module's name does not describe what the module contains.
  criteria:
    "true": >-
      The filename and path name a subject that the module's public items do
      not match: the items belong to a different concern than the name states,
      the name names one thing while the module holds an unrelated assortment,
      or the name is narrower or broader than the items it holds.
    "false": >-
      The public items are what the path and filename say. A name that is
      conventional for its directory, such as index or mod, is not a mismatch.
```

Why `graph`: it carries path identity, imports and the symbol table with no
source, so it is small at any file size. `severity: info` because one
labelled defect per variant is all the shipped corpus has.

## 11. A convention with an exception the parser cannot see

The `score` recipe. Use it when the answer is "how badly" rather than
"whether", and when a good exception is only visible in surrounding code.

```yaml
- id: fetch-timeout
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: score
  subject: enclosing
  state: local
  at: 2.0
  rule:
    pattern: fetch($$$ARGS)
  ask: >-
    This fetch call can hang indefinitely: it is given no timeout and nothing
    around it imposes one.
  note: >-
    A signal from AbortSignal.timeout, an AbortController that a timer aborts,
    or a wrapper the function name makes clear is a retrying or timed client
    all count as a timeout.
```

`score` answers on a fixed scale — `not-applicable`, `satisfied`, `arguable`,
`violation` — with a confidence. Level 0 is how the model says "your matcher
caught something this rule is not about", which is cheaper to read in a
report than to prevent in YAML; that is why the matcher is left loose. The
cutoff `2.0` reports `arguable` and above; move it to `2.5` to report only
clear violations.

---

## Patterns that do not work, and why

- **"Is this well named?"** No claim to check against. Capture the name and
  ask whether the body honours it (recipe 1).
- **"Is this function too long / too complex?"** A parser can count.
- **"Does this call `.sort()` correctly?"** Needs knowledge of the API, which
  the model is measurably poor at. That is ESLint's.
- **A criteria branch phrased in terms of something outside the subject** —
  "unless the caller needs it", "if the team agreed". Every answer lands
  mid-scale. Rewrite the branch in terms of what the code in front of the
  model shows, or widen `subject`/`state` until it does.
- **A number in the sentence** ("more than 3 parameters"). That is a cutoff,
  and it belongs in `at:` or in a parser.
