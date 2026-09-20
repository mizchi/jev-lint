# Family M: doc-errors-match-body -- the failure contract of a doc comment

One rule, three grammars: `experiments/rule-candidates/{typescript,python,rust}/doc-errors-match-body/`.
The claim is a doc comment's **failure contract** -- what it says the
function throws, raises, rejects with, panics on, or returns in place of a
result, and when -- and the question is whether the body contradicts it.
This is the narrower cousin of `comment-describes-declaration`: only the
failure clauses are judged, because that is the half no tool checks.
clippy's `missing_errors_doc` / `missing_panics_doc` check that a `# Errors`
or `# Panics` section *exists*; eslint-plugin-jsdoc's `require-throws` and
darglint's `DAR401` check that a `@throws` / `Raises:` is *present* for a
throw; none of them can read "throws `NotFoundError` when no user has this
id" against a body that returns `null` there, or "`# Panics` if the ring is
empty" against an `unwrap_or(0)`, or "returns `ConfigError::Unset`" against
an `ok_or_else(|| ConfigError::Missing(..))`. That reading is the whole
rule, and it is what the model is measured to do well: a body contradicting
a contract it declares about itself. The matchers are the sibling rule's
(`$DOC` via `follows:` in TypeScript, the docstring as first statement in
Python, the `///` run walked with `stopBy` in Rust), each narrowed by a
regex so only documentation that makes a failure claim is a subject; `ask`,
`criteria` and `note` are one text in the three files, and the loader
reports 0 drift warnings with the three trees loaded together (`rules -R
experiments/rule-candidates/typescript -R experiments/rule-candidates/python
-R experiments/rule-candidates/rust --no-config`: 19 rules, 0 errors, 0
warnings).

Summary (accepted baselines, 3 passes each; headroom is the smaller of
cutoff minus top clean and lowest defect minus cutoff, on means):

| language | at | P / R | tp/fp/fn | flips | clean top / defect floor | headroom | subjects (bad / hard clean) | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript | 0.56 | 1.00 / 1.00 | 6/0/0 | 0 | 0.36 / 0.74 | 0.18 | 16 (6 / 8) | SHIP |
| python | 0.70 | 1.00 / 1.00 | 6/0/0 | 0 | 0.50 / 0.88 | 0.18 | 17 (6 / 7) | SHIP |
| rust | 0.54 | 1.00 / 1.00 | 6/0/0 | 0 | 0.38 / 0.67 | 0.13 | 18 (6 / 8) | SHIP |

The sentence took three attempts, and every attempt was a scoping decision
rather than a synonym: attempt 1 said "the documentation's failure
section", and a Rust doc that describes its fallback in the summary line
was read as an undocumented default; attempt 2 said "anywhere in its text"
and left an `expect` with no `# Panics` as a body-owned failure, which put
the one contentious case mid-scale (0.64, spread 0.11); attempt 3 says an
`unwrap`/`expect`/index counts only against a claim the documentation makes
("never panics", "returns an error if ..."), because whether the `expect`
is reachable is not visible in the subject and whether it deserves a
section is clippy's check. Attempt 3 is the one that separates in all three
grammars with no flips. The unseen pass (jev-lint's own `src/`, serde_json,
requests + filelock) found one real defect in filelock and one false
positive that needs API knowledge, and it also found that my Python regex
over-matched `:rtype:` -- three of five findings on requests were
docstrings with no failure claim at all, where the rule fell back to
"undocumented raise", darglint's territory. That is fixed in the matcher,
not the sentence, and the Python baseline was re-taken.

---

## typescript/doc-errors-match-body

### Rule

`experiments/rule-candidates/typescript/doc-errors-match-body/rule.yml`:

