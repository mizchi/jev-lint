# Family J: the shipped rules, in Go

Every rule here is a port: the sentence, criteria, note and `explain` of a
shipped TypeScript rule copied verbatim (the loader's drift warning holds
the copies together), with a Go matcher, a Go corpus and a cutoff fitted on
that corpus. What jev does that a linter cannot is the same in Go as in
TypeScript: it reads the claim a name, a comment or a test title makes and
the body beneath it, and says whether the body honours the claim. Go adds
three things a port has to answer for. Failure is a returned `error` or a
`(value, ok)` pair rather than a throw, so the guarantee names (`Safe*`,
`Try*`, `*OrDefault`) promise something the TypeScript criteria never had to
spell out, and `Must*` promises the opposite; doc comments are `//` runs
that tree-sitter splits into one node per line, so every comment matcher
captures the last line and relies on jev-lint widening it; and tests are
`func TestX(t *testing.T)` plus `t.Run("title", func...)` subtests, so the
title is a function name for the outer test and a string literal for the
inner one, and an outer test whose subtests carry the assertions is a clean
shape the TypeScript corpus has no twin for.

Thirteen candidates under `experiments/rule-candidates/go/<id>/`: the
twelve families the brief lists, plus `must-name-panics`, which is where
`Must*` went. Each has its fixtures, `expect.yml` and an accepted
`baseline.json`; `last.json` beside it is the same run. Records of the
earlier attempts (the `located` run of `comment-describes-block`, the
first `safe-name-is-safe` and `must-name-panics` wordings, the `cart`-stem
run of `tests-cover-failure-paths`) were kept only in a scratch directory
and are quoted below from their output.

Verdicts at a glance:

| rule | at | P / R | flips | headroom (clean / defect) | verdict |
| --- | --- | --- | --- | --- | --- |
| fn-name-promises | 0.40 | 1.00 / 1.00 (9/0/0) | 0 | 0.14 / 0.10 | SHIP |
| var-name-describes-value | 0.50 | 1.00 / 0.90 (9/0/1) | 0 | 0.36 / 0.21 | SHIP, one recorded miss |
| comment-describes-declaration | 0.40 | 1.00 / 0.67 (4/0/2) | 0 | 0.19 / 0.06 | COOKBOOK |
| comment-describes-block | 0.50 | 0.88 / 1.00 (7/1/0) | 0 | 0.05-0.16 / 0.06 | COOKBOOK |
| test-name-describes-code | 0.78 | 1.00 / 1.00 (5/0/0) | 0 | 0.10 / 0.11 (0.02 on one pass) | COOKBOOK |
| test-name-verifies-claim | 0.70 | 1.00 / 0.89 (8/0/1) | 0 | 0.19 / 0.16 | SHIP, one recorded miss |
| module-name-describes-contents | 0.60 | 1.00 / 1.00 (5/0/0) | 0 | 0.20 / 0.19 | SHIP (10 subjects) |
| idempotent-name | 0.42 | 1.00 / 1.00 (6/0/0) | 0 | 0.15 / 0.14 | SHIP |
| pure-name-is-pure | 0.60 | 1.00 / 1.00 (6/0/0) | 0 | 0.26 / 0.30 | SHIP |
| safe-name-is-safe | 0.43 | 1.00 / 1.00 (5/0/0) | 0 | 0.14 / 0.13 | SHIP, with a Go sentence in `note` |
| must-name-panics | 0.75 | 1.00 / 0.83 (5/0/1) | 0 | 0.24 / 0.18 | SHIP, one recorded miss (new rule) |
| log-level-matches-event | 0.66 | 1.00 / 1.00 (7/0/0) | 0 | 0.10 / 0.09 | COOKBOOK |
| tests-cover-failure-paths | 0.40 | 1.00 / 1.00 (5/0/0) | 0 | 0.22 / 0.11 | SHIP |

Headroom is measured on the accepted run's means (single-pass extremes are
in each section). tp/fp/fn are at the fitted `threshold`.

---
## fn-name-promises

### Rule

`experiments/rule-candidates/go/fn-name-promises/rule.yml`:

```yaml
id: fn-name-promises
language: Go
kind: noul
subject: node
state: located
# 0.40, fitted 2026-09-20 (9 defects, 15 cleans of which 10 hard, 3 passes):
# clean tops at 0.26 (`Take`, the terse pop-and-mark), defects start at 0.59
# (`Drain`, which copies and removes nothing; 0.50-0.68 across passes, the
# widest spread in the corpus) then 0.60 (`Summarize`); the other seven sit at
# 0.76-0.95. Set under the midpoint so Drain's lowest pass keeps 0.10 and the
# top clean keeps 0.14. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.40
axis: file
severity: warning
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    - has: { field: name, pattern: $NAME }
    # Test, benchmark, fuzz and example functions get the test rules, which
    # ask a sharper question (as rust/fn-name-promises excludes #[test]).
    - not:
        has:
          field: name
          regex: "^(Test|Benchmark|Fuzz|Example)([A-Z_]|$)"
# The same sentence as typescript/fn-name-promises, by copy: the loader warns
# if the two drift.
ask: >-
  The body of this function does something materially different from what its
  name promises.
criteria:
  "true": >-
    Someone who read only the name and the parameter list would be wrong about
    what this function does: it returns a different kind of thing than the name
    suggests (a count that is a list, a predicate that is a number), it changes
    state when the name says it only reads, checks, looks up or serialises, it
    can fail or return nothing when the name promises a value, it handles only a
    narrower case than the name claims, it never performs an effect or
    repetition the name names (a drain or remove that leaves the container as it
    was, a retry that tries once), it computes something no reading of the name
    accounts for, or it does substantial work the name does not mention at all,
    such as writing what it was asked to read.
  "false": >-
    The name and parameter list describe what the body actually does. Someone
    who read only them would not be surprised by the body, even if a longer or
    more specific name could be imagined. A terse or conventional name (run,
    handle, take, len, fmt, toString, a getter) that the body fits is not a
    violation, and a comment inside the body that is wrong about the body is a
    wrong comment, not a wrong name.
```

### Corpus

24 subjects in `fixtures/queue.go` (a mutex-guarded job queue) and
`fixtures/store.go` (a `database/sql` user store): 9 bad, 15 clean, of
which 11 hard (`Take`, `Len`, `Record`, `String`, `Run`, `Handle`, `Close`,
`FindByEmail` returning `(*User, error)`, `Disable`, `displayName`,
`IsFull` beside the broken `HasCapacity`).

- `GetJob` -- a lookup that inserts and enqueues the job when it is missing,
  and takes a payload a lookup has no use for.
- `CountFailed` -- promises a count, returns the failed jobs.
- `Drain` -- copies the jobs out and removes nothing.
- `HasCapacity` -- reads as a predicate, returns the number of free slots.
- `Retry` -- takes `attempts` and a delay, returns on the first error and
  never sleeps, so it tries once.
- `IsDisabled` -- a predicate that also writes `last_seen` for active users.
- `ValidateEmail` -- checks the address, then inserts a user row.
- `DeleteStale` -- selects and counts the stale rows, deletes nothing.
- `Summarize` -- an arbitrary sum of email lengths, day numbers and name
  lengths (the `summarize` case of the TypeScript and Rust corpora).

### Attempts

1. Sentence and criteria verbatim from TypeScript; matcher
   `function_declaration | method_declaration` with `has: {field: name}`,
   excluding `Test*`/`Benchmark*`/`Fuzz*`/`Example*` as the Rust rule
   excludes `#[test]`; `state: located`. `gaps`: **move**, gap 0.29, head
   +0.08 at the uncalibrated 0.70, suggest 0.40. One attempt was enough.

### Fit

Fitted 0.40 (midpoint 0.43). Accepted run, 3 passes: P 1.00, R 1.00,
tp 9 / fp 0 / fn 0, 0 flips. Clean tops at 0.26 (`Take`); defects start at
0.59 on means (`Drain`, 0.50-0.68 across passes, the widest spread in the
corpus at 0.18) then 0.60 (`Summarize`), then 0.76-0.95. Headroom 0.14
over the top clean, 0.10 under Drain's lowest pass. In the first run
`Drain` sat at 0.54-0.57 and `Summarize` at 0.62-0.64; the ordering of
the two weak defects swapped between runs, the band did not move.

### Verdict

**SHIP.** Separates with 0.10+ a side and no flips on a corpus whose clean
half is mostly the terse conventional names (`Take`, `Run`, `Handle`,
`Record`) the criteria forgive. The two weakest defects are the two that
are weak everywhere: a container operation that leaves the container as it
was, and a vague name over a nonsense computation.

### What I would change

Nothing in the rule. A second fixture file of exported HTTP handler methods
(`ServeHTTP`, `handleX`) would test the class of conventional names Go adds
and TypeScript does not have.

---

## var-name-describes-value

### Rule

`experiments/rule-candidates/go/var-name-describes-value/rule.yml`:

