# Family B: function names that promise a guarantee

Four rules for TypeScript/TSX/JavaScript, each a narrowing of the shipped
`fn-name-promises` to a family of names that makes one specific promise:
`validate*`/`check*`/`ensure*` promise that a check happens on every path,
`safe*`/`try*`/`*OrNull` promise that failure comes back as a value,
`ensure*`/`upsert*`/`register*` promise that a second call is harmless, and
`compute*`/`format*`/`parse*`/`to*` promise a computation that touches nothing
outside itself. A linter can find the names (the regex on `$NAME` does exactly
that and costs nothing); it cannot say whether a `catch` that returns `true`
is a rate limiter failing open, whether an `ALTER TABLE` between two
`IF NOT EXISTS` statements will run twice, or whether a `Map` write is a
memo or a leak. Jev reads the body against the promise. The narrower question
pays off measurably: the shipped `fn-name-promises` at its cutoff of 0.83
flags **none of the 22 labelled defects** in this corpus (its highest answer
on a defect is 0.79, `upsertUser`; 16 of the 22 sit at or under 0.29, mixed
in with the clean band), while the four narrow rules together find 21 of 22
on `local` and 22 of 22 with `idempotent-name` on `located`, at zero false
positives.

Corpus: `corpus/guards.ts`, `corpus/safe.ts`, `corpus/idempotent.ts`,
`corpus/pure.ts` -- 58 subjects, 22 bad, 36 clean. Labels in `labels.json`
with the argument for each. Records in `records/` (`attempt1..3-local.json`
are the sentence iterations, `final-local.json` and `final-located.json` are
the fits, `fn-name-promises-located.json` is the shipped rule on the same
corpus; `scores.mjs` prints per-subject values across passes from any of
them). Every number below is from those records and reproducible with
`jev-lint replay <record> --labels labels.json`.

One tooling note: `gaps` and `calibrate` ignore `--dry-run` (only `check`
honours it), so the price of a run has to be read from `check --dry-run`
beforehand. Attempt 1's `gaps` was priced that way and cost $0.0013.

---

## guard-name-guards

### Rule

```yaml
- id: guard-name-guards
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: local
  at: 0.63
  # Fitted on records/final-local.json: clean tops at 0.47 (ensureBucket),
  # defects start at 0.79 (ensureDir). Midpoint of that gap, 0.16 headroom each
  # side. `located` widened the gap by 0.08 and changed no decision.
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &guard_name
              field: name
              pattern: $NAME
              regex: "^(validate|sanitize|assert|ensure|check|verify)([A-Z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *guard_name
      - all:
          - kind: variable_declarator
          - has: *guard_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) promises a check, but there is a path through
    its body on which that check is not performed and the function still
    completes as if it had passed.
  criteria:
    "true": >-
      Some path returns, resolves or falls through normally without the check
      the name promises having been performed: an input is accepted early
      without being examined, a failure of the operation that would have
      established the condition is caught and discarded, or a shortcut branch
      skips the check for some callers or inputs.
    "false": >-
      On every path that completes normally the check the name promises has
      been performed, by this body or by a schema, library or helper it
      delegates to. Reporting the outcome by returning false, null or a
      result object rather than throwing is still performing the check, and a
      terse name is not a missing check.
  note: >-
    Only this function's paths are judged, not how thorough its check is: a
    body that performs the check the name names on every path but could have
    examined more is not skipping it. A schema, validator or helper the body
    calls is assumed to check what its own name says. Failing closed --
    rejecting when the check cannot be run -- honours the name; failing open
    -- accepting when the check cannot be run or was skipped -- does not.
```

### Corpus

15 subjects found / 4 bad / 11 clean (6 hard). Overlaps `idempotent-name` on
the five `ensure*` subjects; each is labelled for both rules.

- `guards.ts:7 validateEmail` -- returns `true` for the empty string before
  examining it; `''` is not an email, and the empty path is accepted as if
  checked.
- `guards.ts:16 ensureDir` -- swallows every `mkdir` error, so on
  `EACCES`/`ENOTDIR` it returns normally with the directory not ensured.
- `guards.ts:24 verifyWebhookSignature` -- returns `true` when no signature
  header is present; omitting the header skips verification.
- `guards.ts:106 checkRateLimit` -- returns `true` (allowed) when the counter
  store throws; the caller reads "checked and under the limit", the limit was
  never checked (fails open).

Hard cleans: `validateOrder` (body shows no check, delegates to a zod
schema), `checkQuota` (boolean, no throw), `assertOk` (terse, one
condition), `verifyToken` (reports failure as `null`), `ensureBucket`
(try/catch that rethrows everything except NotFound), `ensureArray` and
`ensureTrailingSlash` (`ensure*` that is a pure conversion), `sanitizeHtml`
(see below).

`sanitizeHtml` (strips only `<script>`) is in the corpus, labelled **clean
for this rule** with the argument in `labels.json`: it is an incompleteness
defect, and the rule as it separates is a path rule. See Attempts.

### Attempts

1. Ask "there is a path on which the check is not performed and the function
   still completes as if it had passed"; `sanitizeHtml` labelled bad. `gaps`:
   **works**, gap 0.40 (0.42 on the calibrate merge), head +0.30 at 0.70. Per subject: defects 0.81-0.92,
   `sanitizeHtml` 0.39-0.40, tied with the top clean (`ensureBucket`
   0.39-0.40). Fit 0.40, precision 1, recall 0.75 (tp 3, fp 0, fn 1). The
   partial sanitiser is not a skipped path and the model says so.
