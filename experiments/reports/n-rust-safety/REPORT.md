# Family N: the SAFETY comment, in Rust

One rule, `rust/safety-comment-holds`. A `// SAFETY:` comment above an
`unsafe` block is the one comment Rust code is required to write (clippy's
`undocumented_unsafe_blocks` checks that it exists) and the one nothing
reads: it states the reason the block's preconditions hold -- "len < cap
after the grow above", "id.0 < slots.len(), checked above", "frame_open
returns a valid context, so ctx is non-null" -- and the reason is either in
the code around it or it is not. A linter cannot decide it because the
comment is prose and the evidence is a check two lines up, a loop bound, a
constructor's guard, an extern block's doc comment, or another function of
the file; jev reads the claim and the code and says whether the code gives
the reason the comment gives. The rule is the Rust twin of
`rules/rust/comment-describes-block` narrowed to the one comment whose
falsehood is undefined behaviour rather than confusion.

Candidate: `experiments/rule-candidates/rust/safety-comment-holds/`
(rule.yml, fixtures/{ring,arena,ffi}.rs, expect.yml, baseline.json and
last.json from the accepted run). Verdict: **COOKBOOK** -- P 1.00 / R 0.89
(8/0/1) at 0.58 with no flips, but 0.05 of defect-side headroom and one
defect sitting inside the top clean's band.

---
## safety-comment-holds

### Rule

`experiments/rule-candidates/rust/safety-comment-holds/rule.yml`:

```yaml
# A `// SAFETY:` comment is the one comment Rust code is required to write
# (clippy's undocumented_unsafe_blocks) and the one nothing checks: it states
# the reason the unsafe block's preconditions hold, and the reason is either
# in the code around it or it is not.

id: safety-comment-holds
language: Rust
kind: noul
subject: node
# `located`, not `local`: the reason a SAFETY comment gives is often in
# another function of the file -- the grow it cites, the open that never
# tested for null, the release that empties the slot a Handle points at --
# and on `local` three of the nine defects answered 0.30-0.60 next to a
# clean band under 0.32. With the file in view they answer 0.58-0.82.
state: located
# 0.58, fitted 2026-09-20 (9 defects, 17 cleans of which 9 hard, 3 passes,
# accepted run): cleans top at 0.47 (0.45-0.48 across passes: Drop's
# `frame_close` beside an `open` that never tests for null; every other
# clean is under 0.32), defects start at 0.63 (0.63-0.64: the from_raw_parts
# given len + 1), 0.67 (0.64-0.71: the window whose check was on the other
# index), then 0.79-0.95. One defect sits under the cutoff: the
# unreachable_unchecked whose slot `release` empties answers 0.50-0.56, in
# the band between the top clean and the lowest found defect, so it is
# routed to a person rather than automated. Set at the middle of the
# worst-pass gap (0.48 to 0.63): 0.10 of clean headroom and 0.05 of defect
# headroom, so this is a recipe cutoff, not a shipped one. Report:
# experiments/reports/n-rust-safety/REPORT.md.
at: 0.58
severity: warning
rule:
  all:
    - any:
        # `unsafe { .. }` as a statement, bound by `let`, returned, as a
        # match arm's value, or inside a block's tail expression (a tail is
        # not an expression_statement, so the expression kinds that can
        # carry one are listed): the node the comment sits above.
        - all:
            - any:
                - kind: expression_statement
                - kind: let_declaration
                - kind: return_expression
                - kind: unsafe_block
                - kind: match_arm
                - kind: call_expression
                - kind: macro_invocation
                - kind: binary_expression
                - kind: unary_expression
                - kind: if_expression
                - kind: match_expression
                - kind: field_expression
                - kind: parenthesized_expression
                - kind: struct_expression
                - kind: tuple_expression
                - kind: index_expression
                - kind: reference_expression
                - kind: try_expression
                - kind: assignment_expression
                - kind: await_expression
                - kind: closure_expression
                - kind: array_expression
            - has:
                kind: unsafe_block
                stopBy: end
        # `unsafe fn` with a SAFETY comment above it.
        - all:
            - kind: function_item
            - has: { kind: function_modifiers, regex: unsafe }
    # The comment immediately above; tree-sitter gives one node per `//`
    # line, so this is the last line of the comment and jev-lint widens it
    # to the run.
    - follows:
        any:
          - kind: line_comment
          - kind: block_comment
        pattern: $DOC
    # Some line of a comment run above carries SAFETY.
    - follows:
        any:
          - kind: line_comment
          - kind: block_comment
        regex: "SAFETY|Safety|safety"
        stopBy: end
