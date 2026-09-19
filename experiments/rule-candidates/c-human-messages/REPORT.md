# Family C: human-facing strings versus what the code does

Logs, toasts, HTTP response messages and assertion messages are strings a
program writes for a person, and nothing checks them: a type checker does not
know that `logger.info` is the wrong verb for a catch that rethrows, that
"Saved" is a lie after `queue.add`, or that `assert(x > 0, "must be
non-negative")` rejects the zero it promises to accept. The shipped comment
rules cover the one kind of human-facing string that sits *above* code; these
three cover the ones that sit *inside* it. The matcher captures the string
(`$MSG`) and, where there is one, the thing it is measured against (`$LEVEL`,
`$COND`), so each sentence compares a named claim to the code around it. What
jev does that a linter cannot is read the claim: no parser knows that
"permanently deleted" is stronger than `deletedAt = now`, or that "Request
received" after the same enqueue is not.

Everything below was measured with `--repeat 3`, `--no-config --cache none`,
on the file axis, model jev-1.13.0. Records are in `records/`; `replay
records/final.json --labels labels.json` re-derives the fits without a key.

## A tool finding that shaped every corpus decision here

With `subject: enclosing`, jev-lint keys twin subjects on the subject *text*
(`verdictKey(rule, arm, s.text, axis)` in `src/run.ts` around line 265), and for a
promoted subject that text is the enclosing function. Two matches of one rule
in the same function therefore have the same key: only the first is asked
and its answer is copied to the second (`wanted.get(s.key)` at line 357).
The first calibration made this visible -- every pair of same-function
subjects had byte-identical scores across all three passes (see
`records/attempt1.json`: `assertions.ts:20`/`:21` both 0.98, `logging.ts:69`/`:72`
both 0.83, `handlers.ts:10`/`:14` both 0.06, where line 14 was a labelled
defect that was never asked about). `matchText` is in the question but not
in the key. This affects the shipped `catch-hides-failure`,
`error-message-describes-failure` and `todo-already-done` recipes as well, and
it is why the corpus below has exactly one match per rule per function, why
two of the three rules ended on `subject: node`, and why the one that stayed
on `enclosing` cannot be trusted on real code until the key includes the
match. That is a `src/` change and outside this brief's write scope.

---

## log-level-matches-event

**Rule**

```yaml
- id: log-level-matches-event
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  # `node` with `local`: the model sees the call and, through the state arm,
  # the function it sits in -- the same evidence as `subject: enclosing`, but
  # the verdict is keyed on the call, so two log calls in one function are two
  # questions rather than one answer copied. Measured: node separated wider
  # (clean max 0.40 vs 0.49) on the same corpus and wording.
  subject: node
  state: local
  at: 0.6
  rule:
    any:
      - pattern: $LOGGER.$LEVEL($MSG, $$$REST)
      - pattern: $LOGGER.$LEVEL($MSG)
  constraints:
    LEVEL: { regex: "^(trace|debug|verbose|info|warn|warning|error|fatal)$" }
    # A receiver that is a logger by name. Without this, `toast.error(...)` is
    # asked about as a log call, which is rule 2's subject.
    LOGGER: { regex: "(?i)(log|console)" }
  ask: >-
    The level of this log call ($LEVEL) misstates the severity of what the
    surrounding code is handling at that point.
  criteria:
    "true": >-
      What the code is doing where the call sits belongs at a clearly
      different level than the one used: the call is at info, debug or trace
      but sits on a path where the operation has failed and the function
      gives up, rethrows, exits, discards data or returns a failure the
      caller must act on; the call is at debug or trace for an outcome the
      function reports to its caller, such as a refusal or a rejection,
      rather than for progress or detail on the way to an outcome; the call
      is at error or fatal but sits on the ordinary success path or on a
      routine, expected branch such as a cache miss, a normal rejection or a
      validation failure; or the call is at warn but the code immediately
      exits or throws with no recovery.
    "false": >-
      The level fits what the code around the call shows: error or warn where
      something went wrong that an operator should see, even if the function
      recovers from it; info for routine outcomes including expected business
      rejections and refused logins; debug or trace for per-item progress in
      loops and other chatter; warn for a degraded or transient condition
      the code goes on to handle; error on stderr for a usage error in a
      command-line entry point. Whether the message text is well written is
      not the question.
  note: >-
    Judge the level against the code path the call sits on, not against
    words in the message. A logger call whose first argument is not a message
    for a human is not a violation.
```

**Corpus**

`corpus/logging.ts`: 17 subjects found, 6 bad, 11 clean (7 hard).

- `:15` `this.logger.info("failed to save order")` in a catch that rethrows -- the operation failed and the caller is left to deal with it; info hides it.
- `:41` `logger.error("user logged in")` on the success path of `openSession` -- a routine event at error.
- `:51` `logger.debug("payment refused by processor")` for a refusal returned to the caller as `{ ok: false }` and counted in metrics -- an operator-visible outcome at a level that is off in production.
- `:69` `logger.warn("could not bind port, exiting")` followed by `process.exit(1)` -- nothing is degraded, the process is gone.
- `:84` `logger.error("profile cache miss")` on the normal path that then fetches and fills the cache -- routine, debug at most.
- `:169` `logger.info("delivery failed, message dropped")` then `discard(msg.id)` -- data lost at info.