```yaml
# doc-errors-match-body: does the doc comment's failure contract match the body?
#
# The narrower cousin of comment-describes-declaration. Only the failure
# clauses are judged: what a JSDoc `@throws {Type} when ...`, `@returns null
# when ...`, or a prose "Throws if ..." / "Rejects when ..." says the function
# does when something goes wrong. eslint-plugin-jsdoc checks that `@throws`
# is well-formed, not that it is true; nothing checks the truth.
id: doc-errors-match-body
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
subject: node
# `located`: the comment sits outside the matched node, and a helper the
# body delegates its failure to (a `requireRow`, a schema) is in the file.
state: located
# 0.56, fitted 2026-09-20 on this rule's own evals (16 subjects: 6 defects,
# 10 cleans of which 8 hard, 3 passes; accepted baseline). Cleans top out at
# 0.36 (`peek`, plain undefined-on-miss) then 0.31 (`fetchProfileOrUndefined`,
# whose "any other failure rejects" covers a plain throw); defects start at
# 0.74 (`parseTtl`, an undocumented RangeError beside a documented undefined)
# then 0.82. Midpoint of the gap, 0.18 of headroom on each side, no decision
# flips, max spread 0.05. On 10 unseen subjects in jev-lint's own src/ the
# clean band topped at 0.27.
at: 0.56
axis: file
severity: warning
rule:
  any:
    # A comment directly above a function or method that makes a failure claim.
    - all:
        - any:
            - kind: function_declaration
            - kind: method_definition
        - follows: &failure_doc
            kind: comment
            regex: "(?i)@throws|@return|throws|rejects|null|undefined|panics|fails"
            pattern: $DOC
    # An exported function: the comment precedes the `export`.
    - all:
        - kind: function_declaration
        - inside:
            kind: export_statement
            follows: *failure_doc
    # A function-valued binding, exported or not: the comment precedes the
    # `const`, or the `export` around it.
    - all:
        - kind: variable_declarator
        - has:
            field: value
            any:
              - kind: arrow_function
              - kind: function_expression
        - inside:
            kind: lexical_declaration
            any:
              - follows: *failure_doc
              - inside:
                  kind: export_statement
                  follows: *failure_doc
ask: >-
  The failure contract stated in the documentation on this function -- what it
  says the function throws, raises, rejects with, panics on, or returns in
  place of a result when something goes wrong, and under what condition -- is
  contradicted by the body.