ask: >-
  The SAFETY comment captured as DOC gives a reason this unsafe code is
  sound, and the code around it does not establish that reason.
criteria:
  "true": >-
    The comment states a fact and the code shows otherwise: it cites a check
    that is not there, or a check on a different variable, index, length or
    vector than the one the unsafe operation uses; it says a bound holds when
    the loop or the arithmetic that produces the index can reach one past it;
    it says a pointer is non-null on a path where the function that produced
    it is documented to return null and nothing tests for it; it claims a
    length equals something the code passes a different value for; it says
    another function of this file leaves a state -- room in a buffer, a byte
    written, an error returned -- that reading that function shows it does not
    leave, or names a step that no function in the file performs; it relies on
    an invariant of a type -- a slot always full, an index always valid -- that
    another function in the file visibly breaks while the value is still held;
    it says the result borrows self or lives only as long as something when
    the signature returns it with 'static or a longer lifetime; or it says
    only that the operation is safe, sound or fine and names no reason, where
    the code checks nothing that would make it so.
  "false": >-
    Every fact the comment relies on is visible in the code: the check it cites
    sits above on the same path, in the loop bound, in the constructor or the
    type's private fields it names, or in the documented contract of the
    function being called; and the value the unsafe operation uses is the one
    that was checked. A terse comment that names the right check, a comment
    that restates a foreign function's documented contract correctly, or a
    comment that gives a reason outside this code that the code does not
    contradict, is not a violation. A precondition the comment does not
    mention is not a claim it makes: only what it states is judged, and a
    longer comment would not change the answer.
note: >-
  The comment under test is the run of comment lines ending at DOC. Judge the
  reason it gives against the code in front of you: the unsafe operation
  beneath it, the checks and arithmetic on the path to it, the signature, and
  what the file shows about the types and foreign functions it names. When
  the comment cites another function of this file -- a grow, a constructor,
  an open, a release -- read that function: the comment is judged by what it
  actually does, not by what its name suggests. A reason that the shown code
  neither confirms nor contradicts -- a caller's obligation, an invariant held
  by code that is not shown -- is not a violation. Whether the code could be
  written without unsafe is not the question; only whether the stated reason
  is the one the code gives.
```

### Corpus

26 subjects the matcher finds in three files of systems code: `ring.rs` (a
manually allocated byte buffer: alloc, realloc, push, extend, slices,
dealloc), `arena.rs` (a slot arena with `get_unchecked` lookups, a `Handle`
whose private index is a type invariant, and an `unreachable_unchecked`) and
`ffi.rs` (an `extern "C"` block with documented contracts, a `Reader` over a
foreign handle, and two `transmute`s). 9 bad, 17 clean, of which 9 are hard
cleans: the check two lines above (`ring.rs:20`, `:48`, `arena.rs:68`), the
loop invariant (`ring.rs:61`), the terse "i < len, loop bound"
(`arena.rs:107`), the type invariant held by a private field and a checked
constructor (`arena.rs:101`, needs the file), the FFI contract restated
correctly (`ffi.rs:41`), the transmute that looks alarming and is checked
three lines up (`ffi.rs:112`), and the vague-but-true null-pointer transmute
(`ffi.rs:124`). No markers in the fixtures; labels are in `expect.yml`.

The defects, one line each:

- `ring.rs:94` `window`: "end < len, checked above" -- the check above is on
  `index`; `end = index + width` is never compared with `len`.
- `ring.rs:103` `framed`: "cap >= len + 1 after the grow in push" -- push
  grows only when `len == cap` and then writes, so `len == cap` is reachable;
  `from_raw_parts` is given `len + 1` bytes of which at most `len` were
  written, and no `finish` writes the terminator the comment names.
- `ring.rs:110` `leaked_view`: "the returned slice borrows self" on a
  function returning `&'static [u8]`; the slice outlives the `dealloc` in
  `Drop`.