Hard cleans: `error` in a catch that recovers by rebuilding an unexpected snapshot (`:94`); `info` for an expired coupon (`:106`) and a refused login (`:33`); `debug` per chunk in the indexing loop (`:119`); `warn` on a single failed attempt inside a retry loop, with "failed" in a catch (`:131`); `warn` for a missing config file handled with defaults (`:141`); `console.error` for a CLI usage error returning 2 (`:149`).

**Attempts**

1. Sentence as shipped, criteria v1, `subject: enclosing` (`records/attempt2.json`; attempt1 was on the pre-fix corpus and is not evidence): `rewrite`, gap 0.14, head +0.07 at 0.70. Bad min 0.63 (debug for the refused payment), clean max 0.49 (info for the refused login). The model ordered them correctly but saw two refusals.
2. Criteria v2 -- added "debug or trace for an outcome the function reports to its caller ... rather than progress", named refused logins and CLI usage errors as clean, added "discards data" to the failure list (`records/attempt3.json`): `works`, gap 0.27, head +0.23. Bad min 0.74, clean max 0.47. Same in `records/attempt4.json` (no wording change): gap 0.26, bad min 0.75, clean max 0.49.
3. Same wording, `subject: node` (`records/attempt5-subject-node.json`): `works`, gap 0.35, head +0.30. Bad min 0.75, clean max 0.40. Adopted.

**Fit** (`records/final.json`, subject node, at 0.6)

Fitted midpoint 0.57; set `at: 0.6` for headroom. Precision 1, recall 1 (tp 6, fp 0, fn 0). Bad band 0.75-0.92, clean band 0.06-0.39; headroom above the highest clean 0.21, below the lowest bad 0.15. 0 decision flips across the 3 passes; max spread 0.07, mean 0.02.

**Verdict**: SHIP -- separates with headroom 0.21/0.15 and no flips, on a corpus whose closest cleans are the two hard ones a lazy rule flags (refused login at info, "failed" inside a retry at warn). Two caveats that do not change the verdict but bound it: the `false` branch names two corpus cases by kind ("refused logins", "usage error in a command-line entry point"), which moved the refused-login clean from 0.49 to 0.39, so the headroom on unseen code is more like 0.10 than 0.20 until step 5 of calibration.md is run on a real repository; and the weakest defect (debug for a refused payment, 0.75) is the one the brief itself called arguable.

**What I would change**: nothing in the matcher. Run it on a real service's logging before trusting the cutoff; the class I expect to land near it is `info` for a failure that is returned as a value but that the caller will treat as fatal, which is exactly where this corpus's two closest cases sit.

---

## ui-message-honest

**Rule**

```yaml
- id: ui-message-honest
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  # `enclosing`, unlike the other two: whether "Saved" is honest is a fact
  # about the whole flow, and judging the function with the message as the
  # matched piece kept the enqueue-then-"Saved" case at 0.88 where `node`
  # dropped it to 0.53. Caveat: jev-lint keys twin subjects on the enclosing
  # function's text, so two messages in one function currently share one
  # verdict; keep one user-facing message per function until that is fixed.
  subject: enclosing
  state: local
  at: 0.62
  rule:
    any:
      # toast("..."), notify("..."), alert("..."), showMessage("..."),
      # setStatus("..."), setMessage("...")
      - all:
          - any:
              - pattern: $FN($MSG, $$$REST)
              - pattern: $FN($MSG)
          - has:
              field: function
              regex: "^(toast|notify|alert|showMessage|showToast|showNotification|showAlert|enqueueSnackbar|setStatus|setMessage|setError|setSuccess|setFeedback)$"
      # toast.success("..."), message.error("..."), notification.open("...")
      - all:
          - any:
              - pattern: $UI.$KIND($MSG, $$$REST)
              - pattern: $UI.$KIND($MSG)
          - has:
              field: function
              regex: "^(toast|notify|message|notification|notifications|snackbar|Alert)\\."
      # res.send("...")
      - all:
          - pattern: $RES.send($MSG)
          - has:
              field: function
              regex: "^(res|reply|response|ctx)\\b"
      # res.json({ message: "..." }), res.status(n).json({ ..., message: "..." })
      - all:
          - kind: call_expression
          - has:
              field: function
              regex: "^(res|reply|response|ctx)\\b.*\\.(json|send|render)$"
          - has:
              field: arguments
              has:
                kind: object
                has:
                  kind: pair
                  all:
                    - has: { field: key, regex: "^(message|msg|error|detail|status)$" }
                    - has: { field: value, pattern: $MSG }
  ask: >-
    This message ($MSG), shown to the user, tells them something other than
    what the surrounding code actually did.
  criteria:
    "true": >-
      The message states an outcome the code in front of it did not establish:
      it reports an operation as done or successful when the code only
      enqueued, scheduled or started it; it reports it as done when the code
      did not wait for it, so the message is shown before the outcome is
      known; it reports success when the code holds a result that can
      express failure and did not look at it; it claims a specific, stronger
      fact than what was done, such as "permanently deleted" when the code
      only marks a record; it reports an action the code never performed at
      all; or, in a catch, it names one specific cause such as a network
      failure or an expired link when the block also receives failures of
      another kind that the code above visibly raises.
    "false": >-
      The message matches what the code did and knows. An awaited call that
      either completed or threw counts as done, whether or not its return
      value is inspected. Saying received, started, queued or scheduled after
      enqueuing is honest. Naming a soft action by its usual word, such as
      archived, closed or cancelled for a record that was flagged rather than
      destroyed, is honest unless the message adds a claim the code does not
      make. A generic failure message in a generic catch is honest. A
      progress message such as "Saving" before the operation is honest. A
      message that is vague, terse or could be more specific is not a
      violation, and a message that restates the intent of the call it
      follows, such as "invitation sent" after a successful call to an
      invitations endpoint, is honest.
  note: >-
    Judge only what the enclosing function shows. A claim about what a
    server, a job or another system will do later, such as data being
    removed after a retention period, is not checkable here and is not a
    violation. A call whose argument is not a message for a human, such as a
    body, a buffer, a health-check string or an empty string, is not a
    violation.
```

