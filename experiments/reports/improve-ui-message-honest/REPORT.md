# improve: ui-message-honest

**Rule**: `ui-message-honest`, `experiments/rule-candidates/ui-message-honest/`.
`subject: enclosing`, `state: local`, unchanged.

| | start | end |
| --- | --- | --- |
| cases | 29 subjects: 10 bad, 19 clean (11 hard) | 55 subjects: 17 bad, 38 clean (24 hard) |
| at | 0.62 | 0.63 |
| P / R (3 passes, means) | 1.00 / 0.90 (fn `handlers.ts:112` at 0.53) | 1.00 / 1.00 |
| bad band / clean band | 0.53-0.94 / 0.06-0.46 | 0.74-0.94 / 0.06-0.48 |
| headroom (clean max to at / at to bad min) | 0.16 / -0.09 | 0.15 / 0.11 |
| flips | 0 | 0 |
| within 0.03 of the cutoff | none | none |

The numbers were re-derived from scratch: the first eval of this brief
reproduced the baseline (same decisions, `:112` at 0.51-0.55), and every
number below is from runs after the promoted-subject key included the match,
so two messages in one function are two questions. The new cases test that
directly: `share.tsx` has "Saving…"/"Saved" in one handler (0.07 / 0.15), a
bad success toast beside its honest `.catch` (0.90 / 0.15), and "Exporting…"
beside an enqueue-only "Export finished" (0.09 / 0.89). Nothing is copied
between twins any more.

**Attempts**

1. As shipped, `eval --repeat 3` (29 subjects): P 1.00 R 0.90, fitted 0.49;
   `handlers.ts:112` ("This verification link has expired" for a token that
   is missing, used or expired) 0.53. Every other defect 0.81-0.94, clean max
   0.46. The only class that misses is a specific cause named for a branch
   that other visible causes also reach, *outside a catch*; the criteria only
   named that class for a catch.