```yaml
id: var-name-describes-value
language: Go
kind: noul
subject: node
state: located
# 0.50, fitted 2026-09-20 (10 defects, 25 cleans of which 12 hard, 3 passes):
# clean tops at 0.09-0.14 (`dot`, an index); nine defects sit at 0.71-0.94
# in the accepted run. One labelled defect of the part-selection class sits
# under the cutoff and is a recorded miss: `host := SplitN(addr, ":", 2)[1]`
# at 0.27-0.30. Its sibling `basename := path[dot+1:]` answered 0.40 in one
# run and 0.86 in the next (same rule, same corpus): a run-to-run move that
# the pass-to-pass spread (<= 0.09) does not show. The fitted midpoint 0.19
# would take `host` with 0.07 of headroom a side; 0.50 sits in the wide gap
# instead, 0.36 over the top clean and 0.21 under the lowest found defect.
# Report: experiments/reports/j-go/REPORT.md.
threshold: 0.50
axis: file
severity: warning
rule:
  any:
    # `x := v` and `x, err := v`: the name is the whole left list, so a
    # capture reads `orders, err` when the binding is a pair, which is what
    # the reader sees too.
    - all:
        - kind: short_var_declaration
        - has: { field: left, pattern: $NAME }
        - has: { field: right, pattern: $VALUE }
        - not:
            has:
              field: right
              has: { kind: func_literal }
    # `var x = v` and `var x T = v`; a `var x T` with no value has nothing to
    # compare and is not matched.
    - all:
        - kind: var_spec
        - has: { field: name, pattern: $NAME }
        - has: { field: value, pattern: $VALUE }
        - not:
            has:
              field: value
              has: { kind: func_literal }
# The same sentence as typescript/var-name-describes-value, by copy: the
# loader warns if the two drift.
ask: >-
  This binding's name misdescribes the value it is bound to.
criteria:
  "true": >-
    The name states a type, unit, shape, quantity or meaning that the
    initializer does not produce: a plural name bound to a single item or a
    singular name bound to a collection, a name that reads as a boolean bound to
    something that is not one, a name naming one unit while the value is in
    another, a name saying it holds a value while it holds a function or a
    promise, or a name describing a different thing entirely from what the
    initializer computes.
  "false": >-
    The name is an accurate description of what the initializer produces, even
    if it is terse or a clearer name could be imagined. Being short or generic
    is not a mismatch.
note: >-
  Compare the name with the initializer and with every use of the binding in
  this file; a mismatch is one the code shows. It counts when the binding is
  used as a different kind of thing from what the name says (a boolean name on a
  value compared with a string, a number or a variant; a path name on contents
  that are split into lines; a result name on a promise that is pushed or
  awaited; a unit suffix on a value the code converts from or compares with
  another unit); when the initializer selects a different element, part or field
  from the one the name names (the first element under a name meaning the last,
  the piece before a separator under a name meaning the piece after it, one
  field of a record under the name of another of its fields); or when the name
  asserts success or presence and the code then reads the value as a failure or
  an absence. It does not count when the name is a convention rather than a
  claim: a plural name on a number, which names the count of those things
  whether the number is a literal or comes from a call; a short accumulator,
  index or buffer name; a collection named for its role such as a set of seen
  items or a list of pending work; a list of test inputs named for the class
  they belong to and paired with the opposite class; a test binding named for
  the scenario it exercises, such as the response to the unauthorized request or
  to the request missing a field, which reads as an adjective and holds the
  result of that scenario; or a name that gives the value's role or provenance
  rather than its type.
```

The TypeScript rule captures the declarator's `name` and `value` and skips
function-valued bindings. Go has two binding forms: `x := v` is a
`short_var_declaration` with `left`/`right` expression lists, and `var x =
v` is a `var_declaration > var_spec` with `name`/`value`. The capture is
the whole left list, so `$NAME` reads `orders, err` for a pair, which is
what the reader sees. `func_literal` on the right is the arrow-function
exclusion.

### Corpus

35 subjects in `fixtures/handler.go` (net/http handlers over an order
repo) and `fixtures/config.go` (a key=value config loader): 10 bad, 25
clean, of which 12 hard (`seen`, `n`, `sc`, `dot`, `total`, `resp`,
`status` narrowed from 500 to 404, `limit` replaced by a default, `ctx,
cancel`, bare `err`, `ErrNotFound`, `lines`).

- `configPath, err := os.ReadFile(path)` -- the file's contents under a
  path name, then split into lines.
- `ttlSeconds, err := time.ParseDuration(value)` -- a `time.Duration`
  under a seconds suffix, assigned to a Duration field.
- `verbose := value` -- a boolean-reading name on the raw string, compared
  with `"1"` and `"true"`.
- `lastLine := lines[0]` -- the first line, returned as the last.
- `basename := path[dot+1:]` -- the extension, in a function named
  `Extension`.
- `orders, err := h.repo.FindByID(ctx, id)` -- plural on one `*Order`,
  then `orders.Archived`.
- `isAdmin := r.Header.Get("X-Role")` -- a boolean name on a header string
  compared with `"admin"`.
- `order, err := h.repo.ListByUser(...)` -- singular on a slice that is
  ranged over.
- `ok := h.repo.Archive(...)` -- asserts success, holds the error, read as
  `ok != nil`.
- `host := strings.SplitN(addr, ":", 2)[1]` -- the port, in `clientHost`.

### Attempts

1. Sentence, criteria and note verbatim; matcher above; `state: located`.
   `gaps`: **works**, gap 0.40, head +0.33 at 0.70, suggest 0.57. Eval at
   0.70: 3 defects under it (`configPath` 0.66, `basename` 0.40, `host`
   0.27); fitted 0.20 with 0.07 of headroom a side.

### Fit

Fitted 0.50, in the wide gap rather than at the fitted midpoint. Accepted
run, 3 passes: P 1.00, R 0.90, tp 9 / fp 0 / fn 1, 0 flips. Clean tops at
0.09 (`dot`); nine defects at 0.71-0.94; `host` at 0.27-0.30 is the
recorded miss. Headroom 0.36 over the top clean, 0.21 under the lowest
found defect (`verbose` at 0.71-0.75). Max pass-to-pass spread 0.09.

Between the two runs `basename := path[dot+1:]` moved from 0.36-0.43 to
0.84-0.87 -- same rule, same corpus, same batch -- a run-to-run move the
pass-to-pass spread does not show. The shipped TypeScript and Rust
baselines each carry one recorded miss of this rule too.

### Verdict

**SHIP**, with `host` recorded as a miss. The part-selection class (the
piece after a separator under a name meaning the piece before it) is the
one the note lists and the model finds least reliably; a cutoff that took
it would sit 0.07 above the top clean.

### What I would change

Corpus: more of the part-selection class, to learn whether `basename`'s
0.40-to-0.86 was batch luck or the class's real band.

---

## comment-describes-declaration

### Rule

`experiments/rule-candidates/go/comment-describes-declaration/rule.yml`:

```yaml
id: comment-describes-declaration
language: Go
kind: noul
subject: node
state: located
# 0.40, fitted 2026-09-20 (6 defects, 17 cleans of which 8 hard, 3 passes):
# clean tops at 0.21 (`Rejected`, a true counter comment; the "keep it
# allocation-free" performance note). Three defects sit at 0.80-0.91 (Allow
# consumes, Set's default and eviction, Wait's 100ms) and `New`'s "never
# evicts" at 0.46-0.55 across two runs. Two labelled
# defects are recorded misses: `Reset` ("empties" over a body that fills to
# burst) at 0.30 and `Keys` ("most recently used first" over a walk from
# list.Back) at 0.22 -- the second needs container/list knowledge, which
# the model is measured to lack. 0.40 keeps 0.19 over the top clean and
# 0.06 under New's lowest pass; a cookbook cutoff, not a shipped one. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.40
axis: file
severity: warning
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
        - kind: type_declaration
    # A Go doc comment is a run of `//` lines; tree-sitter makes each its
    # own node, so this captures the last line and jev-lint widens the
    # capture to the run it ends.
    - follows:
        kind: comment
        pattern: $DOC
# The same sentence as typescript/comment-describes-declaration, by copy:
# the loader warns if the two drift.
ask: >-
  The comment above this code claims something that is not true of the code.
criteria:
  "true": >-
    A specific claim the comment makes is contradicted by the code: it names a
    different operation, direction, rounding, ordering or unit than the code
    uses, it states a return value or guarantee the code does not provide, it
    describes a side effect the code does not perform or omits one it does, it
    gives a count, limit or default that differs from the code's, or it refers
    to a parameter, field or function that the code no longer has.
  "false": >-
    Every specific claim the comment makes holds for the code below it. A
    comment that is vague, redundant, restates the obvious, or says less than it
    could is not a false comment -- only a claim that is actually wrong counts
    here. A section heading or divider ("--- Orchestrator: Budget Planning ---",
    "// Helpers") names the part of the file that starts here, not the
    declaration under it, and makes no claim about it.
note: >-
  Judge only claims the code in front of you can confirm or contradict. A
  comment about a caller's obligations, about performance, or about history is
  not checkable here and is not a violation. A heading that labels a section of
  the file is not a claim about the first declaration in that section.
```

Go has no `export_statement`, so the second arm of the TypeScript matcher
has no counterpart; `type_declaration` stands in for the interface, class
and type-alias kinds. Every doc comment is a `//` run, and jev-lint widens
the captured last line to the run (`--show-subjects` prints the widened
`$DOC`).

### Corpus

23 subjects in `fixtures/ratelimit.go` (a token bucket with an HTTP
middleware) and `fixtures/cache.go` (an LRU with expiry): 6 bad, 17 clean,
of which 7 hard (two "callers must hold mu" obligations, a `// ---
helpers ---` heading, a "cheap; takes the lock briefly" performance
remark, a "keep it allocation-free" instruction, a history note above a
getter, and `Len`'s "including any that have expired", which is true of
`len(c.items)`).

- `Allow` -- "without consuming a token"; the body decrements `tokens`
  exactly as `Take` does.
- `Wait` -- "polls at most once every 10ms"; the select waits 100ms.
- `Reset` -- "empties the bucket so the next call must wait"; the body
  fills it to `burst`.
- `New` (cache) -- "a max of zero or less means the cache never evicts by
  count"; the body replaces it with 1024, and `Set` evicts past `max`.
- `Set` -- "a zero ttl uses DefaultTTL" (5m) and "Set never evicts"; the
  body uses 10 minutes and evicts from the back.
- `Keys` -- "most recently used first"; the loop walks from `list.Back()`,
  which the field comment says is least recent.

### Attempts

1. Sentence, criteria and note verbatim; matcher above; `state: located`.
   `gaps`: **move**, gap 0.28, head +0.15 at 0.70, suggest 0.41. Eval: three
   defects at 0.84-0.93, `New` at 0.51, `Reset` at 0.30, `Keys` at 0.22.
   No second attempt: the sentence is fixed by the copy, `located` is the
   only arm that shows `Set`'s eviction to `New`'s comment, and the two
   misses are not a wording problem -- `Reset` is a plain contradiction the
   model reads as a reset, and `Keys` needs `container/list` semantics.

### Fit

Fitted 0.40. Accepted run, 3 passes: P 1.00, R 0.67, tp 4 / fp 0 / fn 2,
0 flips. Clean tops at 0.20 (`Rejected`'s true comment; the
allocation-free note at 0.18-0.21); `New` at 0.46-0.52 (mean 0.48);
`Reset` 0.26-0.32 and `Keys` 0.15-0.21 are the recorded misses. Headroom
0.19 over the top clean, 0.06 under `New`'s lowest pass. Stable across the
two runs (every subject within 0.05 of its earlier mean).

### Verdict

**COOKBOOK.** The number, effect and default classes separate cleanly
(0.80+ against 0.21); the weakest found defect sits 0.06 over the cutoff
and two labelled defects sit inside the clean band. Worth a recipe with
the Go matcher; not a cutoff to ship.

### What I would change

Corpus first: `Reset` should be re-checked with a second body of the same
shape (a comment claiming one direction over a body doing the other) to
learn whether 0.30 is the class or the case. `Keys` should stay as the
labelled API-knowledge miss it is.

---

## comment-describes-block

### Rule

`experiments/rule-candidates/go/comment-describes-block/rule.yml`:

```yaml
id: comment-describes-block
language: Go
kind: noul
subject: enclosing
# `bare` (as rust/comment-describes-block), measured 2026-09-20 against
# `located` on the same evals: the enclosing function holds the comment and
# the statements beneath it, and the file only lowered the weak defects (the
# 8 MiB cap fell from 0.66-0.84 to 0.40-0.58, the seconds-vs-UnixMilli
# header from 0.67 to 0.55) without moving the one hard clean that sits in
# the defect band either way.
state: bare
# 0.50, fitted 2026-09-20 (7 defects, 11 cleans of which 6 hard, 3 passes,
# two runs): ordinary cleans top at 0.34 on means (0.45 on one pass of the
# "retry only on 5xx" preamble in the first run), defects start at 0.62 on
# means (wg.Wait after the error drain; 0.56 on its lowest pass) and run to
# 0.93. One hard clean is a recorded false positive at 0.78-0.83: "the large
# pool goes first ... see the scheduler in pool.go" above `return small,
# large`, a comment about other code that the model reads against the tuple
# order. 0.50 keeps 0.05-0.16 over the ordinary cleans and 0.06 under the
# lowest defect pass; a cookbook cutoff, not a shipped one.
# Report: experiments/reports/j-go/REPORT.md.
threshold: 0.50
severity: info
utils:
  statement:
    any:
      - kind: if_statement
      - kind: for_statement
      - kind: expression_switch_statement
      - kind: type_switch_statement
      - kind: select_statement
      - kind: return_statement
      - kind: expression_statement
      - kind: short_var_declaration
      - kind: var_declaration
      - kind: const_declaration
      - kind: assignment_statement
      - kind: inc_statement
      - kind: dec_statement
      - kind: go_statement
      - kind: defer_statement
      - kind: send_statement
      - kind: break_statement
      - kind: continue_statement
      - kind: labeled_statement
      - kind: block
rule:
  any:
    # A `//` run above a statement in the middle of a body. tree-sitter makes
    # each line its own node, so this captures the last line and jev-lint
    # widens it to the run.
    - all:
        - matches: statement
        - follows:
            kind: comment
            pattern: $DOC
        - inside:
            kind: block
            stopBy: end
    # A comment that opens a body sits beside the `statement_list`, not
    # inside it, so the first statement has no comment sibling: reach out to
    # the list and read what precedes it.
    - all:
        - matches: statement
        - nthChild: 1
        - inside:
            kind: statement_list
            follows:
              kind: comment
              pattern: $DOC
# The same sentence as typescript/comment-describes-block, by copy: the
# loader warns if the two drift.
ask: >-
  The comment captured as DOC makes a claim about the code beneath it that the
  code contradicts.
criteria:
  "true": >-
    The comment says what the code beneath it does, and the code does something
    else: a count, limit, number of attempts or delay that differs from the
    code's, or that the comment fixes to a number while the code takes it from a
    parameter; a direction, order, sign, rounding or unit that is not the one
    the code uses; a condition the code tests the other way round; or a step the
    comment says happens here that the code beneath it does not perform.
  "false": >-
    Every specific claim in the comment holds for the code beneath it. The code
    beneath a comment is the run of statements from the comment down to the next
    comment or the end of the block, not the first statement alone: "two events"
    above two appends is true. A comment that gives a reason outside the code --
    a policy, a caller, a server, a past bug -- that says what the whole test or
    function is for, that describes what other code does, that is vague, or that
    summarises the code loosely but not wrongly, makes no claim the code can
    contradict. A comment that states the effect the code beneath it achieves
    ("so the newest are kept") is a claim about that code, and is judged by what
    the code does. A comment that sits at the end of a line of code, after that
    code, belongs to that line, not to the code beneath it. The contradiction
    has to be visible in the code shown: a comment about setup, a later step, or
    code that is not shown is not contradicted by a statement that simply does
    not mention it.
note: >-
  The comment under test is the one whose last line is captured as DOC; it may
  begin several lines above that line, and all of it is the comment. Find that
  line in the source before judging: if code precedes the comment on its own
  line, the comment is a trailing remark on that code and makes no claim about
  the line beneath it. Judge the comment only against the code that follows it.
  Other comments in the same function are not your concern.
```

Two matcher facts the probe turned up. `switch_statement` is not a Go
kind; the grammar has `expression_switch_statement` and
`type_switch_statement`, and naming the wrong one fails the whole scan.
And a comment that opens a body is a sibling of the `statement_list`, not
a member of it, so the first statement of a block has no comment sibling
and `follows:` finds nothing -- the second arm reaches out to the list and
reads what precedes it. Without it the `plan` function's opening comment
was not a subject.

### Corpus

18 subjects in `fixtures/worker.go` (a fan-out copier with a WaitGroup)
and `fixtures/client.go` (an HTTP client with retries): 7 bad, 11 clean,
of which 6 hard ("retry only on 5xx" above the loop whose condition is
`StatusCode < 500`; the 404 branch whose comment also says what the
caller does; "feed, then close" spanning a loop and the `close` after it;
a reason-outside-the-code preamble above a sleep; "at or above 1 MiB" as
`>= 1<<20`; and "the large pool goes first ... see the scheduler in
pool.go" above `return small, large`).

- "Cap the body at 8 MiB" -- `LimitReader` is given `4<<20`.
- "The reset header is seconds since the epoch" -- passed to
  `time.UnixMilli`.
- "Newest first" -- the less function is `Updated.Before`, oldest first.
- "Skip disabled items" -- the loop keeps exactly the disabled ones.
- "Wait for every worker before reading the errors" -- `errs` is closed
  and drained before `wg.Wait()`.
- "Three attempts" -- the loop runs five.
- "Round up" -- integer division, nothing adds the partial page.

### Attempts

1. Verbatim sentence; `subject: enclosing`, `state: located` as the
   TypeScript rule. `gaps`: **rewrite**, gap 0.15, head +0.02 at 0.70.
   Eval: defects 0.47-0.94 (the 8 MiB cap at 0.40-0.58, the header unit at
   0.55, the wg.Wait order at 0.65); ordinary cleans top at 0.37; the
   "see pool.go" clean at 0.69-0.79.
2. `state: bare`, as `rust/comment-describes-block` (the enclosing
   function holds the comment and the statements beneath it). Defects rose
   to 0.63-0.93 (the 8 MiB cap 0.66-0.84, the header 0.64-0.71); ordinary
   cleans top at 0.45 on one pass of the "retry only on 5xx" preamble
   (0.37 on means); the "see pool.go" clean stayed at 0.78-0.83. Kept.

### Fit

Fitted 0.50 on `bare`. Accepted run, 3 passes: P 0.88, R 1.00, tp 7 / fp
1 / fn 0, 0 flips. Ordinary cleans top at 0.34 on means; defects start at
0.62 (wg.Wait after the drain; 0.56 on its lowest pass) and run to 0.93.
The one false positive is the "large pool goes first" comment at
0.81-0.83: the criteria say a comment about other code makes no claim the
code beneath can contradict, and the model reads it against the tuple
order of the `return`. Headroom 0.05-0.16 over the ordinary cleans (single
pass / means), 0.06 under the lowest defect pass.

### Verdict

**COOKBOOK.** Every defect separates from every ordinary clean with 0.18
of gap on `bare`; the hard clean that describes other code sits in the
defect band at either arm, and the weakest defect sits 0.06 over the
cutoff. The Go matcher (two arms, the switch kinds) is the reusable part.

### What I would change

Corpus: two or three more "describes other code" comments, to learn
whether the class always lands high or this one does because the return
happens to name the two pools in the other order. If the class always
lands high, the label is wrong and the criteria's exemption is not one the
model honours.

---

## test-name-describes-code

### Rule

`experiments/rule-candidates/go/test-name-describes-code/rule.yml`:

```yaml
id: test-name-describes-code
language: Go
kind: noul
subject: node
state: bare
# 0.78, fitted 2026-09-20 (5 defects, 16 cleans of which 8 hard, 3 passes):
# defects sit at 0.88-0.97 (the "rejects expired token" subtest that expects
# the subject back, Sign "fails on empty subject" over subject u2, the
# RemoveItem test that never removes). The top clean is the synonym,
# `TestDeleteItem` calling RemoveItem, at 0.58-0.76 across two runs (means
# 0.66 and 0.68); next is the vacuous negative-quantity test at 0.53, about
# the named thing and the other rule's business. Midpoint of the 0.68-0.89
# gap: 0.10 over the top clean and 0.11 under the lowest defect on means,
# but 0.02 over the synonym's highest single pass -- a cookbook cutoff until
# a corpus with more synonym titles says where that class really sits. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.78
axis: file
severity: warning
rule:
  any:
    # `func TestFooBar(t *testing.T)`: the name is the title.
    - all:
        - kind: function_declaration
        - has:
            field: name
            pattern: $TITLE
            regex: "^Test([A-Z_]|$)"
        - has:
            field: parameters
            regex: "testing\\.(T|TB)\\b"
    # `t.Run("title", func(t *testing.T) {...})`: a subtest with a literal
    # title. A table-driven `t.Run(tc.name, ...)` has no literal and is
    # judged as part of its enclosing Test function.
    - all:
        - kind: call_expression
        - has:
            field: function
            regex: "\\.Run$"
        - has:
            field: arguments
            all:
              - has:
                  nthChild: 1
                  any:
                    - kind: interpreted_string_literal
                    - kind: raw_string_literal
                  pattern: $TITLE
              - has:
                  kind: func_literal
                  pattern: $BODY
# The same sentence as typescript/test-name-describes-code, by copy: the loader
# warns if the two drift.
ask: >-
  The operation, input or outcome this test's code exercises is not the one its
  name names.
note: >-
  A weak or missing assertion is not a different outcome. The outcome differs
  only when the code expects something the name contradicts: an ordinary value
  where the name says throws or rejects, active where it says rejects, the
  below-threshold price where it says above. A body that calls the named
  operation on the named input and then checks a length, checks that something
  exists, or checks nothing, is about the named thing.
criteria:
  "true": >-
    Reading the name and then the code, they are about different things. The
    operation the code calls is not the one the name says (a lookup where the
    name says remove, a post where it says reverse); the input or case the code
    sets up is not the one the name states (three units where the name says
    above ten, a non-empty list where it says empty); the outcome the code
    expects is the opposite of the one the name implies (expecting active where
    the name says rejects); the name promises a throw, a panic, an error or a
    rejection where the code expects an ordinary value; or the name refers to
    something -- a sort, a warning, a log line -- that the code never calls and
    never checks.
  "false": >-
    The code calls the operation the name says, on the input the name says, and
    expects the kind of outcome the name says. That holds however weak the
    assertion is: a length check, an is_some, a toBeDefined, a bare call with no
    assertion at all, are still about the named thing, and whether they
    establish it is a separate question this rule does not ask. A one-word
    title, a synonym for the operation's name, a compound title whose body
    covers both parts, and setup that calls other operations before the named
    one, are all fine.
