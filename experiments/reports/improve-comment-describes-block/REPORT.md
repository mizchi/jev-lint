# improve: comment-describes-block

## Rule

`comment-describes-block` (TypeScript/JS) and `comment-describes-block-rust`,
`rules/comment-describes-block/`.

| | start | end |
| --- | --- | --- |
| TS `threshold` / state | 0.94 / `bare` | 0.75 (parked, see below) / `located` |
| TS P / R / flips | 1.00 / 0.50 / 0 | 1.00 / 0.92 / 0 |
| TS defects / hard cleans | 2 / 3 (the 3 were marker-laden, see below) | 12 / 13 |
| TS headroom (clean -> at -> lowest caught defect) | preambles at 0.81-0.93 on real code sat OVER one defect | 0.34 -> 0.75 -> 0.83: 0.41 / 0.08 |
| Rust `threshold` / state | 0.90 / `bare` | 0.45 / `bare` |
| Rust P / R / flips | 1.00 / 0.50 / 0 | 1.00 / 1.00 / 0 |
| Rust defects / hard cleans | 2 / 0 | 10 / 8 |
| Rust headroom | - | 0.12 -> 0.45 -> 0.60: 0.33 / 0.15 |

Baseline accepted (3 passes); `eval --replay` passes, "all as shipped".

## The finding: why preambles read as false

Two things, found with `--show-subjects` and by reading `src/state.ts`
(read only, nothing changed there):

1. **A statement in a `test("...", () => {...})` callback has no enclosing
   symbol.** `pickEnclosing` only knows named containers (function
   declarations, methods, `const f = () =>`), so `subject: enclosing` cannot
   promote it and the subject falls back to the bare statement -- listed as
   `composite match` rather than `function judged: enclosing` in
   `--show-subjects`. On `state: bare` the model is handed ONE statement and
   the comment and nothing else. Every TS preamble in the old corpus, in
   `test/test.ts` and in agent-cluster's `worker.test.ts` was judged this way,
   which is why "a pre-commit hook runs `review --staged`" above
   `const { execFileSync } = await import(...)` answered 0.93: the statement
   does not do what the comment says, and there is nothing else to look at.
   Rust tests are named `fn`s, are promoted, and the same preamble shapes
   answered 0.20-0.42 on `bare` before any wording change.
2. **`$DOC` is the last line of a multi-line `//` comment** (each line is its
   own `comment` node). The model was handed fragments like
   `// paths:, scanned the whole tree to discard most of it.` as the claim.

The cure inside the rule is `state: located` for the TS variant (the file
carries the body) plus a note saying where the comment starts. The limit of
that cure: `located` steps down to `local` when a file is over the state
budget -- `test/test.ts` (2652 lines) and agent-cluster's `worker.test.ts`
both do -- and `local` carries nothing for a callback either. On those files
the model is back to the lone statement. The fix that would make it right
everywhere is in `src/state.ts` (treat an arrow function passed as a call
argument as a container, named by the call's first string argument); out of
scope here, recorded in the rule's comment.

The old `cart.test.ts` also carried marker text inside the case file: a
five-line comment saying "the three tests below open with a PREAMBLE ... they
are the hard clean case for that rule", and three dangling half-sentence
comments (`// the line under it. Judged against the body, every claim
holds.`) that the matcher picked up as subjects of their own. Replaced.

## Attempts

Numbers are 3-pass means on the evals unless marked blind. "Blind" is
`test/test.ts` in this repository, 99 subjects, one pass, where `located`
steps down to `local` and the TS model sees only the statement.

0. New cases, rule unchanged (`bare`, old wording). TS: cleans up to 0.90
   (eight preambles/headings 0.77-0.90), defects 0.26-0.96 with two under
   the cleans; no cutoff. Rust: cleans <= 0.42, defects >= 0.55; separates
   already. Blind: median 0.57, 60/99 over 0.50, max 0.93. $0.0031.
1. `state: located` on the TS variant only. TS preambles 0.24-0.79 (84: 0.90
   -> 0.79, 15: 0.89 -> 0.67, 103 trailing: 0.62, the rest <= 0.41); highest
   clean 0.79, lowest defect 0.46. $0.0035.
2. Wording (1 of 4): ask names DOC instead of "marked as matched" (the
   `matched` field holds the statement, not the comment); criteria say what
   "the code beneath" is (the run of statements to the next comment), name
   the preamble/why/history/other-code comment as making no claim, the
   trailing comment as belonging to the line before; note says DOC is the
   last line of a comment that may start above. TS: highest clean 0.49
   (103, trailing), lowest defect 0.58 (session_store:69). Rust: cleans
   <= 0.12, defects >= 0.68. $0.0041.
3. Wording (2 of 4): "a reason outside the code" instead of "explains why",
   and "a comment that states the effect the code achieves is a claim about
   that code" (aimed at session_store:69). TS: 0.47 / 0.59. No movement.
   $0.0044.
4. Wording (3 of 4): note tells the model to find DOC's line in the source
   and treat a comment with code before it on its line as trailing. Also
   disambiguated session_store:69's comment ("newest" is not defined by the
   code; now "the sessions that expire last"). TS: highest clean 0.38 (103),
   lowest defect 0.54 (69). Blind: median 0.26, 5/99 over 0.50, max 0.67.
   $0.0046 + $0.0027.