**Corpus**

`corpus/ui-messages.tsx` (16 subjects) and `corpus/handlers.ts` (13 subjects): 29 subjects found, 10 bad, 19 clean (11 hard, including 2 deliberate matcher over-matches).

- `ui-messages.tsx:13` `toast.success("Saved")` after `queue.add("persist-draft")` -- only enqueued.
- `ui-messages.tsx:23` `toast.success("Email sent")` with `mailer.send` not awaited and no result checked.
- `ui-messages.tsx:39` `setStatus("Payment successful")` before the charge promise resolves.
- `ui-messages.tsx:96` `toast.error("Network error")` in a catch that also receives the validation `Error` thrown for a row with no email.
- `ui-messages.tsx:122` `showMessage("Export complete. Download ready")` right after `POST /exports` returned a job.
- `ui-messages.tsx:157` `alert("You have been unsubscribed")` with the request neither awaited nor checked.
- `handlers.ts:14` `"Account permanently deleted"` when the handler sets `deletedAt` and `status: "deleted"`.
- `handlers.ts:35` `res.send("Password updated")` when the handler only created a reset token and sent an email.
- `handlers.ts:55` `"Index rebuilt"` after `jobs.enqueue("search.rebuild")`.
- `handlers.ts:112` `"This verification link has expired"` for a token that is missing, already used or expired -- three visible causes, one named.

Hard cleans: "Request received" after the same enqueue (`:18`); "Saving..." before the await (`:58`); "Published" after an awaited POST whose return value is not inspected (`:76`); "Something went wrong" in a catch-all (`:104`); "Invitation sent" after an awaited POST to `/invites` (`:127`); "Project archived" after a PATCH that flags (`:164`); "Account closed. Data is retained for 30 days, then removed." on the same soft delete as the bad case (`handlers.ts:25`); the deliberately vague "If an account exists ... a link has been sent" (`:45`); "Cache purge started" with 202 after enqueuing (`:50`); "Subscription cancelled" after `cancel(id, { atPeriodEnd: true })` (`:92`); and two over-matches, `res.send(toCsv(orders))` (`:82`) and a health-check string (`:123`).

**Attempts**

1. Sentence as shipped, criteria v1, `subject: enclosing` (`records/attempt2.json`): `rewrite`, gap 0.14, head +0.06. The model had two labels right that I had swapped ("Network error" 0.89, "Something went wrong" 0.09 -- fixed in labels.json, the model was correct). After that fix the real failures were cleans: "Subscription cancelled" 0.87, "Account closed ... then removed" 0.78, "Published" 0.64 (the criteria said "never checked the result it got", which condemns every awaited call), "Project archived" 0.53.
2. Criteria v2 -- "an awaited call that either completed or threw counts as done"; naming a soft action by its usual word is honest; the note names later-process claims as uncheckable (`records/attempt3.json`): `rewrite`, gap 0.17, head +0.04. Everything separated except two: "Subscription cancelled" 0.66 (clean) and the expired-link case 0.64 (bad). Both had a defect that was not visible in the code -- `consume()` was opaque and `update({cancelAtPeriodEnd})` invited the model to argue. Corpus fix, no wording change: the link case now shows `!record || record.usedAt || record.expiresAt < now`; the cancel case calls `cancel(id, { atPeriodEnd: true })` (`records/attempt4.json`): `works`, gap 0.29, head +0.20 at 0.70. Bad band 0.79-0.94 with the expired-link case at 0.50; clean max 0.47.
3. Same wording, `subject: node` (`records/attempt5-subject-node.json`): worse -- "Saved" after enqueue fell to 0.53, the expired-link case to 0.24, "Request received" rose to 0.57. The honesty of a message is a property of the flow, and `node` narrows the model's attention to the call. Stayed on `enclosing`.

**Fit** (`records/final.json`, subject enclosing, at 0.62)

Calibrate's midpoint is 0.53 (tp 10, fp 0, fn 0 on pass means) but it sits inside the wobble: the expired-link defect ran 0.52-0.59 and "Subscription cancelled" ran 0.34-0.55, so that number is a coin flip. At `at: 0.62`: precision 1, recall 0.9 (tp 9, fp 0, fn 1 -- the expired-link case at 0.56). Highest clean 0.51 ("Request received"; max pass 0.53), lowest strong bad 0.77; headroom 0.11 above the highest clean mean, 0.07 above its highest pass. 0 flips at 0.62; max spread 0.21, mean 0.03.

**Verdict**: COOKBOOK -- nine of ten defects sit at 0.77 and above against cleans at 0.51 and below, but the tenth (a specific cause named for a multi-cause branch) lives in the same 0.45-0.59 band as the two hard cleans that are true only by convention, and `enclosing` is the subject that jev-lint currently cannot key correctly when a function has more than one message. Worth a recipe with the caveat; not a shipped cutoff.