```

Two arms: `func TestX(t *testing.T)` captures the function name as
`$TITLE`; `t.Run("title", func(t *testing.T) {...})` captures the string
literal as `$TITLE` and the closure as `$BODY`, as the TypeScript
`it($TITLE, $BODY)` does. A table-driven `t.Run(tc.name, ...)` has no
literal and is judged as part of its enclosing Test function, which is a
subject in its own right.

### Corpus

21 subjects in `fixtures/cart_test.go` and `fixtures/token_test.go` (a
cart and an HMAC token signer; the fixtures are the test files only, and
`state: bare` sends the matched test alone): 5 bad, 16 clean, of which 9
hard (one-word `TestTotal`; `TestDeleteItem` calling `RemoveItem`; the
compound `TestAddThenRemoveLeavesCartEmpty`; `TestAddItemRejectsNegativeQuantity`
whose assertion is vacuous but about the named thing; the outer
`TestApplyDiscount` and `TestParse` over subtests; "applies 10% discount"
with only a positivity check; `TestSignRoundTrip` with no assertion;
`TestParseReturnsClaims` with a nil check; the table-driven
`TestParseRejectsMalformed`).

- `TestRemoveItemDropsLine` -- calls `Line` and checks a quantity; never
  calls `RemoveItem`.
- `TestApplyDiscountCapsAtHundredPercent` -- applies 10% and checks an
  ordinary total.
- `TestLinesSortedByPrice` -- never sorts, checks only the count.
- `t.Run("rejects expired token")` -- fails on any error and expects the
  subject back.
- `TestSignFailsOnEmptySubject` -- signs subject `u2` and expects success.

### Attempts

1. Verbatim sentence, criteria and note; matcher above; `state: bare`.
   `gaps`: **move**, gap 0.35, head +0.07 at 0.70, suggest 0.34 (a
   misleading suggestion: the widest step is inside the clean half).
   Eval at 0.70: P 1.00 R 1.00 with one flip -- `TestDeleteItem` at
   0.58/0.69/0.71 across 0.70.

### Fit

Fitted 0.78. Accepted run, 3 passes: P 1.00, R 1.00, tp 5 / fp 0 / fn 0,
0 flips. Defects at 0.88-0.97. The top clean is the synonym,
`TestDeleteItem` calling `RemoveItem`, at 0.63-0.76 (mean 0.68; 0.58-0.71
in the first run); next is the vacuous negative-quantity test at 0.53.
Headroom 0.10 over the top clean and 0.11 under the lowest defect on
means, but 0.02 over the synonym's highest single pass.

### Verdict

**COOKBOOK.** It separates, and the synonym title is exactly the hard
clean the criteria exempt ("a synonym for the operation's name"), but it
sits within 0.02 of the cutoff on one pass and moved 0.13 within a run.
A cutoff this close to a named exemption is not one to ship.

### What I would change

Corpus: three or four more synonym titles (`TestDelete`/`Remove`,
`TestFetch`/`Get`, `TestStop`/`Cancel`) to find where the class really
sits; if it sits at 0.7, the Go port needs a Go-specific note about
`Test<Verb>` naming, which would be a documented drift.

---

## test-name-verifies-claim

### Rule

`experiments/rule-candidates/go/test-name-verifies-claim/rule.yml`:

```yaml
id: test-name-verifies-claim
language: Go
kind: noul
subject: node
state: bare
# 0.70, fitted 2026-09-20 (9 defects, 12 cleans of which 6 hard, 3 passes):
# eight defects sit at 0.86-0.97 (the discarded AddItem(-1) error, the
# `Total() > 0` under "applies 10% discount", the round trip that ignores
# Parse's result, the expired token expected to parse). The top cleans are
# the Go shape the TypeScript corpus has no twin for: an outer Test function
# whose subtests carry the assertions, `TestParse` at 0.46-0.51 and
# `TestApplyDiscount` at 0.33-0.41. One labelled defect is a recorded miss
# at 0.60-0.67: `TestParseReturnsClaims`, which checks only that the claims
# are non-nil -- the fitted midpoint 0.56 would take it with 0.07 of
# headroom a side. 0.70 keeps 0.19 over the top clean and 0.16 under the
# lowest found defect. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.70
axis: file
severity: warning
rule:
  any:
    # `func TestFooBar(t *testing.T)`: the name is the title.
    - all:
        - kind: function_declaration
        - has:
            field: name
            pattern: $TITLE
            regex: "^Test([A-Z_]|$)"
        - has:
            field: parameters
            regex: "testing\\.(T|TB)\\b"
    # `t.Run("title", func(t *testing.T) {...})`: a subtest with a literal
    # title. A table-driven `t.Run(tc.name, ...)` has no literal and is
    # judged as part of its enclosing Test function.
    - all:
        - kind: call_expression
        - has:
            field: function
            regex: "\\.Run$"
        - has:
            field: arguments
            all:
              - has:
                  nthChild: 1
                  any:
                    - kind: interpreted_string_literal
                    - kind: raw_string_literal
                  pattern: $TITLE
              - has:
                  kind: func_literal
                  pattern: $BODY
# The same sentence as typescript/test-name-verifies-claim, by copy: the loader
# warns if the two drift.
ask: >-
  This test would still pass if the behaviour its name claims were broken.
note: >-
  Two things to read for. A snapshot records whatever the output was: under a
  name that claims a specific property of the output (a row hidden, a footer
  omitted, a hint shown, a format) it establishes nothing about that property,
  while under a name that only says renders, or snapshot, or labels the variant
  rendered, it is the whole claim. And a body whose named operation is never
  called, or whose named case is never set up, establishes nothing however exact
  its assertion is.
criteria:
  "true": >-
    The body does not establish what the name claims: it asserts nothing at all,
    it asserts something that would hold whether or not the named behaviour
    worked, it checks an incidental property such as a length or a type instead
    of the named behaviour itself, or it never sets up the case the name is
    about so the assertion never exercises it.
  "false": >-
    The body contains at least one assertion that would fail if the named
    behaviour were broken. Read the name for what it actually claims: a name
    that claims only that something renders, or that the output matches a
    snapshot, or that only labels the input the snapshot was taken of, is
    established by the snapshot; a name that claims an interaction with a
    collaborator -- that something was called, once, with these arguments -- is
    established by an assertion on that call.
```

Same matcher and the same two fixture files as `test-name-describes-code`;
the labels differ, and overlap where a test is about the wrong thing and
therefore also proves nothing (the calibration notes warn that the two
failure modes nest).

### Corpus

21 subjects, 9 bad, 12 clean, of which 5 hard (the outer `TestApplyDiscount`
and `TestParse`, whose own names claim only that the operation is tested
while the subtests carry the assertions; `TestDeleteItem`;
`TestParseUsesClockOnce`, an interaction claim proved by counting calls
on a fake; the table-driven `TestParseRejectsMalformed`).

- `TestRemoveItemDropsLine` -- `RemoveItem` is never called.
- `TestAddItemRejectsNegativeQuantity` -- the error is discarded and
  `len(...) < 0` cannot fail.
- "applies 10% discount" -- `Total() > 0` holds either way.
- `TestApplyDiscountCapsAtHundredPercent` -- the capping case is never set
  up.
- `TestLinesSortedByPrice` -- a length check cannot fail on wrong order.
- `TestSignRoundTrip` -- the `Parse` result and error are discarded.
- `TestParseReturnsClaims` -- only non-nil is checked.
- "rejects expired token" -- passes when rejection is broken, fails when it
  works.
- `TestSignFailsOnEmptySubject` -- the empty subject is never set up.

### Attempts

1. Verbatim; `state: bare`. `gaps`: **works**, gap 0.31, head +0.12 at
   0.70, suggest 0.74. Eval at 0.70: P 1.00 R 0.89, `TestParseReturnsClaims`
   under at 0.60-0.67.

### Fit

Fitted 0.70 (midpoint 0.57 would take the nil-check case with 0.07 a
side). Accepted run, 3 passes: P 1.00, R 0.89, tp 8 / fp 0 / fn 1, 0
flips. Eight defects at 0.86-0.97; the top cleans are the outer tests
with subtests, `TestParse` at 0.50-0.53 and `TestApplyDiscount` at
0.36-0.39; `TestParseReturnsClaims` at 0.62-0.67 is the recorded miss.
Headroom 0.19 over the top clean, 0.16 under the lowest found defect.

### Verdict

**SHIP**, with the nil-check case recorded as a miss. It is the greyest
label in the corpus (a non-nil `*Claims` is some evidence that claims came
back) and the model's 0.64 says so; the eight unambiguous defects and the
Go-specific outer-test cleans separate by 0.33.

### What I would change

Nothing in the rule. The outer-test-with-subtests shape deserves a line in
the cookbook: its title claims little, and `bare` shows the model the
subtests inside it, which is why it lands at 0.4-0.5 rather than 0.9.

---

## module-name-describes-contents

### Rule

`experiments/rule-candidates/go/module-name-describes-contents/rule.yml`:

```yaml
id: module-name-describes-contents
language: Go
kind: noul
subject: file
state: graph
# 0.60, fitted 2026-09-20 (5 defects, 5 cleans of which 3 hard, 3 passes):
# clean tops at 0.39 (errors.go, sentinel errors plus a status mapping),
# defects start at 0.79 (auth/password.go holding an email normaliser and a
# slugifier) and run to 0.90 (utils.go over one nameable concern). Midpoint
# of the 0.40 gap, 0.20 of headroom a side. `main.go` scored 0.66 at the
# fixtures root and 0.13 under cmd/server/, where the outline names it by
# its directory. The outline lists Go functions and methods but not type
# declarations (the probe has no name field for them), so a file of types
# shows only its methods. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.60
axis: file
severity: info
rule:
  kind: source_file
# The same sentence as typescript/module-name-describes-contents, by copy:
# the loader warns if the two drift.
ask: >-
  This module's name does not describe what the module contains.
criteria:
  "true": >-
    The filename and path name a subject that the module's public items do not
    match: the items belong to a different concern than the name states, the
    name names one thing while the module holds an unrelated assortment, the
    name is narrower or broader than the items it holds, or the name is a
    placeholder such as utils, helpers, misc, common or manager for items that
    share a concern that could be named.
  "false": >-
    The filename and path describe what the module's public items are about,
    closely enough that someone looking for those items would look here.