- `arena.rs:90` `pair`: "both indices were checked against the vec they
  index" -- `b.0` was checked against `free.len()` and indexes `slots`.
- `arena.rs:120` `count_full`: "i is bounded by len" above `while i <= len`;
  the last iteration indexes at `len`.
- `arena.rs:133` `get_mut`: `unreachable_unchecked` on the `Empty` arm,
  justified by "a Handle is only returned by alloc, which stores a Full
  slot"; `release` empties the slot while the `Copy` handle is still held,
  and `Handle::new` hands out a handle for any in-range index.
- `ffi.rs:65` `Reader::open`: "ctx is non-null here" -- `frame_open` is
  documented to return NULL when the file cannot be opened, and nothing tests
  `ctx` before `frame_set_flag`.
- `ffi.rs:77` `read_into`: "open returns Err before constructing a Reader
  with a null context" -- `open` has no such check; the cited guard is absent.
- `ffi.rs:117` `Tag::from_raw`: "this conversion is safe" names no reason;
  the byte comes off the wire unchecked into a three-variant `repr(u8)` enum.

### Attempts

Each line is one configuration; `gaps` was run on the first, `eval --repeat
1` on the rest (same measurement, with the labels applied), and `--repeat 3`
on the last two.

1. **`subject: node`, `state: local`, first wording.** `gaps`: matched 26,
   median 0.26, gap 0.25, suggest 0.45, verdict `rewrite`. With labels:
   cleans top at 0.32; five defects at 0.73-0.94, and four under 0.7:
   `read_into` 0.60, `framed` 0.54, `get_mut` 0.30, `leaked_view` 0.23. Three
   of the four cite another function of the file (`open`, `push`,
   `release`) that `local` does not show. Not a wording problem.
2. **`state: located`, same wording.** `read_into` rose to 0.77; `framed`
   0.53, `get_mut` 0.25, `leaked_view` 0.21 stayed; the top clean rose from
   0.32 to 0.47 (`Drop`'s `frame_close`, which now sits beside an `open` the
   model can see never tests for null). Gap between the found defects and
   the cleans 0.26, but two defects inside the clean band.
3. **`located`, criteria rewritten** to name the three shapes the file
   shows: another function of the file that does not leave the state the
   comment says (the grow, the open), a type invariant another function
   visibly breaks (the release), and a borrow claim against a `'static`
   return. Note told to read the cited function rather than trust its name;
   "false" told that a precondition the comment does not mention is not a
   claim it makes. One pass: `get_mut` 0.60, `framed` 0.68, `window` 0.65,
   `leaked_view` 0.20; top clean 0.45. Three passes: found defects
   0.58-0.93, `leaked_view` 0.22 on every pass, top clean 0.46 (0.43-0.51),
   one flip (`window` 0.72/0.58/0.66 around the uncalibrated 0.7).
