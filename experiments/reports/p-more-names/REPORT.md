# Family P: more names -- a describe title, a parameter, a migration file

Three more claim-versus-body rules for TypeScript, each the cousin of a
shipped naming rule one level over. `describe-names-subject` is
`test-name-describes-code` one level up: a `describe("parseConfig")` is a
claim about every test inside it. `param-name-describes-use` is
`var-name-describes-value` for the binding that has no initializer: the only
evidence for a parameter's name is what the body does with it.
`migration-name-describes-change` is `module-name-describes-contents` for
the one kind of file whose name is a sentence about a schema change. None of
the three is decidable by a parser or a type checker: `userId` sent as an
email address type-checks, a describe whose tests never call the named
function passes, and a migration that "adds an index" and also drops a
column runs. What jev does is read the body against the one claim the name
makes -- and, measured on unseen code, it also reads the domain knowledge
the file does not contain, which is where two of the three stop short of
shipping.

Layout: `experiments/rule-candidates/typescript/<id>/` with `rule.yml`,
`fixtures/`, `expect.yml`, `baseline.json` (accepted) and `last.json`. The
unseen-code records this report draws on are in `records/` beside it:
`param-unseen-attempt{2,3}-src.json` (701 parameters of this repository's
`src/`) and `migration-unseen-attempt{2,3}-directus.json` (107 knex
migrations of Directus, vendored at
`~/ghq/github.com/ubugeeei-prod/vize/tests/_fixtures/_git/directus/api/src/database/migrations`).
Every paid run was `--no-config --cache none` and preceded by a `--dry-run`.

Per-subject bands quoted below are means over the three passes of the
accepted baseline unless an attempt is named; a "single pass" figure is
the extreme pass.

---

## describe-names-subject

### Rule

