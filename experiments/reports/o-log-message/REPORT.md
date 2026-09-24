# Family O: the log message, in TypeScript

One rule, `typescript/log-message-matches-event`, the sibling of the shipped
`log-level-matches-event`: the same matcher, judging the message text
instead of the level. A log message is a claim about what just happened, or
is about to, at the point where the call sits -- "user saved" is a claim
that a save ran, "cache hit" that the cached branch was taken, "retrying"
that something goes round again, "deleted 12 rows" that 12 is the deleted
count. A linter can see the string and the level and nothing about the
path; jev reads the enclosing function and says whether the message is true
of the point where it is emitted. The family's difficulty is on the clean
side: intent phrasing before an operation ("saving user"), a terse "done",
a message in a `finally`, and the same text that is a defect in one function
and true in the next.

Candidate: `experiments/rule-candidates/typescript/log-message-matches-event/`
(rule.yml, fixtures/{sync,billing}.ts, expect.yml, baseline.json and
last.json from the accepted run). Verdict: **SHIP** on this corpus -- P
1.00 / R 1.00 (7/0/0) at 0.62, no flips, 0.17 of headroom each side on the
means and 0.10 / 0.14 on the worst pass -- with one tooling caveat below
that affects exactly this rule's copy-paste defect class.

---
## log-message-matches-event

### Rule

`experiments/rule-candidates/typescript/log-message-matches-event/rule.yml`:

```yaml
# The sibling of log-level-matches-event: same matcher, judging the message
# text instead of the level. A log message is a claim about what just
# happened, or is about to, at the point where it is emitted; a linter has no
# notion of "happened".

id: log-message-matches-event
languages:
  - TypeScript
  - Tsx
  - JavaScript
  - Jsx
kind: noul
subject: node
# `local`, as the level rule: the message is judged against the path it
# sits on, and the enclosing function is that path. `located` was measured
# on one pass and moved no decision.
state: local
# 0.62, fitted 2026-09-20 (7 defects, 17 cleans of which 9 hard, 3 passes,
# accepted run): cleans top at 0.45 (0.39-0.52 across passes: "invoice paid"
# logged in a webhook handler on receipt of an invoice.paid event, before
# the code marks anything paid), then 0.41 ("payment captured" after
# gateway.capture, the twin of the defect after gateway.authorize); every
# other clean is under 0.34. Defects start at 0.79 (0.76-0.82: the deleted
# count that is the candidate count) and the other six sit at 0.88-0.95.
# The midpoint of the gap: 0.17 of headroom each side on the means, 0.10
# clean / 0.14 defect on the worst pass, no flips. Report:
# experiments/reports/o-log-message/REPORT.md.
threshold: 0.62
rule:
  any:
    - pattern: $LOGGER.$LEVEL($MESSAGE, $$$REST)
    - pattern: $LOGGER.$LEVEL($MESSAGE)
constraints:
  LEVEL:
    regex: ^(trace|debug|verbose|info|warn|warning|error|fatal|log)$
  LOGGER:
    regex: (?i)(log|console)
  # Only a literal message can be read; a variable or an object is not judged.
  MESSAGE:
    any:
      - kind: string
      - kind: template_string
ask: >-
  The message of this log call (MESSAGE) misdescribes the event at the point
  in the code where the call sits.
criteria:
  "true": >-
    What the message says happened is not what the code path shows at that
    point: it reports an outcome as done before the operation that produces it
    runs, or on the branch where that operation failed or was skipped; it names
    an action -- a retry, a deletion, a cache hit, a capture, a send -- that the
    path does not perform, or performs a different one of; it reports a number
    as the count of what was deleted, sent, written or fetched when the value
    it interpolates is the count of what was selected, requested or attempted
    and the operation's own result count is available and may differ; it
    interpolates a value that is not what the message calls it; or it names a
    kind of thing -- an order where a subscription is cancelled, a user where a
    session is deleted -- other than the one the surrounding code acts on.
  "false": >-
    The message is true of the point where it sits: an intent phrased before
    the operation ("saving user", "syncing"), a completion phrased after it, a
    failure or a fallback on the branch that fails or falls back, a message in
    a finally that holds on both branches, a templated message whose
    interpolated values are what it calls them, or a terse message ("done",
    "ok") on the path it describes. A message that is vague, generic, names the
    intent rather than the mechanism, or could say more is not wrong. Whether
    the level fits is not the question.
note: >-
  Judge the message text against the code path the call sits on -- what ran
  before it, what branch it is in, what the values it interpolates hold -- not
  against the level. A logger call whose first argument is not a message for a
  human is not a violation.
axis: file
```

