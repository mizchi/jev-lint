# Improve: guard-name-guards

## Rule

`guard-name-guards` (TypeScript/TSX/JS/JSX), candidate, in
`experiments/rule-candidates/guard-name-guards/`. Names matching
`^(validate|sanitize|assert|ensure|check|verify)`; `subject: node`,
`state: local`. Family report: `experiments/reports/b-guarantee-names/`.

| | start (2026-09-19 baseline) | end (2026-09-20 baseline) |
| --- | --- | --- |
| `threshold` | 0.63 | 0.59 |
| P / R / flips | 1.00 / 1.00 / 0 | 1.00 / 1.00 / 0 |
| defects / cleans | 4 / 11 (7 labelled hard) | 10 / 20 (16 labelled hard) |
| clean top -> `threshold` -> defect bottom | 0.52 -> 0.63 -> 0.80 (0.11 / 0.17) | 0.51 -> 0.59 -> 0.66 (0.08 / 0.07) |
| unseen (agent-cluster, 26 subjects) | 4 findings, 2 false | 3 findings, 0 clearly false |

Nothing outside the rule's directory was touched. Three passes, decisions
on the mean, every number from `eval --repeat 3 --no-config`.

## Attempts

0. **As shipped.** 4/0/0 at 0.63, fitted 0.66; clean top `ensureBucket`
   0.52, defects 0.80-0.95. $0.0011.
