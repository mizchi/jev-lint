# Family I: the shipped rules, ported to Python

Eleven of the twelve shipped families whose claim transfers (the spec's
"Phase 2" list) are here as `rules/python/<id>` candidates, one directory
per rule under `experiments/rule-candidates/python/`, each with its own
matcher, fixtures, `expect.yml` and accepted baseline. The claim in each
is the TypeScript rule's claim: a name, a comment, a docstring, a test
title or a log level says something about the code beside it, and the
question is whether the code honours it. What jev does here that a linter
cannot is the same in Python as in TypeScript; what is Python-specific is
the grammar, and the grammar is where this port spent its effort:
methods are plain `function_definition` nodes inside a class, a docstring
is the first statement of a body, tree-sitter hoists a comment that opens
a block out of the block, `assert` is its own statement kind, `__init__.py`
is named by its directory, and pytest pairs `test_cart.py` with `cart.py`
by prefix. `ask`, `criteria`, `note` and `explain` are copied verbatim
from `rules/typescript/<id>/rule.yml`; the loader reports no drift with
both trees loaded (`rules -R rules -R experiments/rule-candidates/python`:
37 rules, 0 errors, 0 warnings). One `state` differs and is measured
(`module-name-describes-contents`, `full` for `graph`); one matcher
constraint differs by necessity (`log-level-matches-event`'s level list).

Procedure per rule, as the BRIEF: node kinds found with `ast-grep
--debug-query=ast` on concrete snippets; `rules -R` to 0 errors;
`--dry-run --show-subjects` until every intended subject and capture was
right; `gaps`; `eval --repeat 3`; the fitted `threshold:` written with its
reasons; `eval --repeat 3 --accept`. Every paid run was priced with
`--dry-run` first; no single run exceeded $0.003. Verdicts: 10 SHIP, 1
COOKBOOK (`test-name-verifies-claim`), 0 DROP. Three fixtures were
rewritten after the model disagreed with my label and was right (a
docstring that claimed a command line the CLI never reads, a test whose
"free item" could not change the total, a `try_lock` that let a missing
directory escape); each is recorded in its section and, where it matters,
in `expect.yml`. No label was flipped to agree with the model.

Summary (accepted baselines, 3 passes each; headroom is the smaller of
cutoff minus top clean and lowest caught defect minus cutoff, on means):

| rule | at | P / R | flips | headroom | subjects (bad / hard clean) | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| fn-name-promises | 0.51 | 1.00 / 1.00 | 0 | 0.10 | 23 (9 / 9) | SHIP |
| var-name-describes-value | 0.57 | 1.00 / 1.00 | 0 | 0.26 | 26 (6 / 11) | SHIP |
| comment-describes-declaration | 0.67 | 1.00 / 1.00 | 0 | 0.21 | 19 (8 / 8) | SHIP |
| comment-describes-block | 0.45 | 1.00 / 0.86 | 0 | 0.11 | 17 (7 / 9) | SHIP, 1 recorded miss |
| test-name-describes-code | 0.79 | 1.00 / 1.00 | 0 | 0.15 | 22 (6 / 11) | SHIP |
| test-name-verifies-claim | 0.68 | 1.00 / 1.00 | 1 | 0.03 | 22 (11 / 7) | COOKBOOK |
| module-name-describes-contents | 0.46 | 1.00 / 1.00 | 0 | 0.18 | 9 (4 / 4) | SHIP (`full`) |
| idempotent-name | 0.68 | 1.00 / 1.00 | 0 | 0.17 | 16 (6 / 9) | SHIP |
| pure-name-is-pure | 0.58 | 1.00 / 1.00 | 0 | 0.26 | 17 (6 / 8) | SHIP |
| safe-name-is-safe | 0.59 | 1.00 / 1.00 | 0 | 0.12 | 15 (6 / 6) | SHIP |
| log-level-matches-event | 0.60 | 1.00 / 1.00 | 0 | 0.14 | 16 (6 / 5) | SHIP |
| tests-cover-failure-paths | 0.52 | 1.00 / 1.00 | 0 | 0.14 | 12 (4 / 6) | SHIP |

Two grammar facts every Python rule author needs, found the hard way
and now in the rules' comments:

- A comment that is the first thing in a block (`def f():` / `# ...` /
  first statement; likewise the first line of an `if`, `for`, `with`,
  `try` or class body) is **not inside the block**: tree-sitter attaches
  it to the parent node, before the `block`. `follows: {kind: comment}`
  on the first statement finds nothing. `comment-describes-block` and
  `comment-describes-declaration` each carry an arm for it.
- A declaration is one subject however many arms match it. A `def` with
  a `#` comment above and a docstring inside is asked once, about the
  comment; the docstring is not judged.

---

## fn-name-promises

### Rule

`experiments/rule-candidates/python/fn-name-promises/rule.yml`:

```yaml
id: fn-name-promises
language: Python
kind: noul
subject: node
state: located
# 0.51, fitted 2026-09-20 on this rule's own evals (23 subjects: 9 defects,
# 14 cleans of which 9 hard, 3 passes). Cleans top out at 0.40 (`take`, which
# removes what it returns) then 0.30 (`consume`, the boolean-returning
# mutator); defects start at 0.61 (`calculate_total` writing the cart and an
# audit list) and 0.66 (`load_config` writing defaults to disk). Midpoint of
# the gap, 0.10 of headroom on each side, no decision flips, max spread 0.05.
# Methods are `function_definition` inside `class_definition`, so one arm
# covers functions, methods and decorated definitions.
threshold: 0.51
axis: file
severity: warning
rule:
  all:
    - kind: function_definition
    - has: { field: name, pattern: $NAME }
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

23 subjects in `fixtures/cart.py` and `fixtures/jobs.py` (a dataclass cart
and a sqlite job store with a polling `run`): 9 bad, 14 clean, 9 of them
hard. Methods are `function_definition` nodes inside `class_definition`,
so one arm finds functions, methods and decorated definitions alike.

- `is_expired` reads as a predicate, returns `"expired"` / `"active"`.
- `get_order` promises a read; `orders.pop(order_id)` removes.
- `calculate_total` writes `cart.total_cents` and appends to a module audit list.
- `remove_expired_items` (plural) deletes the first match and returns.
- `load_config` writes the defaults to disk when the file is missing.
- `retry(fn, attempts=3)` tries once and returns None on failure.
- `JobStore.get_job` inserts a pending row when the job is missing.
- `count_pending` returns the list of ids.
- `drain` copies the queue and leaves it as it was.

Hard cleans: `__len__`, `sum_prices`, `fmt_money`, `take` (removes what it
returns), `consume` (boolean-returning mutator), `apply_discount` with a
wrong comment inside its body, `to_dict` reading the table, `handle`,
`poll_interval` consulting the environment, `run`.

### Attempts

1. Matcher `function_definition` + `has: {field: name}`, `located`, sentence
   verbatim from TypeScript. `gaps`: 23 matched, gap 0.20, suggest 0.49,
   verdict `rewrite` (the gaps verdict, on a corpus whose eval then
   separated with 0.10 of headroom -- the verdict's width threshold is
   stricter than the eval's fit). No second attempt was needed.

### Fit

Fitted 0.51 (accepted run: cleans top 0.39 `take`, 0.29 `consume`;
defects from 0.61 `calculate_total`, 0.65 `load_config`, up to 0.88
`retry`). Precision 1.00, recall 1.00, tp 9 / fp 0 / fn 0. Flips 0 across
3 passes. Max spread 0.05.

### Verdict

**SHIP.** Separates with 0.10-0.12 of headroom on each side and no flips;
the quiet defects (a calculator that writes, a loader that writes) sit
where the TypeScript variant's quiet defects sit.

### What I would change

Nothing in the matcher. The corpus could use one `async def` and one
`@property`; both are `function_definition` and would be found, but they
are not measured.

---

## var-name-describes-value

### Rule

`experiments/rule-candidates/python/var-name-describes-value/rule.yml`:

```yaml
id: var-name-describes-value
language: Python
kind: noul
subject: node
state: located
# 0.57, fitted 2026-09-20 on this rule's own evals (26 subjects: 6 defects,
# 20 cleans of which 11 hard, 3 passes). Cleans top out at 0.31 (`healthy`,
# a test binding holding the count it is named for) then 0.17 (`admin`, a
# response named for its scenario); defects start at 0.84 (`count` bound to
# a list, `config_path` bound to lines). Midpoint of the gap, 0.26 of headroom
# on each side, no decision flips, max spread 0.11 (the `healthy` clean).
# The matcher is `assignment` with an `identifier` on the left, so a
# dataclass field default and a module constant are subjects too; `self.x =`
# (an `attribute` on the left) and tuple unpacking are not.
threshold: 0.57
axis: file
severity: warning
rule:
  all:
    - kind: assignment
    - has: { field: left, kind: identifier, pattern: $NAME }
    - has: { field: right, pattern: $VALUE }
    # Functions are judged by `fn-name-promises`; this rule is about values.
    - not:
        has: { field: right, kind: lambda }
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

### Corpus

26 subjects in `fixtures/client.py` (a requests-based client) and
`fixtures/test_client.py`: 6 bad, 20 clean, 11 hard. The matcher is
`assignment` with an `identifier` on the left and a `right` side captured
as `$VALUE`; `self.x =` (an `attribute` on the left), tuple unpacking and
augmented assignment are not subjects, and a `lambda` on the right is
excluded as `fn-name-promises`' subject.

- `users = fetch_user(uid)`: plural on one record, read with `.get("role")`.
- `is_admin = users.get("role")`: boolean name on the role string, compared with `"admin"`.
- `username = email.split("@")[1]`: the domain, in `domain_of`.
- `config_path = path.read_text().splitlines()`: a path name on lines.
- `count = [u for u in urls if ...]`: a count name on a list, then `len(count)`.
- `first = lines[-1]` in `latest_line`.

Hard cleans: `retries = 3`, `seen = set()`, `pending = []`, `i = 0`,
`raw = os.environ.get("PORT")`, `buf = bytearray()`, the test bindings
`admin`, `unauthorized`, `ok` / `bad` fixture lists, `healthy` holding the
count asserted `== 2`.

### Attempts

1. Matcher as above, `located`, sentence and note verbatim. `gaps`: 26
   matched, gap 0.60, suggest 0.51, `works`. One attempt.

### Fit

Fitted 0.57 (first run: cleans top 0.31 `healthy`, 0.17 `admin`; defects
0.84-0.93; accepted run: cleans top 0.22, defects from 0.83). Precision
1.00, recall 1.00, tp 6 / fp 0 / fn 0. Flips 0. Max spread 0.11 (the
`healthy` clean).

### Verdict

**SHIP.** 0.26 of headroom on each side. The TypeScript note's hard-clean
list (counter, role name, provenance name, scenario-named test binding)
transfers unchanged.

### What I would change

The corpus is missing the TypeScript variant's two known misses (a name on
the success branch of a union result; one field under another's name) and
a `unit` case; none of the three was built here, so this rule's Python
recall on those classes is unmeasured.

---

## comment-describes-declaration

### Rule

`experiments/rule-candidates/python/comment-describes-declaration/rule.yml`:

```yaml
id: comment-describes-declaration
language: Python
kind: noul
subject: node
state: located
# 0.67, fitted 2026-09-20 on this rule's own evals (19 subjects: 8 defects,
# 11 cleans of which 8 hard, 3 passes). Cleans top out at 0.43 (`parse_args`,
# whose docstring claims the exit argparse performs) then 0.30 (the comment
# hoisted above a class body's first method); defects start at 0.90 (`recent`,
# "newest first" over an ascending sort). Midpoint of the gap, 0.23 of
# headroom on each side, no decision flips, max spread 0.08. One node is one
# subject: a declaration with both a `#` comment above and a docstring is
# asked once, about the comment.
threshold: 0.67
axis: file
severity: warning
rule:
  any:
    # A `#` comment directly above the declaration.
    - all:
        - any:
            - kind: function_definition
            - kind: class_definition
        - follows:
            kind: comment
            pattern: $DOC
    # A decorated declaration: the comment precedes the decorator, so the
    # relation has to be tested one level up.
    - all:
        - any:
            - kind: function_definition
            - kind: class_definition
        - inside:
            kind: decorated_definition
            follows:
              kind: comment
              pattern: $DOC
    # The first declaration in a class body: tree-sitter hoists a comment
    # that opens a block out of the block, so it precedes the block, not
    # the declaration.
    - all:
        - kind: function_definition
        - nthChild: 1
        - inside:
            kind: block
            follows:
              kind: comment
              pattern: $DOC
    # A docstring: the claim sits inside the declaration, as the first
    # statement of its body.
    - all:
        - any:
            - kind: function_definition
            - kind: class_definition
        - has:
            field: body
            has:
              kind: expression_statement
              nthChild: 1
              has: { kind: string, pattern: $DOC }
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

### Corpus

19 subjects in `fixtures/session_store.py` and `fixtures/cli.py`: 8 bad,
11 clean, 8 hard. Four matcher arms: a `#` comment directly above a
`function_definition` / `class_definition`; a comment above a
`decorated_definition` (the decorator sits between comment and
declaration); a comment that opens a class body, which tree-sitter hoists
out of the block so it precedes the block and not the first method
(`nthChild: 1` inside a `block` that `follows` the comment); and a
docstring (`body > expression_statement[nthChild: 1] > string`), the
cookbook's recipe 6b. One node yields one subject: a declaration with both
a comment above and a docstring is asked once, about the comment (this
happened to `SessionStore` and to `tag`).

- `SessionStore` class comment: "every public method takes the store's lock"; there is no lock.
- `ttl`: "milliseconds"; returns seconds.
- `touch` docstring: "does not mutate"; increments `hits`.
- `recent`: "newest first"; sorts ascending.
- `create` docstring documents a `ttl_seconds` argument the method lacks.
- `revoke` docstring: "raises KeyError"; returns False.
- `probe`: "up to three times"; `range(5)`.
- `configure_logging` (decorated): "DEBUG unless --verbose, then INFO"; WARNING / INFO.

Hard cleans: a caller's obligation (`__iter__`), history (`purge`), a
section divider above `tag`, a true O(1) claim (`find`), argparse's exit
claimed on `parse_args`, a true memoisation claim above a decorated
`build_parser`, the hoisted comment above `Command.run`, "Entry point.".

### Attempts

1. Matcher as above, `located`, sentence verbatim. `gaps`: 19 matched, gap
   0.29, suggest 0.76, `works`. Eval: cleans top 0.66 -- `Command.name`,
   whose docstring I had written as "The command's name as typed on the
   command line" in a CLI that never accepts a command name. The model was
   right and the fixture was wrong; the docstring was rewritten to what it
   was meant to claim ("the class name, lowercased"), not relabelled.
2. Same rule, fixed fixture: cleans top 0.43.

### Fit

Fitted 0.67 (accepted run: cleans top 0.42 `parse_args`, 0.30 the hoisted
comment; defects from 0.88 `recent` to 0.97 `probe`). Precision 1.00,
recall 1.00, tp 8 / fp 0 / fn 0. Flips 0. Max spread 0.08.

### Verdict

**SHIP.** 0.23 of headroom on each side. The docstring arm and the `#` arm
answer in the same band, so one cutoff serves both.

### What I would change

Ask both halves when a declaration has a comment above and a docstring
inside: today the docstring is silently not judged whenever a `#` line
precedes the `def`. That is a subject-identity question for `src/`, not a
matcher fix.

---

## comment-describes-block

### Rule

`experiments/rule-candidates/python/comment-describes-block/rule.yml`:

```yaml
id: comment-describes-block
language: Python
kind: noul
subject: enclosing
state: located
# 0.45, fitted 2026-09-20 on this rule's own evals (17 subjects: 7 defects,
# 10 cleans of which 9 hard, 3 passes) and checked on 18 unseen subjects
# from three real files. Cleans top out at 0.22 (a body-opening comment
# over the loop it describes) on the evals and 0.32 on the unseen files (a
# section heading "agent.log (INFO+)" over a handler whose level is a
# parameter). Five defects answer 0.81-0.95; the inverted condition ("skip
# entries older than a day" over `ts > now - DAY`) answers 0.56 (0.53-0.60
# across passes), and the cutoff sits 0.11 under it and 0.13 over the
# unseen clean band. One labelled defect is not found and is left in the
# evals as such: "keep the newest" over an ascending sort and a `[:N]`
# slice (0.36), false only when the two statements are read together --
# the same shape the TypeScript variant records as its miss. The fitted
# midpoint (0.29) sits between that miss and the clean band and is not
# used. The grammar hoists a comment that opens a block out of the block;
# the second arm matches the block itself so those comments are asked
# about too, and the subject is the enclosing function either way.
threshold: 0.45
severity: info
rule:
  any:
    # A statement that follows a `#` comment inside a body.
    - all:
        - any:
            - kind: if_statement
            - kind: for_statement
            - kind: while_statement
            - kind: try_statement
            - kind: with_statement
            - kind: return_statement
            - kind: raise_statement
            - kind: expression_statement
            - kind: assert_statement
            - kind: delete_statement
            - kind: match_statement
            - kind: break_statement
            - kind: continue_statement
            - kind: pass_statement
        - follows:
            kind: comment
            pattern: $DOC
        # Inside a body, not at the top level: a top-level comment above a
        # statement is documentation and the declaration rule covers it.
        - inside:
            kind: block
            stopBy: end
    # A comment that opens a body: tree-sitter hoists it out of the block, so
    # it precedes the block rather than the block's first statement.
    - all:
        - kind: block
        - follows:
            kind: comment
            pattern: $DOC
        - inside:
            kind: function_definition
            stopBy: end
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

### Corpus

17 subjects in `fixtures/retry_queue.py` and `fixtures/test_log_sink.py`:
7 bad, 10 clean, 9 hard. Two arms: a statement (any of the 15 statement
kinds, `assert_statement` included -- it is its own kind in Python) that
`follows` a `comment` inside a `block`; and a `block` that `follows` a
`comment` inside a `function_definition`, for the comment that opens a
body, which tree-sitter hoists out of the block. `subject: enclosing`
either way, `located` as in TypeScript.

- "keep the newest MAX_ENTRIES" over an ascending sort and a `[:N]` slice (keeps the oldest).
- "skip entries older than a day" over `if ts > now - DAY: continue` (skips the newer ones).
- "retry up to three times" over `range(5)`.
- "wait one second" over `sleep(0.1)`.
- "mark the entry done and notify the sender" over one assignment; nothing notifies.
- "convert to milliseconds" over `seconds * 100`.
- "round down" over `round()`.

Hard cleans: a why-comment opening `push`, "housekeeping", a true
body-opening comment over a dict-and-loop, "oldest first" over an
ascending sort, "two events" over two appends, "verify", "newest first"
over two asserts, a preamble opening a test, a trailing comment on a
query line, "must not raise" over a second `close()`.

### Attempts

1. Matcher as above. `gaps`: 17 matched, gap 0.29, suggest 0.68, `works`.
   Eval at 0.7: 5 of 7 defects at 0.81-0.95, the inverted condition at
   0.56 (0.53-0.60), "keep the newest" at 0.36; cleans top 0.22. The
   fitted midpoint, 0.29, sits between the miss and the clean band.
2. No rewrite (the sentence is a copy). Instead the rule was run on 18
   unseen subjects from three real files (`hermes_time.py`,
   `hermes_logging.py`, `utils.py` of nousresearch/hermes-agent) with the
   cutoff at 0.30: one subject at 0.32 (a heading "agent.log (INFO+)" over
   a handler whose level is a parameter), the next at 0.17. So the real
   clean band tops at 0.32 on that sample.

### Fit

`threshold: 0.45`, set for headroom rather than at the midpoint: 0.23 over the
evals' cleans, 0.13 over the unseen clean band, 0.11 under the inverted
condition (0.08 on its lowest pass). Accepted run: precision 1.00, recall
0.86, tp 6 / fp 0 / fn 1 -- the fn is "keep the newest" (0.33), false
only when the sort and the slice are read together, the shape the
TypeScript variant records as its own miss. Flips 0. Max spread 0.12.

### Verdict

**SHIP** (severity `info`, as the TypeScript variant), with one labelled
defect it does not find and says so. It separates with headroom on both
the corpus and the unseen sample and does not flip.

### What I would change

The hoisted-block arm reports at the block's first line and judges the
whole enclosing function; when the block is a `for` body with three other
comments in it (the inverted-condition case) the model answers 0.56, and
that is the weakest catch. A subject that is the run of statements to the
next comment, rather than the enclosing function, would sharpen it; that
is a `subject` mode `src/` does not have.

---

## test-name-describes-code

### Rule

`experiments/rule-candidates/python/test-name-describes-code/rule.yml`:

```yaml
id: test-name-describes-code
language: Python
kind: noul
subject: node
state: bare
# 0.79, fitted 2026-09-20 on this rule's own evals (22 subjects: 6 defects,
# 16 cleans of which 11 hard, 3 passes). Cleans top out at 0.65
# (`test_items_are_sorted_by_price`, which calls sorted_items and checks
# only the length: the right thing, weakly) then 0.46 and 0.41 (the
# tautological `is not None` asserts, same class); defects answer
# 0.94-0.96. Midpoint of the gap, 0.14 of headroom on each side, no
# decision flips, max spread 0.07. The three hard cleans near the cutoff
# are the other rule's defects, which is the split the two rules exist for.
threshold: 0.79
axis: file
severity: warning
rule:
  all:
    - kind: function_definition
    # pytest collects `test_*`; unittest collects `test*` methods.
    - has:
        field: name
        pattern: $TITLE
        regex: "^test($|_|[A-Z0-9])"
    - has:
        field: body
        pattern: $BODY
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

### Corpus

22 subjects in `fixtures/test_cart.py` (pytest functions with a
`make_cart()` helper) and `fixtures/test_inventory.py` (a
`unittest.TestCase`): 6 bad, 16 clean, 11 hard. Matcher:
`function_definition` whose name matches `^test($|_|[A-Z0-9])` (pytest's
`test_*` and unittest's `testFoo`), `$TITLE` the name and `$BODY` the
body, `bare` as in TypeScript. The same fixtures serve
`test-name-verifies-claim`.

- `test_empty_cart_total_is_zero` builds the two-item cart and expects 300.
- `test_remove_item_deletes_it` calls `get`.
- `test_add_item_raises_on_negative_qty` adds qty 2 and expects a value.
- `test_checkout_rejects_expired_card` expects `"paid"`.
- `test_warning_logged_when_over_limit` touches no logger.
- `test_reserve_reduces_quantity` calls `restock`.

Hard cleans: the right thing weakly asserted (`sorted_items()` then a
length; `is not None` after applying a coupon; `items[0] is not None`),
`test_total`, a synonym (`drop` for `remove`), a compound title, setup
before the named call, a bare call with no assertion, a camelCase
unittest method.

### Attempts

1. Matcher as above, `bare`. `gaps`: 22 matched, gap 0.24, suggest 0.81,
   `rewrite` (again the gaps verdict on a corpus that then separated).
   One attempt; the `test_total_ignores_free_items` fixture was rewritten
   for the sibling rule (see there) and re-run here, moving nothing.

### Fit

Fitted 0.79 (accepted run: cleans top 0.59 `test_items_are_sorted_by_price`,
0.52 the coupon tautology; defects 0.94-0.96). Precision 1.00, recall
1.00, tp 6 / fp 0 / fn 0. Flips 0. Max spread 0.07.

### Verdict

**SHIP.** 0.14 of headroom on each side; the three cleans nearest the
cutoff are exactly the sibling rule's defects, which is the split the two
rules exist for.

### What I would change

Nothing. A parametrised `@pytest.mark.parametrize` test is a
`function_definition` under a `decorated_definition` and is found; none is
in the corpus.

---

## test-name-verifies-claim

### Rule

`experiments/rule-candidates/python/test-name-verifies-claim/rule.yml`:

```yaml
id: test-name-verifies-claim
language: Python
kind: noul
subject: node
state: bare
# 0.68, fitted 2026-09-20 on this rule's own evals (22 subjects: 11
# defects, 11 cleans of which 7 hard, 3 passes), and it is thin. Cleans
# top out at 0.61 (`test_total_sums_item_prices`, whose cart comes from a
# `make_cart()` helper the bare state does not show, so the 300 it asserts
# cannot be checked against the setup) then 0.46; ten defects answer
# 0.87-0.97 and the eleventh, `assertIsNotNone(remaining)` under a title
# claiming the remaining quantity is returned, answers 0.75 with a spread
# of 0.14 (0.69-0.83). Midpoint of the gap; 0.07 of headroom on each side.
# `located` was measured too: it takes the helper-backed clean down to
# 0.27 but takes that same defect down to 0.53, level with the cleans, so
# `bare` is kept, as in the TypeScript variant. Expect pytest code that
# builds its inputs in fixtures and helpers to sit in the 0.5-0.65 band.
threshold: 0.68
axis: file
severity: warning
rule:
  all:
    - kind: function_definition
    # pytest collects `test_*`; unittest collects `test*` methods.
    - has:
        field: name
        pattern: $TITLE
        regex: "^test($|_|[A-Z0-9])"
    - has:
        field: body
        pattern: $BODY
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

### Corpus

The same 22 subjects: 11 bad, 11 clean, 7 hard.

- The six wrong-thing tests above, which also establish nothing about their titles.
- `test_items_are_sorted_by_price` checks only the length.
- `test_checkout_charges_the_card` asserts nothing.
- `test_coupon_applies_to_every_item` asserts `cart is not None`.
- `test_cheapest_item_is_first` asserts `items[0] is not None`.
- `test_reserve_returns_remaining` asserts `assertIsNotNone(remaining)`.

Hard cleans: `test_total` (exact total), `< 300` under a title claiming
only a reduction, a compound title with an exact count, setup before the
named call with an exact total, `pytest.raises`, `assertRaises`, a
`Mock` ledger with `assert_called_once_with` under a title that claims
the interaction.

### Attempts

1. `bare`, sentence verbatim. `gaps`: 22 matched, gap 0.33, suggest 0.72,
   `works`. Eval: cleans top 0.61 `test_total_ignores_free_items` and 0.56
   `test_total_sums_item_prices`; defects from 0.77. The first clean was
   my fault: a "free" item at price 0 contributes 0 whether or not it is
   ignored, so the assertion could not fail -- the model was right. The
   fixture became `test_total_ignores_gift_items` with a 500-cent item
   flagged `gift=True`, so the total is 800 if the claim is broken.
2. `located`, to see whether showing `make_cart()` moves the helper-backed
   clean: it does (0.56 to 0.27), and it also takes the
   `assertIsNotNone(remaining)` defect from 0.75 to 0.53, level with the
   cleans. No separating cutoff. Reverted.
3. `bare` with the fixed fixture: cleans top 0.61 `test_total_sums_item_prices`
   (the helper-backed clean: under `bare` the model cannot check 300
   against a cart it does not see), 0.46 the gift test; defects from 0.75
   (0.69-0.83) then 0.87-0.97.

### Fit

Fitted 0.68 (accepted run: cleans top 0.65 [0.61 0.68 0.66], defects from
0.78 [0.75 0.81 0.77]). Precision 1.00, recall 1.00, tp 11 / fp 0 / fn 0
on the means. Flips 1 (the helper-backed clean crosses 0.68 on one pass).
Max spread 0.14 (attempt 3), 0.07 (accepted).

### Verdict

**COOKBOOK.** It separates on the means, but 0.03-0.07 of headroom and a
clean that crosses the cutoff on one pass is a decision inside the wobble
band. The cause is structural: pytest builds inputs in helpers and
fixtures, and `bare` sends only the test; `located` fixes that clean and
loses a defect. A rule for pytest needs the fixture text without the
whole file -- a state arm that follows a helper call, which does not
exist.

### What I would change

`state`: a `local`-like arm that includes module-level helpers and
`@pytest.fixture` functions the body calls. Until then, ship it at 0.68
with `severity: info` if at all, and expect helper-backed clean tests to
sit at 0.55-0.65.

---

## module-name-describes-contents

### Rule

`experiments/rule-candidates/python/module-name-describes-contents/rule.yml`:

```yaml
id: module-name-describes-contents
language: Python
kind: noul
subject: file
# `full`, not the TypeScript variant's `graph`, and this was measured. On
# `graph` (9 subjects, 3 passes) the package `billing/__init__.py`, whose
# public items send email, answered 0.44-0.57 against `conftest.py` at
# 0.41-0.47: no cutoff. The outline already says "named by its directory,
# so its subject is: billing" and lists the senders, so the graph is not
# missing anything; the source is what moved the answer. With it, the same
# package answers 0.67-0.69 and conftest 0.22-0.26. `full` costs the state
# budget sooner on a large module; the outline that is the subject is
# capped regardless.
state: full
# 0.46, fitted 2026-09-20 on this rule's own evals (9 modules: 4 defects, 5
# cleans of which 4 hard, 3 passes). Cleans top out at 0.29
# (`sessions/__init__.py`, named by its directory) then 0.24 (`conftest.py`,
# pytest's fixed name); defects start at 0.63 (`user_repository` holding
# order, cart and invoice lookups) and 0.68 (the `billing` package above).
# Midpoint of the gap, 0.17 of headroom on each side, no decision flips.
# The accepted run has the `billing` package at 0.52-0.76 across passes
# (mean 0.64): the widest spread in this pack, and its low pass clears the
# cutoff by 0.06, so on a package whose __init__ misnames its contents
# expect a `--retry 3` to matter.
threshold: 0.46
axis: file
severity: info
rule:
  kind: module
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

### Corpus

9 modules under `fixtures/`: 4 bad, 5 clean, 4 hard. `subject: file`,
matcher `kind: module`. Two package `__init__.py` files check that
`moduleIdentity` names them by their directory -- it does, and the outline
says so ("this file is named by its directory, so its subject is:
billing"). The Python outline renders classes with their methods indented
beneath them, so the spec's caveat about Python classes did not bite here.

- `utils.py`: four coupon/discount functions under a placeholder name.
- `user_repository.py`: user, order, cart and invoice lookups.
- `shipping.py`: sales-tax rates and lines; nothing ships.
- `billing/__init__.py`: welcome and password-reset email senders.

Hard cleans: `models.py` (dataclasses), `cli.py`, `sessions/__init__.py`
(named by its directory, re-exporting session items), `conftest.py`
(pytest's fixed name), `session_store.py`.

### Attempts

1. `graph`, as TypeScript. `gaps`: 9 matched, gap 0.20, `rewrite`. Eval:
   `billing/__init__.py` 0.44-0.57 against `conftest.py` 0.41-0.47 and
   `user_repository` 0.60-0.69; no cutoff. The outline was inspected
   (rendered directly with `renderOutline`): it carries the directory
   name and the senders' signatures, so the state was not missing the
   evidence; the model weighed it weakly.
2. `full` (outline plus source): `billing` 0.67-0.69, `user_repository`
   0.62-0.65, `conftest` 0.22-0.26, `sessions/__init__` 0.26-0.34. Kept.

### Fit

Fitted 0.46 (accepted run: cleans top 0.26 `conftest`, 0.23
`sessions/__init__`; defects `user_repository` 0.65, `billing` 0.64
[0.76 0.65 0.52], `shipping` 0.83, `utils` 0.90). Precision 1.00, recall
1.00, tp 4 / fp 0 / fn 0. Flips 0. Max spread 0.24 (`billing`).

### Verdict

**SHIP** on `full`, `severity: info` as in TypeScript. 0.17-0.20 of
headroom on the means, no flips; the `billing` package's spread is the
widest in this pack and its lowest pass clears the cutoff by 0.06, which
the rule's comment says.

### What I would change

`state: full` is a drift from the TypeScript variant's `graph` (state is
not part of the loader's drift check, but it is a difference). It costs
the state budget sooner on a large module. Measured, not chosen; the
reason is in the rule.

---

## idempotent-name

### Rule

`experiments/rule-candidates/python/idempotent-name/rule.yml`:

```yaml
id: idempotent-name
language: Python
kind: noul
subject: node
state: located
# 0.68, fitted 2026-09-20 on this rule's own evals (16 subjects: 6 defects,
# 10 cleans of which 9 hard, 3 passes). Cleans top out at 0.48
# (`setup_workdir`: mkdir with exist_ok, then a write_text that overwrites
# a lock file with the same pid) then 0.28 (an ALTER TABLE behind a
# user_version guard); defects answer 0.88-0.95 (a plain INSERT on a keyed
# table, os.mkdir without exist_ok, CREATE TABLE without IF NOT EXISTS, two
# appends, and logging's addHandler on every call). Midpoint of the gap,
# 0.20 of headroom on each side, no decision flips, max spread 0.06.
threshold: 0.68
axis: file
rule:
  all:
    - kind: function_definition
    - has:
        field: name
        pattern: $NAME
        regex: ^(ensure|upsert|setup|install|register)(_|$)
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

16 subjects in `fixtures/idempotent.py` (sqlite setup, logging setup,
signal handlers, a `Service` with plugins and listeners): 6 bad, 10 clean,
9 hard. Regex `^(ensure|upsert|setup|install|register)(_|$)` on the
`function_definition` name; `located` as TypeScript.

- `ensure_table`: `CREATE TABLE` without `IF NOT EXISTS`.
- `register_handler`: appends to a module list.
- `setup_logging`: `addHandler(StreamHandler())` on every call.
- `upsert_user`: a plain `INSERT` on a keyed table.
- `ensure_dir`: `os.mkdir` without `exist_ok`.
- `Service.register_listener`: appends.

Hard cleans: two `IF NOT EXISTS`, an append behind a membership check,
`signal.signal` (assigns), `ON CONFLICT DO UPDATE`, `makedirs(exist_ok=True)`,
`ensure_int` (pure conversion), a flag guard, a keyed write after a log
line, `mkdir(exist_ok=True)` plus a `write_text` that overwrites the same
file, an `ALTER TABLE` behind a `user_version` guard.

### Attempts

1. One attempt. `gaps`: 16 matched, gap 0.48, suggest 0.65, `works`.

### Fit

Fitted 0.68 (accepted run: cleans top 0.51 `setup_workdir`, 0.28 the
migration guard; defects 0.88-0.95). Precision 1.00, recall 1.00, tp 6 /
fp 0 / fn 0. Flips 0. Max spread 0.06.

### Verdict

**SHIP.** 0.17-0.20 of headroom. Python's own idempotency classic --
`logging.addHandler` on every `setup_logging` -- answers 0.90.

### What I would change

Nothing.

---

## pure-name-is-pure

### Rule

`experiments/rule-candidates/python/pure-name-is-pure/rule.yml`:

```yaml
id: pure-name-is-pure
language: Python
kind: noul
subject: node
state: local
# 0.58, fitted 2026-09-20 on this rule's own evals (17 subjects: 6 defects,
# 11 cleans of which 8 hard, 3 passes). Cleans top out at 0.30
# (`parse_args`, which builds an argparse parser and parses the argv it was
# handed) and every other clean answers 0.03-0.04; defects answer 0.85-0.97
# (a file read in a compute_, a clock default in a to_, a log line in a
# format_, a cache write in a derive_, a counter and an argument mutated).
# Midpoint of the gap, 0.27 of headroom on each side, no decision flips,
# max spread 0.03.
threshold: 0.58
axis: file
severity: info
rule:
  all:
    - kind: function_definition
    - has:
        field: name
        pattern: $NAME
        regex: ^(compute|calculate|derive|format|to|parse)(_|$)
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
```

### Corpus

17 subjects in `fixtures/pure.py`: 6 bad, 11 clean, 8 hard. Regex
`^(compute|calculate|derive|format|to|parse)(_|$)` -- `to_dict`, `to_rows`
match; `total`, `tokenize` do not. `local` as TypeScript.

- `calculate_shipping` assigns `order.shipping_cents`.
- `compute_digest` reads the file at `path`.
- `derive_key` stores the key in a module-level cache.
- `format_receipt` logs.
- `format_row` increments `counters["rows"]`.
- `to_timestamp` returns `time.time()` when the value is None.

Hard cleans: `to_dict` reading `self`, a module-level rate table, a local
accumulator, a `hashlib` hasher, a copied-then-updated dict, a fallback
to a module constant, `sorted()` on the argument, a local list,
`parse_int` raising, `parse_args` building an argparse parser over the
argv it was given.

### Attempts

1. One attempt. `gaps`: 17 matched, gap 0.57, suggest 0.60, `works`.

### Fit

Fitted 0.58 (accepted run: cleans top 0.32 `parse_args`, every other
clean 0.03-0.04; defects 0.85-0.97). Precision 1.00, recall 1.00, tp 6 /
fp 0 / fn 0. Flips 0. Max spread 0.03.

### Verdict

**SHIP.** The widest gap in this pack; the note's "obtaining a dependency
is not an effect" clause carries over to `hashlib` and `argparse` without
edit.

### What I would change

The corpus has no `@property` or `@functools.cache`-decorated
computation; a cached `compute_*` is exactly the memoisation the note
calls an effect, and would be worth one labelled case.

---

## safe-name-is-safe

### Rule

`experiments/rule-candidates/python/safe-name-is-safe/rule.yml`:

```yaml
id: safe-name-is-safe
language: Python
kind: noul
subject: node
state: local
# 0.59, fitted 2026-09-20 on this rule's own evals (15 subjects: 6 defects,
# 9 cleans of which 6 hard, 3 passes). Cleans top out at 0.47 (`try_lock`,
# which turns every OSError from the open into False and closes the fd
# outside the try) then 0.30 (`first_or_default`, which cannot fail);
# defects start at 0.71 (`safe_load_json`, whose read_text sits outside the
# try) and 0.82 (`port_or_default`, an int() outside any try), the rest
# 0.90-0.95. Midpoint of the gap, 0.12 of headroom on each side, no
# decision flips, max spread 0.10 (the try_lock clean).
threshold: 0.59
axis: file
rule:
  all:
    - kind: function_definition
    - has:
        field: name
        pattern: $NAME
        regex: ^(safe|try)(_|$)|_or_(none|default)$
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
note: "A throw on a programmer error -- an argument of the wrong type, a misuse
  of the function's own API -- is not the failure such a name promises to absorb
  and does not count. Logging before returning the fallback is fine. The failure
  that counts is the one the name and the parameters are about: parsing, lookup,
  I/O, connection, conversion."
```

### Corpus

15 subjects in `fixtures/safe.py`: 6 bad, 9 clean, 6 hard. Regex
`^(safe|try)(_|$)|_or_(none|default)$`; `local`.

- `safe_load_json`: `path.read_text()` outside the try.
- `try_parse_int`: the except re-raises a new `ValueError`.
- `get_user_or_none`: a missing row answered with `KeyError`.
- `safe_divide`: zero answered with a raise.
- `port_or_default`: `int(raw)` outside any try.
- `try_connect`: the except throws `ConnectionError`.

Hard cleans: a log line before `return None`, `except (TypeError,
ValueError)`, a read and a decode both inside one try, `try_lock` (every
`OSError` from the open becomes False; the `os.close` sits outside the
try), `safe_get` that cannot fail, `except OSError` in `safe_remove`, a
`TypeError` on a programmer error, `next(iter(items), default)`.

### Attempts

1. `gaps`: 15 matched, gap 0.43, suggest 0.50, `works`. Eval: `try_lock`
   at 0.67 -- I had written it catching `FileExistsError` only, so a
   missing parent directory escaped as `FileNotFoundError`, and the model
   was right that an I/O failure escaping a `try_` is the named failure.
   The fixture was changed to `except OSError` (a fixture fix; the reason
   is in `expect.yml`). `safe_load_json` at 0.64-0.72 is the quietest
   defect.
2. Same rule, fixed fixture: `try_lock` 0.41-0.51.

### Fit

Fitted 0.59 (accepted run: cleans top 0.47 `try_lock`, 0.30
`first_or_default`; defects from 0.71 `safe_load_json`, 0.82
`port_or_default`, then 0.90-0.95). Precision 1.00, recall 1.00, tp 6 /
fp 0 / fn 0. Flips 0. Max spread 0.10.

### Verdict

**SHIP.** 0.12 of headroom on each side. `try_lock` stays the clean to
watch: the `os.close` after the try reads to the model as an unguarded
call, and a `try_*` that does anything after its try will sit near 0.5.

### What I would change

Add a `try_*` that returns a `(ok, value)` tuple and one whose fallback
itself can fail (the criteria name it; the corpus does not have it).

---

## log-level-matches-event

### Rule

`experiments/rule-candidates/python/log-level-matches-event/rule.yml`:

```yaml
id: log-level-matches-event
language: Python
kind: noul
subject: node
state: local
# 0.60, fitted 2026-09-20 on this rule's own evals (16 subjects: 6 defects,
# 10 cleans of which 5 hard, 3 passes). Cleans top out at 0.44 (`info` for
# a refused login, the expected business rejection the criteria name) then
# 0.23 (`error` for a failed notify the function recovers from by queueing);
# defects start at 0.76 (`warning` followed by sys.exit) and 0.79 (`debug`
# for a declined payment; `debug` where the fetch gives up), up to 0.90.
# Midpoint of the gap, 0.16 of headroom on each side, no decision flips,
# max spread 0.05. `$LOGGER` matches `self.log` and the `logging` module
# as well as a bare `logger`.
threshold: 0.60
axis: file
rule:
  any:
    - pattern: $LOGGER.$LEVEL($MSG, $$$REST)
    - pattern: $LOGGER.$LEVEL($MSG)
constraints:
  # `logging.exception` logs at ERROR with the traceback; `critical` is
  # Python's `fatal`.
  LEVEL:
    regex: ^(debug|info|warn|warning|error|exception|critical|fatal)$
  LOGGER:
    regex: (?i)(log|console)
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
```

### Corpus

16 subjects in `fixtures/worker.py` (a fetch-and-cache worker with a CLI
`main`): 6 bad, 10 clean, 5 hard. Patterns `$LOGGER.$LEVEL($MSG, $$$REST)`
and `$LOGGER.$LEVEL($MSG)`, `LEVEL` constrained to Python's levels
(`exception` and `critical` added to the TypeScript list; `trace` and
`verbose` dropped, since Python has neither), `LOGGER` to `(?i)(log|console)`.
`$LOGGER` matches `self.log` and the `logging` module as well as `logger`.

- `self.log.error("cache miss")` on a routine miss.
- `logger.info("failed to connect")` then `raise`.
- `logger.debug("giving up ... discarded")` where the fetch gives up.
- `logger.debug("payment declined")` then `return "declined"`.
- `logger.critical("processed %d of %d")` on the success path.
- `logger.warning("config missing, exiting")` then `sys.exit(1)`.

Hard cleans: `warning` on a retried attempt, `info` on a refused login,
`warning` on a slow batch, `error` on a failed notify the function queues
for retry, `logger.exception` before a re-raise, `error` for a usage
error in `main`.

### Attempts

1. One attempt. `gaps`: 16 matched, gap 0.34, suggest 0.59, `works`.

### Fit

Fitted 0.60 (accepted run: cleans top 0.46 the refused login, 0.23 the
recovered notify; defects from 0.76 the warn-then-exit, 0.79 x2, up to
0.90). Precision 1.00, recall 1.00, tp 6 / fp 0 / fn 0. Flips 0. Max
spread 0.05.

### Verdict

**SHIP.** 0.14-0.16 of headroom; the criteria's "info for expected
business rejections" clause is doing the work on the top clean.

### What I would change

`print(..., file=sys.stderr)` is not a logger call and is not matched;
CLI code that logs that way is invisible to this rule. That is a
deliberate scope, not a gap.

---

## tests-cover-failure-paths

### Rule

`experiments/rule-candidates/python/tests-cover-failure-paths/rule.yml`:

```yaml
id: tests-cover-failure-paths
language: Python
kind: noul
subject: node
state: paired
# 0.52, fitted 2026-09-20 on this rule's own evals (12 subjects over two
# paired modules, `cart.py` / `test_cart.py` and `env.py` / `test_env.py`:
# 4 defects, 8 cleans of which 6 hard, 3 passes). Cleans top out at 0.40
# (`parse_sku`, whose raise is reached only through `add_item`'s test) then
# 0.19; defects start at 0.65 (`apply_coupon`, which returns None for an
# unknown code and is tested with SAVE10 only; 0.58-0.69 across passes) and
# the three raises never tripped answer 0.89-0.92. Midpoint of the gap,
# 0.12 of headroom on each side, no decision flips, max spread 0.11.
# The `test_` prefix pairs `test_cart.py` with `cart.py` (the runner splits
# a test file's name on `_`); a helper defined in a test file matches the
# matcher and is dropped as unpaired, which the run reports as one subject.
threshold: 0.52
axis: file
rule:
  all:
    - kind: function_definition
    # Module-level, directly or under a decorator; a leading underscore is
    # Python's "not exported".
    - inside:
        any:
          - kind: module
          - kind: decorated_definition
            inside: { kind: module }
    - has:
        field: name
        pattern: $NAME
        regex: ^[^_]
    # A test is not a function under test; without this every `test_*` in
    # the test files matches and is dropped as unpaired.
    - not:
        has:
          field: name
          regex: ^test_
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
```

### Corpus

12 subjects over two paired modules, `fixtures/cart.py` /
`fixtures/test_cart.py` and `fixtures/env.py` / `fixtures/test_env.py`: 4
bad, 8 clean, 6 hard. Matcher: a module-level `function_definition`
(directly under `module`, or under a `decorated_definition` that is)
whose name does not start with `_` and does not start with `test_`.
`--show-subjects` confirmed the pairing: both source files were asked
(the `test_` prefix pairs, `names("test_cart.py")` includes `cart`), and
the one subject dropped as unpaired is `make_cart`, a helper defined in
the test file, which the matcher finds and the runner rightly has no
tests for.

- `remove_item` raises `KeyError`; the only test removes a present sku.
- `apply_coupon` returns None for an unknown code; tested with SAVE10 only.
- `checkout`: the expired-card raise is reached, the empty-cart `Receipt(ok=False)` is not.
- `require` raises `KeyError`; every test sets the variable.

Hard cleans: `parse_sku` reached through `add_item`'s test, `total`
(cannot fail), `discount_for` (a default is a fallback), `truncate_sku`
whose guard is tripped under a title about display width, `read_flag`
(fallback), `read_config` (only callees raise).

### Attempts

1. Matcher without the `test_` exclusion: 18 test functions matched and
   were dropped as unpaired, a noisy line on every run. Excluded by
   `not: {has: {field: name, regex: ^test_}}` (Rust's regex has no
   lookahead). `gaps`: 12 matched, gap 0.27, suggest 0.77, `works`.

### Fit

Fitted 0.52 (accepted run: cleans top 0.38 `parse_sku`, 0.19; defects
from 0.67 `apply_coupon` [0.65 0.69 0.67], then 0.89-0.92). Precision
1.00, recall 1.00, tp 4 / fp 0 / fn 0. Flips 0. Max spread 0.11 (first
run, `apply_coupon` 0.58-0.69).

### Verdict

**SHIP**, narrowly: 0.12-0.14 of headroom on the means, 0.06 on the
weakest pass of the quietest defect. Twelve subjects is above the bar and
not far above it.

### What I would change

More modules. A `@pytest.fixture`-driven test file and a test that
reaches a guard through `pytest.raises(match=...)` are both absent.

---


## Tooling

Nothing in `src/` blocked a rule. Observations, none of them a defect I
could reproduce as one:

- **`gaps` verdict vs. eval fit.** `fn-name-promises` (gap 0.20) and
  `test-name-describes-code` (gap 0.24) were reported `rewrite` by
  `gaps`, and each then separated on `eval --repeat 3` with 0.10-0.15 of
  headroom and no flips. The verdict's width threshold reads as stricter
  than the fit; the BRIEF says to act on `rewrite` by revisiting
  subject/state, and on both rules the eval said there was nothing to
  revisit. Worth a line in calibration.md: read `gap` and `head` before
  the verdict word.
- **`eval --dry-run` prints a plan once.** The first
  `eval <dir> --repeat 3 --dry-run` on a fresh directory printed
  "6 request(s), $0.00266"; the second printed "0 request(s), $0.00000".
  `last.json` after the dry run has `spent.calls: 0`, so nothing was
  asked either time; only the printed plan differs. Cosmetic.
- **Paired arm and test-file helpers.** `tests-cover-failure-paths`'
  matcher finds module-level functions in test files too (`make_cart`),
  and the runner drops them as unpaired with a count. Correct, but the
  line reads as a warning on every run. Excluding `test_*` names in the
  matcher removed 18 of the 19; the helper remains. The runner could
  skip subjects whose file `isTestFile` says is a test on the paired arm.
- **One node, one subject.** See the summary: a declaration matched by
  two arms with different captures yields one subject with the first
  arm's capture. For the comment rule that silently drops a docstring
  whenever a `#` line precedes the `def`. A subject identity that
  includes the capture would ask both; whether that is wanted is a
  design question, not a bug report.
- **Outline rendering.** `renderOutline` for Python lists methods
  indented under their class and marks `__init__.py` as named by its
  directory; the spec's note that Python classes might not render was
  checked and does not apply.

## Cost

240 requests, about 1.32M input tokens, **$0.056** in total, from the
tool's own per-run summaries (twelve `gaps` runs, twenty-nine
`eval --repeat 3` runs including the twelve `--accept` runs, one
`check` over 18 unseen subjects for `comment-describes-block`, and the
discarded `located` / `graph` attempts). The most expensive single run
was `var-name-describes-value`'s eval at $0.0027. Nothing was cached
(`--cache none` throughout) and no `.jev-lint.yaml` was read
(`--no-config`).
