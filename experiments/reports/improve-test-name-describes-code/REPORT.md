# improve: test-name-describes-code

## Rule

`test-name-describes-code` (TypeScript) and `test-name-describes-code-rust`,
in `rules/test-name-describes-code/`. Shares `cart.test.ts` and
`store_test.rs` with `test-name-verifies-claim` as separate copies, and now
also `inventory.test.ts` and `ledger_test.rs`; the copies are byte-identical.

**Start** (3 passes, shipped `threshold: 0.95` / `0.93`):

| rule | P | R | defects | cleans | clean top | defect floor | flips |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TS | 0.67 | 1.00 | 2 | 8 (2 hard) | 0.96 | 0.96 | 0 |
| Rust | 0.67 | 1.00 | 2 | 5 (1 hard) | 0.95 | 0.93 | 0 |

The one false positive per variant was `cart.test.ts:32` / `store_test.rs:24`
("returns items sorted by price" over `expect(items.length).toBe(2)`), the
case the rule's comments call an inversion.

**End** (3 passes, `threshold: 0.72` / `0.70`, baseline accepted, replay passes):

| rule | P | R | defects | cleans (hard) | clean top | defect floor | headroom | flips |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TS | 1.00 | 1.00 | 10 | 19 (13) | 0.54 | 0.84 | 0.18 / 0.12 | 1 |
| Rust | 1.00 | 1.00 | 9 | 15 (11) | 0.51 | 0.86 | 0.19 / 0.16 | 0 |

The TS flip is `inventory.test.ts:77` (the adjacent-name defect, below);
its mean is 0.12 above the cutoff, but one pass of three landed at 0.70.
Bar reached on both variants, with that one wobble noted.

## The question the brief asked: can the criteria separate "about a different thing" from "about the right thing, weakly"?

Yes, once the labels stop conflating them. The 0.96 case is not the
right-thing-weakly case. "returns items sorted by price" over
`expect(items.length).toBe(2)` calls no sort and nothing under test; it
counts the fixture. That is this rule's own true branch ("the name refers to
something the code never touches"), and the model was reading it correctly.
"The code is about items" is not "the code is about sorting items".

Both labels changed to `bad`, with the argument in `labels.json`. Since the
rules are nested (a wrong-thing test also fails to establish its claim), the
relabel makes them consistent: those two lines were already `bad` for
`test-name-verifies-claim`. The test of the split is now a case where the
sort IS called and only the length is checked (`inventory.test.ts:26`,
`ledger_test.rs:19`): labelled clean here, defect for the other rule, and
answered 0.51 / 0.42 at the end against 0.76 / 0.26 before the question was
touched. So the criteria can separate the two, and the separation is what
the note buys (attempt 3).

## Attempts

Numbers are at the shipped `threshold:` of the time (0.95 / 0.93) until the last row.

0. Add cases, relabel :32 / :24, question untouched -> TS P 1.00 R 0.40,
   clean top 0.81 (a `toBeDefined` over the sorted result), defect floor 0.88,
   fitted 0.845; Rust P 1.00 R 0.56, clean top 0.61, defect floor 0.27 (a
   defect written as `bulk_rate(200, 3)`, unreadable: which argument is the
   unit count?). Fixed that fixture to a named struct, and made
   `reverses_a_posting` assert `4500 + 500` so the posting is visibly an
   addition.
1. Criteria rewritten: the true branch names each wrong-thing shape with an
   example in code (a lookup where the name says remove; three units where it
   says above ten; active where it says rejects), the false branch says a
   length, an `is_some`, a `toBeDefined` or no assertion is still about the
   named thing -> TS clean top 0.77, defect floor 0.86 (gap 0.09); Rust clean
   top 0.57, defect floor 0.81 (gap 0.24).
2. Ask rewritten from "does something other than what its name says" to "The
   operation, input or outcome this test's code exercises is not the one its
   name names" -> TS clean top 0.74, defect floor 0.88 (gap 0.14); Rust 0.58 /
   0.79 (gap 0.21). The old ask invited reading a weak assertion as
   "something other".
3. Note added: a weak or missing assertion is not a different outcome; the
   outcome differs only when the code expects what the name contradicts ->
   weak-but-right cleans fell to 0.49-0.52. Remaining high clean was
   `cart.test.ts:76` at 0.69, the preamble test titled "does not double-count
   an item listed twice" over a body expecting the doubled sum -- the rule was
   right and the title was wrong (see cases). TS clean top after the rename
   0.54, defect floor 0.85; Rust 0.50 / 0.84.