**What I would change**: state stays `local` and subject stays `enclosing`, but the tool needs the match text in the twin key before this is usable on real components, where success and error toasts share a handler. Corpus: add a second "specific cause for a general failure" defect that is not a catch, to learn whether `:112` is a weak label or a class the sentence misses. Matcher: `setStatus`/`setMessage` are guesses at React state setters and will miss most real names; a `regex: "^set(Status|Message|Error|Success|Feedback|Notice|Banner)"` prefix form would over-match better.

---

## assertion-message-matches

**Rule**

```yaml
- id: assertion-message-matches
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  # `node`: the check and its message are both in the match; `local` adds the
  # function for the copied-message case. Measured: node lowered every clean
  # answer (max 0.29 vs 0.44) with the bad band unchanged.
  subject: node
  state: local
  at: 0.65
  rule:
    any:
      - pattern: assert($COND, $MSG)
      - pattern: assert($COND, $MSG, $$$REST)
      - pattern: invariant($COND, $MSG)
      - pattern: console.assert($COND, $MSG)
      - pattern: console.assert($COND, $MSG, $$$REST)
      - pattern: if ($COND) throw new $TYPE($MSG)
      - pattern: if ($COND) throw new $TYPE($MSG, $$$REST)
      - pattern: if ($COND) { throw new $TYPE($MSG) }
      - pattern: if ($COND) { throw new $TYPE($MSG, $$$REST) }
  ask: >-
    When this check fails, its message ($MSG) tells the reader something
    untrue about what was wrong, judged against the condition ($COND) that
    was actually tested.
  criteria:
    "true": >-
      The message and the condition disagree about what is being required:
      the message names a different thing than the one the condition
      examines, such as an order when the condition tests a user; it states a
      different bound, direction or sign than the condition, such as
      non-negative for a check that rejects zero, too many for a check that
      fires on none, or a term for one direction of overrun when the
      condition detects the other; it names a different failure than the one
      the condition detects, such as expired for a check that fires on
      absence; it is about a different quantity than the one compared, such
      as a size being positive when the condition compares a position to a
      length; or it is a copy of another check's message in the same
      function and describes that check's condition rather than this one.
    "false": >-
      The message is about the condition being checked, whether it states the
      requirement, its negation, the consequence of failing it, or the cause
      the condition implies: "duplicate ids" for a set that is smaller than
      the list it was built from is a match, as is "forbidden" for a role
      check. A message that is terse or generic, that says the same thing
      from the other side, or that names what cannot proceed rather than the
      value that failed, is not a mismatch.
  note: >-
    The check fires when the guard is true for if-throw shapes and when the
    condition is false for assert and invariant shapes; judge the message
    against the case in which it is shown. Only the condition and the message
    are compared; whether the check itself is correct is not the question.
```

**Corpus**

`corpus/assertions.ts` (21 subjects) plus one over-match in `ui-messages.tsx:91`: 22 subjects found, 7 bad, 15 clean (7 hard).

- `:8` `assert(item.quantity > 0, "quantity must be non-negative")` -- zero fails the check and the message says it should pass.
- `:19` `invariant(user, "order not found")` -- checks a user, names an order.
- `:24` `if (items.length === 0) throw new Error("too many items in batch")`.
- `:34` `if (!session) throw new Error("session expired")` -- fires on absence; expiry is the next line's check.
- `:47` `if (a.currency !== b.currency) throw new RangeError("amounts must not be negative")` -- a message copied from the sign checks above.
- `:52` `console.assert(offset + frame.length <= buffer.length, "buffer underflow")` -- the condition detects an overrun past the end, an overflow.
- `:124` `if (page * size >= items.length) throw new RangeError("page size must be positive")` -- a different quantity entirely.

Hard cleans: the terse "bad input" (`:58`); consequence phrasing "cannot proceed without a user" (`:70`), "gave up after N attempts" (`:86`), "forbidden" (`:129`); inferred cause "duplicate ids in input" for `seen.size === ids.length` (`:92`); reversed phrasing "start must not exceed end" for `end < start` (`:97`); and the block-form if-throw (`:108`).

Decision recorded in `note:`/criteria: consequence phrasing counts as matching. A message is judged on whether it would mislead the reader about what was wrong when the check fires, and "cannot proceed without a user" does not; the model agreed without being told (0.13 on the first attempt, before the criteria said so).

**Attempts**

1. Ask "describes a different condition from the one the check actually tests", criteria v1, `subject: enclosing` (`records/attempt2.json`): `works` by the table (gap 0.33, head +0.14) but the fit had fp 1 / fn 1: "duplicate ids" (clean) 0.56 above "buffer underflow" (bad) 0.52, and "bad input" wobbling 0.28-0.55.
2. Criteria v2 -- named the overrun-direction and different-quantity classes as true, named inferred cause ("duplicate ids", "forbidden") as false (`records/attempt3.json`): `works`, gap 0.26, head +0.08. Underflow 0.62, duplicate ids 0.53. Both moved up 0.1, the order did not change: the model does not treat "underflow" as clearly wrong for an overrun, and half-treats a cause-phrased message as a different condition even when the criteria cite it.
3. Ask rewritten to the truth-at-failure form: "When this check fails, its message tells the reader something untrue about what was wrong, judged against the condition that was actually tested" (`records/attempt4.json`): `works`, gap 0.41, head +0.19. Every clean dropped (duplicate ids 0.44, bad input 0.31), the strong bads stayed at 0.89-0.97, underflow 0.51. Then `subject: node` with the same wording (`records/attempt5-subject-node.json`): clean max 0.29, underflow 0.53. Adopted `node`.

