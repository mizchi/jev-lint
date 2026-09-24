# Family F: names that promise a resource is released

One rule, for TypeScript/TSX/JavaScript/JSX, the next member of the
guarantee-name family (`guard-name-guards`, `safe-name-is-safe`,
`idempotent-name`, `pure-name-is-pure`): a function named `with*`, `using*`,
`scoped*`, `runWith*`, `inTransaction*` or `*Scope` promises that whatever it
acquires for the callback it runs is given back when the callback ends --
on the throw and the early return as much as on the happy path. A linter can
find the names for nothing (the regex on `$NAME`) and can find `try` without
`finally`; it cannot say whether the thing before the `try` was an
acquisition, whether `db.transaction(fn)` or `await using` already does the
scoping, whether a timer cleared in both promise handlers is the same as a
`finally`, or whether a `<style>` appended in an effect with no cleanup is a
leak. Jev reads the body against the one promise. On the corpus every
strong defect class -- release only after the awaited callback, release
only on the success branch, a spinner or `isLoading` flag reset only on
success, a span ended only on success, a temp dir removed only on success,
an interval skipped by a rethrow -- answers 0.67-0.93 against a clean band
whose React HOCs, delegating wrappers, `using` declarations and for-await
loops all sit under 0.13. What keeps it from shipping is the pair of
structural edge cases the corpus and unseen code turned up, described
below.

Corpus: `experiments/rule-candidates/with-name-releases/evals/cases/`
(`resources.ts`, `cli.ts`, `wrappers.tsx`, `edge.ts`) -- 33 subjects, 12
bad, 21 clean, 17 of the cleans labelled hard. Labels in `evals/labels.json`
with the argument for each. Records in `records/`: `attempt1..3-local.json`
are the single-pass sentence iterations (`calibrate --repeat 1`),
`unseen-attempt3.json` and `unseen-final.json` are the runs over 25 real
subjects the corpus never saw; the fits are `evals/baseline.json` (final)
and the numbers below are from `eval --repeat 3 --no-config --cache none`.