```yaml
# --------------------------------------------------------------------------
# Does a describe block's title name what the tests inside it exercise?
# --------------------------------------------------------------------------
# The sibling of test-name-describes-code one level up: `it` titles are
# judged by that rule, this one judges the `describe` that groups them. The
# title of a describe is a claim about every test inside it -- "these tests
# are about parseConfig" -- and the claim fails when the block's tests only
# ever call loadConfig, or when a block called "retry" never retries. A
# linter can find `describe(` and its string; it cannot say whether the
# calls inside reach what the string names, or whether "discount codes" is
# honoured by tests that call `checkout`.
#
# `bare`: the node is the whole call, so the callback body -- every `it`,
# `beforeEach` and nested `describe` -- is inside the subject, and the file
# adds only the import list, which the criteria deliberately do not need
# (whether loadConfig calls parseConfig internally is not visible in the
# test file either way). Nested describes are separate subjects and each
# is judged with everything inside it.
id: describe-names-subject
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
subject: node
state: bare
# Fitted 2026-09-20 on fixtures/ (33 subjects: 10 defects, 23 cleans of which
# 14 are labelled hard; 3 passes, 0 flips, max spread 0.04). Cleans top out
# at 0.18 (a sentence title naming deleteUser with one test that touches
# validateEmail); defects start at 0.65 (createOrder over a body that only
# calls createOrderDraft -- the adjacent-name class) and the rest sit at
# 0.78-0.96. Midpoint 0.42; set at 0.45 for headroom on the clean side,
# since a clean case's corpus answer is an upper bound on its real-code
# answer only in the other direction. One sentence attempt; `gaps` said
# `works` on the first and the widened corpus.
threshold: 0.45
axis: file
severity: warning
rule:
  any:
    - pattern: describe($TITLE, $BODY)
    - pattern: describe.only($TITLE, $BODY)
    - pattern: describe.skip($TITLE, $BODY)
    - pattern: describe.each($CASES)($TITLE, $BODY)
    - pattern: describe.concurrent($TITLE, $BODY)
    - pattern: describe.sequential($TITLE, $BODY)
    - pattern: context($TITLE, $BODY)
    - pattern: suite($TITLE, $BODY)
ask: >-
  The tests inside this describe block exercise something other than what its
  title ($TITLE) names.
criteria:
  "true": >-
    The title names a specific function, method, class or module and no test
    in the block calls, constructs or otherwise reaches it: every test calls a
    differently named sibling instead (a block titled parseConfig whose tests
    only call loadConfig, a block titled removeItem whose tests only call
    addItem); or the title names a class and the tests only exercise a
    free-standing helper, never the class or anything that constructs it; or
    the title names a behaviour and no test makes that behaviour happen or
    observes it (a block titled retry whose tests only compute delays and
    never retry anything).
  "false": >-
    What the title names is what the tests exercise, directly or through
    something that reaches it: a feature or behaviour tested through a public
    function of another name, as long as the tests set up and observe that
    behaviour; a class tested through its factory function, through an
    instance created in beforeEach, or through nested blocks named for its
    methods; a function called through a small wrapper defined inside the
    block; a title that is a file name, a scenario, a condition or a whole
    sentence rather than a symbol, when the tests are about that file,
    scenario or condition; a title that is an abbreviation, synonym or
    qualified form of what the tests call; and a block where most tests
    exercise the named thing and one touches a neighbour on the way.
note: >-
  Judge the block as a whole against its title; whether each individual test's
  own name fits its body is a separate rule. Set-up in beforeEach, helpers
  defined inside the block, and nested describe blocks all count as part of
  what the block exercises. A title naming a behaviour or feature is honoured
  when the tests make it happen and check the result, whatever function they
  call to do so. Only what the block's own code shows is evidence: whether a
  function the tests call happens to invoke the named one internally is not
  visible here and is not assumed.
```

### Corpus

33 subjects found (six files, one `.tsx`), 10 bad, 23 clean of which 14 are
labelled hard. Nested describes are separate subjects (`ConfigLoader` >
`load` / `watch`, `UserRepository` > `findByEmail` / `create`).

Bad cases, one line each:

- `config.test.ts:7` -- titled `parseConfig`; every test calls `loadConfig`,
  nothing references `parseConfig`.
- `checkout.test.ts:27` -- titled `CartService`; every test calls the free
  function `computeTotals`, nothing constructs the class.
- `checkout.test.ts:47` -- titled `removeItem`; both tests call `addItem`
  and count lines.
- `retry.test.ts:6` -- titled `retry`; every test calls `backoffDelay` and
  checks a delay; nothing retries.
- `users.test.ts:12` -- titled `deleteUser`; every test calls
  `deactivateUser` and asserts the row is still there.
- `users.test.ts:30` -- titled `validateEmail`; every test calls
  `normalizeEmail` and checks the transformed string.
- `services.test.ts:83` -- titled `createOrder`; every test calls
  `createOrderDraft` (the adjacent-name class).
- `services.test.ts:100` -- titled `UserService.findById`; both tests call
  `service.findByEmail`.
- `services.test.ts:116` -- titled `cache eviction`; every cache has `max:
  100` and holds one key, so nothing is ever evicted.
- `forms.test.tsx:23` -- titled `LoginForm validation`; every test renders
  `<SignupForm />`.

Hard cleans: a feature title honoured through `checkout(cart, { code })`
(`discount codes`); a class tested through nested method blocks with the
instance from `beforeEach` (`ConfigLoader`, `UserRepository`); a file-name
title (`config.ts`); a condition as title (`when the config file is
unreadable`); a local wrapper `usd` calling `formatMoney`; a class tested
through its factory (`HttpClient` via `createHttpClient`); a behaviour
through `createLimiter().tryAcquire` (`rate limiting`); two entry points for
one feature (`password reset`); middleware mounted with `app.use` and hit
over HTTP (`requireAuth`); a test double named as the class (`Scheduler` /
`FakeClockScheduler`); the named function called with only weak assertions
(`sortByPrice`, the other rule's finding); the named function called only in
`beforeEach` (`seedDatabase`); a sentence title with one test touching a
sibling (`deleteUser removes the row`).

### Attempts

One sentence, no rewrite. The corpus was widened once.

1. Ask, criteria and note as shipped above; `subject: node`, `state: bare`.
   First corpus of 24 (6 bad): `gaps` `matched 24 reported 6 median 0.08
   top<at 0.16 head +0.54 gap 0.60 suggest 0.46 works`; eval P 1.00 R 1.00,
   0 flips, defects 0.75-0.96, cleans at or under 0.17, fitted 0.46. Too
   easy, so nine subjects were added (`services.test.ts`, `forms.test.tsx`:
   the adjacent-name bads and the mounted-middleware, test-double,
   weak-assertion and setup-only cleans). Same sentence on 33: `gaps`
   `matched 33 reported 10 median 0.08 top<at 0.18 head +0.52 gap 0.59
   suggest 0.48 works`; eval at 0.7 P 1.00 R 0.90 (fn: `createOrder` at
   0.65), 0 flips, fitted 0.42. In the accepted run that same case answered
   0.75 (0.73-0.77) on identical input, so the run-to-run movement of the
   quietest defect is about 0.10.

### Fit

Accepted baseline (3 passes): fitted 0.48 (midpoint), shipped `threshold: 0.45`.
Precision 1.00, recall 1.00, tp 10 / fp 0 / fn 0 at 0.45 and at any cutoff
in 0.21-0.72. Decision flips across the 3 passes: 0. Max spread 0.05
(`CartService`, 0.73-0.78). Defects 0.75-0.96 (`createOrder` 0.75,
`CartService` 0.76, `LoginForm validation` 0.81, the rest 0.83-0.96). Clean
band: 0.20 (`deleteUser removes the row`), 0.16 (`Scheduler`), 0.14, 0.13,
then nineteen at 0.11 and under. Headroom at 0.45: 0.25 above the highest
clean mean, 0.24 above the highest single clean pass (0.21), 0.28 below the
lowest defect mean. `eval --replay`: same decisions.

No unseen run: this repository's tests are `node:test` (`test(...)`), not
`describe`, so there was nothing to run on; see below.

### Verdict

SHIP -- the one sentence separated on the first and the widened corpus, the
hard cleans (feature through an entry point, class through a factory,
middleware through HTTP, a test double) all sit under 0.21, and the cutoff
has 0.24 of headroom on either side with no flips. The reservation is the
missing unseen run: every clean here is one I wrote knowing the rule.

### What I would change

Run it on a repository with `describe` blocks before promoting (any vitest
or jest project); the class most likely to fire on real code is a top-level
`describe("<module name>")` whose tests reach the module only through
fixtures. `$BODY` is captured and travels beside the code as
`matcher_captured`, doubling the subject's tokens; `$$$REST` in the pattern
would halve the cost of a big block without changing the question. Nothing
in matcher, subject or state.

---

## param-name-describes-use

### Rule

```yaml
# --------------------------------------------------------------------------
# Does a parameter's name describe how the body uses it?
# --------------------------------------------------------------------------
# The parameter cousin of var-name-describes-value. A binding's initializer
# is one half of that comparison; a parameter has no initializer, so the
# only evidence is what the body does with it -- sends `userId` as an email
# address, indexes with `items.sku`, multiplies `timeoutMs` by 1000, counts
# up to `isEnabled`. A type checker sees none of it: every one of those
# type-checks. The claim is the name, the evidence is the use.
#
# `subject: enclosing`: the parameter is the match and the function around
# it is what is judged, with the finding reported at the parameter. `state:
# local` is what the brief asked for; for an `enclosing` subject the local
# arm adds nothing over `bare` (the enclosing function IS the subject), so
# it is the same request. Each parameter of one function is its own subject,
# and the state's `matched` says which one the question is about.
#
# TypeScript and Tsx only: the JavaScript grammar has no `required_parameter`
# node (an untyped parameter is a bare `identifier` inside
# `formal_parameters`), and ast-grep rejects a kind absent from the grammar.
id: param-name-describes-use
languages: [ TypeScript, Tsx ]
kind: noul
subject: enclosing
state: local
# Fitted 2026-09-20 on fixtures/ (91 subjects on distinct lines: 8 defects,
# 83 cleans of which 27 are labelled hard; 3 passes, 0 flips at this
# cutoff, max spread 0.08). Corpus cleans top out at 0.38 (`threshold`, a cutoff
# parameter) and 0.37 (`maxLength` used with `- 1`); defects start at 0.56
# (`userIds` read as `userIds[0]` and handed to a session lookup -- a
# compound case) and the rest sit at 0.71-0.95. Corpus midpoint 0.47.
# On 701 unseen parameters (this repository's src/, one pass) the clean
# band reaches 0.47 -- `fixtures: string`, a directory named for what it
# holds, and `id` used as a subject id -- and the one answer above it,
# `palette(color: boolean)` at 0.67, is a noun used as a flag and arguably
# a finding. 0.50 sits between the unseen clean top and the defect floor
# with 0.03 and 0.06 of headroom: enough to separate this corpus, not
# enough to ship. Cookbook recipe, not a shipped cutoff.
threshold: 0.50
axis: file
severity: warning
rule:
  all:
    - any:
        - kind: required_parameter
        - kind: optional_parameter
    # A destructured parameter has no single name to make a claim; a rest
    # parameter's name is a collection by construction. Both are left to
    # the parser, so only a plain identifier is a subject.
    - has: { field: pattern, kind: identifier, pattern: $NAME }
    # Parameters of a function that has a body. A parameter in a type
    # signature (`handler: (payload: unknown) => void`, a method in a type
    # literal) is a `required_parameter` too, and has no use to judge.
    - inside:
        kind: formal_parameters
        inside:
          any:
            - kind: function_declaration
            - kind: function_expression
            - kind: arrow_function
            - kind: method_definition
            - kind: generator_function_declaration
            - kind: generator_function
ask: >-
  This parameter's name ($NAME) misdescribes how the function's body uses it.
criteria:
  "true": >-
    The body uses the parameter as a different kind of thing from what its
    name says: an id, key or handle name for a value the body sends, displays,
    splits or validates as an address, email or text; a plural name for a
    value the body reads fields from as one item, or a singular name for a
    value it iterates; a name that reads as a yes-or-no (is*, has*, enabled)
    for a value the body counts up to, compares numerically or does
    arithmetic on; a name that states a unit for a value the body treats as
    another unit -- a *Ms parameter multiplied by 1000 before a timer or
    printed with an "s" suffix, a *Seconds parameter handed straight to a
    millisecond timer; an options, config or settings name for a value the
    body passes as a single scalar; a name that says where the value goes --
    prefix, suffix, head, tail, start, end, first, last -- for a value the
    body puts or looks for in the other place (a prefix appended after the
    string, checked with endsWith); or a name that says what the value
    bounds -- limit, max, count, size -- for a value the body uses as a
    position instead (the start index of a slice, an offset to skip).
  "false": >-
    The body uses the parameter as the thing the name says, even when the name
    is short, conventional or could be more specific: x, i, n, cb, fn, req,
    res, next, key, path and the like are fine when the use fits; a parameter
    forwarded to another call, stored, returned or spread unchanged is used as
    its name says; a leading-underscore parameter declares itself unused; a
    plural name on a repository, store, table, client, map, directory or file
    that holds or serves those things (users for a user repository, sessions
    for a session store, fixtures for the directory the fixtures are read
    from) is named for what it holds and is used as that container; a short
    name taken from the surrounding code's own vocabulary (at for a cutoff, n
    for a count, spec for a range) is fine when the body uses it as that; a
    name for what the caller supplies -- retries, force, limit, ttl -- that
    the body uses to size a loop, skip a step, cap a result or set a timer is
    honoured; and a number with no unit in its name converted with * 1000 or
    / 1000 is not a mismatch, since the name claimed no unit.
note: >-
  Only the parameter in `matched` is judged; the function's other parameters
  are separate subjects and the surrounding code is context. Read every use
  of that parameter in the body: which argument position it fills and what
  that position means (the first argument of slice is a start index, the
  argument of setTimeout is milliseconds), what it is compared with or
  concatenated to and on which side, what it is multiplied or divided by,
  which fields are read from it, and whether it is called. The type
  annotation is not the evidence -- it type-checks either way -- the name is
  the claim and what the body does with the value is the evidence. A body
  that only passes the parameter on, stores it, or returns it shows nothing
  against the name.
```

### Corpus

99 subjects found by `check` (91 by `eval`, which keys on line: `req, res,
next` on one line is one case), five files. 8 bad, 83 clean of which 27 are
labelled hard with a reason; the rest are default-clean parameters of the
same functions (`cart`, `mailer`, `db`, callback parameters `l`, `r`,
`err`), which are the over-match the matcher is meant to produce.

Bad cases:

- `notify.ts:7` -- `userId` validated with `includes("@")`, sent as `to:`
  and split at `@`: an email address.
- `notify.ts:36` -- `options` handed to `setInterval` as the interval: a
  single number.
- `timing.ts:3` -- `timeoutMs * 1000` for the deadline and printed with an
  `s` suffix: treated as seconds.
- `cart.ts:5` -- `items` read as `items.sku` / `items.price` and pushed as
  one line.
- `cart.ts:28` -- `isEnabled` is the upper bound of a `for` loop.
- `cart.ts:37` -- `prefix` checked with `endsWith` and appended after the
  name: a suffix.
- `cart.ts:45` -- `limit` passed as the start of `slice`: an offset.
- `routes.ts:69` -- `userIds` read as `userIds[0]` and handed to
  `db.sessions.get`: a list of user ids used as one session id (the compound
  case, and the corpus's quietest defect).

Hard cleans include the twin of each bad (`userId` looked up, `options`
merged over defaults, `timeoutMs` straight into `setTimeout`, `items`
iterated, `limit`/`offset` used properly), `ttl * 1000` and `ttlSeconds *
1000` into `setTimeout`, `timeoutMs / 1000` for display, `retries` sizing a
loop, `force` skipping a cache read, `count` as a truthiness guard, `id` in a
URL, `items[0]` behind a length check, `handler` stored and never called,
`onDone` passed to `.then`, `_req`, the express triple, node-style `cb`, and
-- added after the unseen run -- `fixtures: string` (a directory named for
what it holds) and `threshold: number` (a cutoff, from this repository's own
vocabulary). A destructured parameter is present (`resolveUpload`) and is
not a subject by construction.

### Attempts

All three attempts kept the ask (`This parameter's name ($NAME) misdescribes
how the function's body uses it.`), `subject: enclosing`, `state: local`.
The matcher was tightened once before any paid run: the first draft matched
`required_parameter` anywhere, which included parameters inside type
signatures (`handler: (payload: unknown) => void`, a method in a type
literal), 85 subjects; requiring `inside: formal_parameters` of a
body-bearing function node gave 75.

1. Draft criteria and note. 75 subjects: `gaps` `matched 75 reported 7
   median 0.05 top<at 0.64 head +0.06 gap 0.47 suggest 0.41 move`; eval at
   0.7 P 0.86 R 0.75 (tp 6 / fp 1 / fn 2), 0 flips, fitted 0.60 "no
   separating cutoff". `prefix`-as-suffix answered 0.08 (not found at all),
   `limit`-as-offset 0.60 with spread 0.12, and `users: UserRepository`
   fired at 0.78 -- a plural name on the thing that holds users, a clean
   shape the false branch had not named.
2. Criteria: the true branch names position words (prefix, suffix, head,
   tail, start, end) and bound words (limit, max, count, size) used as a
   position; the false branch forgives a plural on a repository, store,
   table, client or map; the note tells the model to read each use by
   argument position, comparison side, multiplier and field access. Same 75:
   `gaps` `matched 75 reported 7 median 0.05 top<at 0.64 head +0.06 gap
   0.48 suggest 0.40 move`; eval at 0.7 P 1.00 R 0.88 (fn `userIds` 0.61),
   1 flip (`prefix` 0.75/0.75/0.64), fitted 0.39; `prefix` 0.08 -> 0.71,
   `limit` 0.60 -> 0.91, `users` 0.78 -> 0.07. Then `api.ts` was added
   (nine hard cleans: `timeoutMs / 1000`, `count` as a guard, `id` in a
   URL, `items[0]`, `maxLength - 1`, ...): 94 subjects, `gaps` `matched 94
   reported 7 median 0.05 top<at 0.62 head +0.08 gap 0.30 suggest 0.47
   move`; eval at 0.7 P 1.00 R 0.88, 1 flip, fitted 0.42; cleans now top at
   0.28 (`maxLength`) and 0.23 (`timeoutMs / 1000`). Unseen run
   (`records/param-unseen-attempt2-src.json`, 701 parameters, one pass, at
   0.42): 7 findings -- `palette(color: boolean)` 0.66 (a noun used as a
   flag; arguably right), `fixtures: string` 0.63 and 0.58 (a directory
   named for what it holds; wrong), and `threshold`, `scale`, `id`, `spec`/`budget`
   at 0.45-0.49 (terse names from the code's own vocabulary; wrong). Real
   clean band top: 0.63 against a corpus clean top of 0.28.
3. Criteria: the false branch adds directory/file to the container list
   (`fixtures`) and "a short name taken from the surrounding code's own
   vocabulary (at, n, spec)"; two fixtures taken from the unseen findings.
   99 subjects: `gaps` `matched 99 reported 7 median 0.05 top<at 0.59 head
   +0.11 gap 0.15 suggest 0.40 rewrite` (single pass); eval at 0.7 P 1.00 R
   0.88 (fn `userIds` 0.56), 0 flips, fitted 0.47; `threshold` 0.38, `fixtures`
   0.25, `maxLength` 0.37. Unseen run again
   (`records/param-unseen-attempt3-src.json`, at 0.47): 3 findings --
   `color` 0.67, `fixtures` (the second one) 0.47, `id` 0.47; `bestTradeoff`
   0.45 just under. Real clean band top: 0.47.

### Fit

Accepted baseline (3 passes, attempt 3 wording): fitted 0.50 (midpoint),
shipped `threshold: 0.50`. Precision 1.00, recall 1.00, tp 8 / fp 0 / fn 0 at 0.50
and at any cutoff in 0.45-0.56. Decision flips across the 3 passes: 0. Max
spread 0.06 (`prefix`, 0.70-0.76; `maxLength`, 0.31-0.37). Defects: 0.59
(`userIds`, 0.57-0.61), 0.72 (`prefix`), 0.76 (`options`), then 0.87-0.95.
Clean band: 0.42 (`threshold`, 0.40-0.44), 0.35 (`maxLength`), 0.23 (`fixtures`),
0.18, then everything else at 0.16 and under. Headroom at 0.50: 0.08 above
the highest clean mean, 0.06 above the highest single clean pass, 0.09 below
the lowest defect mean, 0.07 below its lowest pass. On unseen code (attempt
3, 701 subjects): 0 findings above 0.50 except `color` at 0.67; clean band
top 0.47, so 0.03 of headroom there.

### Verdict

COOKBOOK -- it separates the corpus with P 1.00 / R 1.00 and no flips, and
on 701 unseen parameters the one finding left at 0.50 is a defensible one,
but the headroom is under 0.10 on both sides of the corpus and 0.03 on real
code, and the weakest defect is a compound case the rule only half sees.
A recipe with this wording and cutoff is worth having; a shipped cutoff
would produce its next false positive on the next terse name.

### What I would change

Corpus: more defects of the quiet classes -- plural-used-as-one-of-another-
kind (`userIds` 0.59) and position words (`prefix` 0.72) -- to learn whether
they are a band or two outliers, and hard cleans from other real
repositories, since this repository's vocabulary (`threshold`, `spec`, `fixtures`)
is now in the false branch by name. Matcher: consider `not: { regex:
"^_" }` on the name so `_unused` parameters are not subjects at all (they
answer 0.05, so it is only cost). State: `local` on an `enclosing` subject
is the same request as `bare`, since the enclosing function is already the
subject and `local` adds a context only for fragments; the field is kept as
the brief asked, and the report says so. Subject: none.

---

## migration-name-describes-change

### Rule

```yaml
# --------------------------------------------------------------------------
# Does a migration file's name describe the change its `up` makes?
# --------------------------------------------------------------------------
# The migrations cousin of module-name-describes-contents. A migration's
# file name is the one line of it that ever appears in a migration table, a
# deploy log or a code review list, and it is a claim about the schema
# change: "add index to users email", "drop legacy orders". The claim fails
# when `up` also drops a column the name never mentions, renames instead of
# dropping, or alters a type under a name that says "add column". A linter
# can find `up`; it cannot read a Kysely builder chain, a knex callback, a
# TypeORM QueryRunner call and a raw SQL string as the same operation and
# compare that to a snake_case sentence.
#
# `subject: file` because the file's text never mentions its own name, and
# `state: located` rather than `graph`: the outline lists `up` and `down`
# with their signatures and nothing of what they do, and the graph carries
# no source, so the SQL strings and builder calls only arrive with the file
# source. A migration file is small, so the located state costs little.
# The matcher requires an `up` in one of the shapes the ORMs use, so a
# non-migration file in the same tree is not a subject.
id: migration-name-describes-change
languages: [ TypeScript, Tsx, JavaScript, Jsx ]
kind: noul
subject: file
state: located
# Fitted 2026-09-20 on fixtures/migrations/ (27 files: 11 defects, 16 cleans
# of which 10 are labelled hard; 3 passes, 0 flips, max spread 0.14 on the
# TypeORM wrong-table case). Cleans top out at 0.27 (rename_customers_to_
# accounts, which also recreates the email index) and 0.25 (appearance, a
# bare topic name over an add/copy/drop); defects start at 0.82 and reach
# 0.96. Corpus midpoint 0.54. Set at 0.60 because of the unseen run: on 107
# real knex migrations (Directus) the clean band is not under 0.27 -- a
# feature-named migration whose table the file cannot connect to the name
# (add-color-to-insights-icon on directus_dashboards, 0.85; add-origin-to-
# accountability on activity and sessions, 0.60) answers inside the corpus's
# defect band, beside real hidden drops and deletes at 0.71-0.89. 0.60
# keeps 0.33 of headroom over the corpus cleans and 0.22 under its defects,
# and trims the unseen list from 11 to 10; it does not separate the
# domain-knowledge cases, which no cutoff does. Cookbook recipe.
threshold: 0.60
axis: file
severity: warning
rule:
  kind: program
  has:
    stopBy: end
    any:
      # export async function up(db) {}
      - all:
          - kind: function_declaration
          - has: { field: name, regex: "^up$" }
      # export const up = async (db) => {}
      - all:
          - kind: variable_declarator
          - has: { field: name, regex: "^up$" }
      # class X implements MigrationInterface { async up(runner) {} }
      # export default { async up(qi) {} }
      - all:
          - kind: method_definition
          - has: { field: name, regex: "^up$" }
      # module.exports = { up: async (qi) => {} }
      - all:
          - kind: pair
          - has: { field: key, regex: "^up$" }
      # exports.up = function (knex) {}
      - all:
          - kind: assignment_expression
          - has: { field: left, regex: "\\.up$" }
ask: >-
  This migration file's name misdescribes the change its up migration makes.
criteria:
  "true": >-
    The file name states one operation on one thing and the up function does
    something else or something more: it names an add, create or index and
    the body also drops, renames or changes the type of something the name
    does not mention; it names a drop or removal and the body renames,
    archives or deletes rows instead of dropping; when the name names a
    specific table, column or index, the one the body touches is a different
    one (a name saying one table while the column or index goes on another); it names a column addition and the body alters an existing
    column instead; it names a constraint (not null, unique, foreign key)
    that the body never actually adds, however much it prepares for it; or
    it names a seed, backfill or data fix, which is data only, and the body
    also creates or alters a table, index or constraint -- a unique index
    added after a backfill is a schema change the name hides.
  "false": >-
    The up function does what the name says and nothing the name would hide.
    A name that summarises a multi-step change is faithful when every step
    serves it (split_name_column covering add two columns, backfill, drop the
    old one; a rename done as add, copy, drop; rename_x_to_y also renaming
    x's index); a different verb for the same operation is faithful (create
    and add for a new table, make unique and add a unique index, remove and
    drop, revert_add and drop); a supporting index, default, not-null or
    foreign key on the very column or table the name says it adds is part of
    adding it; a name that names a feature, module or topic rather than a table
    or column (add_shares, add_notifications, themes, marketplace) claims
    only that every change serves that feature, so creating its tables,
    adding its columns to several related tables, and reshaping the columns
    that feature replaces are all what the name says, and no single table is
    the wrong one; and a timestamp, sequence number or ticket reference in
    the name is not a claim.
note: >-
  Judge the up function against the words of the file name, whatever style
  the migration uses -- a query builder chain, a schema callback, a
  QueryRunner call or a raw SQL string. The down function is the inverse by
  convention and says nothing about the name; a down that undoes more or
  less than up is not this rule's question. Numbers and ticket ids in the
  name carry no claim. Under a feature name the question is not how many
  tables are touched but whether something is dropped, deleted or altered
  that the feature does not account for. The question is whether someone reading only the
  file name in a migration list would be surprised by what up changes.
```

### Corpus

27 subjects found (`fixtures/migrations/`, one file each): 11 bad, 16 clean
of which 10 are labelled hard. Styles: Kysely builder chains, knex schema
callbacks, TypeORM `MigrationInterface` classes, a Sequelize `export default
{ up, down }` object, and one JavaScript `exports.up = function (knex)`. A
non-migration tree (`param-name-describes-use/fixtures`, `src/state.ts`)
yields 0 subjects.

Bad cases:

- `20240301..._add_index_to_users_email` -- creates the index and drops
  `legacy_login`.
- `003-drop-legacy-orders` -- renames `legacy_orders` to `orders_archive`;
  nothing dropped.
- `20240415..._add_column_phone_to_customers` -- alters the existing
  `phone` column's type and nullability; adds nothing.
- `20240501..._seed_default_roles` -- creates `roles`, adds `users.role_id`,
  then inserts.
- `1714..-AddStatusToInvoices` (TypeORM) -- adds `status` to `payments`.
- `20240610..._remove_unused_sessions_table` -- deletes expired rows and
  adds an index; the table stays.
- `20250105..._add_soft_delete_to_projects` (Sequelize) -- adds
  `deleted_at` and also drops `project_snapshots`.
- `20250401..._add_not_null_to_users_email` -- backfills and sets a default;
  never sets NOT NULL.
- `20250420..._add_index_on_orders_customer` -- the index goes on
  `order_lines`.
- `20250501..._backfill_user_slugs` -- backfills and adds a unique index on
  `slug`.
- `20250701..._add_comments` -- a feature name whose up also deletes every
  row of `activity`.

Hard cleans: `split_name_column` (add two, backfill, drop one);
`rename_column_status_to_state_on_jobs` (a rename as add/copy/drop, with the
MySQL reason in a comment); `rename_customers_to_accounts` (also recreates
the email index under the new name); `revert_add_currency_to_orders` (the
name says add, the up drops); `add_tags_table` via `createTable`;
`make_email_unique` via a unique index; `add_idempotency_key_to_payments`
with its unique constraint; `issue_1234_add_currency_to_orders`;
`BackfillOrderTotals` with an empty down; `orders_indexes` (vague, true);
`fix_orders_total_type`; `add_user_preferences` (table plus FK);
`add_notifications` (a table plus one column each on `users` and
`settings`); `appearance` (a bare topic name over a `theme` ->
`appearance` add/copy/drop across two tables). The last two are shaped
after the Directus migrations that fired on the unseen run.

### Attempts

The ask never changed (`This migration file's name misdescribes the change
its up migration makes.`); `subject: file`, `state: located` throughout.
What the model receives was checked in `src/state.ts` and `src/questions.ts`
rather than with `--show-subjects` (which prints the subject's range and
kind, not the state): a `subject: file` rule sends the outline as
`module_outline` (path, exports with signatures, private items, imports),
and the `located` arm adds `source`, the whole file, in the state. The
outline alone lists `up(db: Kysely<any>): Promise<void>` and nothing of
what it does, which is why `graph` was not measured.

1. Draft criteria and note. First corpus of 16 (7 bad): `gaps` `matched 16
   reported 7 median 0.18 top<at 0.27 head +0.43 gap 0.50 suggest 0.52
   works`; eval at 0.7 P 1.00 R 0.86, 1 flip (`AddStatusToInvoices`
   0.76/0.48/0.76), fitted 0.46; defects 0.83-0.96 otherwise, cleans at or
   under 0.25. Eight subjects were added (the not-null miss, the kysely
   wrong-table, the backfill-plus-unique-index, `revert_add`, the
   add/copy/drop rename, `orders_indexes`, `add_user_preferences`,
   `fix_..._type`). Same sentence on 24: `gaps` `matched 24 reported 7
   median 0.08 top<at 0.66 head +0.04 gap 0.23 suggest 0.51 rewrite`; eval
   at 0.7 P 1.00 R 0.70 (fn: both wrong-table cases at 0.63 and 0.65, the
   backfill at 0.36), 2 flips, fitted 0.33. The false branch's "a
   supporting index ... is part of adding it" was being read to cover a
   unique index after a backfill, and "a different table" was not weighing
   a related one.
2. Criteria: wrong-table clause reworded to "however closely related the
   two are"; a constraint named but never added; seed/backfill plus
   "a unique index added after a backfill is a schema change the name
   hides"; the false branch lists `revert_add` and add/copy/drop renames and
   limits the supporting-index clause to "the very column or table the name
   says it adds". `gaps` `matched 24 reported 10 median 0.08 top<at 0.31
   head +0.39 gap 0.49 suggest 0.56 works`; eval at 0.7 P 1.00 R 1.00, 0
   flips, fitted 0.54; defects 0.81-0.96, cleans at or under 0.26. Unseen
   run (`records/migration-unseen-attempt2-directus.json`, 107 knex
   migrations, one pass, at 0.54): 18 findings (17%). Read against the
   code: `add-project-owner` 0.89 also drops `accepted_terms`,
   `add-default-language` 0.85 also changes `directus_users.language`'s
   type, `add-deployment-webhooks` 0.83 deletes every deployment run,
   `add-shares` 0.82 drops `sessions.data`, `add-auth-provider` 0.84 also
   alters `users.email` and `sessions` -- defensible; but `themes` 0.74,
   `marketplace` 0.74, `add-insights` 0.69, `add-notifications` 0.65,
   `add-licensing` 0.83, `add-collection-organization` 0.73 are
   feature-named migrations touching several tables for that feature, and
   `add-color-to-insights-icon` 0.82 (column on `directus_dashboards`) and
   `add-origin-to-accountability` 0.76 (`activity` and `sessions`) need
   Directus's vocabulary to read as right.
3. Criteria: the wrong-table clause applies only "when the name names a
   specific table, column or index"; the false branch adds "a name that
   names a feature, module or topic rather than a table or column ... claims
   only that every change serves that feature"; the note says that under a
   feature name the question is whether something is dropped, deleted or
   altered that the feature does not account for. Three fixtures added
   (`add_notifications`, `appearance`, `add_comments`). `gaps` `matched 27
   reported 11 median 0.11 top<at 0.29 head +0.41 gap 0.53 suggest 0.55
   works`; eval at 0.7 P 1.00 R 1.00, 0 flips, fitted 0.54; defects
   0.82-0.96, cleans at or under 0.27. Unseen run again
   (`records/migration-unseen-attempt3-directus.json`, at 0.54): 11
   findings. The feature-named ones dropped out (`themes`, `marketplace`,
   `add-insights`, `add-notifications`, `add-shares`,
   `consolidate-content-versioning`; `update-material-icons` 0.55 -> 0.51).
   Of the 11: `add-project-owner` 0.89, `add-default-language` 0.79,
   `add-deployment-webhooks` 0.71 and `add-licensing` 0.75 (a stray
   `collections.status`) are right; `add-auth-provider` 0.66,
   `add-foreign-key-constraints` 0.67 and `add-system-fk-triggers` 0.77 are
   arguable; `add-color-to-insights-icon` 0.85, `add-origin-to-
   accountability` 0.60, `add-collection-organization` 0.70 and
   `remove-files-interface` 0.60 (an UPDATE replacing one interface name
   with another) are wrong. Four of eleven wrong, and the wrong ones are
   not under any cutoff the right ones are over.

### Fit

Accepted baseline (3 passes, attempt 3 wording): fitted 0.55 (midpoint),
shipped `threshold: 0.60`. Precision 1.00, recall 1.00, tp 11 / fp 0 / fn 0 at 0.60
and at any cutoff in 0.35-0.77. Decision flips across the 3 passes: 0. Max
spread 0.07 (`rename_customers_to_accounts`, 0.27-0.34). Defects 0.80-0.96
(`add_index_on_orders_customer` 0.80, `add_not_null` 0.83, the rest
0.85-0.96). Clean band: 0.29 (`rename_customers_to_accounts`), 0.25
(`appearance`), 0.11 (`add_notifications`), then thirteen at 0.08 and under.
Headroom at 0.60: 0.31 above the highest clean mean, 0.26 above the highest
single clean pass (0.34), 0.20 below the lowest defect mean. On unseen code
(attempt 3, 107 files): the clean band reaches 0.85, so the headroom there
is negative; at 0.60 the list is the same 11 findings (two sit at exactly
0.60), 4 of them wrong.

### Verdict

COOKBOOK -- on the corpus it is the cleanest of the three (gap 0.51, no
flips, every ORM style found), and on real migrations it finds real hidden
drops and deletes at 0.71-0.89; but the same run puts four domain-knowledge
cleans at 0.60-0.85, inside the defect band, because whether
`directus_dashboards` is where "insights" live is not in the file. One
finding in three wrong on unseen code is not a shipped cutoff.

### What I would change

State: `full` (source plus the graph) would not help -- the missing
evidence is project vocabulary, not code. What would: a `note` the user
fills in, or a `--context` mechanism, naming the project's table-to-feature
mapping; without that the rule belongs in `review` mode on a migrations
directory, where one file at a time is read by a person anyway. Corpus: it
now contains the shapes the unseen run taught it (feature names, topic
names, revert), so a second unseen repository is the next measurement.
Matcher: the `has: stopBy: end` walk over the whole program is fine for
migration-sized files; on a large non-migration file it is a full-tree scan
per file, which is cheap in ast-grep but worth knowing. `severity: info`
if it ever ships, as `module-name-describes-contents` did.

---

## Tooling

No obstacle in `src/`. Two notes:

- `eval` reports fewer subjects than `check` for the parameter rule (91
  against 99) because it keys cases on `file:line` and `req, res, next` on
  one line is one case; labels are per line, so a signature with one
  parameter per line is what makes a parameter individually labellable.
- `--show-subjects` prints the subject's range, kind and captures, not the
  state; what a `subject: file` rule sends on `located` was confirmed by
  reading `resolveSubject` in `src/state.ts` (outline as the subject) and
  the `located` arm (`state.source = source`).

## Cost

From the tool's own summaries, every paid run:

| rule | runs | requests | input tokens | usd |
| --- | --- | --- | --- | --- |
| describe-names-subject | gaps x2, eval x3, accept | 76 | ~450k | 0.0210 |
| param-name-describes-use | gaps x3, eval x3, unseen x2, accept | 140 | ~3.3M | 0.1374 |
| migration-name-describes-change | gaps x3, eval x3, unseen x2, accept | 659 | ~1.0M | 0.0387 |
| **total** | | **875** | **~4.8M** | **$0.197** |

The two `src/` runs for the parameter rule are $0.068 of the total (701
subjects each, the whole file per request); the two Directus runs are
$0.015. Every run had a `--dry-run` before it, and no single run exceeded
$0.035.