4. `threshold:` 0.95 -> 0.72 and 0.93 -> 0.70, a little above the fitted midpoints
   (0.69 / 0.68) -> P 1.00 R 1.00 both, 0 flips on the fitting run, 1 flip
   (`inventory.test.ts:77`, one pass at 0.70) on the accept run.

## Cases added

`inventory.test.ts` (TS) and `ledger_test.rs` (Rust) mirror each other;
one line per TS case, the Rust twin in parentheses.

Defects:
- `:43` (`:39`) wrong input: "applies the bulk discount above ten units", body
  sets up three units and expects full price.
- `:63` (`:51`) wrong operation: "removes an item by its sku", body calls
  `lookupSku` and removes nothing.
- `:67` (`:56`) error promised, ordinary value expected: "throws for an
  unknown sku" over `toBeUndefined()` (`panics_...` over `None`).
- `:77` (`:66`) adjacent-name wrong operation: "reserves stock for an order",
  body restocks and checks the quantity went up ("reverses a posting", body
  posts). The quietest defect in both languages, 0.84-0.89.
- `:82` (`:72`) never touched: "logs a warning when restocking a discontinued
  item", body observes no logger.
- `:112` (`:109`) opposite outcome: "rejects an expired coupon", body expects
  it active.
- `:117` (TS only) rejection promised, resolution expected: "rejects when the
  gateway times out" over `.resolves.toEqual(captured)`.
- relabelled: `cart.test.ts:32`, `store_test.rs:24` (above).

Hard cleans:
- `:26` (`:19`) sortByPrice called, only the length checked -- right thing,
  weakly. 0.51 / 0.42.
- `:36` (`:33`) sort called, `toBeDefined` / `is_some` on the first element.
- `:48` (`:45`) right input (twelve units), `toBeLessThan(full)`.
- `:30` (`:25`) compound claim ("sorts ... and keeps ties in insertion
  order"), body sets up a tie and asserts the full order.
- `:88` (`:80`) compound claim, both quantities asserted.
- `:71` (`:61`) one-word title "finds".
- `:122` (`:115`) synonym title "prices the cart" over `totalCents`
  ("totals the ledger" over `balance`).
- `:94` (`:87`) named input, no assertion at all.
- `:102` (`:100`) setup calls an operation the title does not mention
  (remove, then undo); assertion is about the undo.
- `:126` (`:120`) negative claim, "does not read a trailing comma as an
  empty sku", exact equality on the parse result -- the shape of the
  self-lint test `test/test.ts:2296`.
- `:53` (TS only) `it.each` with a printf title.
- `:98` (`:92`) throw promised, throw asserted (easy, kept for balance).
- `cart.test.ts:36`, `store_test.rs:30`: labelled explicitly as hard cleans
  (named operation and input, nothing asserted).
- `cart.test.ts:76`: RENAMED in both copies from "does not double-count an
  item listed twice" to "counts an item listed twice once per occurrence".
  The body expects 450, the item counted twice; the old title, read plainly,
  said the opposite, and only the preamble comment explained that
  "double-count" meant the dedupe bug. The preamble shape is what the case is
  for and is untouched.

## What stops the bar

Nothing on the evals. Two things to watch:

- `inventory.test.ts:77` (reserves / restock) spans 0.70-0.92 across six
  passes. Its mean clears 0.72 by 0.12 but it is the case a lower-scoring
  real-world twin would miss; adjacent names are a real shape.
- On unseen code, `collect-autonomous-results.test.ts:164` ("classifies
  no-runner-result when artifacts are empty", asserting
  `reason === 'queue_starvation'`) answered 0.59 -- a probable stale title
  the rule half-sees. Whether `queue_starvation` is the no-runner-result
  category is API knowledge; it belongs to the class the skill says the model
  is poor at.

## Unseen check

`check` over six agent-cluster test files (loop-service, cli,
self-improve-loop, validate-cluster-config, collect-autonomous-results,
watch-open-hub-prs; 82 subjects, `--cache none`): 0 findings, median answer
0.07, top 0.59 (above), then 0.33. The Rust variant matched nothing, as
expected on a TypeScript repository. $0.0053.

## Cost

About 16 eval passes of the suite plus one unseen run: ~50 requests,
~0.9M input tokens, ~$0.039 (evals ~$0.034, unseen $0.005). Figures are the
sum of the per-run `spent` lines; one attempt's tokens are estimated.