note: >-
  A module holding one cohesive group of items is not a mismatch merely for
  holding several of them, and a conventional entry-point name (index, mod, lib,
  main) is named by its directory rather than by itself.
```

`subject: file`, `state: graph`, `kind: source_file`: the outline is the
path, the exported functions and methods with their signatures, the
private ones, and the imports. The Go structure in `src/scan.ts` lists
`type_declaration` as a container with no name field, so **types do not
appear in the outline**: `user.go`, which is four structs and two methods,
is shown as two methods whose receivers are `*Order` and `Invoice`. The
rule still found it, from the receivers.

### Corpus

10 subjects, one per file: 5 bad, 5 clean, of which 3 hard
(`handlers.go`, several handlers under a plural name; `store.go`, a
generic name over one store; `cmd/server/main.go`, the conventional entry
point named by its directory).

- `metrics.go` -- session lookup, an auth middleware and a role check;
  nothing measures.
- `utils.go` -- retry with backoff, one nameable concern under a
  placeholder.
- `user.go` -- `Order`, `Line` and `Invoice` with their methods beside
  `User`.
- `cache.go` -- a token-bucket rate limiter, nothing that caches.
- `auth/password.go` -- a salt generator and a constant-time compare, then
  an email normaliser and a slugifier.

### Attempts

1. Verbatim; `main.go` at the fixtures root. `gaps`: **rewrite**, gap
   0.24, head +0.13 at 0.70 -- `main.go` at 0.65-0.67, over the 0.36-0.39
   of `errors.go` and among the defects. Its outline said "named by its
   directory, so its subject is: fixtures", which describes nothing.
2. Same rule; `main.go` moved to `cmd/server/main.go`, the layout a Go
   binary actually has. `main.go` fell to 0.12-0.14 and the gap opened to
   0.40 (0.39 to 0.79). A corpus fix, not a rule change: the note says an
   entry point is named by its directory, and the directory has to be
   one.

### Fit

Fitted 0.60. Accepted run, 3 passes: P 1.00, R 1.00, tp 5 / fp 0 / fn 0,
0 flips. Clean tops at 0.40 (`errors.go`); defects at 0.79-0.90
(`password.go` lowest, `utils.go` highest). Headroom 0.20 / 0.19. Max
spread 0.05.

### Verdict

**SHIP**, on the smallest corpus here (10 subjects, the bar's minimum plus
two) -- the one rule where a subject is a whole file, so the corpus is as
many files as one can write. Worth calling out as a SHIP with a thin
corpus; the shipped Rust variant has four files.

### What I would change

Tooling: give `type_declaration` a name (it is `type_spec > name`, one
level down) so a file of types has an outline. Until then a Go file of
only types reads as "declares no named items", and this rule will call
it whatever its name suggests.

---

## idempotent-name

### Rule

`experiments/rule-candidates/go/idempotent-name/rule.yml`:

```yaml
id: idempotent-name
language: Go
kind: noul
subject: node
state: located
# 0.42, fitted 2026-09-20 (6 defects, 9 cleans of which 5 hard, 3 passes):
# clean tops at 0.26 (`SetupDefaultRegistry`, which reassigns a global);
# five defects sit at 0.88-0.94 (plain INSERT under Upsert, the appended
# handler and hook, CREATE TABLE without IF NOT EXISTS, the O_APPEND header)
# and `SetupRoutes` at 0.55-0.63, which needs to know that ServeMux panics
# on a duplicate pattern -- API knowledge, and the weakest answer for it.
# Midpoint of the 0.26-0.59 gap: 0.16 over the top clean, 0.13 under the
# lowest defect pass. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.42
axis: file
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    # Go's spelling of the family: exported and unexported both count.
    - has:
        field: name
        pattern: $NAME
        regex: "^([Ee]nsure|[Uu]psert|[Ss]etup|[Ii]nstall|[Rr]egister)([A-Z0-9_]|$)"
# The same sentence as typescript/idempotent-name, by copy: the loader warns
# if the two drift.
ask: This function's name ($NAME) says a repeated call is harmless, but calling
  it a second time with the same arguments leaves a different result from
  calling it once.
criteria:
  "true": "The body performs its effect without finding out whether it is already
    in place, and repeating the effect accumulates or fails: it appends to a
    list or adds a listener, creates a record, index, table, column or resource
    that would then exist twice or make the second creation fail, inserts where
    a matching row may already be, or runs a step that is not itself safe to
    repeat -- with no existence check, no keyed overwrite and no guard that
    makes the second call a no-op. One such step is enough, even when the other
    steps of the body are safe to repeat."
  "false": "A second call finds the effect already in place and leaves the state
    as the first call left it: the body checks for existence before acting,
    writes by key so a repeat overwrites the same entry, assigns rather than
    appends, uses an operation that is inherently repeatable (put, set, mkdir
    with recursive, CREATE IF NOT EXISTS, ON CONFLICT), returns early on a flag
    it sets, or has no effect at all beyond its return value."
note: Only this body is judged. A helper it calls whose own name says it is
  repeat-safe (ensure*, upsert*, put*, set*, *IfNotExists) is assumed to be.
  Logging on each call, or returning a fresh object each call, is not a
  different result. A function whose name says ensure but is a pure conversion
  of its argument has nothing to repeat and is not a violation.
```

### Corpus

15 subjects in `fixtures/schema.go` (migrations, a registry, hooks): 6
bad, 9 clean, of which 5 hard (`ensureDir` via `MkdirAll`;
`EnsureTrailingSlash`, a pure conversion; `RegisterMetric`, which writes
zero by key and so resets a counter on repeat -- the same state the first
call left; `SetupDefaultRegistry`, which reassigns a global;
`InstallSignalHandler` under `sync.Once`).

- `EnsureUsersTable` -- `CREATE TABLE` without `IF NOT EXISTS`.
- `UpsertSetting` -- a plain `INSERT` under an Upsert name.
- `EnsureStateFile` -- opens with `O_APPEND` and writes a header line
  every call.
- `RegisterHandler` -- appends to a slice, no existence check.
- `SetupRoutes` -- `ServeMux.HandleFunc` panics on a duplicate pattern, so
  the second call panics.
- `InstallShutdownHook` -- appends to a package-level slice; the hook runs
  twice at shutdown.

### Attempts

1. Verbatim; `state: located`. `gaps`: **works**, gap 0.32, head +0.12 at
   0.70, suggest 0.74. Eval at 0.70: `SetupRoutes` under at 0.55-0.63.

### Fit

Fitted 0.42 (the midpoint). Accepted run, 3 passes: P 1.00, R 1.00, tp 6
/ fp 0 / fn 0, 0 flips. Clean tops at 0.27 (`SetupDefaultRegistry`);
five defects at 0.88-0.94; `SetupRoutes` at 0.56-0.58 (0.55-0.63 in the
first run), which needs the API fact that `HandleFunc` panics on a
repeat, and is the weakest answer for that reason. Headroom 0.15 over the
top clean, 0.14 under `SetupRoutes`' lowest pass.

### Verdict

**SHIP.** Separates with headroom and no flips; the one weak defect is
the one API-knowledge case, and it still clears the cutoff by 0.13.

### What I would change

Nothing. A `Register*` that both checks and appends under a lock would be
a good extra clean.

---

## pure-name-is-pure

### Rule

`experiments/rule-candidates/go/pure-name-is-pure/rule.yml`:

```yaml
id: pure-name-is-pure
language: Go
kind: noul
subject: node
state: local
# 0.60, fitted 2026-09-20 (6 defects, 12 cleans of which 8 hard, 3 passes):
# clean tops at 0.31-0.37 (`ComputeRate`, which takes a mutex to read two
# fields); the next clean is 0.13 (`FormatLocalTime`, a LoadLocation the
# note calls acquiring a dependency). Defects sit at 0.90-0.97: the slog
# line in computeTotal, time.Now in CalculateShipping, the key cache, the
# os.WriteFile in FormatReceipt, os.Getenv in ParseConfig's fallback, and
# toRow assigning through its pointer. Set just under the midpoint: 0.23
# over the top clean, 0.30 under the lowest defect. Before the lock, the
# loader and the parameter-named-env cleans were added the top clean was
# 0.06; they are what the cutoff is measured against. Report:
# experiments/reports/j-go/REPORT.md.
threshold: 0.60
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    # Go's spelling of the family: exported and unexported both count.
    # `To` needs a capital after it, so `Total` and `Token` are not `To*`.
    - has:
        field: name
        pattern: $NAME
        regex: "^([Cc]ompute|[Cc]alculate|[Dd]erive|[Ff]ormat|[Tt]o|[Pp]arse)([A-Z0-9_]|$)"
# The same sentence as typescript/pure-name-is-pure, by copy: the loader
# warns if the two drift.
ask: This function's name ($NAME) presents it as a computation of a result from
  its inputs, but its body changes state outside itself or performs I/O.
criteria:
  "true": "The body mutates an argument or something reachable through one,
    assigns to a module-level binding, a field of `this` or an object it did not
    create, stores something it computed into a cache, Map, Set or other store
    that outlives the call, logs, emits or increments a metric, or reads or
    writes a file, network, database, environment, clock or random source --
    directly, or through a call whose name or arguments show it does so (fetch,
    a path, a URL, a query, send, save). One such read or write on any path is
    enough: a default taken from the clock, the environment or a random source
    when a field is missing, or an effect in a fallback branch, makes the body
    impure even though its common path is not."
  "false": The body derives its result from its parameters, from `this`, from
    module-level values it only reads, and from dependencies it obtains -- a
    module, binding, table, formatter, parser or backend handed back by a
    loader, resolver or registry lookup -- and returns it. A mutable local
    accumulator, a copy of an argument that is then modified, and a local object
    built up and returned are not effects outside the function.
note: "Obtaining a dependency is not an effect. Calling or awaiting a helper
  that hands back a module, native binding, compiled table, backend or client
  (get*Module, load*, require, resolve*, a dynamic import) acquires something
  the body needs; that the helper memoises what it loaded is the helper's
  business, not this body's. What is judged is what the body then does with its
  inputs: calling a pure function of an acquired module is a computation, using
  an acquired client to fetch, read, write or send is I/O. The line is what gets
  written: a body that puts its own result -- a value it computed, a key it
  generated, a formatter it built -- into a cache, Map or Set that outlives the
  call changes what later calls observe and is an effect even when it is only
  memoisation; a body that only takes a dependency out of such a store is not. A
  helper that receives its input from a parameter (readEnvInt(raw.count, ...))
  reads that argument, not the environment, whatever its name says. Reading
  `this` in a toJSON, toString or similar method is reading, not writing.
  Sorting or mutating a copy the body made itself is not mutating the argument."