### Corpus

24 subjects in two files of a small billing service: `sync.ts` (a
`UserSync` class: sync one, sync all with try/catch/finally, a cache in
front of a repo, fetch with and without retry, a purge, an archive, a paged
fetch) and `billing.ts` (a `Billing` class over a payment gateway: cancel,
authorize, capture, invoice mail, a 429/404 refresh, a webhook handler, a
close). 7 bad, 17 clean, of which 9 are hard cleans: intent phrasing before
the operation (`sync.ts:15` "syncing user", `:28` "saving user"), the
`finally` message true on both branches (`:35`), the terse "done" after the
loop (`:38`), "retrying" inside a loop that retries (`:84`), two templated
messages whose variables are right (`:109`, `:115`), "payment captured"
after `gateway.capture` -- the same text as the defect after
`gateway.authorize` (`billing.ts:25`), "rate limited, backing off" followed
by a sleep and a retry (`:41`), and "cache hit" inside `if (cached)` -- the
same text as the defect on the miss path (`sync.ts:45`). No markers in the
fixtures; labels in `expect.yml`.

The defects:

- `sync.ts:18` "user saved" logged before `await this.repo.save(user)`.
- `sync.ts:33` "user synced" in the catch branch, where the fetch or save
  threw.
- `sync.ts:55` "cache hit" on the fall-through after `if (cached) return`:
  the miss branch, which goes on to read the repo.
- `sync.ts:95` "directory fetch failed, retrying" followed by `throw err`,
  with no loop and no second call.
- `sync.ts:103` `deleted ${stale.length}` -- the number of candidates handed
  to `deleteMany`, not `result.deletedCount`, which the function returns.
- `billing.ts:14` "order cancelled" after `gateway.cancelSubscription`: the
  entity is a subscription.
- `billing.ts:19` "payment captured" after `gateway.authorize` in
  `holdFunds`, which returns the auth id; capture is the separate `settle`.

### Attempts

1. **`subject: node`, `state: local`, first wording** (`eval --repeat 1`):
   four defects at 0.88-0.93; `billing.ts:14` (order/subscription) 0.69,
   `sync.ts:48` (cache hit on the miss path) 0.67, `sync.ts:103` (deleted
   count) 0.41; top clean 0.67 -- the *true* "cache hit" on the hit branch,
   which answered exactly the defect's 0.67. Fitted 0.41, "no separating
   cutoff".
