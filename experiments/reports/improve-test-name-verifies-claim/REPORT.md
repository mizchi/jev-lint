# improve: test-name-verifies-claim

## Rule

`test-name-verifies-claim` (TypeScript) and `test-name-verifies-claim-rust`,
in `rules/test-name-verifies-claim/`. Shares `cart.test.ts`, `store_test.rs`,
`inventory.test.ts` and `ledger_test.rs` with `test-name-describes-code` as
byte-identical copies; `profile.test.ts` and `notify_test.rs` are its own.

**Start** (3 passes, shipped `threshold: 0.52` / `0.53`):

| rule | P | R | defects | cleans | clean top | defect floor | flips |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TS | 0.93 | 1.00 | 14 | 29 (3 hard) | 0.56 | 0.59 | 2 |
| Rust | 1.00 | 1.00 | 4 | 3 (0 hard) | 0.15 | 0.90 | 0 |

The TS false positive was `cart.test.ts:76` (the preamble test) at 0.56;
`order-summary.test.ts:53` ("renders" over a snapshot) sat on the cutoff
and flipped, as did `:63`.

**End** (3 passes, `threshold: 0.62` / `0.54`, baseline accepted, replay passes):

| rule | P | R | defects | cleans (hard) | clean top | defect floor | headroom | flips |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TS | 1.00 | 1.00 | 31 | 52 (20) | 0.58 | 0.73 | 0.04 / 0.11 | 1 |
| Rust | 1.00 | 1.00 | 17 | 18 (9) | 0.48 | 0.57 | 0.06 / 0.03 | 0 |

Correct on every case at the accepted cutoffs, but NOT the bar: the
headroom is short on the clean side in TS and on both sides in Rust, and
the TS flip (`profile.test.ts:164`) is the case eating the clean-side
headroom. The reason is one class, stated below.

## Attempts

Numbers at the shipped `threshold:` of the time (0.52 / 0.53) unless stated.

0. Cases added (shared files plus `profile.test.ts`, `notify_test.rs`),
   question untouched -> TS P 0.97 R 1.00, clean top 0.54, defect floor 0.55;
   Rust P 0.94 R 0.88, clean top 0.59, defect floor 0.48. The TS false
   positive was my own label error (`profile.test.ts:96`, "removes the
   previous avatar object, not the new one": `toHaveBeenCalledWith(old)`
   alone does not establish "not the new one"; a call count was added so the
   compound claim is covered). The Rust misses were the two adjacent-name /
   never-set-up wrong-thing defects (`ledger_test.rs:66`, `:39`).
1. Criteria rewritten in full, with the snapshot reasoning spelled out in the
   true branch and every quiet shape listed -> WORSE: TS P 0.81, every
   snapshot test including the label-only cleans lifted to 0.59-0.76 (an
   inline snapshot that visibly shows the sorted order went to 0.67); Rust
   P 0.88 R 0.88, `digest_snapshot_three_items` 0.71, `renders_the_empty_digest`
   0.76. Reverted.
2. Original criteria plus a note: a snapshot under a name claiming a
   specific property establishes nothing about it, under a name that only
   says renders / snapshot / labels the variant it is the whole claim; a body
   whose named operation is never called or whose named case is never set up
   establishes nothing -> TS P 0.97 R 1.00, clean top 0.54
   (`profile.test.ts:164`), next clean 0.44, defect floor 0.54
   (`inventory.test.ts:77`), next defect 0.76; "renders" fell from 0.50 to
   0.32. Rust P 1.00 R 1.00, clean top 0.50, defect floor 0.61. KEPT.
3. Ask rephrased to "The assertions in this test do not establish what its
   name claims" -> a different trade, not a better one: `inventory.test.ts:77`
   rose to 0.76 and `profile.test.ts:164` fell, but "renders the error state
   when the request fails" over a snapshot dropped to 0.48 (a miss: it now
   read as a label) and two exact-order cleans wobbled to 0.48-0.49. Reverted.