axis: file
severity: info
```

### Corpus

18 subjects in `fixtures/pricing.go`: 6 bad, 12 clean, of which 8 hard
(`ComputeTax` reading a package-level table; `computeDigest` writing into
a hasher it made; `ParseLine` returning an error; `ParseAddr` using
`net.ParseIP`; `ToJSON` reading its receiver; `derivePlan` sorting a copy;
`parseEnvInt`, named for the environment but given the raw value as a
parameter; `FormatLocalTime` obtaining a location through
`time.LoadLocation`; `ComputeRate` taking a mutex to read two fields).

- `computeTotal` -- logs through `slog` on every call.
- `CalculateShipping` -- reads `time.Now()` for a Sunday surcharge.
- `deriveKey` -- stores the key into a package-level cache.
- `FormatReceipt` -- writes the receipt to a file on the way out.
- `ParseConfig` -- `os.Getenv` for a default in the fallback branch.
- `toRow` -- assigns `o.Total` through its pointer argument.

### Attempts

1. Verbatim; `state: local`; 15 subjects. `gaps`: **works**, gap 0.84,
   head +0.64 at 0.70. Every clean at 0.03-0.06, every defect at
   0.90-0.97: too easy to fit against.
2. Same rule; three harder cleans added (the parameter-named-env helper,
   the loader, the lock). The lock case landed at 0.31-0.37 and is what
   the cutoff is now measured against; the other two at 0.12 and 0.04.

### Fit

Fitted 0.60. Accepted run, 3 passes: P 1.00, R 1.00, tp 6 / fp 0 / fn 0,
0 flips. Clean tops at 0.34 (`ComputeRate`); defects at 0.90-0.97.
Headroom 0.26 over the top clean, 0.30 under the lowest defect. Max
spread 0.06.

### Verdict

**SHIP.** The widest separation in the family. The note's clauses about
acquiring dependencies and reading through parameters, written for
TypeScript loaders, transfer as written; the one Go-specific clean that
scores mid-band is a lock taken to read, which the note does not mention.

### What I would change

A sentence in the note about locks: "taking a lock to read is reading" --
but only if a corpus with more lock cases shows the class creeping up.

---

## safe-name-is-safe

### Rule

`experiments/rule-candidates/go/safe-name-is-safe/rule.yml`:

```yaml
id: safe-name-is-safe
language: Go
kind: noul
subject: node
state: local
# 0.43, fitted 2026-09-20 (5 defects, 15 cleans of which 5 hard, 3 passes,
# with the Go sentence in the note): clean tops at 0.26-0.31 (`tryConnect`
# returning (net.Conn, error); `SafeGo`, whose goroutine recovers its own
# panic, at 0.28), defects start at 0.54-0.59 (`SafeDiv`, whose panic on a
# zero divisor is implicit in `a / b`) then 0.69 (`FirstOrZero` indexing an
# empty slice), 0.67-0.76 (`SafeDeref`), 0.79-0.85 (the panicking day
# branch) and 0.95 (os.Exit). Midpoint of the gap: 0.12 over the top clean
# and 0.11 under the lowest defect on single passes. Without the note's
# last sentence the two error-returning cleans sat at 0.63 and 0.49, inside
# the defect band. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.43
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    # Go's spelling of the family. `Must*` promises the opposite (it panics)
    # and has its own candidate, must-name-panics. Go's throw is a panic,
    # and os.Exit / log.Fatal escape the caller the same way.
    - has:
        field: name
        pattern: $NAME
        regex: "^([Ss]afe|[Tt]ry)([A-Z0-9_]|$)|(OrZero|OrDefault|OrNil|OrEmpty|OrNone)$"
# The same sentence as typescript/safe-name-is-safe, by copy: the loader
# warns if the two drift. "throw" and "rejected promise" there read as
# panic here; the criteria's "result object the caller can inspect" is
# Go's (value, error) or (value, ok) pair.
ask: This function's name ($NAME) says that failure is absorbed and reported as
  a value, but its body has a path on which a failure escapes as a throw or a
  rejection.
criteria:
  "true": "A failure of the kind the name promises to absorb can reach the caller
    as an exception or a rejected promise: the operation that can fail is
    outside any try, the catch rethrows or throws a new error, a failing case is
    detected and answered with a throw instead of the null, undefined, default,
    false or result value the name promises, or the fallback itself is computed
    by something that can fail."
  "false": "Every failure of the kind the name refers to is turned into the value
    the name promises: null, undefined, a default, a boolean, or a result object
    the caller can inspect. A body that cannot fail at all, and so has nothing
    to catch, honours the name."
# Deliberate drift from typescript/safe-name-is-safe, in `note` only: one
# sentence added at the end. Go reports failure as a returned `error` or a
# `(value, ok)` pair, and its throw is a panic (os.Exit and log.Fatal end
# the process the same way). Without the sentence the model read
# `tryConnect(...) (net.Conn, error)` and `TryFirst(...) ("", ErrEmpty)` as
# failures escaping (0.63 and 0.49 on the first attempt) -- an `error` is
# not among the values the TypeScript criteria list, because TypeScript has
# no such convention.
note: "A throw on a programmer error -- an argument of the wrong type, a misuse
  of the function's own API -- is not the failure such a name promises to absorb
  and does not count. Logging before returning the fallback is fine. The failure
  that counts is the one the name and the parameters are about: parsing, lookup,
  I/O, connection, conversion. A returned error value or a (value, ok) pair is
  failure reported as a value; a panic, an os.Exit or a log.Fatal is failure
  escaping."
axis: file
```

**This is the one deliberate drift in the family**, in `note` only, and
the loader warns on it as it should: one sentence added at the end
saying that a returned error value or a `(value, ok)` pair is failure
reported as a value, and a panic, `os.Exit` or `log.Fatal` is failure
escaping. The TypeScript criteria list the values a safe name may return
-- null, undefined, a default, a boolean, a result object -- and Go's
`error` is none of them by name. `Must*` is the inverse claim and went to
its own candidate, `must-name-panics`, because the sentence has to say
the opposite and a copy cannot.

### Corpus

20 subjects in `fixtures/conv.go`: 5 bad, 15 clean, of which 5 hard
(`SafeClose` recovering and logging; `SafeGo` whose goroutine recovers
its own panic; `TryLock`, which cannot fail; `tryConnect` returning
`(net.Conn, error)`; `TryFirst` returning `("", ErrEmpty)`).

- `SafeDiv` -- `a / b` with no check panics on a zero divisor.
- `tryParseDuration` -- the day-suffix branch panics on a bad count
  instead of returning `(0, false)`.
- `FirstOrZero` -- `xs[0]` on an empty slice.
- `SafeDeref` -- `*p` with no nil check.
- `SafeAtoi` -- logs and `os.Exit(2)` on a parse error.

### Attempts

1. Verbatim (no Go sentence); `state: local`. `gaps`: **rewrite**, gap
   0.23, head +0.11 at 0.70. Eval: `tryConnect` at 0.61-0.65 and `TryFirst`
   at 0.46-0.51 -- two cleans whose "value" is an `error` -- inside the
   defect band; `SafeDiv` at 0.54-0.60.
2. The Go sentence appended to `note`. `tryConnect` fell to 0.26-0.31,
   `TryFirst` to 0.21-0.30; defects unchanged (`SafeDiv` 0.54-0.59). Gap
   0.23 between 0.31 and 0.54.

### Fit

Fitted 0.43 (the midpoint). Accepted run, 3 passes: P 1.00, R 1.00, tp 5
/ fp 0 / fn 0, 0 flips. Clean tops at 0.29 (`tryConnect`; `SafeGo` at
0.27); defects at 0.56-0.64 (`SafeDiv`, whose panic is implicit in the
division), 0.67-0.71 (`FirstOrZero`), 0.70-0.76 (`SafeDeref`), 0.79-0.85
(the day branch), 0.95 (`os.Exit`). Headroom 0.14 over the top clean,
0.13 under `SafeDiv`'s lowest pass.

### Verdict

**SHIP**, with the note drift documented in the file. Without the
sentence the rule flags idiomatic Go (`try*` returning an error), which
is the first thing it would meet on a real repository.

### What I would change

The drift should go the other way eventually: the TypeScript `note` could
carry the same sentence harmlessly ("a returned error value ... is failure
reported as a value" is true of a `Result`-like return there too), which
would end the warning without a Go-only copy.

---

## must-name-panics

### Rule

`experiments/rule-candidates/go/must-name-panics/rule.yml`:

```yaml
id: must-name-panics
language: Go
kind: noul
subject: node
state: local
# 0.75, fitted 2026-09-20 (6 defects, 10 cleans of which 7 hard, 3 passes):
# clean tops at 0.51-0.57 (`MustListen`, which turns an empty address into
# ":0" -- a normalisation to its author and a substituted default to the
# model, and the ambiguity is real); the next clean is 0.17 (the delegation
# to regexp.MustCompile). Five defects sit at 0.93-0.97 (nil returned after
# a logged open error, the empty string for an unset variable, the (int,
# error) signature, defaults for a missing config file, the discarded
# WriteFile error). One labelled defect is a recorded miss at 0.08-0.19:
# `mustDecode`, whose deferred recover swallows the panic it raised and
# returns the zero value; spelling the recover out in the note moved it
# from 0.18 to 0.09, so the sentence went back to its first form. 0.75 keeps
# 0.18 over the top clean and 0.18 under the lowest found defect. Report:
# experiments/reports/j-go/REPORT.md.
threshold: 0.75
axis: file
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    # The inverse of safe-name-is-safe: `Must*` promises that failure is
    # NOT reported as a value. Its own candidate because the sentence is
    # the opposite of the safe rule's, not a variant of it.
    - has:
        field: name
        pattern: $NAME
        regex: "^([Mm]ust)([A-Z0-9_]|$)"
ask: >-
  This function's name ($NAME) says that a failure stops the program instead
  of being handed back, but its body has a path on which a failure is
  returned, swallowed, or replaced by a default.
criteria:
  "true": >-
    A failure of the kind the name is about is handed back rather than
    raised: the body returns an error value beside its result, returns nil,
    a zero value or a default when the operation fails, logs the failure and
    carries on, discards the error a call returns, or recovers a panic and
    turns it into a value.
  "false": >-
    Every failure of the kind the name is about ends in a panic, a log.Fatal
    or an os.Exit -- directly, or through a helper whose own name says it
    does the same, such as a Must* it delegates to -- or the body cannot fail
    at all. Retrying before panicking, wrapping the error before panicking
    with it, and validating arguments with a panic are all the promised
    shape.