Two tooling notes. `gaps` does not honour `--record`, so the per-subject
answers behind an attempt come from `calibrate --repeat 1 --record` over
the same directory (same price, ~$0.001). And `calibrate --labels` resolves
label paths differently from `eval` (it printed "no labeled violations
matched" for the `evals/labels.json` layout), so the fits here are from
`eval`, and the attempt records were scored by hand from their answers.

---

## with-name-releases

### Rule

```yaml
# Guarantee names, resource scoping: with* / using* / scoped* / runWith* /
# inTransaction* / *Scope with a body that acquires something and has a path
# on which it is never released.
#
# The sibling rules in this family (safe-name-is-safe, idempotent-name,
# pure-name-is-pure, guard-name-guards) each narrow the shipped
# fn-name-promises to one promise a name makes; this one is the promise that
# a resource acquired for a callback is given back when the callback ends,
# whichever way it ends. The name is the matcher's job (a regex on $NAME) and
# is over-matched on purpose: withRouter, withDefaults, withRetry and
# withAuth(Component) acquire nothing, and the criteria say so -- a body
# that holds no resource has nothing to leak. Only the release is the
# model's question.
#
# `local`: the body is the evidence. A release delegated to a helper is
# judged by that helper's name (db.transaction, mutex.runExclusive,
# AsyncLocalStorage.run, `using`, a for-await loop), never by the file, so
# `located` was not measured.

- id: with-name-releases
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: local
  # 0.56, fitted 2026-09-20 on evals/ (12 defects, 21 cleans, 3 passes).
  # Before the two hard cleans taken from unseen code the fit was 0.45 with
  # 0.15 of headroom each side (clean top 0.31, `withMemo`). Those two --
  # `withImmediateWrite`, a retry loop whose rollback has its own error
  # swallowed, and `withDeadline`, a timer cleared in both promise handlers
  # rather than a finally -- answer 0.49 and 0.41, and the weakest defects
  # (`withLock`, an early return between acquire() and the try; `withPidFile`,
  # two things acquired and one released) answer 0.64-0.65. The gap is 0.15
  # on the mean and 0.07 across passes; the midpoint is 0.56 and the headroom
  # is under 0.10 on both sides, which is why this is a cookbook recipe and
  # not a shipped cutoff.
  threshold: 0.56
  rule:
    any:
      - all:
          - kind: function_declaration
          - has: &scope_name
              field: name
              pattern: $NAME
              regex: "^(with|using|scoped|runWith|inTransaction)([A-Z0-9_]|$)|Scope$"
      - all:
          - kind: method_definition
          - has: *scope_name
      - all:
          - kind: variable_declarator
          - has: *scope_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function's name ($NAME) says it holds a resource only for the
    duration of the work it runs, but its body has a path on which something
    it acquired is not released, rolled back, cleared or restored.
  criteria:
    "true": >-
      The body acquires something -- a connection, client, lock, file handle,
      cursor, transaction, temporary file or directory, timer, listener,
      span, spinner, or a flag it sets on the way in -- and there is a path
      through the body on which the matching release does not happen: the
      release is written only after the awaited callback with no try/finally
      around it, so a throw or rejection skips it; it sits only in the
      success branch of a try/catch and the catch rethrows without it; an
      early return leaves after the acquisition and before it -- including a
      return that sits between the acquisition and the try/finally that
      would have released it; or one of two things acquired is released and
      the other is not.
    "false": >-
      Either the body acquires nothing that needs giving back -- it wraps a
      component, merges defaults, retries, or passes a value through -- or
      everything it acquires is released on every path: in a finally, by a
      helper whose own name or shape does the scoping (transaction(fn),
      runExclusive(fn), run(ctx, fn), acquire-and-callback APIs), by a
      `using` or `await using` declaration, or by a for-await loop, which
      closes its iterator when the loop exits by return or throw. Rollback in
      the catch and release in the finally is the honoured shape.
  note: >-
    Only this body's own acquisitions are judged. A helper the body calls
    whose name says it scopes, runs or disposes (transaction, runExclusive,
    withLock, using, dispose, close on a for-await) is assumed to release what
    it acquires, and a callback passed to such a helper is inside that
    helper's scope. Whether the callback's own work is correct is not the
    question; what matters is what this body took and whether the path that
    throws, rejects or returns early gives it back. A finally protects only
    the statements inside its try: something acquired before the try and
    returned from before the try is never reached by that finally. What is
    judged is whether the path reaches the release, not whether the release
    itself can fail: a rollback or close that is attempted on the failure
    path and has its own error swallowed is a release that was reached.
    Logging in the catch is fine. A timer set and never cleared, and a
    boolean flag set on entry and reset only on success, count as acquired
    and not released.
  axis: file
```

### Corpus

33 subjects found / 12 bad / 21 clean (17 hard).

- `resources.ts:7 withConnection` -- `client.release()` only after
  `await fn(client)`, no try/finally; a rejection leaks the pooled connection.
- `resources.ts:14 withTransaction` -- `client.release()` only in the
  success branch; the catch rolls back and rethrows without releasing.
- `resources.ts:56 withLock` -- `return undefined` on `signal.aborted`
  between `mutex.acquire()` and the try/finally that would release it.
- `resources.ts:81 withTempDir` -- `rm(dir)` only after `fn` resolves.
- `cli.ts:6 withSpinner` -- `spinner.succeed()` only after the task
  resolves; a rejection leaves it spinning.
- `cli.ts:13 withPolling` -- the catch rethrows before the `clearInterval`
  that follows the try/catch; on failure the interval keeps the process alive.
- `cli.ts:66 traceScope` -- `span.end()` only after `fn` resolves.
- `cli.ts:86 withSyncing` (method) -- `this.isSyncing = true` on entry,
  reset only after `action` resolves.
- `wrappers.tsx:68 withSaving` (arrow inside a hook) -- `saving: true`
  before `await save(draft)`, reset only on resolve.
- `wrappers.tsx:81 withStyleOverride` -- appends a `<style>` in an effect
  with no cleanup; the override outlives the wrapped component.
- `edge.ts:43 withPidFile` -- two things acquired (pid file, heartbeat
  interval); the finally removes the file and never clears the interval.
- `edge.ts:101 withFallbackTimeout` -- `clearTimeout` only after
  `await Promise.race`; when the operation rejects the await throws and the
  timer fires `fallback()` later. Rewritten from the one true finding on
  unseen code (crater `wpt-runner.ts:2682 withTimeout`).

Hard cleans: `withRouter`, `withAuth`, `withDefaults`, `scopedLogger`,
`withSnapshot`, `withRetry` (acquire nothing); `inTransaction`
(`db.transaction(fn)`), `withKeyLock` (`runExclusive`), `runWithContext`
(`AsyncLocalStorage.run`), `withScratchDir` (`await using`), `usingCursor`
(return from inside a for-await closes the cursor), `withTimeout` (timer
cleared in a `.finally` on the race), `withKeyboardShortcuts` (listener
removed in the effect cleanup), `withClient` (release duplicated in both
branches, no finally), `withBatchClient` (early return *before* the
acquisition), `withFileLock` (`.finally(release)` on the promise chain),
`withMemo` (a memo cache keeps state on purpose), and the two lifted from
unseen code after attempt 3: `withImmediateWrite` (a retry loop that begins
a transaction inside the try, with the rollback's own error swallowed) and
`withDeadline` (timer cleared in both the fulfil and the reject handler).

### Attempts

All on `subject: node`, `state: local`; the body holds both sides of the
comparison and every delegated release is judged by the helper's name, so
`located` was not measured.

1. Sentence as above; criteria list the four leak shapes; note names the
   scoping helpers, `using`, for-await, and says a timer or flag counts.
   25 subjects (10 bad). `gaps`: **move**, gap 0.30, head +0.07 at 0.70,
   suggest 0.30. Per subject (`records/attempt1-local.json`): defects
   0.63-0.93 except `withLock` at **0.43**; clean top 0.12
   (`inTransaction`). Precision 1, recall 1 at the suggested cutoff, but
   the early-return defect sits 0.31 above the cleans and 0.20 under the
   next defect. $0.0008 (+$0.0008 for the `gaps` run itself).
2. Criteria `true` adds "including a return that sits between the
   acquisition and the try/finally that would have released it"; note adds
   "a finally protects only the statements inside its try". `gaps`:
   **move**, gap 0.44, head +0.04, suggest 0.32. `withLock` 0.43 -> 0.54,
   no clean moved above 0.10. $0.0009.
3. Same sentence; corpus +5 (`edge.ts`: four hard cleans that a lazy rule
   flags -- release in both branches without finally, early return before
   the acquisition, `.finally()` on the chain, a memo cache -- and the
   two-acquisitions defect). `gaps`: **move**, gap 0.33, head +0.04,
   suggest 0.45. Clean top rose to 0.29 (`withMemo`), defect bottom 0.62
   (`withLock`); `withPidFile` 0.70. $0.0011. `eval --repeat 3`: fitted
   0.45, P 1 R 1 (11/0/0), 0 flips at 0.45, clean top 0.31, defect bottom
   0.54 on the lowest pass / 0.59 on the mean; accepted as a first baseline.
   Then 25 unseen real subjects from other repositories under ghq (mnemo,
   crater, oden, rolldown, chaosbringer, lightbringer, flaker,
   agent-cluster; `records/unseen-attempt3.json`, 3 passes): 2 findings,
   `withTimeout` 0.68 (real: timer skipped when the raced operation
   rejects) and `withWrite` 0.58 (false: a retry loop whose rollback is
   attempted and its own failure swallowed); next `withChaos` 0.43 (a
   crawler handed to `use(fixture)` with no teardown -- whether it owns a
   browser is not visible, an honest hedge) and `withWallTimeout` 0.36
   (clean, cleared in both handlers). The unseen clean band tops 0.27 above
   the corpus's. $0.0037.
   Third and last wording change, folded into this attempt's refit: note
   adds "what is judged is whether the path reaches the release, not
   whether the release itself can fail"; corpus +3 (`withImmediateWrite`
   and `withDeadline` as hard cleans rewritten from the unseen shapes,
   `withFallbackTimeout` as a defect rewritten from the unseen finding).
   Result below.

### Fit

`evals/baseline.json`, 33 subjects, 3 passes. Cutoff **0.56** (fitted
midpoint 0.55). Precision 1.00, recall 1.00 (tp 12, fp 0, fn 0) on the
mean. Decision flips across the 3 passes: **1** (`withPidFile`, 0.70 /
0.52 / 0.67). Max spread 0.18 (the same subject). Clean top 0.51
(`withImmediateWrite`; 0.52 on its highest pass), then `withDeadline`
0.42, `withMemo` 0.30, everything else under 0.12. Defect bottom 0.58
(`withLock`; 0.56 lowest pass), `withPidFile` 0.63, then 0.67-0.93.
Headroom: **0.05** above the top clean, **0.02** below the lowest defect on
the mean; 0 across passes (0.52 vs 0.52).

Before the two unseen-derived hard cleans the same rule fitted at 0.45 with
0.15 of headroom each side and no flips; those two cases are what the
number really is.

Unseen, final rule (`records/unseen-final.json`, 25 subjects, 3 passes):
`withTimeout` 0.68 (3/3, real), `withWrite` 0.57 (2/3, false), `withChaos`
0.42, `withWallTimeout` 0.37, all else under 0.25. One finding in two is
wrong, and the wrong one straddles the cutoff.

### Verdict

**COOKBOOK.** The rule separates the resource-leak shapes people actually
write -- release after the await, release on the success branch only, the
flag or spinner never reset, the span or temp dir handled only on success,
the interval skipped by a rethrow -- from HOCs, delegations, `using` and
for-await by 0.35 or more, and it found a real dangling-timer bug in unseen
code on its first run. But two structural cases pin the bands together:
the model reads a retry loop that *attempts* a rollback and swallows the
rollback's own error as a path without release (0.51-0.58), and it reads an
early return between `acquire()` and the `try` (0.58) and a second
acquisition beside a released first one (0.52-0.70) as only probably
leaks. Three wording attempts moved those by 0.1-0.2 and not further, the
headroom is 0.05/0.02 with one flip, and the unseen false positive sits on
the cutoff. Worth the recipe "a scoping name is an every-path claim"; not
worth a shipped cutoff.

### What I would change

- Corpus: the honest thing is that the attempted-rollback and the
  early-return-before-try shapes need three or four instances each before
  any cutoff between 0.45 and 0.60 means anything; today each is one case.
  Real `with*` code is also rarer than `validate*` (0 subjects in
  jev-lint's own `src/`, 25 across eight repositories), so a corpus of it
  is slower to grow from unseen findings.
- Rule: if it is ever revisited, split by acquisition kind rather than by
  wording: the timer/flag/spinner subclass (`withSpinner`, `withPolling`,
  `withSyncing`, `withSaving`, `withFallbackTimeout`: 0.68-0.93, no clean
  above 0.42) would ship on its own today; it is the transaction-with-retry
  and lock-with-early-return subclass that does not.
- Matcher: keep it. `Scope$` matched `metricScope`/`runtimeScope`/
  `matchesRuntimeScope` on unseen code and all three answered under 0.10;
  the over-match costs nothing.
- State: `located` might lift `withChaos` (whether `ChaosCrawler` owns a
  browser is in the file), but that is one hedge, not the pinned pair.

---

**Cost**: 157 requests, ~601k input tokens, **$0.0248** -- `gaps` $0.0008;
`calibrate` x3 $0.0027; `eval --repeat 3` x4 $0.0136 (two fits, two
accepts); unseen `check --retry 3` x2 $0.0076.