**Fit** (`records/final.json`, subject node, at 0.65)

Calibrate's midpoint 0.39 gives tp 7, fp 0, fn 0 on means, but underflow ran 0.44-0.61 and the highest clean ("duplicate ids") ran 0.19-0.32, so that cutoff has 0.12 of headroom on one side and sits on a case whose own spread is 0.17. At `at: 0.65`: precision 1, recall 0.86 (tp 6, fp 0, fn 1 -- underflow at 0.51). Bad band 0.89-0.97, clean band 0.04-0.28; headroom 0.37 above the highest clean, 0.24 below the lowest strong bad. 0 flips at 0.65; max spread 0.17, mean 0.04.

**Verdict**: COOKBOOK -- six of seven defect classes (wrong thing, wrong bound, wrong failure, wrong quantity, copied message) separate from every hard clean by 0.37 of headroom with no flips, which is the widest gap in the family; but the seventh, a wrong technical term for the direction of an overrun, does not separate at any stable cutoff after three sentences, and criteria v2 cites two corpus cases by name ("duplicate ids", "forbidden"), so the clean band is optimistic by an unknown amount. Ship it after a run on unseen code that keeps the clean band under 0.4; until then it is a recipe with a known miss.

**What I would change**: replace the corpus-specific examples in `criteria."false"` with the general statement ("the cause the condition implies") alone and refit, to learn what the naming bought; add two more wrong-term defects (underflow/overflow, timeout/refused, missing/invalid) to find out whether that class is unlearnable or just thin at n=1. Matcher: add `if ($COND) return reject(new $TYPE($MSG))` and `?? throw` shapes; both are common and both currently fall to recipe 9.

---

## Which of the three is closest to recipe 9, and should it replace it

`assertion-message-matches` is the same question as the cookbook's
`error-message-describes-failure` (recipe 9) with the guard condition captured
instead of inferred: recipe 9 matches `throw new $TYPE($MSG)` anywhere and asks
the model to find "the condition guarding the throw" in the enclosing
function; this rule matches the `if ($COND) throw` shape and the
`assert`/`invariant`/`console.assert` shapes and hands the model `$COND` by
name. Measured on this corpus the named capture is what makes it sharp: with
both sides named, six of seven defects sit at 0.89 and above against a clean
band that tops out at 0.28.

It should not *replace* recipe 9, because its matcher is strictly narrower: a
throw in a `switch` default, in an `else`, after a `try`, or guarded by a
compound `if` with other statements before it has no `$COND` to capture and
would be lost. The right relation is: this rule takes the `if`/`assert`
shapes at `subject: node`, and recipe 9 keeps the rest with a `not:` that
excludes an `if_statement` whose consequence is only the throw, so that one
defect is never asked twice. Recipe 9 also inherits the twin-key limitation
above whenever a function has two throws, which is most functions that throw
at all; that is a stronger argument for moving the common shape to `node`
than any number here.

## Cost

From the tool's own per-pass summaries (4 requests per pass; each record's
`spent` is its last pass):

| run | passes | requests | input tokens | USD |
| --- | --- | --- | --- | --- |
| gaps, attempt 1 corpus | 1 | 4 | 37,605 | 0.0016 |
| calibrate attempt 1 (pre-fix corpus) | 3 | 12 | 112,815 | 0.0047 |
| calibrate, run lost to a broken pipe (no record) | 3 | 12 | 144,702 | 0.0061 |
| calibrate attempt 2 | 3 | 12 | 144,702 | 0.0061 |
| calibrate attempt 3 | 3 | 12 | 161,292 | 0.0068 |
| calibrate attempt 4 | 3 | 12 | 162,216 | 0.0068 |
| calibrate attempt 5 (subject: node) | 3 | 12 | 159,690 | 0.0067 |
| calibrate final | 3 | 12 | 160,902 | 0.0068 |
| **total** | 22 | **88** | **~1,083,900** | **~$0.046** |

Every run was priced with `--dry-run` first; the largest single run was
$0.0068. Output tokens were ~1,400 per pass.

---

## assertion-message-matches, revision 2

Why: on the unseen repository mizchi/agent-cluster (`../unseen/agent-cluster.json`,
75 subjects) the rule as shipped above produced four findings, all wrong. Three
were test doubles throwing a simulated failure -- `if (agentCalls === 2) { throw
new Error('temporary upstream failure') }` at `apps/agent-worker/worker.test.ts:10203`
(0.85), `if (fetchAttempts === 1) { throw new Error('temporary network failure') }`
at `packages/agent-cluster/bit-fetch-collector.test.ts:335` (0.72), and a
route-keyed one, `if (url.includes('/prs?') && ...) { throw new Error('This
operation was aborted') }` inside a `fetchImpl:` callback at
`packages/agent-cluster/hub-pr-review.test.ts:345` (0.70). The fourth,
`apps/agent-worker/moonbit.ts:487` (0.66 against 0.65), is the inner guard of a
nested check: `if (baseRaw.length === 0) { if (adapter === 'base_url') throw new
Error('missing env: ...BASE_URL (adapter=base_url)') ... }` -- the matched
condition only chooses the wording, the outer one is what failed, and the
message is right. Two mechanisms were on the table: (a) the matcher, since a
counter compared to a sequence number or a throw inside a mock factory's
callback is never a check on the program's state; (b) the criteria, since a
message that names an injected failure inside a test double describes the
scenario, not the condition. Both were measured; the rule now carries both.
Since the previous report the promoted-subject key was fixed, so `enclosing`
was available; it was not needed here, and under `local` the stubs have no
named container anyway (an arrow assigned to `globalThis.fetch` or sitting in
an object literal is not a symbol), so the model sees only the if-throw and the
file name for exactly the cases that failed.