2. Ask "does not perform that check, in full, on every path", criteria adds
   "examines only one form of the problem the name names". `gaps`: **move**,
   gap 0.26, head +0.13. `sanitizeHtml` rose to 0.57 -- but so did
   `ensureIndex` (0.31 -> 0.53) and `ensureBucket` (0.40 -> 0.50): clean top
   0.55, defect bottom 0.57. "In full" turned the question into "is this
   check thorough", which every `ensure*` answers weakly. Fit 0.55 with
   0.02 of headroom; worthless.
3. Revert to attempt 1's sentence; add to `note:` "not how thorough its check
   is: a body that performs the check on every path but could have examined
   more is not skipping it"; relabel `sanitizeHtml` clean for this rule;
   add `checkRateLimit`. `gaps`: **works**, gap 0.33, head +0.24.
   `sanitizeHtml` 0.13-0.14, `ensureIndex` 0.18-0.23, `ensureBucket` stays
   the top clean at 0.46-0.47; defects 0.79-0.95.

### Fit

`records/final-local.json`, 3 passes. Cutoff **0.63** (midpoint of
0.47-0.79). Precision 1, recall 1 (tp 4, fp 0, fn 0). Decision flips: 0. Max
spread 0.05. Headroom 0.16 above the top clean, 0.16 below the lowest defect.
`located` (`records/final-located.json`): fit 0.64, gap 0.44-0.84, no
decision changed, +0.08 of gap for the cost of the file; not taken.

`fn-name-promises` at 0.83 on the same four defects: 0.20, 0.18, 0.23, 0.55.
None flagged.

### Verdict

**COOKBOOK.** It separates with 0.16 of headroom and no flips, but on 4
defects, and the class the brief named first -- the partial sanitiser -- is
out of its reach by construction: completeness of a check is domain
knowledge, not a path, and the one attempt to fold it in destroyed the
separation. Ship it as the recipe "a guard name is a path claim", not as a
cutoff.

### What I would change