1. **Cases only**: `gates.ts`, 6 defects and 9 cleans, two of the cleans
   rewritten from the unseen false positives (a catch branch that returns a
   fallback helper's verdict). No wording change. 10 tp / 3 fp, 2 flips:
   `validateBody` (GET has no body -> ok) 0.78, `checkRateLimit` (fallback
   helper) 0.72, `validateAlignment` (fallback helper) 0.64; also
   `validateAlignmentFallback` 0.60 and `checkHealth` 0.50. The new defects
   all landed at 0.77-0.95. $0.0022.
2. **Criteria + note, first edit.** `false`: "...a schema, library or helper
   it delegates to -- including a fallback helper whose verdict is returned
   when the primary check fails to run"; "returning early because there is
   nothing to examine (no body on a GET, an empty list) is not accepting an
   unexamined input". `note`: the fallback-helper sentence, and "the
   distinction for an early acceptance is what is absent: the thing to be
   examined, or the evidence the check needs (no signature, no expected
   value, an unsupported algorithm)". 10/0/0, fitted 0.63. The fallback
   cleans fell to 0.23-0.29 and `validateBody` to 0.56 -- but "an empty list"
   taught the wrong lesson: `validateEmail` (empty string accepted) fell
   0.93 -> 0.78 and `assertPositive` (NaN returned early) 0.77 -> 0.66.
   ~$0.0025.
3. **Criteria + note, second edit.** "an empty list" removed; `note` gains
   "an empty, NaN or otherwise degenerate value of the thing being checked
   is an input, and accepting it without examination is skipping the
   check". `validateEmail` back to 0.86, `validateBody` 0.44;
   `assertPositive` 0.64 and `validateAlignmentFallback` 0.59 both flipping
   around 0.63; fitted 0.61. ~$0.0025.
4. **`assertPositive` fixture rewritten** (see Cases): the NaN early return
   skipped nothing, because `value <= 0` is already false for NaN -- the
   model was right to hedge. Now `typeof value !== "number"` returns, and
   `!(value > 0)` throws. Result: 0.59, a miss at 0.63 -- the wording from
   attempt 2 ("not the kind of thing the check examines") now covered it as
   a type guard. ~$0.0025.
5. **Criteria + note, third edit.** `false`: "returning early when there is
   nothing to accept (a GET has no body, so a body validator returns ok
   with no body)". `note`: "what matters is whether something goes on as if
   it had passed: a value of the wrong type, an empty string, NaN or a key
   with a magic prefix that the function lets through unexamined is a
   skipped check even when the early return looks like a type guard".
   10/0/0, defects 0.66-0.95, cleans <= 0.51, fitted 0.59, flips 0.
   ~$0.0025.
6. **`threshold: 0.59`; `--accept`.** 10/0/0, flips 0, nothing within 0.03 of the
   cutoff. Clean top `validateAlignmentFallback` 0.51 (0.48-0.54), defect
   bottom `assertPositive` 0.66 (0.64-0.67). `--replay` passes. $0.0030.

Three criteria/note edits (attempts 2, 3, 5), one left unused: the two
cases that pinch the gap are not wording problems (below).

## Cases added

All in `gates.ts`.

- `:4 assertInvariant` **bad** -- returns without looking at the condition
  when `NODE_ENV` is production. 0.91.
- `:11 validateUpload` **bad** -- accepts any file over the scan limit
  without reading a byte. 0.90.
- `:21 verifyChecksum` **bad** -- `createHash` throws on an unsupported
  algorithm, the catch returns `true`. 0.93.
- `:35 ensureSubscribed` **bad** -- `.catch(() => undefined)` on the
  subscribe, resolves with nothing ensured. 0.90.
- `:44 validateLicenseKey` **bad** -- `dev-` prefix returns
  valid/enterprise before the signature is looked at. 0.87.
- `:56 assertPositive` **bad** (arrow function) -- a non-number is returned
  silently; the caller continues with it as positive. 0.66, the lowest
  defect.
- `:81 Room.checkRateLimit` -- hard clean, method; the catch returns
  `fallbackRateLimit(...)`, a helper named for the same check. Rewritten
  from agent-cluster `apps/bit-relay/worker.ts:396`, flagged at 0.80 on the
  recorded unseen run. 0.29.
- `:127 validateAlignment` -- hard clean; the catch is empty but the
  function then returns the fallback validator's verdict. Rewritten from
  `apps/agent-worker/worker.ts:6991`, flagged at 0.72 on the unseen run.
  0.27.
- `:115 validateAlignmentFallback` -- hard clean, a pure two-comparison
  validator whose name says it is the lesser path. 0.51, the top clean.
- `:144 validateBody` -- hard clean; GET/HEAD returns ok with no body,
  every request that has a body is parsed and checked. 0.36 (0.78 before
  the wording named it).
- `:160 checkPermission` -- hard clean; the early return is a memoised
  earlier verdict. 0.33.
- `:169 assertDefined` -- hard clean, terse arrow-function assert. 0.07.
- `:174 verifyPassword` -- hard clean, delegates to `argon2.verify`. 0.09.
- `:178 validatePort` -- hard clean, early returns reject. 0.11.
- `:190 checkHealth` -- hard clean; the catch records a failure. 0.35.

## What stops the bar

Headroom: 0.08 above the clean top, 0.07 below the defect bottom; the bar
asks 0.10 on both sides. Two cases:

- **`gates.ts:56 assertPositive`**, bad, 0.66. After three wordings, the
  last of which says in so many words that a wrong-typed value let through
  "even when the early return looks like a type guard" is a skipped check,
  the model still reads `if (typeof value !== "number") return;` as a
  guard half the time. A human reviewer would flag it; it is also the kind
  of code half of them would defend as "not my type to check". The label
  stands; the case is a weak contradiction.
- **`gates.ts:115 validateAlignmentFallback`**, clean, 0.51 (0.48-0.54).
  Every path compares and reports. The 0.5 comes from the name: the
  function is called `Fallback`, and the file shows it being used when a
  core module fails, so the model half-believes it is the lesser check --
  which the note says is not the question. It is the real shape from
  agent-cluster (`worker.ts:6932`, 0.74 on the recorded run, 0.60 now), so
  it stays.

Also noted: `guards.ts:7 validateEmail` (bad) is the widest spread in the
suite, 0.69-0.80 across passes, mean 0.74; not within 0.03 of the cutoff
but the case most sensitive to wording about empty inputs (attempt 2 sank
it to 0.78 with one example).

The partial-sanitiser class (`sanitizeHtml` stripping only `<script>`)
remains out of reach as the family report said; it is labelled clean here
and scores 0.25.

## Unseen check

`check apps packages -R rule.yml --no-config --cache none --threshold
guard-name-guards=0.59` over agent-cluster: 26 subjects, 8 requests,
$0.0010, record in the scratchpad. Three findings:

- `apps/bit-relay/worker.ts:241 sanitizeEnvelopes` 0.68 (0.80 on the
  recorded run). `if (!Array.isArray(value)) return value;` then maps
  `sanitizeEnvelope(item) ?? item`. A non-array body, or a non-object
  element, passes through with its `signature` intact. **True positive by
  the rule's letter**; whether the relay can ever hand it a non-array is
  outside the subject. I would keep it.
- `apps/agent-worker/worker.ts:6932 validateHubPrObjectiveAlignmentFallback`
  0.60 (0.74 before). `if (objective === null) return { ok: true }` -- no
  objective, nothing to align against. **Arguable**: vacuous acceptance
  (the "nothing to accept" class), but the proposal does go on as
  aligned. Sits 0.01 over the cutoff; a reviewer would dismiss it in ten
  seconds.
- `apps/bit-relay/worker.ts:246 sanitizeErrorMessage` 0.59 (0.60 before).
  `if (typeof value !== 'string') return value;` -- a non-string error
  passes through unsanitised. **Weak true positive**, same class as the
  first; exactly on the cutoff.

The two false positives the brief asked about are gone: `worker.ts:396
checkRateLimit` 0.80 -> 0.35 and `apps/agent-worker/worker.ts:6991
validateHubPrObjectiveAlignment` 0.72 -> 0.29, both the fallback-helper
class now in the criteria and the evals. Below the cutoff the real-code
clean band tops at 0.55 (`checkScopedApiAuth`, which returns pass after
`shouldEnforceApiToken` says not to) and 0.53; the corpus clean top is
0.51, so on this repository the corpus is not hiding a hole.

## Cost

About 60 requests, ~330k input tokens, **~$0.017** (six three-pass evals at
$0.0011-0.0030, one unseen check at $0.0010).

Both rules together: **~$0.065** of the $0.60 budget.
