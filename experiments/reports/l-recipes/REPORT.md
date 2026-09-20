# Family L: four cookbook recipes, measured

Four recipes from `skills/jev-lint/references/cookbook.md` that shipped as
YAML with `at: 0.7` and no corpus behind them -- recipe 3 (a type's name
versus its shape), recipe 9 (an error message versus the condition that
raises it), recipe 7 (a TODO above work already done) and recipe 8 (a
catch that swallows a failure the caller needed). Each is a claim the code
makes about itself: a type name, an error string, a TODO, a function's
name and return type. A type checker sees the members and never the name;
a linter can count TODOs, find an empty catch or grep a throw, and cannot
read any of them against the code they sit in. Jev reads the claim against
the body and, on these corpora, separates every defect class from the hard
cleans -- the branded primitive, the `Props` type, the generic message on a
generic guard, the test double, the TODO above a stub, the cleanup catch,
the CLI `main` that exits 1 -- with 0.16-0.23 of headroom on each side and
no decision flips across three passes.

Candidates: `experiments/rule-candidates/typescript/{type-name-describes-shape,
error-message-matches-condition,todo-describes-work,catch-hides-failure}/`,
each with `rule.yml`, `fixtures/`, `expect.yml` and an accepted
`baseline.json`. Every attempt's `eval --repeat 3` record is in
`records/<id>-attempt<n>.json`; `records/<id>-accepted.json` is the run
the baseline was taken from. The per-subject tables below are from those
records (mean of three passes, then the three passes).

Tooling first, because it shaped one rule.

## Tooling

**Twins under `subject: enclosing` swallow the copied-message class.**
`src/cache.ts` `verdictKey` keys a promoted subject on `(rule, arm, group,
enclosing text, match text)`. Two `throw new ValidationError("invalid
email")` in one function are byte-identical matches inside one enclosing
text, so the second is never asked and takes the first one's verdict
(`src/run.ts:455`, "One verdict answers for every subject that shared its
key"). The copied message is the defect class recipe 9 exists for, and it
is exactly the case where the match text is identical. Evidence, attempt 1
of `error-message-matches-condition` (`records/error-message-matches-condition-attempt1.json`):

```
0.89 clean http_client.ts:27  [0.86 0.89 0.91]   "API_KEY is not set" for !apiKey
0.89 bad   http_client.ts:31  [0.86 0.89 0.91]   "API_KEY is not set" for !baseUrl (copied)
0.79 clean accounts.ts:22     [0.78 0.82 0.76]   "invalid email" for the email pattern
0.79 bad   accounts.ts:25     [0.78 0.82 0.76]   "invalid email" for password.length (copied)
0.78 bad   accounts.ts:47     [0.77 0.78 0.79]   "session expired" for !session
0.78 clean accounts.ts:50     [0.77 0.78 0.79]   "session expired" for expiresAt < now
0.67 clean accounts.ts:12     [0.69 0.65 0.68]   "account not found" for !target
0.67 bad   accounts.ts:15     [0.69 0.65 0.68]   "account not found" for the role check
```

Four pairs, each pair identical to the hundredth across all three passes.
The command: `source ~/.profile && node --experimental-strip-types
src/cli.ts eval experiments/rule-candidates/typescript/error-message-matches-condition
--repeat 3 --no-config --cache none`, rule as in attempt 1 (matcher
`kind: throw_statement` with the `new $TYPE($MESSAGE)` capture). The fix
this report does not make: put the match's byte range, or its line, in
the key of a promoted subject. The fix this report does make is in the
matcher, below: match the guarding `if` together with its throw, so the
condition is in the match text.

**`gaps` prints no per-subject answers**, so every band in this report is
read from `eval`'s `last.json` (which `eval` writes beside the rule, whether
or not the run is accepted), through a fifteen-line script that joins
`passes[]` with `expect.yml`. `gaps` was still run once per rule, as the
brief asks; its verdicts are in each rule's Attempts.