4. Note lengthened with two general clauses: "with / for / of some state
   names the input, not a property", and "a different function with a
   similar name is not the named operation" -> `inventory.test.ts:77` 0.72
   (the second clause works) but `profile.test.ts:164` 0.58 and the Rust
   label-only snapshot cleans 0.50-0.54 (the first clause hurts). Reverted;
   the similar-name clause alone was not tried, as it would be a fifth change.
5. `threshold:` 0.52 -> 0.62 (TS) and 0.53 -> 0.54 (Rust, the midpoint of two
   runs). Accept run: TS P 1.00 R 1.00, `inventory.test.ts:77` at 0.73 this
   time (it spans 0.46-0.81 across six passes), `profile.test.ts:164` 0.58
   with one pass at 0.62; Rust P 1.00 R 1.00, `ledger_test.rs:39` at 0.57.

## Cases added

Shared with `test-name-describes-code` (`inventory.test.ts`,
`ledger_test.rs`): every wrong-thing defect there is a defect here (nested),
its weak-but-right cleans are defects here (`:26` length only, `:36`
`toBeDefined`, `:94` no assertion, and the Rust twins), and its other cleans
are cleans here. Two hard cleans specific to this rule fall out of it:
`inventory.test.ts:48` / `ledger_test.rs:45` ("discounts a line of more than
ten units" over `toBeLessThan(full price)`: the title claims only that a
discount happens, and strict less-than fails if none does) and
`:126` / `:120` (a negative claim established by exact equality, the
self-lint shape).

`profile.test.ts` (vitest, mocked repository / storage / bus):
- defects, all quiet: `:35` "stores the email lowercased" over
  `toHaveBeenCalledTimes(1)`; `:45` "publishes a profile.updated event
  carrying the changed fields" over `toHaveBeenCalled()`; `:61` "returns the
  updated profile" over `toBeDefined()`; `:74` "retries the upload once on a
  transient failure" with the rejection swallowed and `toHaveBeenCalled()`;
  `:109` "clears the avatar url" over `toHaveBeenCalledWith(id, anything())`;
  `:134` "trims the display name" over a call count; `:168` "shows the
  pending email with a verification hint" over a snapshot.
- hard cleans: `:40` the lowercased-email claim established by
  `toHaveBeenCalledWith` carrying it (twin of `:35`); `:50` "does not publish
  an event when the email is unchanged" over `not.toHaveBeenCalled()`; `:55`
  "reads the profile before writing it" over invocation order; `:80` preamble
  comment, compound claim, both call count and stored url asserted; `:91`
  "calls the storage client once per upload" over `toHaveBeenCalledTimes(1)`
  (the boundary claim); `:96` compound claim (previous object, not the new
  one) with count and argument; `:114` "does not touch storage" over
  `not.toHaveBeenCalled()`; `:139` negative claim, exact equality; `:150`
  "renders the profile card" over a snapshot; `:154` "profile card, no
  avatar" over an inline snapshot; `:164` "matches the snapshot with a
  pending email change" over a snapshot.
- ordinary cleans: `:128`, `:143`, `:172`.

`notify_test.rs` (a recording mailer behind a trait):
- defects: `:27` display name claimed, only `sent.len() == 1` checked; `:58`
  "lists every unread item" over the sent count; `:83` "omits the unsubscribe
  footer" over `insta::assert_snapshot!`; `:88` "retries once when the mailer
  fails" over `is_err()`.
- hard cleans: `:43` "sends exactly one message per welcome" over the count;
  `:50` "sends nothing when opted out" over `is_empty()`; `:73`
  `digest_snapshot_three_items`; `:78` `renders_the_empty_digest`.
- ordinary cleans: `:34`, `:65` (per-line count; the model hedges it at
  0.46-0.59 across attempts, since the `"- "` prefix is an assumption about
  the format), `:100`.

`cart.test.ts:76` renamed in both copies (see the describes-code report):
the old title read as the opposite of the 450 the body expects. After the
rename it answers under 0.4 here.