note: >-
  A Must* that takes what a fallible call returns and panics when the error
  is non-nil is the canonical shape. Only this body is judged; a callee that
  is not itself a Must* is assumed to report its failures as an error, and
  what matters is what this body does with that error. Substituting a
  default for a missing input is a failure handed back, whatever the log
  line beside it says.
```

A new rule, not a port: the brief asked whether `Must*` belongs in
`safe-name-is-safe` inverted or in its own candidate. Its own, because
`safe-name-is-safe`'s sentence, criteria and note are a verbatim copy and
the `Must*` claim is the opposite one -- failure must NOT come back as a
value. There is no TypeScript twin, so no drift question.

### Corpus

16 subjects in `fixtures/must.go`: 6 bad, 10 clean, of which 7 hard
(`MustCompile` delegating to `regexp.MustCompile`; `MustConnect` using
`log.Fatalf`; `MustNew` validating by panic; `mustHave`, an assertion
helper; `MustParseDuration` wrapping the error before panicking with it;
`MustResolve` retrying three times then panicking; `MustListen`, which
turns an empty address into `":0"`).

- `MustOpen` -- logs the open error and returns nil.
- `mustEnv` -- an unset variable returns the empty string.
- `MustAtoi` -- returns `(int, error)`.
- `MustLoad` -- a missing file becomes default config with a warning; only
  the parse error panics.
- `mustDecode` -- a deferred `recover` swallows the panic it raised and
  returns the zero value.
- `mustWrite` -- discards the error from `os.WriteFile`.

### Attempts

1. Sentence as above. `gaps`: **move**, gap 0.40, head +0.14 at 0.70,
   suggest 0.36. Eval: five defects at 0.93-0.97; `mustDecode` at
   0.17-0.19; `MustListen` (clean) at 0.52-0.56.
2. A sentence added to the note spelling out that a deferred recover in
   the same body cancels the panic and returns the named results.
   `mustDecode` fell to 0.08-0.10. Reverted: the sentence did not help and
   an untested clause is worse than none.

### Fit

Fitted 0.75. Accepted run (attempt-1 wording), 3 passes: P 1.00, R 0.83,
tp 5 / fp 0 / fn 1, 0 flips. Clean tops at 0.51 (`MustListen`, whose
":0" is a normalisation to its author and a substituted default to the
model -- the note says a substituted default is a failure handed back,
and the ambiguity is real); next clean 0.17. Five defects at 0.93-0.97;
`mustDecode` at 0.16-0.20 is the recorded miss. Headroom 0.24 over the top
clean, 0.18 under the lowest found defect.

### Verdict

**SHIP**, with the recover case recorded as a miss and the empty-address
normalisation as the top clean. The returned-error, returned-zero,
logged-and-continued and discarded-error shapes -- what `Must*` misuse
looks like in practice -- all land above 0.9.

### What I would change

Corpus: two more recover-in-the-same-body cases to learn whether the
model ever sees that shape; if not, it is an API-knowledge miss to
document, like `Keys` above.

---

## log-level-matches-event

### Rule

`experiments/rule-candidates/go/log-level-matches-event/rule.yml`:

```yaml
id: log-level-matches-event
language: Go
kind: noul
subject: node
state: local
# 0.66, fitted 2026-09-20 (7 defects, 19 cleans of which 6 hard, 3 passes):
# clean tops at 0.54-0.58 (`Fatalw` on an ack failure during a drain --
# severe, on a real failure), then 0.41-0.45 (the refused login at info);
# defects start at 0.74-0.78 (the permanent drop at debug, the 401 refusal
# at debug, the ack failure at info) and run to 0.89. Midpoint of the
# 0.16 gap: 0.10 over the top clean and 0.09 under the lowest defect on
# means, 0.08 a side on single passes. A cookbook cutoff until the fatal
# class has more cases. Report: experiments/reports/j-go/REPORT.md.
threshold: 0.66
# Not a `pattern:`: in the Go grammar `$LOGGER.$LEVEL($MSG)` parses as a
# type conversion (`pkg.Type(x)`), so the one-argument pattern matches no
# call at all. The kind-based form matches any arity.
rule:
  all:
    - kind: call_expression
    - has:
        field: function
        kind: selector_expression
        all:
          - has: { field: operand, pattern: $LOGGER }
          - has: { field: field, pattern: $LEVEL }
    - has:
        field: arguments
        has: { nthChild: 1, pattern: $MSG }
constraints:
  # log/slog, zap (sugared and not), logrus and log15 spellings: Info,
  # Infof, Infow, Infoln, InfoContext, Warning ...
  LEVEL:
    regex: ^(Trace|Debug|Info|Warn|Warning|Error|Fatal|Panic)(f|w|ln|Context)?$
  LOGGER:
    regex: (?i)(log|zap|sugar)
# The same sentence as typescript/log-level-matches-event, by copy: the
# loader warns if the two drift.
ask: The level of this log call ($LEVEL) misstates the severity of what the
  surrounding code is handling at that point.
criteria:
  "true": "What the code is doing where the call sits belongs at a clearly
    different level than the one used: the call is at info, debug or trace but
    sits on a path where the operation has failed and the function gives up,
    rethrows, exits, discards data or returns a failure the caller must act on;
    the call is at debug or trace for an outcome the function reports to its
    caller, such as a refusal or a rejection, rather than for progress or detail
    on the way to an outcome; the call is at error or fatal but sits on the
    ordinary success path or on a routine, expected branch such as a cache miss,
    a normal rejection or a validation failure; or the call is at warn but the
    code immediately exits or throws with no recovery."
  "false": "The level fits what the code around the call shows: error or warn
    where something went wrong that an operator should see, even if the function
    recovers from it; info for routine outcomes including expected business
    rejections and refused logins; debug or trace for per-item progress in loops
    and other chatter; warn for a degraded or transient condition the code goes
    on to handle; error on stderr for a usage error in a command-line entry
    point. Whether the message text is well written is not the question."
note: Judge the level against the code path the call sits on, not against words
  in the message. A logger call whose first argument is not a message for a
  human is not a violation.
axis: file
```

The TypeScript rule is two `pattern:`s. In the Go grammar
`$LOGGER.$LEVEL($MSG)` parses as a `type_conversion_expression`
(`pkg.Type(x)`), so the one-argument pattern matches no call at all --
`slog.Error("usage: ...")`, `w.sugar.Debugw("queue empty")` and the
`Warn` before `os.Exit` were all silently absent from the first
`--show-subjects` listing. The matcher is a kind-based rule on
`call_expression > selector_expression` instead, and the two
`constraints:` do the level and logger narrowing as before (`Infow`,
`Errorf`, `WarnContext` and `Warning` are admitted).

### Corpus

26 subjects in `fixtures/service.go` (`log/slog` in a handler, a login, a
DB wait loop, a batch and a CLI entry) and `fixtures/worker.go` (a zap
sugared logger in a queue loop): 7 bad, 19 clean, of which 6 hard (the
refused login at info; a failed write to a gone client at warn; error for
a load that is skipped; warn for defaults; the CLI usage error at error;
`Fatalw` on an ack failure during a drain).

- `Debug("request rejected: missing token")` before a 401 -- an outcome
  reported to the caller, at debug.
- `Error("cache miss")` -- the routine branch.
- `Info("load failed")` before a 500 -- giving up, at info.
- `Warn("database unreachable ... exiting")` then `os.Exit(1)`.
- `Error("processed batch")` on the success path.
- `Debugw("job failed permanently, dropping")` -- data discarded, at
  debug.
- `Infow("ack failed; job will be redelivered")` then `return err`.

### Attempts

1. Verbatim; kind-based matcher; `state: local`. `gaps`: **rewrite**, gap
   0.20, head +0.13 at 0.70 (the widest step is inside the clean half,
   between 0.33 and 0.54). Eval: defects 0.74-0.89; `Fatalw` at 0.54-0.58;
   the refused login at 0.41-0.45.

### Fit

Fitted 0.66 (the midpoint). Accepted run, 3 passes: P 1.00, R 1.00, tp 7
/ fp 0 / fn 0, 0 flips. Clean tops at 0.56 (`Fatalw`); defects start at
0.72 (the permanent drop) and 0.76 (the 401 at debug), run to 0.89.
Headroom 0.10 over the top clean and 0.06-0.09 under the lowest defect
(0.72 on means this run, 0.74 last run); 0.08 a side on single passes.

### Verdict

**COOKBOOK.** It separates and does not flip, but the headroom is under
0.10 on one side and the pinning clean is a single `Fatal` case; the
severity of a fatal on a real failure is a judgement the criteria do not
settle. The kind-based matcher is the reusable part and is needed for
any Go rule that matches one-argument method calls.

### What I would change

Corpus: more `Fatal`/`Panic` calls on real failures and on routine
branches, to learn where that level's clean band ends.

---

## tests-cover-failure-paths

### Rule

`experiments/rule-candidates/go/tests-cover-failure-paths/rule.yml`:

```yaml
id: tests-cover-failure-paths
language: Go
kind: noul
subject: node
state: paired
# 0.40, fitted 2026-09-20 (5 defects, 7 cleans of which 3 hard, 3 passes):
# clean tops at 0.17-0.19 (`Merge`, which discards its callee's errors and
# has no path of its own); four defects sit at 0.87-0.95 and
# `ParseQuantity` -- whose non-number path is tested and whose non-positive
# path is not -- at 0.51-0.72, the widest pass-to-pass spread here. 0.40
# keeps 0.21 over the top clean and 0.11 under that lowest pass. The
# fixtures are `basket.go` + `basket_test.go` because a stem of `cart`
# paired with the repository's own test/fixtures/cookbook/cart.test.ts and
# cart.rs, split the excerpt budget three ways and cut the Go test file
# to 2665 characters, which lost `TestLine` and flagged `Line` at 0.83.
# Report: experiments/reports/j-go/REPORT.md.
threshold: 0.40
rule:
  all:
    - any:
        - kind: function_declaration
        - kind: method_declaration
    # Exported, in Go's spelling: a capital first letter. Test functions
    # live in _test.go files and are the pair, not the subject.
    - has:
        field: name
        pattern: $NAME
        regex: "^[A-Z]"
    - not:
        has:
          field: name
          regex: "^(Test|Benchmark|Fuzz|Example)([A-Z_]|$)"
# The same sentence as typescript/tests-cover-failure-paths, by copy: the
# loader warns if the two drift. Go's failure path is a returned error, a
# panic, or a (zero, false) pair, all of which the criteria already name
# ("returns an error value", "refuses an input through a guard").
ask: >-
  This function ($NAME) has a failure path of its own that none of the related
  tests reaches.