5. Wording (4 of 4): "the contradiction has to be visible in the code
   shown", for the blind case. Evals unchanged (0.39 / 0.53). Blind: median
   0.24, 4/99 over 0.50, max 0.63 (1969: 0.63, 820: 0.58, 2211: 0.52,
   2558: 0.52 -- all preambles judged without a body). $0.0049 + $0.0029.
6. Case fix: `retry_queue.ts:54` ("remove the head" above `queue[0]`) had a
   second line marking the job as claimed, which half-achieves what the
   comment promises; the model sat at 0.69-0.74, on the cutoff. Removed that
   line; it answers 0.86. Rust `threshold` 0.50 -> 0.45 for headroom under
   `scheduler.rs:86` (0.56-0.65). Accepted. $0.0049 x 3 (one run with
   shifted labels, one accept, one re-accept).

## Cutoffs

- **Rust 0.45.** Evals: cleans 0.06-0.12, defects 0.60-0.95, fitted 0.36.
  Blind (40 subjects, five wasmtime files, `bare`, promoted): max 0.51 for
  a comment saying "disable this suite when QEMU is enabled" above an `if`
  that tests `WASMTIME_TEST_NO_HOG_MEMORY` -- a fair candidate -- then 0.41
  (a `// TODO: assert!` above an assignment). 0.45 has 0.33 / 0.15 headroom
  on the evals.
- **TS 0.75, parked.** The fitted midpoint is 0.43 and at it the evals are
  1.00/1.00 with 0.09 / 0.09 headroom (0.34 -> 0.43 -> 0.52). But on a test
  file over the state budget the real preamble band reaches 0.63 (blind,
  above), and that band sits over the lowest defect (session_store:69 at
  0.52) and under the rest (>= 0.83). Per the brief, the cutoff stays over
  the real band rather than being lowered to pass the evals: 0.75 is 0.12
  over the blind maximum and 0.08 under the lowest caught defect
  (retry_queue.ts:31, a unit mismatch, 0.82-0.83). The rule's comment says
  to set 0.45 when test files fit the budget.

## What stops the bar

- **TS recall 0.92**: `session_store.ts:69`, 0.52 [0.47-0.58]. "Sort so the
  sessions that expire last are the ones kept" above an ascending sort; the
  sort is consistent with the comment, and the falsehood appears only with
  the `slice(limit)` loop after it. Three wordings did not move it (0.53,
  0.59, 0.54, 0.52). A two-statement inference the model does not make;
  labelled bad, left as the stated miss.
- **TS headroom 0.08** under the cutoff (bar: 0.10), a consequence of
  parking at 0.75 rather than at the fit.
- **Real code over the state budget**: the four blind preambles at
  0.52-0.63 are under 0.75 today with 0.12 to spare, but they are judged
  without a body, and a longer or more assertive preamble could pass 0.75.
  That is a `src/state.ts` matter (callbacks are not containers).

## Cases added

`cases/cart.test.ts` removed (markers inside the file). Window 0 throughout:
the reported line is the match, not the function.