2. Corpus + matcher, wording unchanged (55 subjects): P 1.00 R 0.90, fitted
   0.49. `:112` 0.56, and its new sibling `admin_handlers.ts:8` ("already
   been accepted" for missing/accepted/expired) 0.65 with a flip (0.61-0.69)
   -- the class confirmed at n=2. The matcher widening: React setters by
   prefix (`set(Status|Message|Msg|Error|Success|Feedback|Notice|Banner|Toast|Flash)\w*`),
   which found `setNotice`/`setBanner` in the new cases.
3. Criteria: the "one specific cause" clause now covers a branch, not only a
   catch -- "a condition joined with || that names only one of its
   alternatives, such as calling a link expired when the same branch is taken
   for a token that is missing or already used" -- and the false branch says
   a message that covers every cause of its branch ("no longer valid") is
   honest. P 1.00 R 1.00, fitted 0.63; `:112` 0.88, `admin_handlers.ts:8`
   0.86, the "no longer valid" sibling 0.12. Clean max 0.50 (`handlers.ts:25`,
   "Account closed. Data is retained for 30 days, then removed."), bad min
   0.76 ("Comment deleted" for a PATCH `hidden: true`). Set `at: 0.63`.
4. Matcher, no wording change: the prefix regex from attempt 2 had lost its
   `$` anchor, so `notify*` matched `notifyLoopIterateGateRejectedCandidates`
   on the unseen repository; anchored. `message.includes(...)` (a string
   method on a variable called `message`) was already a subject under the
   `$UI.$KIND` arm and is now excluded by a `KIND` constraint. A fifth arm
   matches `jsonResponse({ error: "..." }, status)`, the Workers-style helper
   agent-cluster uses everywhere, since without it the rule had zero real
   subjects there. Re-run and accepted: P 1.00 R 1.00, fitted 0.61, bad
   0.74-0.94, clean 0.06-0.48, 0 flips.

**Cases added** (`share.tsx`, `admin_handlers.ts`; labels carry the full
argument)

- `share.tsx:13` clean, "Saving…" before the await, with a second message in
  the same function -- 0.07.
- `share.tsx:15` clean (hard), "Saved" after the awaited PATCH in the same
  function as the progress message -- 0.15.
- `share.tsx:30` bad, "Shared with your team" shown before the request
  resolves, failure reported only in `.catch` -- 0.90.
- `share.tsx:31` clean, "Sharing failed" in that `.catch`; sits in the same
  function as the bad one -- 0.15.
- `share.tsx:39` / `:41` clean, "Invoice sent" after the awaited POST inside
  a try, generic "Could not send the invoice" in its catch -- 0.14 / 0.07.
- `share.tsx:47` bad, "Comment deleted" when the code PATCHes `hidden: true`
  -- 0.74 (the weakest defect: "deleted" for a hide is one word away from the
  soft-action convention the false branch forgives).
- `share.tsx:52` clean (hard), the same PATCH described as "Comment hidden"
  -- 0.11.
- `share.tsx:59` / `:61` clean / bad, "Exporting…" then "Export finished"
  after only `queue.add` -- 0.09 / 0.89.
- `share.tsx:77` bad, `setNotice("Saved")` after an un-awaited `queue.add`
  -- 0.91.
- `share.tsx:90` clean (hard), "Review requested. The reviewer will be
  notified." after an awaited POST; the notification is another system's
  claim -- 0.47.
- `share.tsx:97` / `:100` clean, generic catch and "Version restored" after
  the awaited call -- 0.07 / 0.10.
- `share.tsx:110` bad, `setBanner("Renamed")` with the PATCH explicitly
  `void`ed and the dialog closed -- 0.87.
- `admin_handlers.ts:8` bad, "This invitation has already been accepted"
  for a `!invite || invite.acceptedAt || expired` branch -- 0.85.
- `admin_handlers.ts:19` clean (hard), the same branch as "no longer valid"
  -- 0.12.
- `admin_handlers.ts:29` clean (hard), "Reindex queued" with 202 after
  enqueue -- 0.10.
- `admin_handlers.ts:35` / `:45` / `:55` clean, three "not found" messages
  on their `!x` branches -- 0.06-0.07.
- `admin_handlers.ts:39` clean (hard), "Member removed" after an update
  setting `removedAt` -- 0.31.
- `admin_handlers.ts:49` bad, "All personal data has been erased" after only
  enqueuing `gdpr.anonymize` -- 0.94.
- `admin_handlers.ts:58` clean, "API key rotated" after the awaited rotate
  returned the key -- 0.11.
- `admin_handlers.ts:66` clean (hard), "Catalog file could not be parsed" in
  a catch whose try holds only `parseCatalog` -- 0.18.
- `admin_handlers.ts:70` clean (hard), "Import started" with 202 after the
  enqueue -- 0.15.

**What stops the bar**: nothing. The two closest cases are the soft-delete
"closed ... then removed" clean at 0.48 (0.15 under) and "Comment deleted"
for a hide at 0.74 (0.11 over); both are the convention boundary the rule is
about, and both are stable across passes (spread 0.03 and 0.01).

**Unseen check** (agent-cluster `apps/` + `packages/`, final rule, one pass,
`--record`): 408 subjects, 10 requests, $0.0139, **0 findings at 0.63**.
Median 0.14, highest 0.46: `apps/sandbox/worker.ts:729`, a catch whose
fallback string is `'gitfs mount failed'` while the try also resolves the
sandbox -- a specific-cause-in-a-catch borderline the model answers as clean
with 0.17 of headroom, which is the right side. Next: `worker.ts:17121`
"planner produced empty todo list" for `tasks.length === 0` (0.36),
`:19139` "cluster stopped" (0.35), `sandbox/worker.ts:701` "invalid json
payload" (0.35). All clean. The repository is an API server: every subject
is an error message on a guarded branch, so this run measures the clean band
only; the recall evidence is the corpus. Before the fifth matcher arm the
rule had no real subject in this repository (15 over-matches, all
`message.includes` or a `notify*` prefix), which is why the arm was added.

**Cost**

| run | passes | requests | USD |
| --- | --- | --- | --- |
| eval, as shipped (29) | 3 | 6 | 0.0030 |
| eval, corpus + matcher (55) | 3 | 12 | 0.0069 |
| eval, criteria v2 | 3 | 12 | 0.0069 |
| eval --accept, final matcher | 3 | 12 | 0.0062 |
| check, unseen (408 subjects) | 1 | 10 | 0.0139 |
| **total** | | **52** | **~$0.037** (~0.9M input tokens) |