Corpus: more fail-open shapes (`assert*` disabled outside development,
`validate*` with a `skipValidation` option) to get the defect side above 4
before trusting 0.63. Rule: leave completeness out; if a sanitiser rule is
wanted it is a separate question ("this sanitizer's output is used as HTML
and it removes only X") and needs `located` to see the use.

---

## safe-name-is-safe

### Rule

```yaml
- id: safe-name-is-safe
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: local
  at: 0.48
  # Fitted on records/final-local.json: clean tops at 0.27 (tryAcquireLock),
  # defects start at 0.70 (safeReadJson). `located` widened the gap to 0.66
  # and changed no decision; not needed.
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &safe_name
              field: name
              pattern: $NAME
              regex: "^(safe|try)([A-Z0-9_]|$)|(OrNull|OrDefault|OrUndefined)$"
      - all:
          - kind: method_definition
          - has: *safe_name
      - all:
          - kind: variable_declarator
          - has: *safe_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) says that failure is absorbed and reported
    as a value, but its body has a path on which a failure escapes as a
    throw or a rejection.
  criteria:
    "true": >-
      A failure of the kind the name promises to absorb can reach the caller
      as an exception or a rejected promise: the operation that can fail is
      outside any try, the catch rethrows or throws a new error, a failing
      case is detected and answered with a throw instead of the null,
      undefined, default, false or result value the name promises, or the
      fallback itself is computed by something that can fail.
    "false": >-
      Every failure of the kind the name refers to is turned into the value
      the name promises: null, undefined, a default, a boolean, or a result
      object the caller can inspect. A body that cannot fail at all, and so
      has nothing to catch, honours the name.
  note: >-
    A throw on a programmer error -- an argument of the wrong type, a misuse
    of the function's own API -- is not the failure such a name promises to
    absorb and does not count. Logging before returning the fallback is fine.
    The failure that counts is the one the name and the parameters are about:
    parsing, lookup, I/O, connection, conversion.
```

### Corpus

12 subjects found / 5 bad / 7 clean (5 hard).

- `safe.ts:4 tryParseDate` -- throws `RangeError` on the unparseable date the
  name promises to return `null` for.
- `safe.ts:12 safeReadJson` -- the read is in a `try`, `JSON.parse` is
  outside it; a malformed file throws.
- `safe.ts:33 getUserOrNull` -- throws `NotFoundError` on the missing row
  that `OrNull` promises to return `null` for.
- `safe.ts:39 parsePortOrDefault` -- returns the default only for an absent
  value and throws `RangeError` for an invalid one.
- `safe.ts:110 tryConnect` -- log-and-rethrow on the last attempt; the
  connection failure reaches the caller as a rejection.

Hard cleans: `tryParseInt` (throws `TypeError` on a non-string argument --
programmer error, decided in `note:` as not counting; parse failure returns
`null`), `safeGet` (no try/catch at all, cannot throw), `readConfigOrDefault`
(logs in the catch), `tryAcquireLock` (reports failure as `false`, nothing
to catch), `tryRun` (result object).

### Attempts

1. Ask "says that failure is absorbed and reported as a value, but its body
   has a path on which a failure escapes as a throw or a rejection"; `note:`
   excludes programmer-error throws. `gaps`: **works**, gap 0.43-0.44,
   head +0.41 (at 0.70); defects 0.67-0.93, cleans 0.05-0.27. One decision
   flip at the uncalibrated 0.70 (`safeReadJson` 0.67-0.71), none at the
   fitted 0.47. Not changed after this; attempts 2 and 3 re-ran the same
   sentence with the same result (gap 0.45, then 0.46).

### Fit

`records/final-local.json`, 3 passes. Cutoff **0.48** (midpoint of
0.27-0.70). Precision 1, recall 1 (tp 5, fp 0, fn 0). Decision flips: 0 at
0.48 (the 0.70 flip is 0.22 above the cutoff). Max spread 0.04. Headroom
0.21 above the top clean (`tryAcquireLock`), 0.22 below the lowest defect
(`safeReadJson`).
`located`: fit 0.46, gap 0.12-0.78 (cleans dropped, `safeReadJson` rose to
0.78-0.83); wider by 0.22, no decision changed. `local` has the headroom
already, so the file is not bought.

`fn-name-promises` at 0.83 on the five defects: 0.20, 0.20, 0.24, 0.29,
0.20 -- all inside its clean band. None flagged. This is the clearest case
in the family: "throws" is not "materially different from the name" to the
broad rule, and is exactly the promise `try*`/`*OrNull` makes.

`tryParseInt`'s `TypeError`: the `note:` decides that a throw on a wrong
argument type is not the failure the name absorbs. The model agrees at
0.14-0.17. If a team wants "never throws", delete that sentence and refit.

### Verdict

**SHIP.** Separates with >= 0.21 of headroom on both sides, no flips, the
hard cleans (no-try `safeGet`, `TypeError` in `tryParseInt`, logging
`readConfigOrDefault`) all answer under 0.27, and the shipped rule sees none
of its defects.

### What I would change

Corpus: an `async` `*OrNull` whose `await` sits outside the try, and a
`safe*` wrapper around a callback the caller supplies (does a throw from the
callback count? the `note:` says no by the programmer-error clause, but that
is untested). Matcher: `*OrEmpty` and `*OrZero` are the same promise; add
them once there is a case.

---

## idempotent-name

### Rule

```yaml
- id: idempotent-name
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: located
  at: 0.47
  # `located`, measured: on `local` the unconditional ALTER TABLE in
  # setupDatabase scores 0.22-0.28, under the top clean (setupLogger 0.25);
  # with the file in view it scores 0.64-0.72. Fitted on
  # records/final-located.json: clean tops at 0.28, defects start at 0.64.
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &idem_name
              field: name
              pattern: $NAME
              regex: "^(ensure|upsert|setup|install|register)([A-Z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *idem_name
      - all:
          - kind: variable_declarator
          - has: *idem_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) says a repeated call is harmless, but
    calling it a second time with the same arguments leaves a different
    result from calling it once.
  criteria:
    "true": >-
      The body performs its effect without finding out whether it is already
      in place, and repeating the effect accumulates or fails: it appends to a
      list or adds a listener, creates a record, index, table, column or
      resource that would then exist twice or make the second creation fail,
      inserts where a matching row may already be, or runs a step that is not
      itself safe to repeat -- with no existence check, no keyed overwrite and
      no guard that makes the second call a no-op. One such step is enough,
      even when the other steps of the body are safe to repeat.
    "false": >-
      A second call finds the effect already in place and leaves the state as
      the first call left it: the body checks for existence before acting,
      writes by key so a repeat overwrites the same entry, assigns rather than
      appends, uses an operation that is inherently repeatable (put, set,
      mkdir with recursive, CREATE IF NOT EXISTS, ON CONFLICT), returns early
      on a flag it sets, or has no effect at all beyond its return value.
  note: >-
    Only this body is judged. A helper it calls whose own name says it is
    repeat-safe (ensure*, upsert*, put*, set*, *IfNotExists) is assumed to
    be. Logging on each call, or returning a fresh object each call, is not a
    different result. A function whose name says ensure but is a pure
    conversion of its argument has nothing to repeat and is not a violation.
```

### Corpus

15 subjects found / 6 bad / 9 clean (7 hard). Overlaps `guard-name-guards`
on `ensure*`.

- `idempotent.ts:5 ensureIndex` -- `CREATE INDEX` without `IF NOT EXISTS`
  and without a check; the second call fails.
- `idempotent.ts:12 registerHandler` -- pushes onto an array; a second call
  registers the handler twice.
- `idempotent.ts:16 setupDatabase` -- an unconditional `ALTER TABLE ADD
  COLUMN` between two `IF NOT EXISTS` statements; the second call fails on
  the duplicate column.
- `idempotent.ts:22 installShutdownHooks` -- adds a fresh SIGTERM/SIGINT
  listener per call; the second call closes and exits twice.
- `idempotent.ts:39 upsertUser` -- a plain `INSERT`, no `ON CONFLICT`; the
  name says upsert.
- `idempotent.ts:117 setupWorkspace` -- overwrites `workspace.json` (that
  part is repeat-safe) and appends another `.cache/` line to `.gitignore`
  (that part is not).

Hard cleans: `registerCommand` (overwrites by key), `ensureBucket`
(existence check via `headBucket`), `setupLogger` (reassigns a module-level
binding every call, but to the same state), `installRequestId` (returns
early on a flag it sets), `registerCron` (clears the previous interval under
the same name), `ensureDir` (mkdir recursive), `ensureArray` /
`ensureTrailingSlash` (pure).

### Attempts

1. Ask "calling it a second time with the same arguments leaves a different
   result from calling it once". `gaps` (local): **works**, gap 0.57, head
   +0.45 at 0.70 -- but that gap is 0.26 -> 0.81 and `setupDatabase`, a
   defect, sits at 0.24-0.26 under the top clean (`setupLogger` 0.22). The
   fitter reported 0.23, precision 1, recall 1: a cutoff 0.01 above a clean
   and 0.01 below a defect, i.e. noise. Real fit: recall 4/5.
2. Same sentence; `setupWorkspace` added to see whether a mixed
   (idempotent + accumulating) setup is reachable. It scored 0.48-0.56:
   "half of it is repeat-safe" reads as 0.5. `setupDatabase` 0.22-0.23
   again. `gaps`: **works** on paper (gap 0.30), fitter: "no separating
   cutoff".
3. Criteria adds "One such step is enough, even when the other steps of the
   body are safe to repeat." `setupWorkspace` 0.54-0.63 on `local`,
   `setupDatabase` still 0.22-0.28. `gaps` (local): **move**, gap 0.37,
   head +0.08; after the last corpus additions (`final-local`) gap 0.31,
   head +0.12. Then `--arm located`: `setupDatabase` 0.64-0.72,
   `setupWorkspace` 0.68-0.77, cleans unchanged (top `setupLogger` 0.28).

### Fit

`records/final-located.json`, 3 passes, `state: located`. Cutoff **0.47**
(midpoint of 0.28-0.64). Precision 1, recall 1 (tp 6, fp 0, fn 0).
Decision flips at 0.47: 0 (the two flips the tool printed were at the
uncalibrated 0.70, `setupDatabase` 0.64-0.72 and `setupWorkspace`
0.68-0.77 -- both 0.17+ above 0.47). Max spread 0.09. Headroom 0.19 above
the top clean, 0.17 below the lowest defect.
On `local` (`records/final-local.json`) the same labels give recall 5/6:
`setupDatabase` is under the top clean and no cutoff reaches it; the honest
local fit is 0.42 (0.28-0.54) with 0.12 of headroom.

`fn-name-promises` at 0.83 on the six defects: 0.20, 0.09, 0.18, 0.19,
0.79, 0.19. None flagged; `upsertUser` is its highest answer on the whole
corpus and still 0.04 short.

### Verdict

**SHIP on `located`**, with one caveat stated: the file that lifts
`setupDatabase` from 0.26 to 0.68 is a file full of `IF NOT EXISTS` and
`ON CONFLICT` siblings, so part of that lift may be contrast rather than
SQL knowledge. On a real migration file with no such siblings the rule may
miss it again; the other five defects are visible from the body alone and
answer 0.6-0.93 on either arm.

### What I would change

Corpus: a `register*` on a framework router (Express adds duplicate routes
silently) is a real and common case, but it is API knowledge and would
probably score like `setupDatabase` on `local`; worth one measured case so
the report can say so. A `setup*` that is idempotent only because a
`try/catch` swallows the duplicate-creation error would be a good hard
clean for this rule and a defect for `guard-name-guards` at once.

---

## pure-name-is-pure

### Rule

```yaml
- id: pure-name-is-pure
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: local
  at: 0.48
  # Fitted on records/final-local.json: clean tops at 0.07, defects start at
  # 0.87. Memoisation into a module-level Map is decided to be an effect (see
  # note); exempting it in attempt 2 shrank the gap from 0.80 to 0.17.
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &pure_name
              field: name
              pattern: $NAME
              regex: "^(compute|calculate|derive|format|to|parse)([A-Z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *pure_name
      - all:
          - kind: variable_declarator
          - has: *pure_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) presents it as a computation of a result
    from its inputs, but its body changes state outside itself or performs
    I/O.
  criteria:
    "true": >-
      The body mutates an argument or something reachable through one,
      assigns to a module-level binding, a field of `this` or an object it did
      not create, records into a store that other code reads, logs, emits or
      increments a metric, or reads or writes a file, network, database,
      environment, clock or random source -- directly or through a call whose
      name shows it does so.
    "false": >-
      The body derives its result from its parameters, from `this` and from
      module-level values it only reads, using only locals it created, and
      returns it. A mutable local accumulator, a copy of an argument that is
      then modified, and a local object built up and returned are not effects
      outside the function.
  note: >-
    Reading `this` in a toJSON, toString or similar method is reading, not
    writing. Writing into a cache, Map or Set that outlives the call -- a
    module-level one or one captured from an enclosing scope -- is an effect
    outside the function even when it is only memoisation. Sorting or
    mutating a copy the body made itself is not mutating the argument.
```

### Corpus

16 subjects found / 7 bad / 9 clean (7 hard). `parsePortOrDefault` in
`safe.ts` overlaps `safe-name-is-safe` and is a hard clean here (it throws,
but touches nothing).

- `pure.ts:4 formatDate` -- `setHours` on its argument.
- `pure.ts:17 computeTotal` -- writes `cart.lastTotal` on its argument and
  increments a metric.
- `pure.ts:30 parseConfig` -- takes a path and reads the file.
- `pure.ts:41 deriveSessionKey` -- increments `account.keyVersion`; each
  call derives a different key.
- `pure.ts:48 toSlug` -- records into a module-level `Set`, so the same title
  yields a different slug next time.
- `pure.ts:82 formatMoney` -- memoises `Intl.NumberFormat` into a
  module-level `Map`. Decided in attempt 3 to be an effect; see Attempts.
- `pure.ts:128 calculateShippingCost` -- fetches a quote over the network.

Hard cleans: `toJSON` / `toString` (read `this`), `computeChecksum` (mutable
local accumulator), `toSorted` (`.sort()` on a copy it made), `deriveTheme`
(assigns into an object it created by spreading), `formatLogLine` ("log" in
the name, constructs a `Date`, pure), `parseDbEnv` ("env" in the name, but
the environment is a parameter), `parseArgs`, `parsePortOrDefault`.

### Attempts

1. Ask "presents it as a computation of a result from its inputs, but its
   body changes state outside itself or performs I/O"; `note:` says
   memoisation into a closure-captured `Map` is not an effect;
   `formatMoney` labelled clean. `gaps`: **works**, gap 0.75 (0.05 ->
   0.80), suggest 0.43 -- which would flag `formatMoney` at 0.80-0.81. The
   fitter, honouring the clean label, put the cutoff at 0.83 between
   `formatMoney` (0.81) and `calculateShippingCost` (0.84): a coin flip.
   The model does not accept "a Map write is not a write".
2. Criteria and `note:` rewritten to exempt memoisation explicitly, whether
   module-level or closure-captured, "a cache keyed by the function's own
   inputs that holds only what it would compute anyway". `formatMoney` fell
   to 0.51-0.62 (max spread 0.11, the wobbliest subject in the family) and
   `toSlug`, whose `Set` is also "a cache", fell from 0.90 to 0.79-0.83.
   `gaps`: **move**; its largest step (0.49) now lay inside the clean band
   (0.06 -> 0.51), and the clean/violation gap was 0.17 (0.62 -> 0.79), fit
   0.68 with 0.06 of headroom. Exempting memoisation cost 0.6 of gap and pulled a real defect
   toward the line.
3. Decision reversed: `note:` says a write into a cache, Map or Set that
   outlives the call is an effect "even when it is only memoisation";
   `formatMoney` relabelled bad with that argument. `formatMoney`
   0.91-0.92, `toSlug` 0.94-0.95, cleans 0.03-0.07. `gaps`: **works**, gap
   0.84.

### Fit

`records/final-local.json`, 3 passes. Cutoff **0.48** (midpoint of
0.07-0.87). Precision 1, recall 1 (tp 7, fp 0, fn 0). Decision flips: 0.
Max spread 0.03. Headroom 0.41 above the top clean (`formatLogLine` 0.07),
0.39 below the lowest defect (`calculateShippingCost` 0.87). `located`: fit
0.50, gap 0.07-0.92, identical decisions; not needed.

`fn-name-promises` at 0.83 on the seven defects: 0.65, 0.52, 0.19, 0.68,
0.58, 0.18, 0.15. None flagged, though four of them are the broad rule's
highest answers after `upsertUser` -- argument mutation is the one thing it
half-sees. `parseConfig` reading a file (0.19) and `calculateShippingCost`
fetching (0.15) it does not see at all: to the broad question a `parse*`
that reads a file is "parsing".

### Verdict

**SHIP.** The widest separation in the family (0.80 of gap, 0.39+ headroom,
no flips) -- on a corpus whose clean side is honest: a `.sort()` call, a
`Date` construction, "env" and "log" in the names, assignment into a local
spread all answer under 0.08. The one decision worth arguing is
memoisation, and the record shows why it was decided the way it was: with
the exemption the rule stops separating.

### What I would change

The memoisation decision means a memoised `format*` on real code is a
finding. That finding is accurate (the name does not say the function fills
a cache) but some teams will call it noise; the escape is
`jev-lint-ignore-next-line pure-name-is-pure` or renaming to
`cachedFormatter`. If the noise is unacceptable, the measured alternative is
attempt 2: 0.17 of gap, cutoff 0.68, and route the 0.5-0.7 band to a
person. Matcher: `to*` relies on the capital-letter boundary in the regex:
`total`, `token`, `toggle`, `topLevel` do not match, `toLowerCaseKeys` and
`toJSON` do, which is right.

---

## Cost

From the tool's own summaries (each `calibrate` pass printed its own line;
records carry the last pass's `spent`):

| run | requests | input tokens | USD |
| --- | --- | --- | --- |
| attempt 1 `gaps` (local) | 4 | 31,288 | 0.00131 |
| attempt 1 `calibrate --repeat 3` | 12 | 93,864 | 0.00394 |
| attempt 2 `calibrate --repeat 3` | 12 | 97,992 | 0.00412 |
| attempt 3 `calibrate --repeat 3` | 12 | 96,747 | 0.00406 |
| final `calibrate --repeat 3` (local) | 12 | 101,856 | 0.00428 |
| final `calibrate --repeat 3 --arm located` | 12 | 115,038 | 0.00483 |
| `check -R rules/naming.yml --retry 3` (comparison) | 24 | 177,336 | 0.00745 |
| **total** | **88** | **~714,000** | **~$0.030** |

Output tokens were ~1,100-1,200 per calibrate pass and 6,816 for the
comparison run. Well under the $0.50 budget; the largest single run was
$0.0075.

---

## pure-name-is-pure, revision 2

Revision 1 (above) was run over an unseen repository, mizchi/agent-cluster
(`../unseen/agent-cluster.json`, 182 subjects for this rule), and produced 6
findings. All 6 were one pattern at one or two removes: a `parse*`/`compute*`
whose body begins `const mod = await getXModule()` -- a lazily loaded,
memoised wasm module -- and then calls a pure function on `mod`. The rule
counted the load as I/O (0.56-0.72). This revision draws the line the
revision-1 note left undrawn: *caching this function's own result* is an
effect; *obtaining a dependency the function needs* is not. It then hit a
second hole the corpus did not contain and the unseen code did, and fixed
that too. Three attempts, every number from `records/pure-v2*.json`.

The six revision-1 findings, judged (all under
`/Users/mz/ghq/github.com/mizchi/agent-cluster/`):

| finding | rev 1 | what the body does | real impurity? |
| --- | --- | --- | --- |
| `apps/agent-worker/loop-contract.ts:116 parseLoopBootstrapRequest` | 0.71 | awaits `getLoopContractModule()`, calls `mod.loop_parse_bootstrap_request` | **no** -- the loader memoises an `import()`; the body converts its arguments |
| `apps/agent-worker/loop-contract.ts:129 parseLoopIterateRequest` | 0.72 | same loader, `mod.loop_parse_iterate_request` | **no** |
| `packages/agent-cluster/hub-pr-review.ts:214 parseHubPrReviewItem` | 0.70 | awaits `getHubPrReviewModule()`, calls `mod.hub_pr_parse_review_item` | **no** |
| `apps/agent-worker/worker.ts:3463 parseTodoSeedTaskDraft` | 0.58 | awaits `sanitizeLoopObjectivePrefix()` (itself the same loader pattern, in `loop-domain.ts:115`) and calls `readEnvString(raw.x)`/`readEnvInt(raw.y, ...)` -- helpers that receive the value as an argument | **no** -- the `Env` in the helper names is misleading, nothing reads the environment |
| `apps/agent-worker/worker.ts:13138 computeOrchestratorReactionStep` | 0.56 | awaits `getOrchestratorCoreModule()`, calls `mod.orchestrator_reaction_step`, falls back to a pure TS implementation | **no** |
| `packages/agent-cluster/run-collector.ts:224 parseCycleEventsBody` | 0.57 | awaits `getRunCollectorModule()`, calls `mod.run_collector_parse_cycle_events` | **no** |

Six findings, zero real. Revision 1's precision on unseen code was 0.

### Rule

```yaml
- id: pure-name-is-pure
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: local
  at: 0.55
  # Fitted on records/pure-v2.json: clean tops at 0.31 (parseWorkerLimits), defects
  # start at 0.60 (parseCliOptions); midpoint 0.46. Set at 0.55 for the unseen
  # band (records/pure-v2-unseen.json): its top clean is 0.50, its lowest real
  # finding 0.68, so 0.55 leaves 0.05 under the corpus defects and 0.05 over
  # the unseen cleans. Thin on both sides; see REPORT.md.
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &pure_name
              field: name
              pattern: $NAME
              regex: "^(compute|calculate|derive|format|to|parse)([A-Z0-9_]|$)"
      - all:
          - kind: method_definition
          - has: *pure_name
      - all:
          - kind: variable_declarator
          - has: *pure_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) presents it as a computation of a result
    from its inputs, but its body changes state outside itself or performs
    I/O.
  criteria:
    "true": >-
      The body mutates an argument or something reachable through one,
      assigns to a module-level binding, a field of `this` or an object it did
      not create, stores something it computed into a cache, Map, Set or
      other store that outlives the call, logs, emits or increments a metric,
      or reads or writes a file, network, database, environment, clock or
      random source -- directly, or through a call whose name or arguments
      show it does so (fetch, a path, a URL, a query, send, save). One such
      read or write on any path is enough: a default taken from the clock,
      the environment or a random source when a field is missing, or an
      effect in a fallback branch, makes the body impure even though its
      common path is not.
    "false": >-
      The body derives its result from its parameters, from `this`, from
      module-level values it only reads, and from dependencies it obtains --
      a module, binding, table, formatter, parser or backend handed back by a
      loader, resolver or registry lookup -- and returns it. A mutable local
      accumulator, a copy of an argument that is then modified, and a local
      object built up and returned are not effects outside the function.
  note: >-
    Obtaining a dependency is not an effect. Calling or awaiting a helper
    that hands back a module, native binding, compiled table, backend or
    client (get*Module, load*, require, resolve*, a dynamic import) acquires
    something the body needs; that the helper memoises what it loaded is the
    helper's business, not this body's. What is judged is what the body then
    does with its inputs: calling a pure function of an acquired module is a
    computation, using an acquired client to fetch, read, write or send is
    I/O. The line is what gets written: a body that puts its own result -- a
    value it computed, a key it generated, a formatter it built -- into a
    cache, Map or Set that outlives the call changes what later calls observe
    and is an effect even when it is only memoisation; a body that only takes
    a dependency out of such a store is not. A helper that receives its input
    from a parameter (readEnvInt(raw.count, ...)) reads that argument, not
    the environment, whatever its name says. Reading `this` in a toJSON,
    toString or similar method is reading, not writing. Sorting or mutating a
    copy the body made itself is not mutating the argument.
```

### Corpus

`corpus/pure.ts` grew from 16 to 28 subjects for this rule (with
`parsePortOrDefault` in `safe.ts`): 12 bad, 16 clean (13 hard). Existing
cases and labels untouched; everything new is appended.

Attempt 1 added the lazy-dependency shapes, six hard cleans and two bads
that hold the boundary from the other side:

- `pure.ts:185 parseIcuMessage` -- clean: awaits a memoised module loader
  (`getIcuCoreModule`, the agent-cluster shape) and calls a pure parse on it.
- `pure.ts:195 formatPluralLabel` -- clean: same loader after an early return.
- `pure.ts:215 computeContentHash` -- clean: a synchronous `require`-once
  cache (`loadNativeHasher`) for a native binding, then a hash of the bytes.
- `pure.ts:235 toCountryName` -- clean: reads a constant table a helper builds
  lazily on first use.
- `pure.ts:251 derivePublicKey` -- clean: resolves a backend from a
  module-level registry, derives from the seed; the registry is only read.
- `pure.ts:273 parseWorkerLimits` -- clean: calls `readEnvInt`/`readEnvString`
  on fields of its argument (the `worker.ts:3463` shape).
- `pure.ts:300 parseRemoteManifest` -- **bad**: acquires a lazily initialised
  client (fine) and then uses it to GET a URL. The I/O is the fetch, not the
  acquisition.
- `pure.ts:323 computeRoute` -- **bad**: acquires the router module (fine),
  then writes the route it computed into a module-level `routeCache`. Caching
  its own result is the effect the note still counts -- the same decision as
  `formatMoney` and `toSlug`.

Attempt 2 added the class the unseen run exposed (see Attempts), three bads
and one hard clean:

- `pure.ts:346 parseCheckpoint` -- **bad**: `new Date().toISOString()` as the
  default for a missing `started_at`/`updated_at`; the common path is pure,
  the fallback path reads the clock (the `worker.ts:7586/16594/5308` shape).
- `pure.ts:360 toCheckpoint` -- clean: the same function with the timestamp
  injected as a `now` parameter; the fix shape.
- `pure.ts:379 parseCliOptions` -- **bad**: reads `process.env.CLUSTER_API_TOKEN`
  as the default token in an argv parser (the `self-improve-loop.ts:1875`
  shape).
- `pure.ts:400 toReviewRecord` -- **bad**: mints `rev_${crypto.randomUUID()}`
  when there is no current record; a random source on the fallback path (the
  `worker.ts:5133` shape).

### Attempts

1. Criteria `"false"` adds "and from dependencies it obtains -- a module,
   binding, table, formatter, parser or backend handed back by a loader,
   resolver or registry lookup"; `"true"` says "stores something it computed
   into a cache" instead of "records into a store"; `note:` rewritten to say
   obtaining a dependency is not an effect, the memoising loader is the
   helper's business, and "the line is what gets written: a body that puts its
   own result into a cache ... is an effect even when it is only memoisation;
   a body that only takes a dependency out of such a store is not". Corpus 24
   subjects. `gaps`: **works**, gap 0.76, head +0.32, top<at 0.16, suggest
   0.54. Calibrate (`records/pure-v2-attempt1.json`): clean tops at 0.20
   (`parseWorkerLimits` 0.17-0.20), the six new hard cleans at 0.06-0.14,
   defects start at 0.90 (`parseRemoteManifest`); `formatMoney` 0.93-0.94,
   `toSlug` 0.96, `computeRoute` 0.96 -- the memoisation decision held. Fit
   0.55, precision 1, recall 1 (tp 9), 0 flips, max spread 0.03. On unseen
   (`records/pure-v2-attempt1-unseen.json`, at 0.55): the three lazy-module
   findings fell to 0.14-0.25, `worker.ts:3463` to 0.35, `:13138` to 0.27.
   Two findings: `worker.ts:7586` 0.56 and `:5133` 0.55 -- both **real**
   (a clock read and a `randomUUID()`, each on a fallback path), and both
   0.01 above the cutoff, with four more of the same kind at 0.43-0.47 under
   it. The corpus had no "impure only on the fallback path" case, so its
   0.70 gap was measuring a class the unseen code does not have.
2. Criteria `"true"` adds "One such read or write on any path is enough: a
   default taken from the clock, the environment or a random source when a
   field is missing, or an effect in a fallback branch, makes the body impure
   even though its common path is not." Corpus +4 (above), 28 subjects.
   `gaps`: **works**, gap 0.33, head +0.30, top<at 0.25. Calibrate
   (`records/pure-v2.json`): the three fallback defects 0.84-0.85
   (`parseCheckpoint`), 0.80-0.83 (`toReviewRecord`), 0.60-0.66
   (`parseCliOptions` -- the model half-accepts `process.env` in an argv
   parser as convention); clean tops at 0.31 (`parseWorkerLimits`, up from
   0.20: the word "environment" in the clause pulled the `readEnv*`-named
   helper up). Fit 0.46, precision 1, recall 1 (tp 12), 0 flips, max spread
   0.06. On unseen (`records/pure-v2-unseen.json`): the six fallback-path
   impurities at 0.68-0.83; top clean 0.50 (`worker.ts:3463`); gap 0.18.
3. `note:` makes the environment concrete ("process.env, Deno.env,
   import.meta.env, or a settings object read from module scope"), restates
   that a value arriving through a parameter is an input whatever the helper
   is called, and adds "an argv parser that also reads process.env is reading
   the environment, however conventional that is for a CLI"
   (`pure-v2-attempt3.yml`). `gaps`: **works**, gap 0.35, head +0.09, top<at
   0.46. Calibrate (`records/pure-v2-attempt3.json`): `parseCliOptions` rose
   to 0.78-0.82 as intended, but `parseWorkerLimits` rose to 0.43-0.52 (max
   spread 0.09, the wobbliest subject): naming the environment made the model
   warier of the `readEnv` name, the explicit example notwithstanding. Fit
   0.63, tp 12, 0 flips. On unseen (`records/pure-v2-attempt3-unseen.json`):
   the six real findings 0.72-0.87, but the whole `readEnvString`-using clean
   band lifted from 0.10-0.20 to 0.40-0.48 and `worker.ts:8025
   toBillingUserSummary` -- a pure field mapping whose only suspicious token
   is `readEnvString(ledger.events[0]?.at)` -- reached 0.65: one false
   positive, and a gap of 0.07 between the top clean and the lowest real
   finding, against attempt 2's 0.18. **Attempt 2 is the final.**

### Fit

`records/pure-v2.json` (attempt 2), 3 passes, `state: local`. Corpus:
clean tops at 0.31 (`parseWorkerLimits`), defects start at 0.60
(`parseCliOptions`); fitted midpoint **0.46**, precision 1, recall 1 (tp 12,
fp 0, fn 0), decision flips 0, max spread 0.06. Unseen
(`records/pure-v2-unseen.json`, 182 subjects): top clean 0.50, lowest real
finding 0.68.

Cutoff written as **0.55**, not the midpoint, for the unseen band
(calibration.md step 6): `replay` at 0.55 gives 12/12 on the corpus with no
flip (`parseCliOptions` 0.60/0.60/0.66) and 6 findings on unseen, all real.
Headroom: 0.24 above the corpus cleans, 0.05 below the corpus defects, 0.05
above the unseen cleans, 0.13 below the unseen findings. The two 0.05s are
the honest number.

### Unseen findings, revision 2 (attempt 2 at 0.55)

Values are rev 1 / attempt 1 / attempt 2 / attempt 3.

| subject | values | judgement |
| --- | --- | --- |
| `apps/agent-worker/worker.ts:16594 parseOrchestratorDialogueSession` | 0.23 / 0.47 / **0.83** / 0.85 | **real**: `new Date().toISOString()` as the default for `at`, `created_at`, `updated_at`; the same input parses differently at a different time |
| `apps/agent-worker/worker.ts:5308 parseVirtualFsPrCheckpoint` | 0.26 / 0.46 / **0.83** / 0.82 | **real**: `new Date().toISOString()` as the default `started_at`/`updated_at` |
| `apps/agent-worker/worker.ts:7586 parseAuthD1PrincipalRecord` | 0.29 / 0.56 / **0.82** / 0.87 | **real**: `const nowIso = new Date().toISOString()` used as the default for both timestamps |
| `apps/agent-worker/worker.ts:5133 toHubPrRecordFromGitPrContract` | 0.45 / 0.55 / **0.73** / 0.78 | **real**: `pr_id: current?.pr_id ?? \`hpr_${crypto.randomUUID()}\`` -- a random source when there is no current record |
| `packages/agent-cluster/self-improve-loop.ts:1875 parseSelfImproveArgs` | 0.41 / 0.47 / **0.73** / 0.77 | **real**: reads `process.env.CLUSTER_API_TOKEN`, `AGENT_CLUSTER_TOKEN`, `BILLING_USER_ID` as defaults in an argv parser |
| `packages/agent-cluster/autonomous-self-improve.ts:1675 parseAutonomousSelfImproveArgs` | 0.38 / 0.43 / **0.68** / 0.72 | **real**: same, `process.env` at lines 1678 and 1708 |

Six findings, six real, all of one kind: a `parse*`/`to*` that is pure on
its main path and consults the clock, the environment or a random source
when a field is missing. Revision 1 scored all six 0.23-0.45 and flagged
none of them. Whether a team wants them flagged is a decision -- the fix is
`toCheckpoint`'s shape, inject `now` -- but each is exactly what the sentence
asks, and a `parse*` whose output depends on the wall clock is a real
testing hazard.

Under the cutoff, worth naming:

| subject | values | judgement |
| --- | --- | --- |
| `apps/agent-worker/worker.ts:3463 parseTodoSeedTaskDraft` | 0.58 / 0.35 / 0.50 / 0.48 | **clean** (rev-1 finding); 0.05 under. The `await sanitizeLoopObjectivePrefix()` is an async helper the body cannot see into, and the `readEnv*` names. The next false positive lives here. |
| `apps/cloudflare-debug/worker.ts:32 parseJsonBody` | 0.32 / 0.42 / 0.47 / 0.40 | **arguable**: `await request.text()` consumes the request's body stream. The `Request` is the input; reading it is reading the input, but it is also the network. The model's 0.47 is a fair answer. |
| `apps/agent-worker/worker.ts:7937 parseBillingLedger` | 0.16 / 0.19 / 0.37 / 0.52 | **real but invisible on `local`**: `defaultBillingLedger()` reads the clock (`worker.ts:7932`), and neither its name nor the body shows it. A `located` arm would see it; not measured. |
| `apps/agent-worker/worker.ts:8025 toBillingUserSummary` | 0.28 / 0.25 / 0.25 / 0.65 | **clean**; attempt 3's false positive, 0.25 under attempt 2. |
| lazy-module rev-1 findings (`loop-contract.ts:116/:129`, `hub-pr-review.ts:214`, `run-collector.ts:224`, `worker.ts:13138`) | 0.56-0.72 / 0.14-0.27 / 0.15-0.37 / 0.15-0.36 | **clean**; the pattern this revision was for, now 0.18+ under the cutoff on every attempt. |

### Verdict

**COOKBOOK.** The dependency distinction works (the pattern that was 100%
of revision 1's unseen findings is now 0.15-0.37, and the memoisation
decision survived it untouched), and the revision found a second class the
corpus lacked and now catches it on unseen code with precision 6/6 -- but
the cutoff that does both has 0.05 of headroom on each side, under the
brief's 0.10 for SHIP, and the class that sits at 0.50 (`readEnv*`-named
helpers plus an opaque `await`) is common in real code. Ship the criteria
and note as the recipe; a cutoff needs a corpus with a dozen
`readEnv`-shaped cleans before anyone trusts 0.55.

### What I would change

Corpus: the `readEnvString(raw.x)` shape is the whole remaining risk and it
has one case; it needs five or six, including one that also awaits an
opaque helper, so the clean top on the corpus matches the clean top on real
code (0.31 vs 0.50 now). State: `parseBillingLedger` says the clock read one
helper down is invisible on `local`; a `located` run would say whether the
file buys it without lifting the `readEnv` cleans further, and was not
measured. Note: attempt 3 showed that any sentence mentioning the
environment by name raises the `readEnv`-named cleans by 0.2; the wording
that separates is the one that does not name it.

### Cost, revision 2

From the records' `spent` (per pass for calibrates; `gaps` priced from its
own summary line):

| run | requests | input tokens | USD |
| --- | --- | --- | --- |
| attempt 1 `gaps` | 2 | ~19,600 | 0.00082 |
| attempt 1 `calibrate --repeat 3` | 6 | 58,764 | 0.00247 |
| attempt 1 unseen `check` | 26 | 177,490 | 0.00745 |
| attempt 2 `gaps` | 2 | ~24,400 | 0.00103 |
| attempt 2 `calibrate --repeat 3` (final) | 6 | 73,332 | 0.00308 |
| attempt 3 `gaps` | 2 | ~25,900 | 0.00109 |
| attempt 3 `calibrate --repeat 3` | 6 | 77,784 | 0.00327 |
| attempt 3 unseen `check` | 26 | 195,482 | 0.00821 |
| attempt 2 unseen `check` (final) | 26 | 186,313 | 0.00783 |
| **total** | **102** | **~839,000** | **~$0.035** |

Output tokens: ~490-570 per calibrate pass, 3,564 per unseen run. Largest
single run $0.0082. Family total with revision 1: ~$0.065 of the $0.50.