**Rule** (final, as in `rules.yml`; `assert-v2.yml` is the byte-identical
single-rule copy the unseen run used)

```yaml
- id: assertion-message-matches
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  # `node`: the check and its message are both in the match; `local` adds the
  # function for the copied-message case. Measured: node lowered every clean
  # answer (max 0.29 vs 0.44) with the bad band unchanged.
  #
  # Revision 2 (REPORT.md, "assertion-message-matches, revision 2"): on an
  # unseen repository the rule flagged three test doubles throwing a simulated
  # failure on a call counter or a route. The matcher now drops a bare counter
  # compared to a positive integer and any throw inside a mock factory's
  # callback; the criteria say a throw in a test double describes the
  # scenario, not the condition. `at` stays 0.65: fitted trade-off 0.56, and
  # the stub band tops out at 0.55.
  subject: node
  state: local
  at: 0.65
  rule:
    all:
      - any:
          - pattern: assert($COND, $MSG)
          - pattern: assert($COND, $MSG, $$$REST)
          - pattern: invariant($COND, $MSG)
          - pattern: console.assert($COND, $MSG)
          - pattern: console.assert($COND, $MSG, $$$REST)
          - pattern: if ($COND) throw new $TYPE($MSG)
          - pattern: if ($COND) throw new $TYPE($MSG, $$$REST)
          - pattern: if ($COND) { throw new $TYPE($MSG) }
          - pattern: if ($COND) { throw new $TYPE($MSG, $$$REST) }
      # A throw inside a mock factory's callback is a scripted failure, never
      # a check on the program's state. Excluded by structure, not by asking.
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
  constraints:
    # `if (calls === 2) throw` -- a bare counter compared to a positive
    # integer literal is a sequence position, the shape of a stub that fails
    # on the n-th call, not a precondition. `=== 0` is kept: it is the real
    # divide-by-zero and empty-input guard.
    COND:
      not:
        regex: "^[A-Za-z_$][\\w$]*\\s*===?\\s*[1-9]\\d*$"
  ask: >-
    When this check fails, its message ($MSG) tells the reader something
    untrue about what was wrong, judged against the condition ($COND) that
    was actually tested.
  criteria:
    "true": >-
      The message and the condition disagree about what is being required:
      the message names a different thing than the one the condition
      examines, such as an order when the condition tests a user; it states a
      different bound, direction or sign than the condition, such as
      non-negative for a check that rejects zero, too many for a check that
      fires on none, or a term for one direction of overrun when the
      condition detects the other; it names a different failure than the one
      the condition detects, such as expired for a check that fires on
      absence; it is about a different quantity than the one compared, such
      as a size being positive when the condition compares a position to a
      length; or it is a copy of another check's message in the same
      function and describes that check's condition rather than this one.
    "false": >-
      The message is about the condition being checked, whether it states the
      requirement, its negation, the consequence of failing it, or the cause
      the condition implies: "duplicate ids" for a set that is smaller than
      the list it was built from is a match, as is "forbidden" for a role
      check. A message that is terse or generic, that says the same thing
      from the other side, or that names what cannot proceed rather than the
      value that failed, is not a mismatch. A throw that is part of a test
      double is not a mismatch: a fake, stub, mock, replaced global or
      scripted dependency in a test throws to simulate a failure, its
      condition only picks when the simulated failure happens, such as a call
      counter, a request route or an input id, and its message names the
      failure being injected, so the message describes the scenario the test
      sets up, not the condition. A message whose wording is chosen by an
      inner guard inside an outer one is judged against both conditions
      together, and is a match when it describes the outer failure.
  note: >-
    The check fires when the guard is true for if-throw shapes and when the
    condition is false for assert and invariant shapes; judge the message
    against the case in which it is shown. Only the condition and the message
    are compared; whether the check itself is correct is not the question.
    A throw inside a test double is not a check on the program's state and is
    out of scope, whether or not the double has a name; in a test file, a
    throw whose condition is a call count, a route or an input value and
    whose message is a failure being simulated is one. A nested guard is
    judged as one check whose condition is the outer and inner conditions
    combined.
```

**Corpus additions** (labels appended to `labels.json`; the 21 existing
`assertions.ts` labels are untouched)

`corpus/fakes.test.ts`, 8 subjects under the original matcher, 4 under the
final one:

- `:25` hard clean -- fake `globalThis.fetch` throwing "temporary upstream failure" on `agentCalls === 2`. Dropped by the counter constraint.
- `:50` hard clean -- `fetchImpl` stub throwing "temporary network failure" on `fetchAttempts === 1`. Dropped by the counter constraint.
- `:69` hard clean -- `fetchImpl` stub throwing "This operation was aborted" for one route (the hub-pr-review shape, no counter). Still a subject.
- `:91` hard clean -- `vi.fn().mockImplementation` throwing ECONNRESET on `writes === 1`. Dropped by both exclusions.
- `:104` hard clean -- `jest.fn` throwing EACCES for `jobId === "job-locked"`. Dropped by the mock-factory exclusion.
- `:117` hard clean -- a hand-written `class FakeQueue` whose `send` throws "payload too large" for a body containing "poison". Still a subject; under `local` the context is the method body alone, so the class name is not visible.
- `:136` hard clean -- a scripted `readFileText` in a plain `runtime` object throwing EBUSY for `path.endsWith(".lock")`. Still a subject.
- `:37` bad -- `assert(retried.length > 0, "message must be retried at most once")`: at-least-one checked, at-most-one claimed. A real assertion in the test file, so the file name alone cannot be the tell.

`corpus/runner-config.ts`, 5 subjects:

- `:20` hard clean -- the moonbit nested guard, verbatim shape: inner `adapter === "base_url"` selects the wording, outer `baseRaw.length === 0` is the failure.
- `:49` hard clean -- `normalized === null` with "invalid materialized path": the cause `normalizeAbsPath` returning null implies (the `apps/sandbox/worker.ts:370` shape, 0.63 on the unseen run).
- `:32` bad -- `if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("missing env: MOONBIT_RUNNER_TIMEOUT_MS")`: a value check that says absence, with a default of 30000 so the variable cannot even be absent.
- `:11`, `:59` clean -- `!env.MOONBIT_RUNNER_SERVICE` / "missing env", `content === null` / "invalid utf-8 content".

Final corpus for this rule: 31 subjects found, 9 bad, 22 clean (12 hard, of
which 3 are test doubles the matcher still sees).

**Attempts** (one pass each unless noted; `records/assert-v2-attempt*.json`)

0. Rule as shipped, on the extended corpus (`assert-v2-attempt0.json`): `rewrite`, gap 0.21, head +0.02, 14 reported. The corpus reproduces the failure and harder than the repository did: all six stubs at 0.71-0.93 (vi.fn 0.93, FakeQueue 0.91, jest.fn 0.85, route 0.81, counters 0.73/0.71), nested guard 0.61, the two new defects 0.85/0.72, underflow 0.63.
1. Mechanism (b) in `note:` only -- "a throw inside a test double ... is not a check on the program's state and is out of scope: its condition picks when the scripted failure happens ... its message names the failure the test is simulating"; nested guards judged against the outer condition (`assert-v2-attempt1.json`): `rewrite`, gap 0.21, head +0.09, 8 reported. Stubs fell to 0.24-0.51 (route 0.51, vi.fn 0.40, counters 0.33/0.24, jest.fn 0.32, FakeQueue 0.30), nested guard 0.51, underflow 0.56. A second pass of the same wording (`assert-v2-attempt1-pass2.json`, run by mistake, kept as evidence): nested guard 0.72, underflow 0.65, route 0.53, "duplicate ids" 0.44 -- the note alone leaves the nested guard inside the wobble.
2. Mechanism (b) moved into `criteria."false"` ("A throw that is part of a test double is not a mismatch: ... its message names the failure being injected, so the message describes the scenario the test sets up, not the condition"), nested guard stated as one check over both conditions, note shortened to the scoping sentence (`assert-v2-attempt2.json`): `rewrite`, gap 0.20, head +0.08, 8 reported. Route 0.32, FakeQueue 0.48, nested guard 0.48, vi.fn 0.38, underflow 0.57. Clean max 0.48.
3. Mechanism (a) added to the matcher, wording unchanged, plus the `:136` stub (`assert-v2-attempt3.json`): 31 subjects, `rewrite`, gap 0.21, head +0.11, 8 reported. FakeQueue 0.54, nested guard 0.49, route 0.34, EBUSY 0.25, underflow 0.46. The `gaps` verdict stays `rewrite` on every attempt because the largest step is always between the 0.73-0.76 defect and the 0.46-0.57 underflow miss, which is the known miss from revision 1, not the class this revision is about.

What (a) bought, measured: the counter constraint and the mock-factory
exclusion remove four of seven corpus stubs and two of three repository stubs
without asking, at the price of `if (n === 1) throw` shapes (a bare
identifier against a positive integer; `=== 0` is kept). What (b) bought: the
three stubs (a) cannot see -- route-keyed, input-keyed and a fake class --
moved from 0.81-0.93 to 0.25-0.54, and the repository's route stub from 0.70
to 0.49. Neither alone is enough: (a) misses the route shape by construction,
and (b) alone left the nested guard flipping across 0.65 (attempt 1, two
passes: 0.51 and 0.72).

**Fit** (`records/assert-v2.json`, 3 passes, at 0.65)

Fitted trade-off 0.56, precision 0.89, recall 0.89 (tp 8, fp 1, fn 1) on pass
means -- the fp is the nested guard (mean 0.58), the fn is underflow (0.56).
At `at: 0.65`, on means: precision 1, recall 0.89 (tp 8, fp 0, fn 1). Bad
band 0.73-0.98 with underflow at 0.56; clean band 0.03-0.58. 2 decision flips
across the 3 passes, both at the cutoff's edge: the nested guard ran 0.49,
0.55, 0.70 and the underflow miss 0.49, 0.55, 0.65. Max spread 0.21, mean
0.05. The stub band across all passes: FakeQueue 0.46-0.55, route 0.30-0.38,
EBUSY 0.20-0.25 -- headroom 0.10 from the highest stub pass to the cutoff. The
next hard clean, "duplicate ids", 0.12-0.30. No cutoff removes both flips:
0.72 clears the nested guard's worst pass but sits on the "missing env for a
value check" defect at 0.71-0.76.