4. **Same rule, corpus fix.** `leaked_view`'s answer was identical to
   `as_slice`'s on every pass (0.22/0.23/0.22) because the two `unsafe {
   slice::from_raw_parts(self.ptr, self.len) }` statements are the same
   text, and jev-lint asks one question per distinct subject text (see
   Tooling). With the defect's text made distinct (`self.ptr.cast_const()`)
   it answers 0.95 on every pass. This is the accepted run.

### Fit

Accepted run (`baseline.json`, 3 passes, `located`, attempt 3's wording):

| | |
| --- | --- |
| fitted cutoff | 0.50 (tool's midpoint); set **0.58** for the worst-pass gap |
| precision / recall at 0.58 | 1.00 / 0.89, tp 8, fp 0, fn 1 |
| decision flips across 3 passes at 0.58 | 0 |
| clean top | 0.47 (`ffi.rs:90`, 0.45-0.48); next clean 0.30 |
| lowest found defect | 0.63 (`framed`, 0.63-0.64), then 0.67 (`window`, 0.64-0.71) |
| the miss | `get_mut` 0.54 (0.50-0.56): between the top clean and the lowest found defect |
| max pass-to-pass spread | 0.07 (`window`) |
| headroom at 0.58 | clean 0.11 on the mean, 0.10 on the worst pass; defect 0.05 on the mean and on the worst pass |

At the tool's 0.50 every defect is found and nothing clean is flagged, but
`get_mut`'s lowest pass sits on the cutoff and the top clean is 0.02 under
it; that is the wobble band, and the calibration notes say not to automate
inside it.

### Verdict

**COOKBOOK.** The rule separates -- eight of nine defects at 0.63-0.95
against a clean band that tops at 0.47 and is otherwise under 0.32, no
flips, hard cleans (the two-lines-above check, the loop bound, the type
invariant, the FFI contract, the checked transmute) all under 0.32 -- but
the defect-side headroom is 0.05, and the ninth defect, the one that needs
the reader to notice that `release` breaks the invariant `get_mut` relies
on, lands inside the top clean's band. The arithmetic defects (`len + 1`
against a grow that leaves `len == cap`; `end = index + width` against a
check on `index`) are the quiet ones at 0.63-0.67; the cited-check-is-absent,
wrong-vec, off-by-one-loop, documented-null and boilerplate defects are
found at 0.79-0.95 by every wording. Worth a recipe with `located` and this
cutoff; not a shipped `at:` until a second corpus shows the quiet class
higher.

### What I would change

- **Corpus**: more of the quiet class -- arithmetic that reaches one past a
  checked bound, a length that is `len + 1` against a grow that leaves
  `len == cap` -- and a second file of `Drop`/`close` cleans beside defective
  constructors, since the one such clean here is what sets the top of the
  band. Real code from a crate's `unsafe` sites would be the next step; the
  clean band there will be higher than 0.47 in places.
- **Matcher**: the `unsafe fn` arm never fired on this corpus (no fixture has
  a `// SAFETY` line comment above an `unsafe fn`; such functions carry a
  `/// # Safety` doc section for callers, which is a different claim). Either
  drop the arm or give it its own sentence.
- **State**: `located` is right and costs 27k tokens for 26 subjects; the
  three defects that needed it are the realistic ones.
- **Tooling** (below): until the verdict key includes the file or the
  enclosing context, two identical `unsafe { ... }` lines in one repository
  get one verdict, and the second is never asked.

### Tooling

`src/run.ts` (the "Identical subject text under the same rule draft is one
question" block) and `src/cache.ts` `verdictKey(rule, arm, subjectText,
group, matchText)`: the key is the subject's own text, with no file and no
enclosing context, so under `subject: node` two textually identical nodes in
different functions share one question and one verdict, even at `state:
local` / `located` where the answer depends on where the node sits. Seen
here: `ring.rs:71` (`as_slice`, clean) and `ring.rs:110` (`leaked_view`,
defect) both `unsafe { slice::from_raw_parts(self.ptr, self.len) }` answered
0.22/0.23/0.22 in lockstep across three passes; after the defect's text was
changed to `self.ptr.cast_const()` it answered 0.95/0.95/0.95. Reproduce:

```
$ source ~/.profile; node --experimental-strip-types src/cli.ts eval experiments/rule-candidates/rust/safety-comment-holds --repeat 3 --no-config --cache none
  x ring.rs:110  safety-comment-holds  bad but pass at 0.22 [0.22 0.23 0.22]
  (ring.rs:71, the clean twin, in last.json: 0.22 0.23 0.22)
```

Not fixed here (`src/` is out of bounds). The same key produced the
`cache hit` lockstep in the sibling report `o-log-message`.

### Cost

From the tool's summaries, this rule: `gaps` 3 requests, 22k tokens,
$0.00093; three single-pass evals (local, located, rewritten criteria) 9
requests, 72k tokens, $0.0030; three 3-pass evals (the fit, the first
`--accept` at 0.52, the accepted run after the corpus fix) 27 requests,
243k tokens, $0.0102. Total 39 requests, ~337k input tokens, **$0.0142**.
Both rules together: 51 requests, ~450k input tokens, **$0.019**.