criteria:
  "true": >-
    The documentation names a failure the body cannot produce: it says the
    function throws or raises a named error and the body returns null, None,
    a default or a success value on that condition instead; it says the
    function panics on a condition and the body returns a value on that
    condition; it says an error is returned when something is missing or
    invalid and the body unwraps, expects or asserts there instead. Or the
    documentation names the wrong failure: a different error type, exception
    class or error variant than the body raises, or a different condition
    than the one the body actually checks before failing. Or the body
    explicitly fails on its own -- a throw, raise, panic!, bail, assert,
    explicit error return, or a null, None or default returned in place of a
    result -- under a condition the documentation says nothing about anywhere
    in its text. Or the documentation says the function never throws, never
    panics or never fails and the body has a throw, a panic, an unwrap, an
    expect, an assert, or an index that can be out of range.
  "false": >-
    Every failure the documentation names is one the body produces under the
    condition named, and every explicit failure the body writes is covered
    somewhere in the documentation, whether under a heading such as Raises,
    Errors or Panics, in a Returns clause, or in the summary sentence. A
    failure described at the level of intent ("when the record does not
    exist", "if the response is an error status") is honoured by whatever
    mechanism the body uses to produce it: a lookup helper named for that
    failure, a raise_for_status, a `?` on the call the documentation is
    about, a catch that converts one error into the documented one. A
    documented panic that the body reaches through expect, unwrap, an index or
    an assert on the documented condition is honoured. Documentation that says
    the function never throws, never panics or never fails over a body with
    no failure path of its own is honoured. A documented error that the body
    obtains by delegating to a named schema, parser, validator or argument
    parser is honoured by that call. A fallback the documentation describes
    -- a default when the file is absent, None when the row is missing -- is
    a documented outcome, not a failure path, wherever in the text it is
    described. An unwrap, expect or index in a body whose documentation makes
    no claim about panicking is not a contradiction here; whether it deserves
    a Panics section is a linter's check, not this rule's.
note: >-
  Only the failure clauses are judged -- what the documentation says the
  function throws, raises, rejects with, panics on, or returns instead of a
  result, and when. Whether the rest of the documentation is accurate is a
  different question. The failures that count as the body's own are the ones
  it writes explicitly: a throw, raise, panic!, bail, assert, explicit Err, or
  a null, None or default returned where a result was expected. An unwrap,
  expect or index counts only against a claim the documentation makes: that
  the function never panics, or that it returns an error on the very
  condition the unwrap fails on. An error that merely passes through
  unchanged from a callee -- a `?`, an awaited call, an un-caught call to a
  library function -- is the callee's failure, not a clause this body owes,
  unless the documentation says the function cannot fail. A helper whose
  name states what it fails with (require_row, must_exist, get_or_raise, a
  parser or schema named in the clause) is assumed to fail that way, whether
  or not its body is in view.
```

### Corpus

16 subjects found by the matcher in `fixtures/users.ts` (fetch + zod
service, 8) and `fixtures/cache.ts` (fs-backed cache, 8); 6 bad, 10 clean
of which 8 hard. Nothing unintended matched: constructors and undocumented
helpers are not subjects. `$DOC` is the whole JSDoc block.

Bad:

- `users.ts:35 loadUser` -- `@throws {NotFoundError} when no user has this id`; the body returns `null` there.
- `users.ts:53 findUser` -- "returns null when there is none with this id"; the body throws `NotFoundError` there.
- `users.ts:94 promote` -- `@throws` names only `NotFoundError`; the body also throws when the user is already an admin.
- `users.ts:116 removeUser` -- `@throws {RangeError}` on an empty id; the body throws `TypeError`.
- `cache.ts:28 FileCache.get` -- "throws CacheMissError if expired; never-written yields null"; the body does the reverse (throws on never-written, null on expired).
- `cache.ts:88 parseTtl` -- `@returns undefined when the string is not a duration`; the body also throws `RangeError` on a zero count.

Hard cleans: `parseUser` (`@throws {ZodError}` delegated to the schema by
name), `fetchProfile` (`TimeoutError` produced by a catch that converts the
AbortSignal timeout; everything else rethrows), `fetchProfileOrUndefined`
("any other failure rejects" covering a plain `throw`), `FileCache.set`
("never throws" over a try whose catch only logs), `FileCache.require`
(intent-level condition served by `peek`'s undefined), `FileCache.raw`
(wrapper whose only failure is `readFileSync`'s, the documented callee),
`loadManifest` (`SyntaxError` is `JSON.parse`'s), `sweep` ("never throws"
is true while the rest of the comment is wrong -- it counts rather than
removes -- which is the sibling rule's finding, not this one's).

### Attempts

| # | change | gaps verdict | gap | head | eval at 0.7 (P/R) | fitted | clean top / defect floor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | sentence v1: "the documentation's failure section says nothing about" | works | 0.38 | +0.26 | 1.00 / 1.00 | 0.63 | 0.44 / 0.82 |
| 2 | sentence v2: "anywhere in its text"; a described fallback is a documented outcome | works | 0.39 | +0.27 | 1.00 / 1.00 | 0.61 | 0.44 / 0.79 |
| 3 | sentence v3: unwrap/expect/index count only against a claim the doc makes | works | 0.44 | +0.36 | 1.00 / 1.00 | 0.56 | 0.37 / 0.75 |

TypeScript separated from the first attempt; attempts 2 and 3 were made
for Rust and applied here because the sentence is shared. Each one widened
the gap slightly (the hard cleans moved down, the defects did not move).

### Fit

Accepted baseline at `at: 0.56` (attempt 3): precision 1.00, recall 1.00,
tp/fp/fn 6/0/0, 0 decision flips across 3 passes, max spread 0.05. Clean
top 0.36 (`peek`), then 0.31, 0.29, 0.28 (the three fetch/JSON.parse hard
cleans); defect floor 0.74 (`parseTtl`), then 0.82 (`promote`). Headroom
0.18 on the defect side and 0.20 on the clean side. Unseen: 10 subjects in
jev-lint's own `src/` (`@returns`/`null` in JSDoc over the config loader,
the gate, the rule loader): 0 findings, clean band topped at 0.27.

### Verdict

SHIP -- separates with 0.18 of headroom, no flips, on a corpus whose cleans
include the schema delegation, the converted timeout and the wrapper over a
throwing callee, and the unseen band sits under the corpus band.

### What I would change

The regex keeps `@return` because the brief lists it, but `@returns` alone
(no `null`/`undefined`/`throws` word) matches documentation that makes no
failure claim, which is the Python `:rtype:` hole in another spelling; on
`src/` it cost nothing (0 findings) but on a JSDoc-heavy codebase I would
expect it to surface "throws, and no @throws" findings that belong to
eslint-plugin-jsdoc's `require-throws`. Dropping `@return` from the regex
loses only `@returns null when ...` docs that spell it without the word
`null`, which is none. A criteria clause saying "a doc with no failure
clause at all makes no contract here" would close the hole for every
grammar at once; it is a fourth sentence attempt and was not made.

---

## python/doc-errors-match-body

### Rule

`experiments/rule-candidates/python/doc-errors-match-body/rule.yml`:

```yaml
# doc-errors-match-body: does the docstring's failure contract match the body?
#
# The narrower cousin of comment-describes-declaration. Only the failure
# clauses are judged: what a Google-style `Raises:` / `Returns:` section or a
# Sphinx `:raises X:` field says the function does when something goes wrong.
id: doc-errors-match-body
language: Python
kind: noul
subject: node
# `located`: the docstring is inside the node, but a helper the body
# delegates its failure to (`_require_row`, a validator) is in the file.
state: located
# 0.70, fitted 2026-09-20 on this rule's own evals (17 subjects: 6 defects,
# 11 cleans of which 7 hard, 3 passes; accepted baseline). Cleans top out at
# 0.50 (`main`, whose "1 if the API call failed" is served by an except
# RequestException while argparse's SystemExit passes through) then 0.30;
# defects start at 0.88 (`start`, an undocumented Conflict beside a
# documented NotFound) then 0.92. Just above the midpoint of the gap, 0.18 of
# headroom on the defect side and 0.20 on the clean side, no decision flips,
# max spread 0.05. On 7 unseen subjects in requests and filelock: one real
# defect at 0.93 and one false positive at 0.79 (`raise_on_not_writable_file`,
# which raises PermissionError under a `:raises OSError:` clause -- that the
# one is the other is API knowledge).
at: 0.70
axis: file
severity: warning
rule:
  all:
    - kind: function_definition
    - has: { field: name, pattern: $NAME }
    # The docstring: the first statement of the body, a bare string, and
    # only one that has a failure section. `:rtype:` is deliberately not in
    # the list: on requests it matched docstrings that make no failure claim,
    # and the rule then reported every undocumented raise under them, which
    # is darglint's missing-Raises check and not this rule's question.
    - has:
        field: body
        has:
          kind: expression_statement
          nthChild: 1
          has:
            kind: string
            pattern: $DOC
            regex: "Raises:|:raises |Returns:|:returns:"
ask: >-
  The failure contract stated in the documentation on this function -- what it
  says the function throws, raises, rejects with, panics on, or returns in
  place of a result when something goes wrong, and under what condition -- is
  contradicted by the body.
criteria:
  "true": >-
    The documentation names a failure the body cannot produce: it says the
    function throws or raises a named error and the body returns null, None,
    a default or a success value on that condition instead; it says the
    function panics on a condition and the body returns a value on that
    condition; it says an error is returned when something is missing or
    invalid and the body unwraps, expects or asserts there instead. Or the
    documentation names the wrong failure: a different error type, exception
    class or error variant than the body raises, or a different condition
    than the one the body actually checks before failing. Or the body
    explicitly fails on its own -- a throw, raise, panic!, bail, assert,
    explicit error return, or a null, None or default returned in place of a
    result -- under a condition the documentation says nothing about anywhere
    in its text. Or the documentation says the function never throws, never
    panics or never fails and the body has a throw, a panic, an unwrap, an
    expect, an assert, or an index that can be out of range.
  "false": >-
    Every failure the documentation names is one the body produces under the
    condition named, and every explicit failure the body writes is covered
    somewhere in the documentation, whether under a heading such as Raises,
    Errors or Panics, in a Returns clause, or in the summary sentence. A
    failure described at the level of intent ("when the record does not
    exist", "if the response is an error status") is honoured by whatever
    mechanism the body uses to produce it: a lookup helper named for that
    failure, a raise_for_status, a `?` on the call the documentation is
    about, a catch that converts one error into the documented one. A
    documented panic that the body reaches through expect, unwrap, an index or
    an assert on the documented condition is honoured. Documentation that says
    the function never throws, never panics or never fails over a body with
    no failure path of its own is honoured. A documented error that the body
    obtains by delegating to a named schema, parser, validator or argument
    parser is honoured by that call. A fallback the documentation describes
    -- a default when the file is absent, None when the row is missing -- is
    a documented outcome, not a failure path, wherever in the text it is
    described. An unwrap, expect or index in a body whose documentation makes
    no claim about panicking is not a contradiction here; whether it deserves
    a Panics section is a linter's check, not this rule's.
note: >-
  Only the failure clauses are judged -- what the documentation says the
  function throws, raises, rejects with, panics on, or returns instead of a
  result, and when. Whether the rest of the documentation is accurate is a
  different question. The failures that count as the body's own are the ones
  it writes explicitly: a throw, raise, panic!, bail, assert, explicit Err, or
  a null, None or default returned where a result was expected. An unwrap,
  expect or index counts only against a claim the documentation makes: that
  the function never panics, or that it returns an error on the very
  condition the unwrap fails on. An error that merely passes through
  unchanged from a callee -- a `?`, an awaited call, an un-caught call to a
  library function -- is the callee's failure, not a clause this body owes,
  unless the documentation says the function cannot fail. A helper whose
  name states what it fails with (require_row, must_exist, get_or_raise, a
  parser or schema named in the clause) is assumed to fail that way, whether
  or not its body is in view.
```

### Corpus

17 subjects in `fixtures/repo.py` (sqlite-backed `JobRepo`, 8) and
`fixtures/client.py` (requests + argparse CLI, 9); 6 bad, 11 clean of which
7 hard. `_require_row` and `__init__` have no docstring and are not
subjects. `$DOC` is the docstring; `$NAME` the function.

Bad:

- `repo.py:55 by_name` -- `Raises: NotFound` when no job has the name; the body returns `None`.
- `repo.py:79 start` -- `Raises:` names only `NotFound`; the body also raises `Conflict` when the job is not queued.
- `repo.py:118 count` -- `Returns: ... or None if the state is unknown`; the body raises `ValueError` there.
- `client.py:43 submit` -- `Raises: requests.Timeout`; the body catches `Timeout` and returns `-1`.
- `client.py:83 read_config` -- `Raises: FileNotFoundError`; the body catches it and returns `{}`.
- `client.py:111 port_from` -- `Raises: ValueError` if not an integer in range; the body raises `TypeError` for the range half.

Hard cleans: `JobRepo.get` (`NotFound` raised by `_require_row`, a helper
named for it), `find` (`OperationalError` is sqlite's own, passing through
`execute`), `rename` (`NotFound` via `self.get`), `fetch_job`
(`HTTPError` via `raise_for_status`, `Timeout` via the `timeout=` argument),
`parse_args` (`SystemExit` delegated to argparse), `load_token` ("never
raises" over an `except OSError`), `main` ("1 if the API call failed" served
by `except RequestException` while argparse's `SystemExit` passes through).

### Attempts

| # | change | gaps verdict | gap | head | eval at 0.7 (P/R) | fitted | clean top / defect floor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | sentence v1 | works | 0.30 | +0.11 | 1.00 / 1.00 | 0.72 | 0.53 / 0.90 |
| 2 | sentence v2 | works | 0.39 | +0.18 | 1.00 / 1.00 | 0.71 | 0.52 / 0.90 |
| 3 | sentence v3 | works | 0.43 | +0.25 | 1.00 / 1.00 | 0.70 | 0.51 / 0.88 |
| 3 + matcher | `:rtype:` dropped from the docstring regex after the unseen pass (fixtures unaffected: 17 subjects before and after) | -- | -- | -- | 1.00 / 1.00 | 0.69 | 0.50 / 0.88 |

`main` is the clean that sits highest in every attempt (0.53 → 0.50): its
"1 if the API call failed" is a Returns clause about failure, and the body
has an uncaught `parse_args` beside the caught `RequestException`. The
note's "an error that passes through unchanged from a callee is the
callee's failure" is what keeps it under the cutoff; it is the case that
would fire first on a corpus without it.

### Fit

Accepted baseline at `at: 0.70` (attempt 3, regex trimmed): precision 1.00,
recall 1.00, tp/fp/fn 6/0/0, 0 decision flips across 3 passes, max spread
0.05. Clean top 0.50 (`main`), then 0.30 (`fetch_job`, `fetch_job_or_none`);
defect floor 0.88 (`start`), then 0.92. Headroom 0.18 on the defect side,
0.20 on the clean side. Unseen, after the regex trim: 7 subjects in
requests (`adapters.py`, `api.py`, `auth.py`, `sessions.py`, `models.py`)
and filelock -- 2 findings. `filelock/_windows.py:27 _is_reparse_point`
at 0.93 is real: `:raises OSError: If GetFileAttributesW fails for reasons
other than file-not-found`, and the body's "Some other error - let caller
handle it" branch returns `False`. `filelock/_util.py:10
raise_on_not_writable_file` at 0.79 is a false positive: `:raises OSError:
as if the file was opened for writing`, and the body raises
`PermissionError` / `IsADirectoryError` (both `OSError`s) and swallows the
`os.stat` failure on a missing file (which opening for writing would create)
-- both facts are API knowledge the model is measured to lack. Before the
trim the same set gave 38 subjects and 5 findings, three of them (0.70,
0.80, 0.75) under docstrings whose only matching text was `:rtype:`.

### Verdict

SHIP -- separates with 0.18 of headroom and no flips; one real defect and
one API-knowledge false positive on 7 unseen subjects, which is the
one-in-five-is-wrong rate the skill already states for findings.

### What I would change

`raise_on_not_writable_file` is the shape of the next false positive: a
Sphinx `:raises Base:` honoured by subclasses. A note clause "an exception
class documented as a base is honoured by any of its subclasses" would
help where the subclass is spelled `PermissionError` under `OSError`, but
that the one is the other is knowledge, not text, so I would not expect it
to fix this case; I would add it to the corpus as a labelled clean and
expect the rule not to find it, as `var-name-describes-value` records for
`setTimeout`.

---

## rust/doc-errors-match-body

### Rule

`experiments/rule-candidates/rust/doc-errors-match-body/rule.yml`:

```yaml
# doc-errors-match-body: does the doc comment's failure contract match the body?
#
# The narrower cousin of comment-describes-declaration. Only the failure
# clauses are judged: what a rustdoc `# Errors` or `# Panics` section says the
# function does when something goes wrong. clippy's `missing_errors_doc` and
# `missing_panics_doc` check that the section exists, not that it is true.
id: doc-errors-match-body
language: Rust
kind: noul
subject: node
# `located`: the doc comment sits outside the matched node, and a helper the
# body delegates its failure to is in the file.
state: located
# 0.54, fitted 2026-09-20 on this rule's own evals (18 subjects: 6 defects,
# 12 cleans of which 8 hard, 3 passes; accepted baseline). Cleans top out at
# 0.38 (`save`, an `expect` under a doc that makes no panic claim;
# `parse_workers`, one clause served by `?` and `bail!`) then 0.36; defects
# start at 0.67 (`parse_line`, "never panics" over `parts[1]`) then 0.84.
# Midpoint of the gap, 0.13 of headroom on the defect side and 0.16 on the
# clean side, no decision flips, max spread 0.07. On 12 unseen subjects in
# serde_json the clean band topped at 0.26.
at: 0.54
axis: file
severity: warning
rule:
  all:
    - kind: function_item
    # A `///` run is one `line_comment` per line, so the heading may be
    # several siblings above the function; walk the run (and any attribute
    # between it and the function) and capture the line that carries the
    # heading. `//` comments are `line_comment` too and are walked over.
    - follows:
        kind: line_comment
        regex: "(?i)# errors|# panics|never panics|never fails"
        pattern: $DOC
        stopBy:
          not:
            any:
              - kind: line_comment
              - kind: attribute_item
ask: >-
  The failure contract stated in the documentation on this function -- what it
  says the function throws, raises, rejects with, panics on, or returns in
  place of a result when something goes wrong, and under what condition -- is
  contradicted by the body.
criteria:
  "true": >-
    The documentation names a failure the body cannot produce: it says the
    function throws or raises a named error and the body returns null, None,
    a default or a success value on that condition instead; it says the
    function panics on a condition and the body returns a value on that
    condition; it says an error is returned when something is missing or
    invalid and the body unwraps, expects or asserts there instead. Or the
    documentation names the wrong failure: a different error type, exception
    class or error variant than the body raises, or a different condition
    than the one the body actually checks before failing. Or the body
    explicitly fails on its own -- a throw, raise, panic!, bail, assert,
    explicit error return, or a null, None or default returned in place of a
    result -- under a condition the documentation says nothing about anywhere
    in its text. Or the documentation says the function never throws, never
    panics or never fails and the body has a throw, a panic, an unwrap, an
    expect, an assert, or an index that can be out of range.
  "false": >-
    Every failure the documentation names is one the body produces under the
    condition named, and every explicit failure the body writes is covered
    somewhere in the documentation, whether under a heading such as Raises,
    Errors or Panics, in a Returns clause, or in the summary sentence. A
    failure described at the level of intent ("when the record does not
    exist", "if the response is an error status") is honoured by whatever
    mechanism the body uses to produce it: a lookup helper named for that
    failure, a raise_for_status, a `?` on the call the documentation is
    about, a catch that converts one error into the documented one. A
    documented panic that the body reaches through expect, unwrap, an index or
    an assert on the documented condition is honoured. Documentation that says
    the function never throws, never panics or never fails over a body with
    no failure path of its own is honoured. A documented error that the body
    obtains by delegating to a named schema, parser, validator or argument
    parser is honoured by that call. A fallback the documentation describes
    -- a default when the file is absent, None when the row is missing -- is
    a documented outcome, not a failure path, wherever in the text it is
    described. An unwrap, expect or index in a body whose documentation makes
    no claim about panicking is not a contradiction here; whether it deserves
    a Panics section is a linter's check, not this rule's.
note: >-
  Only the failure clauses are judged -- what the documentation says the
  function throws, raises, rejects with, panics on, or returns instead of a
  result, and when. Whether the rest of the documentation is accurate is a
  different question. The failures that count as the body's own are the ones
  it writes explicitly: a throw, raise, panic!, bail, assert, explicit Err, or
  a null, None or default returned where a result was expected. An unwrap,
  expect or index counts only against a claim the documentation makes: that
  the function never panics, or that it returns an error on the very
  condition the unwrap fails on. An error that merely passes through
  unchanged from a callee -- a `?`, an awaited call, an un-caught call to a
  library function -- is the callee's failure, not a clause this body owes,
  unless the documentation says the function cannot fail. A helper whose
  name states what it fails with (require_row, must_exist, get_or_raise, a
  parser or schema named in the clause) is assumed to fail that way, whether
  or not its body is in view.
```

### Corpus

18 subjects in `fixtures/config.rs` (std::fs + toml + serde + anyhow config
loader, 7) and `fixtures/buffer.rs` (a bounded ring with `Result` and
panic contracts, 11); 6 bad, 12 clean of which 8 hard. The first matcher
draft used a case-sensitive regex and missed "Never panics." / "Never
fails." on two subjects; `(?i)` fixed it, at no cost. `$DOC` is the one
`line_comment` that carries the heading, a pointer into the run the model
reads from the file.

Bad:

- `buffer.rs:36 last` -- `# Panics` if the ring is empty; `unwrap_or(0)` returns 0 instead.
- `buffer.rs:60 push` -- `# Errors` returns `CapacityError` if full; the body evicts the oldest and returns `Ok`.
- `buffer.rs:106 parse_line` -- "Never panics."; `parts[1]` indexes past the end when the line has no `=`.
- `config.rs:48 load_strict` -- `# Errors` returns `ConfigError::Missing` if the file does not exist; the body panics there through `unwrap_or_else(panic!)`.
- `config.rs:77 env_value` -- `# Errors` returns `ConfigError::Unset`; the body builds `ConfigError::Missing`.
- `config.rs:103 validate` -- `# Errors` names only a zero port; the body also bails on an empty name.

Hard cleans: `Ring::new` (`# Panics` on an `assert!` with the documented
condition), `first` (`# Panics` on an `expect` with the documented
condition), `mean` (assert), `split_at` (the documented panic is the
callee's, with the callee's condition; no panic visible in the body),
`load` (both documented errors through `?` with context), `load_or_default`
(NotFound absorbed into the default as the summary says; other read errors
and parse errors returned as the section says), `parse_workers` (one
clause served by `?` and `bail!`), `save` (an `expect` on an infallible
serialisation under a doc that makes no panic claim -- see Attempts).

### Attempts

| # | change | gaps verdict | gap | head | eval at 0.7 (P/R) | fitted | clean top / defect floor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | sentence v1: "the documentation's failure section says nothing about"; `save` labelled clean | rewrite | 0.22 | +0.04 | 0.83 / 0.83 | 0.83, "no separating cutoff" | 0.77 (`save`) / 0.66 (`parse_line`) |
| 2 | sentence v2: "anywhere in its text"; a described fallback is a documented outcome; `save` relabelled bad | rewrite | 0.14 | +0.09 | 1.00 / 0.86 | 0.55 | 0.46 / 0.64 (`save`, spread 0.11) |
| 3 | sentence v3: unwrap/expect/index count only against a claim the doc makes; `save` back to clean | works | 0.26 | +0.12 | 1.00 / 0.83 | 0.54 | 0.40 / 0.68 |

Attempt 1 failed on two cases. `load_or_default` (clean) scored 0.68: its
fallback to defaults is described in the summary line, not under
`# Errors`, and the note listed "a default returned in place of a result"
as a body-owned failure, so the model read a default the doc's *section*
does not mention -- a wording defect in the criteria, fixed in attempt 2
(0.68 → 0.42). `save` (labelled clean: `expect` on a serialisation of a
struct of `&str`, `u16`, `Option<usize>`) scored 0.77: the note also listed
`expect` as a body-owned failure, and the doc has no `# Panics`, so the
model was right *under the rule as written* and my label contradicted my
own criteria. Attempt 2 relabelled it bad; it then scored 0.64 with the
widest spread in the family (0.11) -- mid-scale, the signature of a
question the subject cannot answer, because whether that `expect` is
reachable is not in the file. "Is there an `expect` with no `# Panics`" is
also exactly `clippy::missing_panics_doc`, a parser check the rule should
not re-ask. Attempt 3 scopes it: an `unwrap`, `expect` or index counts only
against a claim the doc makes -- "never panics", or "returns an error" on
the very condition it fails on -- and `save` is a hard clean again at 0.38.
The two defects that live on that same edge are unaffected: `load_strict`
(doc says an error is returned; body panics) stayed at 0.91–0.94 through
every attempt, and `parse_line` ("never panics" over an index) rose from
0.66 to 0.68 and is the defect floor.

### Fit

Accepted baseline at `at: 0.54` (attempt 3): precision 1.00, recall 1.00,
tp/fp/fn 6/0/0, 0 decision flips across 3 passes, max spread 0.07. Clean
top 0.38 (`save`, `parse_workers`), then 0.36 (`load_or_default`), 0.34
(`split_at`); defect floor 0.67 (`parse_line`), then 0.84. Headroom 0.13 on
the defect side and 0.16 on the clean side. Unseen: 12 subjects in
serde_json 1.0.133 (`# Errors` / `# Panics` sections in `de.rs`, `ser.rs`,
`raw.rs`, `value/mod.rs`): 0 findings, clean band topped at 0.26; 3 of the
12 fell back from `located` to `local` on the state budget (`de.rs` is
large) and still answered under 0.20.

### Verdict

SHIP -- separates with 0.13 of headroom and no flips after the scoping in
attempt 3, and the corpus carries the cases that pin the rule: the callee's
panic, the two-mechanism clause, the summary-line fallback, the
infallible `expect`.

### What I would change

The defect floor is `parse_line` at 0.67, a "never panics" over
`splitn(2, '=')` followed by `parts[1]`; that the index can be out of range
takes a small inference the model makes only at 0.67. A corpus of "never
panics" claims over indexing would tell whether that is this case or the
class; if the class sits there, the headroom on the defect side is 0.13 and
not more. `$DOC` captures the heading line only; capturing the immediately
preceding line as well (`$LAST`, usually the condition) is cheap and might
sharpen the "wrong condition" cases, but `env_value` and `validate` are
already at 0.84–0.85 so it was not tried.

---

## Tooling

- `jev-lint check <dir>` skips symlinked files when walking a directory:
  `check /Users/mz/brew/lib/python3.14/site-packages/pip/_vendor/requests
  -R ... --dry-run --show-subjects` printed `0 subject(s)` on a directory
  whose every `.py` is a symlink into the Cellar, while `check <that
  dir>/models.py` (the symlink, by path) found 1 subject. Worked around by
  copying with `cp -L` into the scratchpad. Not a blocker; recorded because
  a Homebrew site-packages is a plausible unseen corpus.
- `gaps --dry-run` prints `0 request(s), $0.00000` where `check --dry-run`
  on the same paths prints the real plan (2 requests, ~$0.0009); the paid
  `gaps` then made 2 requests. Priced via `check --dry-run` instead.
- The Rust `///` run is one `line_comment` per line; `follows:` with
  `stopBy: { not: { any: [line_comment, attribute_item] } }` walks it and
  steps over a `#[must_use]` between the doc and the item. Verified on a
  probe with ast-grep; a function with no doc directly after a documented
  one is not matched (the preceding `function_item` stops the walk).

## Cost

From the tool's own summaries. Every paid run was priced with `--dry-run`
first (`check --dry-run` for gaps, `eval --dry-run` for evals); no single
run exceeded $0.005.

| stage | requests | input tokens | usd |
| --- | --- | --- | --- |
| gaps, attempt 1 (3 languages) | 6 | ~57k (gaps prints no token count; from price) | 0.0024 |
| eval --repeat 3, attempt 1 | 18 | 169,608 | 0.0071 |
| gaps, attempt 2 | 6 | ~62k | 0.0026 |
| eval --repeat 3, attempt 2 | 18 | 184,602 | 0.0078 |
| gaps, attempt 3 | 6 | ~66k | 0.0028 |
| eval --repeat 3, attempt 3 | 18 | 197,301 | 0.0083 |
| eval --repeat 3 --accept (3 languages) | 18 | 197,301 | 0.0083 |
| unseen: src/ (TS), serde_json (Rust), requests+filelock (Python, 38 subjects) | 19 | 173,526 | 0.0073 |
| python: eval --repeat 3 --accept after the regex trim | 6 | 68,964 | 0.0029 |
| python: unseen again (7 subjects) | 6 | 33,123 | 0.0014 |
| **total** | **121** | **~1.21M** | **$0.051** |