`log_sink.test.ts` (TS hard cleans, shapes rewritten from `test/test.ts` and
agent-cluster's `worker.test.ts`):
- 15 clean: "Append two events" above the first of two appends -- the count
  spans the section, not the statement (agent-cluster's 0.87).
- 22 clean: "Verify only the new one remains" above the query; the asserts
  after it verify.
- 34 clean: "newest first" above two asserts that check that order.
- 41 clean: multi-line preamble about realpathSync/macOS; DOC is a fragment.
- 57 clean: preamble naming the bug the test guards against.
- 69 clean: "First two polls return an open issue" above one `return` inside
  `if (polls <= 2)` (agent-cluster's 0.84).
- 84 clean: the pre-commit preamble above a dynamic import (this repo's 0.93).
- 101 clean: multi-line "budget, not ceiling" preamble above the loop.
- 103 clean: `continue; // irreducible` -- a trailing comment on the line
  before, matched as the comment above the assert (this repo's 0.86).
- 113 clean: "a claim about the batch COUNT" above `assert.equal(len, 2)`.

`retry_queue.ts` (TS defects, one per function, plus cleans):
- 15 bad: "sort descending" / ascending comparator (direction).
- 20 bad: "at most ten" / `min(size, 25)` (count).
- 26 bad: "double the delay" / linear (step).
- 31 bad: "in milliseconds" / seconds subtracted from `Date.now()` (unit).
- 44 bad: "three times" / `< 5` (count).
- 49 bad: "round down" / `Math.ceil` (rounding).
- 54 bad: "remove the head" / `queue[0]` (step not performed).
- 62 bad: "skip jobs that have a worker" / `if (!job.workerId) continue`
  (inverted condition).
- 70 bad: "oldest first" / newest-first comparator (order).
- 78 bad: "half a second" / 5000 ms (count/unit).
- 85 clean: why-comment about the server's policy above an early return.
- 88 clean: "Bookkeeping." (vague but true). 94 clean: "Fast path."

`scheduler.rs` (Rust defects and hard cleans):
- 37 bad: "ten most recent" / `truncate(20)` (count and direction).
- 43 bad: "newest first" / ascending `sort_by_key` (order).
- 49 bad: "seconds to milliseconds" / `* 1_000_000` (unit; tail expression).
- 56 bad: "up to three times" / `0..5` (count).
- 70 bad: "skip done" / `if !e.done { continue }` (inverted).
- 81 bad: "round down" / `(secs + 59) / 60` (rounding; tail expression).
- 86 bad: "double the backoff" / `+= 1_000` (step).
- 94 bad: "remove the head" / `first().cloned()` (step not performed).
- 102 clean: why-comment about the unit, and the code uses seconds.
- 105 clean: "Bookkeeping." above a tail expression. 110 clean: "Fast path."
- 126 clean: preamble naming the past bug. 138 clean: "Two entries" heading
  above two appends. 143 clean: "Verify" heading. 153 clean: trailing
  comment on `continue`. 164 clean: preamble saying what is NOT tested.

`session_store.ts:69`: comment reworded from "newest" to "expire last" so the
claim is defined by the code (label unchanged, still a miss).

## Matcher change (Rust)

The Rust matcher listed statement kinds and missed a block's tail expression
(`(secs + 59) / 60` as the last line of a function): three of the new
defects were silent. ast-grep needs a positive `kind`, so the tail
expression kinds are now enumerated, `inside: {kind: block}` at the
neighbour. All 18 Rust subjects are found; `--show-subjects` confirms.

## Unseen checks

- **agent-cluster** (`apps/agent-worker/{worker.test.ts,worker.ts,
  control-plane-room.ts}`, `apps/bit-relay/worker.ts`; the recorded run's 30
  subjects), one pass, $0.0016: **0 findings at 0.75**, max 0.42, median
  0.13. The recorded run's top six -- "Append two events" 0.87, "First two
  polls" 0.84, "Verify only new remains" 0.73, "Query all" 0.73, "newest
  first" 0.73, "Validate log lines" 0.71 -- now answer 0.26, 0.24, 0.41,
  0.41, 0.42, 0.41. All six are section headings I judge clean; 23 of the
  30 subjects were judged on `local` (file over budget), i.e. without a body.
- **This repository's `test/test.ts`**, 99 subjects: before, median 0.57 and
  60/99 over 0.50 (max 0.93); after, median 0.24 and 4/99 over 0.50 (max
  0.63). Every one of the 99 I read is a preamble, heading or why-comment;
  none is a defect. The four over 0.50 are listed under attempt 5.
- **wasmtime** (five Rust files, 40 subjects), one pass, $0.0025: max 0.51
  (disas.rs:69, the QEMU/env-var mismatch, which I would show a human), then
  0.41; 1 finding at 0.45.

## Cost

149 requests, ~1.21M input tokens, ~$0.051 (nine 3-pass evals at
$0.003-0.005 each, three runs over test/test.ts, one over agent-cluster, one
over wasmtime).