## What stops the bar

One class, in both languages: **a snapshot as the only assertion, with the
title as the only thing that differs between the defect and the clean.**
"shows the pending email with a verification hint" (defect) and "matches
the snapshot with a pending email change" (clean) have the same body; so do
`omits_the_unsubscribe_footer_for_transactional_mail` (defect) and
`digest_snapshot_three_items` (clean). On `bare` the model answers the two
sides of that pair 0.55-0.68 and 0.48-0.58, and no wording tried moves one
side without moving the other: spelling the snapshot reasoning out lifts
both (attempt 1), naming "with some state" as input-labelling lifts the
cleans (attempt 4), and rephrasing the ask turns "renders the error state
when the request fails" into a label (attempt 3). The counterfactual ask is
close to vacuous for a label-only title -- what behaviour does "matches the
snapshot" claim that could be broken? -- which is why those titles hover at
0.5 whatever the note says.

Specifically:
- TS clean side: `profile.test.ts:164` at 0.54-0.58 (one pass at 0.62).
  Headroom 0.04 against the bar's 0.10. Everything else clean is 0.44 and
  under, so the cutoff of 0.62 is 0.18 clear of the rest.
- TS defect side: `inventory.test.ts:77` (reserves / restock), 0.46-0.81
  across passes; a defect the other rule owns and catches at 0.89. The next
  defect is 0.73.
- Rust: clean top 0.48 (`digest_snapshot_three_items`), defect floor 0.57
  (`ledger_test.rs:39`, the never-set-up case; 0.61 on the previous run).
  Gap 0.09-0.11, cutoff in its middle.

The labels stay as they are: `:164` is a label-only title and is clean;
`:77` is a wrong-thing test and is a defect. A rule that reports a
0.55-0.60 finding of this shape is reporting a case a human should read.

Suggested next change, not made: the "similar name is not the named
operation" clause alone (attempt 4 showed it lifts `:77` by 0.18 without
touching the snapshot cases; it was the "with / for / of" clause that hurt).
A `state: local` or `located` sweep was not run; both halves of the
comparison are in the node, so the file should add nothing, but this rule
has never had its arm measured post-split.

## Unseen check

`check` over six agent-cluster test files (loop-service, cli,
self-improve-loop, validate-cluster-config, collect-autonomous-results,
watch-open-hub-prs; 82 subjects, `--cache none`, $0.0050): 2 findings at
`threshold: 0.62`, median 0.16.

- `apps/agent-worker/loop-service.test.ts:1283` "executeLoopIterateMergePhase
  merges adopted record and publishes base/rebase events", 0.68: TRUE
  POSITIVE. The merge summary is asserted field by field; the
  `publishBaseCommitUpdated` and `publishRebaseRequested` deps are stubs and
  nothing checks they were called. The "publishes" half of a compound claim
  is unestablished -- exactly the corpus's compound-claim shape, on the
  defect side.
- `apps/agent-worker/loop-service.test.ts:261` "executeLoopIterateSubmitPhase
  bypasses active objective preflight when allowed", 0.65: FALSE POSITIVE.
  `preflightObjectiveSubmit` is stubbed to return a 409 and
  `canBypassActiveObjectivePreflight` to true; `result.ok === true` fails if
  the bypass is broken. The evidence is a failing stub inside a 40-line deps
  literal, and the model did not connect it to the assertion. The real clean
  band reaching 0.65 is the headroom problem the evals already show.

Under 0.62 but worth naming: `scripts/watch-open-hub-prs.test.ts:205` 0.61,
`collect-autonomous-results.test.ts:315` 0.56, `loop-service.test.ts:1447`
0.56 -- not read.

## Cost

Seven eval runs of 3 passes (the last accepted) plus one unseen run: ~85
requests, ~1.65M input tokens, ~$0.073 (evals ~$0.068, unseen $0.005).
Combined with the describes-code work, the whole task spent ~$0.11 of the
$0.60 budget.