**Unseen findings** (`records/assert-v2-unseen.json`: 73 subjects, 21
requests, $0.00335; the two counter stubs are no longer subjects)

0 findings at 0.65. Every answer, judged, from the top:

- 0.59 `apps/agent-worker/moonbit.ts:487` -- the nested guard; correct message. Was 0.66. Clean, and the closest thing to the next false positive: 0.06 of headroom.
- 0.51 x7 `normalizeBaseUrl` copied into `autonomous-self-improve.ts:432`, `hub-pr-review.ts:136`, `hub-pr-watch.ts:117`, `orchestrator-participant.ts:99`, `run-collector.ts:130`, `self-improve-collector.ts:95`, `self-improve-loop.ts:750` -- `if (trimmed.length === 0) throw new Error('missing required option: --base-url')`: an empty-after-trim string called "missing". Clean by convention; the function cannot show that the value came from an option. Was 0.40: the new wording raised this class by 0.11.
- 0.49 `apps/sandbox/worker.ts:370` -- `normalized === null` / "invalid materialized path". Clean, inferred cause. Was 0.63.
- 0.49 `packages/agent-cluster/hub-pr-review.test.ts:345` -- the route-keyed stub. Clean. Was 0.70.
- 0.44 `packages/agent-cluster/cli.ts:317` -- `typeof text !== 'string' || text.trim().length === 0` / "missing required option". Clean. Was 0.55.
- 0.41 `apps/agent-worker/worker.ts:14195` -- `status !== 'complete' && output.trim().length === 0` / "workflow did not produce complete output: ${status}". Clean; the message covers both conjuncts.
- 0.41 `packages/agent-cluster/bit-fetch-collector.ts:113` -- another `normalizeBaseUrl`. Clean.
- 0.40 `apps/bit-relay/worker.test.ts:944` -- `typeof input === 'string'` / "invalid rate limit options": a real check in a test helper, message names the consequence. Clean.
- 0.36 and below: 63 subjects. The nine I read are clean: `cli.ts:289` `readRequiredOption` (0.36), `hub-pr-review.ts:753` "invalid value for --adopt-mode" for a normalisation mismatch (0.34), `bit-fetch-collector.test.ts:424` the "simulated timeout for large batch" stub keyed on `batchRefs.length > 2` (0.34, unchanged), `cli.ts:306` "use one of" for `inline && filePath` (0.27), `cli.ts:455` "missing token" for an empty trimmed token (0.23), `worker.ts:18498` "fanout launch failed: no worker job enqueued" for `launched_count === 0` (0.22), `worker.test.ts:13757` the `alwaysFail` / "queue unavailable" stub flag (0.24 under revision 1), `hub-pr-watch.test.ts:227` "unexpected extra page request" for `calls > 1` inside a stub -- a real guard in a test double, and the message matches (0.12), and the `sandbox/worker.ts:360` sibling of `:370` (0.13). None was a defect under revision 1 either; the remaining 54 sit at 0.32 and below and were not read.

No true positive exists in this repository under either revision, so the run
measures precision only; the recall evidence is the corpus.

**Cost** (this revision only; the tool's own summaries)

| run | passes | requests | input tokens | USD |
| --- | --- | --- | --- | --- |
| gaps, attempt 0 (no record; `gaps` does not write one) | 1 | 4 | ~26,700 | 0.00112 |
| calibrate x1, attempt 0 | 1 | 4 | 26,671 | 0.00112 |
| calibrate x1, attempt 1 | 1 | 4 | 31,125 | 0.00131 |
| calibrate x1, attempt 1 second pass | 1 | 4 | 31,125 | 0.00131 |
| calibrate x1, attempt 2 | 1 | 4 | 33,267 | 0.00140 |
| calibrate x1, attempt 3 | 1 | 4 | 30,689 | 0.00129 |
| calibrate x3, final | 3 | 12 | 92,067 | 0.00387 |
| check, unseen repository | 1 | 21 | 79,851 | 0.00335 |
| **total** | 10 | **57** | **~351,500** | **~$0.0148** |

Family total including revision 1: ~$0.061.

**Verdict**: COOKBOOK -- the class this revision was for is out (seven corpus
stubs and three repository stubs all under 0.55, four of them by the matcher
and so not subject to the model at all, and zero findings on 73 unseen
subjects), but the cutoff has 0.06 of headroom over the nested-guard clean
that flips once in three passes, the underflow defect is still a miss, and the
new wording raised the ordinary "missing" -for-empty clean band from 0.40 to
0.51, so on the next repository the false positive will be a nested guard or
a value-vs-absence message, not a test double.

**What I would change**: the nested guard should be handled in the matcher,
not the sentence -- either exclude an if-throw whose parent block belongs to
another `if` (losing the inner check, which the rule cannot judge alone
anyway), or capture the outer condition through `inside: { pattern: "if
($OUTER) $BODY" }` so the ask can name both; the model half-applies the
"both conditions together" clause and that is the whole wobble. Add two more
value-vs-absence defects to learn whether the "missing" convention band at
0.51 is stable or drifting toward the cutoff. Keep `FakeQueue` in the corpus:
a fake class whose method looks like production code is the residual stub
class, and 0.46-0.55 is where it honestly belongs given what `local` shows.