**`expect.yml` and a promoted subject.** The brief says a `subject:
enclosing` rule reports at the top of the function; it does not any more
(`src/state.ts` `resolveSubject`: "The finding is reported where the MATCH
is"). Every label here is `window: 0` at the match's first line -- the
`if` line for the message rule, the statement's line for the TODO rule,
the `catch` line for the catch rule -- and all of them resolved.

---

## type-name-describes-shape

**Rule** (`experiments/rule-candidates/typescript/type-name-describes-shape/rule.yml`)

```yaml
# --------------------------------------------------------------------------
# Does a type's name describe the shape it declares?
# --------------------------------------------------------------------------
#
# Cookbook recipe 3, the naming pack at the type level. A type name is a
# claim about its members the way a binding name is a claim about its value
# (var-name-describes-value): `UserId` says an identifier, `Config` says
# settings, `Users` says several. A type checker sees the members and never
# the name; a linter can enforce casing and nothing else.
#
# The matcher is every interface and type alias, over-matched on purpose:
# `Props`, a branded primitive, a `Partial<T>` alias and a one-word helper
# type are all subjects, and the criteria are what say they are not
# mismatches.
id: type-name-describes-shape
languages: [ TypeScript, Tsx ]
kind: noul
subject: node
# `located`, as the recipe says: whether `Config` misdescribes its members is
# sometimes only visible where the type is constructed or consumed, and the
# type's own text is short, so the file is cheap here.
state: located
# Fitted 2026-09-20 on 23 subjects (6 defects, 17 cleans, 12 of them hard),
# three passes. The recipe's sentence found three of the six: UserId-is-a-
# session 0.81, isHealthy-as-string 0.78, ErrorHandler-is-a-record 0.73;
# Config-that-is-a-report 0.53, ParseResult-that-is-a-flag 0.39 and
# Users-for-one-user 0.33 sat inside the wobble. The ask now says the type
# is judged against how the file builds and uses it, and the true branch
# names those three as classes (a settings type a function fills with
# results; a result type that is only a success flag; a plural on a type
# handled one at a time) -- they answer 0.77, 0.72 and 0.65. The cleans
# never moved: the branded primitive, the Partial alias, Props, Ctx, Row,
# Timestamps, a recursive Json, a Result union, Maybe<T>, an interface of
# methods and a ReturnType alias all sit at 0.06-0.20 in every attempt.
# Midpoint 0.42: 0.22 over the highest clean, 0.19 under the lowest pass of
# the weakest defect (Users, 0.61-0.72). The recall on defect classes the
# criteria do not name is not measured here; the clean band is the number
# to trust. See experiments/reports/l-recipes/REPORT.md.
at: 0.42
severity: warning
rule:
  all:
    - any:
        - kind: interface_declaration
        - kind: type_alias_declaration
    - has: { field: name, pattern: $NAME }
ask: >-
  This type's name ($NAME) misdescribes the shape it declares, judged
  against its members and against how the file builds and uses values of
  the type.
criteria:
  "true": >-
    The name states a thing, unit, cardinality or role that the members do
    not match: a singular name for a collection type, or a plural name for a
    type whose members are one item and whose values the file handles one at
    a time; a name naming one concept while the members and the code that
    builds or consumes the type describe another, such as an identifier type
    whose members are a session, or a settings or configuration type that a
    function fills with results; a name that says the type is a result,
    output or product when the type is only a success flag and the product
    goes elsewhere; a name that says the type is a function, handler or
    callback when the members are a data record; or a member whose declared
    type contradicts the unit or kind its own name states, such as a
    boolean-named member declared as a string or a count declared as a
    boolean.
  "false": >-
    The members are what the name says they are. A name that is generic,
    abbreviated, terse, or could be more specific is not a mismatch; nor is a
    conventional name such as Props, Ctx, Row or Options; a branded primitive
    that carries the name of what it identifies; an alias built from another
    type by Partial, Pick, Omit or Readonly and named for that type; or a
    plural name on a map or record keyed by the things it names.
```

**Corpus**: 23 subjects found / 6 bad / 17 clean (12 labelled hard), in
`fixtures/session.ts`, `lint_report.ts`, `customers.ts`, `core.ts`.

- `session.ts:6` `UserId` -- named an identifier; the members are a session
  (sessionToken, issuedAt, expiresAt) and `issue()` builds one.
- `lint_report.ts:3` `Config` -- named settings; the members are a lint
  run's output (errors, warnings, filesChecked, durationMs), `lint()`
  returns one, and `LintOptions` beside it is the real config.
- `lint_report.ts:18` `ErrorHandler` -- named a function that handles
  errors; the members are an error record and `classify()` returns it as
  data.
- `lint_report.ts:26` `ParseResult = boolean` -- named the product of a
  parse; it is a success flag and `parseFlags` writes the product into an
  out-parameter.
- `customers.ts:1` `Users` -- plural; the members are one user and
  `findUser` returns `Users | null`.
- `customers.ts:7` `HealthReport.isHealthy: string` -- a boolean-named
  member declared as a string; `probe()` stores ok/degraded/down in it.

Hard cleans: a branded `AccountId`, `SessionPatch = Partial<Session>`,
`Ctx`, `Row`, `Props`, `Timestamps` (a mixin of two), `Errors =
Record<string, string[]>`, a recursive `Json`, a `Result<T, E>` union,
`Maybe<T>`, a `Repository<T>` interface of methods, `Order =
ReturnType<typeof parseOrder>`.

**Attempts**

1. Recipe 3 as written, `subject: node`, `state: located`
   (`records/type-name-describes-shape-attempt1.json`). `gaps`: `rewrite`,
   gap 0.23, head +0.17, median 0.13. Eval at 0.7: P 1.00 R 0.50, fitted
   0.26, 0 flips. UserId 0.81, isHealthy 0.78, ErrorHandler 0.73; Config
   0.53, ParseResult 0.39, Users 0.33. Cleans 0.05-0.20. Three defects
   inside the wobble, so 0.26 would have been a coin flip.
2. Ask says the type is judged "against its members and against how the
   file builds and uses values of the type"; the true branch names the
   three weak classes in general terms (a plural on a type handled one at a
   time; a settings type a function fills with results; a result type that
   is only a success flag). Fitted 0.44, P 1.00 R 0.83 at 0.7 (Users
   0.68), 0 flips. Config 0.76, ParseResult 0.72, Users 0.68; cleans
   unchanged, 0.05-0.20.
3. Corpus only: `core.ts` adds five harder cleans (Json, Result, Maybe,
   Repository, a ReturnType alias), wording unchanged. All five 0.05-0.10.
   Fitted 0.42; bad 0.65-0.86, clean 0.06-0.20.

**Fit** (accepted run): `at: 0.42`; precision 1.00, recall 1.00, tp 6 fp
0 fn 0; 0 flips across the three passes; max pass-to-pass spread 0.05
(Timestamps 0.14-0.19); bad 0.66-0.86, clean 0.05-0.20; headroom 0.21
over the highest clean, 0.22 under the lowest defect (Users, lowest pass
0.64).

**Verdict**: SHIP -- separates with 0.22 of headroom on each side and no
flips, and the twelve hard cleans (every one the brief names, plus five
generic/derived shapes) never rose above 0.20 under any wording. The
caveat is on the recall side: attempt 2 named the three weak defect
classes, so a defect class the criteria do not describe is unmeasured; the
clean band, which is what predicts false positives on real code, was the
same in all three attempts.

**What I would change**: run it on an unseen repository before promoting
-- the clean band is the number this corpus can only bound from above --
and consider a Rust twin (`struct_item` / `enum_item`) since the sentence
is grammar-free.

---

## error-message-matches-condition

**Rule** (`experiments/rule-candidates/typescript/error-message-matches-condition/rule.yml`)

```yaml
# --------------------------------------------------------------------------
# Does an error's message describe the condition that raises it?
# --------------------------------------------------------------------------
#
# Cookbook recipe 9. A wrong error message is a false claim that survives
# every test that only checks that something threw: "user not found" thrown
# from a role check sends the reader of the log to the wrong place. The
# message is the claim; the guard around the throw is the evidence.
#
# The sibling assertion-message-matches matches only `if (COND) throw` and
# assert shapes, so the condition is captured beside the message. This rule
# matches every throw with a message and lets `subject: enclosing` supply
# whatever condition the function has -- an if, a switch arm, a status
# comparison two lines up, or none at all for a rethrow. Its report
# (experiments/reports/improve-assertion-message-matches) found the one
# class a message rule flags wrongly on real code: a test double that throws
# a scripted failure, whose message names the failure being simulated and
# whose condition only picks when to simulate it. The mock-factory callbacks
# are excluded by structure here as they are there; a fake class's method
# still matches and the criteria say what it is.
id: error-message-matches-condition
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
# The function around the throw is the subject: the condition is there,
# and so is any sibling throw whose message this one may have been copied
# from. `local` adds nothing to that and the file would only add cost.
subject: enclosing
state: local
# Fitted 2026-09-20 on 19 subjects (5 defects, 14 cleans, 9 of them hard),
# three passes. With the throw alone as the match (attempt 1) the copied-
# message pairs were twins -- one verdict for both throws -- and the fit
# was P 0.57 R 0.80. With the guard in the match (attempt 2) the defects
# answer 0.84-0.98 and every clean but the fake gateway's scripted throw
# (0.77) sits under 0.35. Attempt 3 hands the Fake*/Mock*/Stub* classes to
# the matcher and describes the unnamed double by its shape (a sentinel
# compared in the condition, a real dependency's failure in the message):
# the inline object double answers 0.29. Bad 0.85-0.97, clean 0.05-0.42
# (the top clean is "API_KEY is not set" on the first of a copied pair,
# 0.39-0.46), no flips. Midpoint 0.63; 0.65 leaves 0.19 over the highest
# clean pass and 0.19 under the lowest defect pass. Not yet run on unseen
# code: the sibling assertion-message-matches found its false positives
# there, in test doubles, which is why the doubles are in this corpus.
# See experiments/reports/l-recipes/REPORT.md.
at: 0.65
severity: warning
rule:
  all:
    - any:
        # The guarding `if` and its throw as ONE match, so that two throws
        # with the same message in one function are two different matches.
        # Attempt 1 matched the throw alone: a promoted subject is keyed on
        # the enclosing text plus the match text, and `throw new
        # ValidationError("invalid email")` twice in one function is one key
        # -- the second copy was never asked and took the first one's
        # verdict (byte-identical triples across three passes, see the
        # report's Tooling note). The copied message is the defect class
        # this rule exists for, so the condition has to be in the match.
        - all:
            - kind: if_statement
            - has:
                field: consequence
                any:
                  - all:
                      - kind: throw_statement
                      - has: &thrown
                          kind: new_expression
                          any:
                            - pattern: new $TYPE($MESSAGE)
                            - pattern: new $TYPE($MESSAGE, $$$REST)
                  - all:
                      - kind: statement_block
                      - has:
                          kind: throw_statement
                          has: *thrown
        # A throw in an else block, keyed on the whole if/else.
        - all:
            - kind: if_statement
            - has:
                field: alternative
                kind: else_clause
                has:
                  kind: statement_block
                  has:
                    kind: throw_statement
                    has: *thrown
        # Every other throw -- a rethrow, a wrapper in a catch, a switch
        # default, a throw after a loop -- on its own.
        - all:
            - kind: throw_statement
            - has: *thrown
            - not:
                inside:
                  any:
                    - kind: if_statement
                    - all:
                        - kind: statement_block
                        - inside:
                            any:
                              - kind: if_statement
                              - kind: else_clause
    # A throw inside a mock factory's callback is a scripted failure, never
    # a claim about a condition. Excluded by structure, not by asking.
    - not:
        inside:
          stopBy: end
          any:
            - pattern: vi.fn($$$)
            - pattern: jest.fn($$$)
            - pattern: mock.fn($$$)
            - pattern: mock.method($$$)
            - pattern: sinon.stub($$$)
            - pattern: $X.mockImplementation($$$)
            - pattern: $X.mockImplementationOnce($$$)
    # A class that says it is a fake is a fake; its throws are scripted.
    # Attempt 2 measured the FakeGateway method at 0.77 under `local`, where
    # the class name is not in the state -- the parser can read it, so it
    # decides. A double that is not named one stays a subject and is the
    # criteria's to recognise.
    - not:
        inside:
          stopBy: end
          kind: class_declaration
          has:
            field: name
            regex: "^(Fake|Mock|Stub|Dummy|Spy)"
ask: >-
  The message given to this error ($MESSAGE) misdescribes the condition
  that leads to the throw.
criteria:
  "true": >-
    The message names a different cause, value, operation or expectation
    than the condition guarding the throw actually checks: it says a thing
    is missing when the check is about its permission, form or range; it
    names one field or operand when the condition tests another; it names one
    failure (a timeout, an expiry) when the status or state tested is a
    different one (a 404, an absence); it states a bound or direction the
    condition does not test; or it is a copy of another throw's message in
    the same function and describes that throw's condition rather than this
    one.
  "false": >-
    The message describes the condition that leads to the throw, whether it
    states the failed requirement, its consequence, or the intent the check
    serves. A message that is short, generic or lacks detail is not wrong,
    only unhelpful; a generic message on a generic guard is a match. A
    message that quotes the offending input, that names what cannot proceed
    rather than the value that failed, or that wraps a caught error with the
    name of the operation that failed, is a match. In a test file, a throw
    whose condition compares a call count, a route, an id or an amount with
    a fixed sentinel value and whose message names a failure of the real
    dependency is a test double simulating that failure: its message
    describes the scenario the test sets up, not the condition, and is a
    match.
note: >-
  Judge only the throw whose message is captured as MESSAGE -- matched together
  with the if that guards it, when one does -- against the
  condition or branch in the enclosing function that leads to it. Whether
  the check itself is correct, and whether the other throws in the function
  are right, is not the question. A throw with no condition -- a rethrow, a
  wrapper in a catch, an unconditional failure at the end of a function --
  is judged against the operation it reports.
```

**Corpus**: 19 subjects found / 5 bad / 14 clean (9 labelled hard), in
`fixtures/accounts.ts`, `http_client.ts`, `gateway.test.ts`. Two throws in
the fixtures are not subjects on purpose: the `vi.fn().mockImplementation`
throw and the `FakeGateway` method, both dropped by the matcher.

- `accounts.ts:14` "account not found" thrown from the role/ownership
  check, two lines after the real not-found guard.
- `accounts.ts:24` "invalid email" thrown from `password.length < 12`,
  copied from the throw above.
- `accounts.ts:46` "session expired" thrown for a session absent from the
  store; the next guard is the expiry check.
- `http_client.ts:15` "request timed out" thrown for `status === 404`.
- `http_client.ts:30` "API_KEY is not set" thrown for a missing
  `API_BASE_URL`, copied from the throw above.

Hard cleans: "verify your email before publishing" for `!emailVerified`
(intent, not operand); "forbidden" for an ownership guard; `unexpected
status ${res.status}` (quotes the input); `unknown command: ${name}`; a
wrapper in a catch with `{ cause }`; "migration failed" for `!ok`; and an
inline object double in a test throwing "gateway unavailable" when
`customerId === "c_down"`.

**Attempts**

1. Recipe 9 as written plus the sibling's mock-factory exclusion;
   `kind: throw_statement`, `subject: enclosing`, `state: local`
   (`records/error-message-matches-condition-attempt1.json`). `gaps`:
   `move`, gap 0.45, head +0.03, suggest 0.44. Eval at 0.7: P 0.57 R 0.80,
   fitted 0.67 "no separating cutoff", 0 flips. Every copied pair answered
   as one (the Tooling table above). Not a wording problem.
2. Matcher: the guarding `if_statement` and its throw are one match (a
   consequence arm, an else-block arm, and a bare-throw arm for rethrows,
   switch defaults and unconditional throws), `$MESSAGE` propagated from
   the nested `has:`. Wording unchanged. P 0.83 R 1.00 at 0.7, fitted
   0.81, 0 flips. Defects 0.84-0.98; the four formerly-twinned cleans fell
   to 0.12-0.35; the one false positive is the `FakeGateway.charge` throw
   at 0.77 (0.77 0.77 0.77) -- under `local` the class name is not in the
   state.
3. Matcher + criteria: a `not: inside: class_declaration` whose name
   matches `^(Fake|Mock|Stub|Dummy|Spy)`, and the false branch describes
   the unnamed double by its shape (a call count, route, id or amount
   compared with a fixed sentinel; a real dependency's failure in the
   message). A new inline-object double added as a subject. P 1.00 R 1.00
   at 0.7, fitted 0.63, 0 flips; the inline double 0.29; bad 0.85-0.97,
   clean 0.05-0.42.

**Fit** (accepted run): `at: 0.65`; precision 1.00, recall 1.00, tp 5 fp
0 fn 0; 0 flips; max spread 0.10 (`accounts.ts:21`, 0.17-0.27); bad
0.85-0.98, clean 0.05-0.34; headroom 0.29 over the highest clean pass
(0.36, "API_KEY is not set" on the first of the copied pair), 0.19 under
the lowest defect pass (0.84).

**Verdict**: SHIP -- separates with 0.19 of headroom and no flips, and
the corpus contains the class that broke the sibling on unseen code (test
doubles, one excluded by name, one recognised by shape at 0.29). Two
caveats: the copied-message class is reachable only because the matcher
carries the condition, which is a workaround for the twin key rather than
a design; and, as with the sibling, no unseen run yet.

**What I would change**: fix the twin key in `src/cache.ts` (byte range
or line of the match for a promoted subject) and then decide whether the
`if`-shaped matcher is still wanted -- it is arguably better anyway, since
the model is handed the condition as the match. Then an unseen run over a
repository with many test doubles.

---

## todo-describes-work

**Rule** (`experiments/rule-candidates/typescript/todo-describes-work/rule.yml`)

```yaml
# --------------------------------------------------------------------------
# Does a TODO describe work the code beneath it has already done?
# --------------------------------------------------------------------------
#
# Cookbook recipe 7, with the comment pack's matcher. A TODO is a claim that
# something is NOT done, and it is the comment least likely to be reread: the
# case gets handled, the check gets added, and the note asking for it
# survives. A linter can count TODOs and cannot read one.
#
# Recipe 7 matches the comment itself; here, as in comment-describes-block,
# the subject is the statement that FOLLOWS the comment, with the comment
# captured as `$DOC`, so the model is told which comment is under test and
# which code it sits above. `subject: enclosing` then hands over the whole
# function: a TODO above a guard is answered by the guard, but a TODO above
# a call is sometimes answered three lines further down.
id: todo-describes-work
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
subject: enclosing
# `bare`: the enclosing function is the subject already, and a TODO that
# is answered outside the function is one the criteria call not judgeable
# here. The file would add cost and let an unrelated edit move the verdict.
state: bare
# Fitted 2026-09-20 on 16 subjects (7 defects, 9 cleans, 8 of them hard),
# three passes. The recipe's sentence ("describes work the code already
# does") found the handled case, the done validation and the dedupe at
# 0.73-0.89 and missed the two that state a defect the code does not have
# -- unbounded retries 0.10, a leaked handle 0.28 -- until the ask named
# that class too (0.88 and 0.81 after). The one clean that fought the rule
# is the "also reject ..." TODO above a neighbouring check of a similar
# kind: 0.62-0.63 through two attempts, 0.28 once the note said two checks
# are the same work only when they test the same field, with the corpus's
# two pairs as the examples -- so that class's clearance is fitted, not
# measured. Bad 0.65-0.89, clean 0.05-0.28, no flips. Midpoint 0.47: 0.16
# over the highest clean pass, 0.16 under the lowest defect pass ("throws
# on an empty file" above a blank-text guard, 0.63-0.67). See
# experiments/reports/l-recipes/REPORT.md.
at: 0.47
severity: info
rule:
  all:
    - any:
        - kind: if_statement
        - kind: for_statement
        - kind: for_in_statement
        - kind: while_statement
        - kind: try_statement
        - kind: switch_statement
        - kind: return_statement
        - kind: expression_statement
        - kind: lexical_declaration
        - kind: throw_statement
        # A top-level TODO above an export has no enclosing function; the
        # subject falls back to the statement, and the criteria call a
        # TODO the statement cannot answer not judgeable here.
        - kind: export_statement
    - follows:
        kind: comment
        pattern: $DOC
        regex: "\\b(TODO|FIXME|XXX)\\b"
ask: >-
  The comment captured as DOC asks for work that the code beneath it
  already does, or describes a defect, leak or limitation that the code
  beneath it does not have.
criteria:
  "true": >-
    The comment asks for something -- handle a case, add a check, cap a
    loop, close or release something, remove duplicates, validate an input,
    fix a specific bug -- and the code beneath it in the same function
    visibly does exactly that: the case is handled, the check is there, the
    handle is closed on every path, the duplicates are removed. Or the
    comment states that the code has a defect, leak or limitation -- retries
    are unbounded, a handle leaks, a case crashes -- and the code beneath it
    visibly does not have it: the loop has a bound, the handle is closed in a
    finally, the case is guarded.
  "false": >-
    The work the comment asks for is not done in the code beneath it: the
    comment names a case, input, path or concern the code does not handle, a
    replacement or refactor the code has not had, a value that is still a
    placeholder or a default, or a step that belongs elsewhere. A comment
    that only cites an issue, ticket or person and states no work makes no
    claim to judge. A comment asking for an additional check ("also reject
    ...") is true until that check itself exists; a neighbouring check of a
    similar kind is not it. A comment about a concern the code beneath it is not
    about -- caching above a lookup, configuration above a constant -- is
    work not done, not work done.
note: >-
  The comment under test is the one captured as DOC; it may be several lines
  and all of it is the comment. The code beneath it is the run of statements
  from the comment to the end of the enclosing function, not the first
  statement alone. Other TODOs in the same function are not the question.
  A partial step is not the whole work: a guard that handles one of the two
  cases the comment names leaves the comment true. Two checks are the same
  work only when they test the same field or condition: a check on an
  expiry date is not a check on a campaign's end, a check on a negative
  quantity is not a check on a missing one, unless the code says the two
  are one.
```

**Corpus**: 16 subjects found / 7 bad / 9 clean (8 labelled hard, plus a
top-level TODO with no enclosing function), in `fixtures/checkout.ts`,
`uploads.ts`, `rows.ts`.

- `checkout.ts:9` "TODO: handle the empty cart" above the guard that
  returns an empty quote for it.
- `checkout.ts:24` "FIXME: retries are unbounded" above a loop bounded by
  `maxAttempts` whose last attempt rethrows.
- `checkout.ts:37` "TODO: dedupe items that appear in both carts" above a
  seen-set loop that does.
- `uploads.ts:13` "XXX: the file handle leaks when a row fails to parse"
  above an `open` whose close is in a `finally`.
- `uploads.ts:27` "TODO: validate the email before saving" above the
  regex guard that rejects it before `repo.save`.
- `rows.ts:5` "TODO: escape the sku before interpolating" above a return
  that passes it through `encodeURIComponent`.
- `rows.ts:10` "FIXME: this throws on an empty file" above a blank-text
  guard that returns `[]`.

Hard cleans: a stub `return 0` under "compute the real estimate"; "also
reject coupons whose campaign has ended" above an expiry check; "cache
these lookups" above the uncached lookup; `TODO(#412)`; "delay should be
exponential" above `sleep(500)`; "move these defaults into the config
file" above the inline default; "also flag rows whose qty is missing"
above unknown-sku and negative-qty checks; "remove this once every
importer sends qty" above the compatibility branch; and the top-level
"drop the legacy alias" above the alias.

**Attempts**

1. Recipe 7's sentence on the comment pack's matcher (statement `follows:`
   the comment, `$DOC` captured), `subject: enclosing`, `state: bare`
   (`records/todo-describes-work-attempt1.json`). `gaps`: `move`, gap
   0.32, head +0.09, suggest 0.45. Eval at 0.7: P 1.00 R 0.60, fitted 0.10
   "no separating cutoff", 1 flip. Handled-case 0.89, validation 0.86,
   dedupe 0.73; the two comments that state a defect the code does not
   have were missed outright -- unbounded retries 0.10, leaked handle
   0.28 -- and the "also reject campaign-ended" clean flipped across 0.7
   (0.74 0.66 0.47).
2. Ask names the second class ("or describes a defect, leak or limitation
   that the code beneath it does not have"); the true branch spells it
   out; the false branch says an "also ..." check is true until that check
   exists. P 1.00 R 1.00 at 0.7, fitted 0.70, 0 flips. Retries 0.88,
   handle 0.79; the partial clean unchanged at 0.63 (0.65 0.57 0.66) --
   0.07 from the lowest defect.
3. Note: "Two checks are the same work only when they test the same field
   or condition", with the corpus's two pairs (expiry / campaign end,
   negative / missing quantity) as its examples; `rows.ts` adds two
   defects and two cleans, one of them the second partial pair. Fitted
   0.47, P 1.00 R 0.86 at 0.7 (the new "throws on an empty file" at 0.65),
   0 flips. The campaign-end clean 0.28, the missing-qty clean 0.08.

**Fit** (accepted run): `at: 0.47`; precision 1.00, recall 1.00, tp 7 fp
0 fn 0; 0 flips; max spread 0.09 (the campaign-end clean, 0.27-0.36); bad
0.67-0.89, clean 0.05-0.33; headroom 0.11 over the highest clean pass
(0.36), 0.19 under the lowest defect pass (0.66).

**Verdict**: COOKBOOK -- it separates (0.34 between the bands, no flips)
and six of the seven defect classes are found at 0.78-0.89 under every
wording, but the one clean class that fought the rule, a neighbouring
check of a similar kind, only fell under the cutoff once the note named
its two corpus instances, so that class's clearance on unseen code is
fitted rather than measured; and nine cleans is a thin clean side for a
comment rule, whose false positives on real code are the whole cost.

**What I would change**: generalise the note's examples away (one more
sentence attempt, not taken: the brief's three were used) and re-measure
the partial-check class on cases the note does not describe; add the
preamble-style TODOs real code has ("TODO: this whole function should be
async") which are neither work done nor a claim, and a TODO in a test
callback, since `subject: enclosing` under `bare` hands a test-callback
statement over alone (the finding that moved `comment-describes-block` to
`located`).

---

## catch-hides-failure

**Rule** (`experiments/rule-candidates/typescript/catch-hides-failure/rule.yml`)

```yaml
# --------------------------------------------------------------------------
# Does a catch hide a failure the caller needed?
# --------------------------------------------------------------------------
#
# Cookbook recipe 8. Whether `return []` in a catch is a bug depends on what
# the function promised: `listInvoices(): Promise<Invoice[]>` that answers
# an outage with an empty list has told its caller the customer has no
# invoices. A linter can find an empty catch; it cannot say whether the
# function's name and return type admit a swallowed failure.
#
# The inverse of the shipped safe-name-is-safe: that rule fires when a
# `safe*` / `try*` / `*OrNull` / `*OrDefault` body lets a failure escape;
# this one fires when a body that made no such promise absorbs one. The
# name exclusion is in the MATCHER, not the note: a parser can decide
# whether the enclosing name says try*, and a subject the rule is not about
# should never be asked about. What the parser cannot decide -- a return
# type of `T | null`, a Result-like value, a cleanup catch, a CLI main that
# exits non-zero -- stays with the criteria.
id: catch-hides-failure
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
# The enclosing function is the answer: its name, its return type and what
# the catch returns are all in it. `local` rather than `located` for the
# reason recipe 8 gives -- the file would add cost and the chance that an
# unrelated edit moves the verdict.
subject: enclosing
state: local
# Fitted 2026-09-20 on 17 subjects (6 defects, 11 cleans, all of them the
# hard ones recipe 8 warns about), three passes. The recipe's sentence
# separated on the first run: defects 0.78-0.93 (only-logs 0.93, a made-up
# rate 0.92, [] for an outage 0.89, 0 for a broken count 0.86, an empty
# placeholder invoice 0.78), cleans 0.04-0.40 (rethrow, wrap, log-and-
# rethrow, Result, T | null, cleanup in a finally, next-source fallback,
# an error list the return carries, a CLI main that exits 1). The one
# clean added later that reached 0.57 was the idempotent delete that
# swallows ENOENT and rethrows the rest; the false branch now names that
# class (a catch that swallows only the case in which the operation's goal
# already holds) and it answers 0.18. The `try*` / `*OrDefault` functions
# in the corpus are not subjects: the matcher drops them. Bad 0.78-0.93,
# clean 0.04-0.32, no flips. Midpoint 0.55: 0.21 over the highest clean
# pass (readSettings falling back to defaults on ENOENT, 0.34), 0.23 under
# the lowest defect. See experiments/reports/l-recipes/REPORT.md.
at: 0.55
severity: warning
rule:
  all:
    - kind: catch_clause
    # A catch inside a function whose name declares that failure is absorbed
    # is safe-name-is-safe's subject, not this rule's. `stopBy: end` walks
    # every ancestor, so a catch in a callback inside `tryLoad` is excluded
    # with it -- accepted, since that callback's failure is tryLoad's to
    # absorb.
    - not:
        inside:
          stopBy: end
          any:
            - all:
                - kind: function_declaration
                - has: &absorbing_name
                    field: name
                    regex: "^(safe|try|maybe)([A-Z0-9_]|$)|(OrNull|OrDefault|OrUndefined|OrElse)$"
            - all:
                - kind: method_definition
                - has: *absorbing_name
            - all:
                - kind: variable_declarator
                - has: *absorbing_name
ask: >-
  This catch block hides a failure the function's caller needed to know
  about.
criteria:
  "true": >-
    The catch block neither rethrows, returns an error value the signature
    admits, nor reports through a channel the function is documented to use;
    it returns a default, an empty value, a made-up value or nothing, or only
    logs, and the function's name or return type promises a real result --
    a value that was fetched, parsed or computed, or an operation such as a
    save or a send that the caller will assume happened.
  "false": >-
    The failure is propagated -- rethrown, wrapped, or logged and then
    rethrown; converted into a value the caller can distinguish from success,
    such as a Result, an error entry the return value carries, or null or
    undefined when the return type admits it; or absorbed where absorbing is
    the point: a cleanup or best-effort step after the real result is
    already in hand, a catch whose only job is to fall back to the next
    attempt or the next source, a catch that swallows only the case in which
    the operation's goal already holds -- removing what is already gone,
    creating what already exists -- and rethrows everything else, or a
    top-level entry point that reports and exits with a non-zero status.
note: >-
  Only the catch captured as the match is judged, against the function it
  sits in. A function returning an optional (T | null | undefined) or a
  Result-like type has declared that it absorbs failure; a function whose
  return type is void and whose name is an operation (save, send, publish)
  has not -- its caller assumes the operation happened. A secondary failure
  -- removing a temporary file, closing a handle, flushing a metric -- that
  is swallowed after the function's real work has succeeded is not the
  failure the caller needed.
```

**Corpus**: 17 subjects found / 6 bad / 11 clean (all 11 labelled hard),
in `fixtures/billing.ts`, `export_cli.ts`. Two catches are not subjects
on purpose: `tryChargeCard` and `loadPlanOrDefault`, dropped by the
matcher's name exclusion (the report's answer to "matcher or note": the
`safe|try|maybe` / `OrNull|OrDefault|OrUndefined|OrElse` names are in the
**matcher**, as a `not: inside:` over the enclosing function, method or
arrow binding; the return-type conventions -- `T | null`, a Result -- stay
in the criteria and note, because a parser cannot read them reliably).

- `billing.ts:12` `listInvoices(): Promise<Invoice[]>` logs and returns
  `[]`; an outage reads as a customer with no invoices.
- `billing.ts:22` `fetchExchangeRate(): Promise<number>` returns `1`.
- `billing.ts:30` `recordPayment(): Promise<void>` only logs.
- `billing.ts:38` `parseInvoice(): Invoice` returns an empty placeholder.
- `export_cli.ts:63` `countPending(): Promise<number>` logs and returns 0.
- `export_cli.ts:90` `isUpstreamHealthy(): Promise<boolean>` returns
  `true` when the fetch fails.

Hard cleans: a Result-returning parser; `findInvoice(): Promise<Invoice |
null>` that returns null on 404 and rethrows the rest; a wrap-and-rethrow;
a log-and-rethrow; a cleanup catch inside a `finally`; `readSettings`
falling back to defaults on ENOENT only; a next-source fallback loop that
throws when every source fails; `prewarm` pushing failed keys into the
return value; an idempotent `removeArtifact` that swallows ENOENT;
`lastRunAt(): Date | undefined`; and a CLI `main` that prints and exits 1.

**Attempts**

1. Recipe 8 as written, name exclusion in the matcher, `subject:
   enclosing`, `state: local`, 14 subjects
   (`records/catch-hides-failure-attempt1.json`). `gaps`: `works`, gap
   0.35, head +0.26, suggest 0.62. Eval at 0.7: P 1.00 R 1.00, fitted
   0.59, 0 flips. Bad 0.78-0.93, clean 0.04-0.40 (readSettings 0.40).
2. Corpus only, wording unchanged: three subjects added (`isUpstreamHealthy`
   returning true, the idempotent delete, the `Date | undefined` reader).
   P 1.00 R 1.00 at 0.7, fitted 0.67, 0 flips -- but the idempotent delete
   answered 0.57 (0.55 0.56 0.60), 0.21 under the weakest defect, and the
   false branch's "void and named for an operation" clause is what pushed
   it there.
3. Criteria: the false branch adds "a catch that swallows only the case in
   which the operation's goal already holds -- removing what is already
   gone, creating what already exists -- and rethrows everything else".
   Fitted 0.55, P 1.00 R 1.00, 0 flips; the delete 0.18; bad 0.78-0.93,
   clean 0.04-0.32.

**Fit** (accepted run): `at: 0.55`; precision 1.00, recall 1.00, tp 6 fp
0 fn 0; 0 flips; max spread 0.10 (readSettings 0.28-0.38); bad 0.79-0.93,
clean 0.04-0.34; headroom 0.17 over the highest clean pass (0.38), 0.24
under the lowest defect (parseInvoice, 0.79 in every pass).

**Verdict**: SHIP -- recipe 8's sentence separated on its first run with
every hard clean the brief names under 0.40, and the one clean class the
corpus later found (an idempotent operation swallowing its own
already-done case) is described as a class, not a case, and answers
0.18. Headroom 0.17 / 0.24, no flips, six defect shapes at 0.79-0.93.

**What I would change**: an unseen run on a repository with many
`catch (e) { logger.error(e) }` blocks in request handlers and React
event handlers, which this corpus does not have (a handler that sets an
error state, or one that has no return type to promise anything, is the
next hard clean); and a Rust twin is not possible as written -- Rust has
no `catch_clause`, its shape is `.unwrap_or_default()` / `if let Err(_) =
... {}` / `let _ = ...`, which is a different matcher and probably a
different sentence.

---

## Cost

From the tool's own summaries (`spent` in each record; `gaps` from its
footer line).

| run | requests | input tokens | USD |
| --- | --- | --- | --- |
| `gaps` x4 (attempt 1 of each) | 10 | -- | 0.00179 |
| type-name-describes-shape: eval attempts 1, 2, 3 + accept | 9 + 9 + 12 + 12 | 33,705 + 37,593 + 47,985 + 47,985 | 0.00142 + 0.00158 + 0.00202 + 0.00202 |
| error-message-matches-condition: eval attempts 1, 2, 3 + accept | 9 + 9 + 9 + 9 | 37,416 + 48,003 + 49,434 + 49,434 | 0.00157 + 0.00202 + 0.00208 + 0.00208 |
| todo-describes-work: eval attempts 1, 2, 3 + accept | 6 + 6 + 9 + 9 | 26,802 + 30,042 + 43,107 + 43,107 | 0.00113 + 0.00126 + 0.00181 + 0.00181 |
| catch-hides-failure: eval attempts 1, 2, 3 + accept | 6 + 6 + 6 + 6 | 30,237 + 36,042 + 37,878 + 37,878 | 0.00127 + 0.00151 + 0.00159 + 0.00159 |
| **total** | **142** | **636,648 (eval only)** | **$0.0285** |

Every paid run was preceded by `--dry-run`; the largest single run was
$0.0025. Free runs: `rules` and `check --dry-run --show-subjects` after
every matcher or fixture edit, and `eval --replay` on all four after the
final label edits (same decisions as accepted).