criteria:
  "true": >-
    The body itself throws, rejects, returns an error value, or refuses an input
    through a guard on some path, and no related test in the state drives $NAME
    down that path: no test passes an input that trips the guard, asserts a
    throw or a rejection from it, or asserts the error result -- neither by
    calling $NAME nor through another function in this file that calls it. A
    related test that never calls $NAME, directly or through a caller, while the
    body has such a path, is that case.
  "false": >-
    Every failure path the body declares is reached by some related test -- a
    test passes the bad input, asserts that the call throws or rejects, or
    asserts the error result it returns, whether it calls $NAME itself or calls
    a function in this file that calls $NAME, and in whatever vocabulary the
    runner uses (`toThrow`, `rejects`, `assert.throws`, a `try`/`catch` around
    the call, an `.ok` read as false) -- or the body has no failure path of its
    own: it cannot fail, or the only failures on its paths come from callees it
    does not guard, which are those callees' paths and not this function's. A
    throw behind one condition with several operands is one path, and a test
    that trips any one operand has reached it.
note: >-
  A failure path is one throw, one reject, or one return of an error value (`{
  ok: false }`, `null`, `undefined` on a checked condition): a single throw
  behind a condition with several `||` operands is one path, reached when any
  operand is tripped. Only the paths this body DECLARES count; a callee that may
  throw is not this function's path unless the body catches and re-reports it.
  Judge what a test's body does, not what its title says: a test whose title
  claims a failure but whose body never trips $NAME's guard reaches nothing, and
  a test whose title is about something else but whose body passes the bad input
  and asserts the throw reaches it. The related tests are excerpts, so a call to
  $NAME counts even when the assertion around it was cut; but a call with
  ordinary input does not reach a guard that ordinary input never trips, and a
  mention of $NAME only in an import reaches nothing. Returning the input
  unchanged, or a default, when a condition is not met is a fallback and not a
  failure path: nothing is refused and nothing reports an error.
axis: file
```

Exported means a capital first letter, so the matcher is a regex on the
name; methods are included (they are Go's public API), and `Test*`
functions are excluded so a `_test.go` in the scanned tree is the pair
and not a subject. The copied criteria already say "returns an error
value" and "refuses an input through a guard", which is Go's failure path,
so no clause was added; the comment above `ask:` says so.

### Corpus

12 subjects in `fixtures/basket.go`, paired with
`fixtures/basket_test.go` (`--show-subjects` prints `arm paired` for all
12; none dropped as unpaired): 5 bad, 7 clean, of which 3 hard (`AddItem`
with three guards each tripped by a subtest; `Merge`, which discards its
callee's errors and has no path of its own; `Line`, whose `(Line{},
false)` path is reached by `Line("nope")`).

- `RemoveItem` -- `ErrNotFound` on an unknown sku; the test removes one
  that exists.
- `ApplyDiscount` -- `ErrBadDiscount` outside 0-100; the test applies 50.
- `Checkout` -- two paths, the empty cart and the second checkout; only
  the second is reached.
- `ParseQuantity` -- the non-number is tested with `"abc"`, the
  non-positive number is not.
- `MustQuantity` -- panics on a bad quantity; the test passes `"4"`.

### Attempts

1. Verbatim; fixtures named `cart.go` / `cart_test.go`. `gaps`: **move**,
   gap 0.32, head +0.21 at 0.70. Eval: `Line` (clean) flagged at
   0.82-0.84; `ParseQuantity` at 0.24-0.70. The excerpt the model saw had
   lost `TestLine`: `findTestFiles` searches the repository's conventional
   `test/` root as well as the scanned paths, the stem `cart` paired with
   `test/fixtures/cookbook/cart.test.ts` and `cart.rs`, and the 8000-char
   budget split three ways cut the Go test file to 2665 chars (see
   Tooling).
2. Same rule; fixtures renamed `basket.go` / `basket_test.go`. One pair,
   whole test file in the excerpt (3355 chars). `Line` fell to 0.07-0.08.

### Fit

Fitted 0.40. Accepted run, 3 passes: P 1.00, R 1.00, tp 5 / fp 0 / fn 0,
0 flips. Clean tops at 0.18 (`Merge`); four defects at 0.87-0.95;
`ParseQuantity` at 0.51-0.65 (mean 0.56; 0.51-0.72 in the run before) --
the second-path-of-two case, and the widest spread in the corpus at
0.14-0.21. Headroom 0.22 over the top clean, 0.11 under `ParseQuantity`'s
lowest pass.

### Verdict

**SHIP.** The `_test.go` pairing works, the excerpt carries `t.Run`
subtests with their titles, and the five failure-path shapes Go has (a
sentinel error, a guard, one of two paths, a panic) separate from the
cleans with 0.33 of gap on means.

### What I would change

Tooling, not the rule: the test-root search should not reach outside the
scanned paths, and a `.rs` or `.ts` file should not pair with a `.go`
module by stem alone (see Tooling). Until then, a Go module whose stem
matches a file under the repository's `test/` gets a truncated excerpt
and a false positive on the function whose test was cut.

---

## Cost

From the tool's own summaries. The thirteen accepted baselines
(`baseline.json`, `spent`) total 87 requests, 594,213 input tokens,
$0.02496. Everything else -- one `gaps` per rule (13 runs, about
$0.0094), the first `eval --repeat 3` of every rule before its cutoff
was written, and the second attempts (`comment-describes-block` on
`located`, `safe-name-is-safe` without the Go sentence,
`must-name-panics` with the recover sentence, `tests-cover-failure-paths`
under the `cart` stem, `pure-name-is-pure` before its three extra cleans,
`module-name-describes-contents` with `main.go` at the root) -- comes to
about 110 requests and $0.042. **Total: about 200 requests, roughly 1.5M
input tokens, $0.067**, against a budget of $1.00. No single run cost
more than $0.0036 (the 35-subject `var-name-describes-value` eval). Every
paid run was preceded by a `--dry-run` of the same corpus and rule.

## Tooling

Things in `src/` that a Go port meets, with the command and the output.
None stopped a rule; two changed what a rule measured.

1. **`paired` reaches into the repository's `test/` root and pairs by
   stem across languages.** With `tests-cover-failure-paths` fixtures
   named `cart.go` / `cart_test.go`:

   ```
   $ node --experimental-strip-types <scratch>/pair3.ts experiments/rule-candidates/go/tests-cover-failure-paths/fixtures/cart.go New AddItem ...
   test files: [
     'experiments/rule-candidates/go/tests-cover-failure-paths/fixtures/cart_test.go',
     'test/fixtures/cookbook/cart.rs',
     'test/fixtures/cookbook/cart.test.ts',
     'test/test.ts'
   ]
   .../fixtures/cart_test.go name len 2665
   test/fixtures/cookbook/cart.rs name len 195
   test/fixtures/cookbook/cart.test.ts name len 174
   ```

   `findTestFiles` (src/paired.ts, `CONVENTIONAL_ROOTS`) adds `test/`,
   `tests/`, `__tests__/`, `spec/` under the cwd whatever paths were
   scanned; `relatedTests` pairs on the stem with no language check, so
   `cart.rs` is a "test" of `cart.go`. The excerpt budget
   (`TEST_EXCERPT_BUDGET` 8000) is split per related file, and the real
   test file was cut to 2665 chars, losing `TestLine` -- which is why the
   first eval flagged `Line` at 0.83. Worked around by renaming the
   fixture stem to `basket`. On a real repository the same thing happens
   to any Go module whose stem matches a file under `test/`.

2. **Go type declarations are not in the outline.** `src/scan.ts`'s Go
   structure lists `type_declaration` with `nameField: null`, so
   `renderOutline` (src/state.ts) filters it out. For
   `module-name-describes-contents`:

   ```
   $ node --experimental-strip-types <scratch>/outline.ts <rule.yml> experiments/rule-candidates/go/module-name-describes-contents/fixtures/user.go
   path: .../fixtures/user.go
   public API:
     Recalculate (method, lines 36-41): func (o *Order) Recalculate()
     Overdue (method, lines 43-45): func (i Invoice) Overdue(now time.Time) bool
   imports:
     import "time"
   ```

   Four structs (`User`, `Order`, `Line`, `Invoice`) are invisible; the
   rule found the defect from the receivers. A file of only types would
   read "this module declares no named items". The name is one level down
   (`type_spec > name`).

3. **`exportedIf` for Go misreads a parameter type as the name.** The
   regex `\b(func|type)\s+\(?[^)]*\)?\s*[A-Z]` lets `[^)]*` run into the
   parameter list, so `func displayName(u User) string` is exported:

   ```
   $ node --experimental-strip-types <scratch>/outline.ts <rule.yml> experiments/rule-candidates/go/fn-name-promises/fixtures/store.go
   public API:
     ...
     Summarize (function, lines 126-135): func Summarize(users []User) int
     displayName (function, lines 137-146): func displayName(u User) string
   ```

   `func main()` and `func helper()` are private, as expected; any
   unexported function with an exported parameter type is not. It affects
   the outline's public/private split and the keywords `paired` excerpts
   on, not any matcher.

4. **`$LOGGER.$LEVEL($MSG)` is a type conversion in the Go grammar.**

   ```
   $ node_modules/.bin/ast-grep run -p '$A.$B($MSG)' --lang go --debug-query=pattern <file>
   Debug Pattern:
   type_conversion_expression
     qualified_type
       MetaVar $A
       .
       MetaVar $B
     ( MetaVar $MSG )
   $ node_modules/.bin/ast-grep run -p 'slog.Error($MSG)' --lang go <file>
   (no matches)
   ```

   Not a jev-lint bug, but the cookbook's `pattern:` recipes for calls do
   not transfer to Go for one-argument calls; the kind-based matcher in
   `log-level-matches-event` is the form that does.

5. **`switch_statement` is not a Go kind** (`expression_switch_statement`
   and `type_switch_statement` are), and **a comment that opens a block is
   a sibling of the `statement_list`**, so `follows:` from the first
   statement finds nothing. Both are grammar facts; both are handled in
   `comment-describes-block`'s matcher and noted there.

6. Not a defect, but worth knowing: a parallel commit (`3c0ff08`,
   "init --pre-push, and docs for commits") swept the first four
   candidate directories into git in their intermediate state while this
   work was in progress. The working tree holds the final versions; `git
   status` shows `comment-describes-block/rule.yml` as modified (the
   `bare` state and the second matcher arm came after that commit) and
   the rest as untracked. Nothing here was committed by this work.