2. **Same state, criteria sharpened** on the count clause (a count of what
   was selected or requested reported as the count of what was deleted or
   sent, when the operation's own result count is available) and the entity
   clause (an order where a subscription is cancelled); the two "cache hit"
   calls moved into different functions (`peek`, hit branch; `load`, miss
   branch) so the true one is not in the defect's enclosing function. One
   pass: six defects at 0.83-0.95, top clean 0.43; but the miss-path "cache
   hit" answered 0.05 -- the same as its clean twin in `peek`.
3. **`state: located`, same wording**, to rule out the enclosing-function
   context as the cause: no decision moved (six defects 0.76-0.93, top clean
   0.43), and the miss-path "cache hit" still 0.06. The cause is the verdict
   key (Tooling): the two calls are the same text, and one question was
   asked. Back to `local`.
4. **`local`, attempt 2's wording, the miss-path call's text made distinct**
   (`{ userId: id }`), three passes: every defect 0.79-0.95, top clean 0.45,
   no flips. This is the accepted run.

### Fit

Accepted run (`baseline.json`, 3 passes, `local`):

| | |
| --- | --- |
| fitted cutoff | 0.62 (the tool's midpoint); shipped **0.62** |
| precision / recall at 0.62 | 1.00 / 1.00, tp 7, fp 0, fn 0 |
| decision flips across 3 passes | 0 |
| clean top | 0.45 (`billing.ts:60` "invoice paid" on receipt of an `invoice.paid` event, 0.39-0.52); then 0.41 (`billing.ts:25`, 0.35-0.44); every other clean under 0.34 |
| lowest defect | 0.79 (`sync.ts:103` the deleted count, 0.76-0.82); the other six 0.88-0.95 |
| max pass-to-pass spread | 0.13 (`billing.ts:60`) |
| headroom at 0.62 | clean 0.17 on the mean, 0.10 on the worst pass; defect 0.17 on the mean, 0.14 on the worst pass |

### Verdict

**SHIP.** Separates with headroom over 0.10 on both sides, on the means and
on the worst pass, with no flips; the hard cleans -- intent phrasing, the
`finally`, the terse "done", "retrying" in a real retry loop, the templated
counts, and the two texts that are defects elsewhere in the corpus -- all
answer under 0.45, and the defects are found by the first wording except
the count and the entity, which the second wording lifted from 0.41 / 0.69
to 0.79 / 0.89. The caveat is not the rule's: the copy-pasted message in the
wrong branch, which is this rule's most realistic defect, is the one
jev-lint's verdict key merges with its clean twin whenever the two calls
are the same text (Tooling). On a repository the rule would find it only
when the arguments differ.

### What I would change

- **Corpus**: it is 24 subjects from two files by one author; the level
  rule's report says its unseen-repository run found two arguable findings
  in 43 calls, and the same run should be made here before the cutoff is
  trusted -- the top clean, an event handler logging the event's name on
  receipt, is a shape real handlers use everywhere and answered 0.52 on one
  pass. A "false" clause for "a message that names the event received, in a
  handler, before the code acts on it" would lower it; not added, since the
  gap is wide without it and every edit to the sentence is a refit.
- **Matcher**: `log` is admitted as a level (`console.log`), which the
  level rule does not; for a message rule it belongs. A message that is a
  concatenation (`"saved " + id`) is a `binary_expression` and is not
  matched; add it if a corpus has them.
- **Tooling**: the verdict key.

### Tooling

`src/cache.ts` `verdictKey(rule, arm, subjectText, group, matchText)` and
the dedup in `src/run.ts` ("Identical subject text under the same rule
draft is one question however many times it occurs"): the key has no file
and no enclosing context, so under `subject: node` two identical
`this.logger.debug("cache hit", { id });` calls -- one inside `if (cached)`,
one on the miss path of another function -- are one question, and the
second takes the first's verdict. Seen on every configuration tried:

```
$ source ~/.profile; node --experimental-strip-types src/cli.ts eval experiments/rule-candidates/typescript/log-message-matches-event --repeat 1 --no-config --cache none
  x sync.ts:55  log-message-matches-event  bad but pass at 0.05 [0.05]      # state: local
  x sync.ts:55  log-message-matches-event  bad but pass at 0.06 [0.06]      # state: located
  (sync.ts:45, the clean twin in `peek`: 0.05 / 0.06)
```

With the defect's arguments changed to `{ userId: id }` it answers
0.94/0.95/0.95. The `matchText` component of the key already handles this
for promoted (`subject: enclosing`) subjects, per the comment in
`cache.ts`; the unpromoted case with a `local` or `located` arm has the same
shape and is not covered. Not fixed here (`src/` is out of bounds). The
same key produced a lockstep miss in the sibling report `n-rust-safety`.

### Cost

From the tool's summaries, this rule: three single-pass evals (local,
local with the corpus split, located) 6 requests, 54k tokens, $0.0023; one
3-pass eval (accepted) 6 requests, 58k tokens, $0.0024. Total 12 requests,
~113k input tokens, **$0.0047**. Both rules together: 51 requests, ~450k
input tokens, **$0.019**.
