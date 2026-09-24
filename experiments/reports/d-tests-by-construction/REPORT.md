# Family D: tests that cannot verify what their name claims, by construction

The shipped `test-name-verifies-claim` asks whether the assertion is strong
enough. This family asks about what sits between the title and the
assertion: the subject has been replaced by a stub, the assertion is aimed
at a mock's call log while the title claims an outcome, or a whole-output
snapshot stands in for a specific claim. A linter can find `vi.mock`,
`toHaveBeenCalled` and `toMatchSnapshot`; it cannot tell whether the module
under `vi.mock` is the one the title is about, whether "calls save once" is
the claim or a proxy for it, or whether "renders the receipt for a
single-item order" asserts a property or just labels a snapshot. That is a
reading of the title against the construction of the test, and it is what
jev does here. All three rules reuse the shipped `&js_test_matcher` shape
(it/test/it.each, capturing `$TITLE` and `$BODY`); every test in the corpus
is a subject of every rule, so each rule's cleans include the other rules'
defects, which is realistic.

Layout: `rules.yml` (three rules), `corpus/` (three vitest files, 33 tests,
no markers), `labels.json` (hand-written), `records/` (every paid run),
`baseline/test-name-verifies-claim.yml` (verbatim copy of the shipped rule,
for the coverage comparison). Nothing outside this directory was touched.

## test-mocks-subject

**Rule**

```yaml
- id: test-mocks-subject
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  # The stub is often a `vi.mock(...)` at the top of the file, outside the
  # matched node, so the file has to be there. Measured: on `bare` the two
  # bad cases whose stub is a top-of-file vi.mock fall from 0.58/0.64 to
  # 0.28/0.28, leaving 0.11 of gap; see records/family-d-bare.json.
  state: located
  # Fitted 0.29 on records/family-d-located.json (5 bad, 28 clean, 3 passes,
  # 0 flips): clean top 0.16, lowest bad 0.42. The bad band is quiet
  # (0.42-0.64 for four of five), so this cutoff is low by construction.
  threshold: 0.30
  rule: &js_test_matcher
    any:
      - pattern: it($TITLE, $BODY)
      - pattern: test($TITLE, $BODY)
      - pattern: it($TITLE, $BODY, $TIMEOUT)
      - pattern: test($TITLE, $BODY, $TIMEOUT)
      - pattern: it.each($CASES)($TITLE, $BODY)
  ask: >-
    The behaviour this test's name attributes to the code under test is
    performed by a mock or stub, and the assertion reads back the stub's
    canned value unchanged.
  criteria:
    "true": >-
      The title says the code under test computes, applies, derives,
      reserves or returns something, but the function, method or module that
      would do it is replaced -- the module is under vi.mock or jest.mock
      with a fake implementation, the method has mockReturnValue or
      mockResolvedValue, a stubbed global resolves to a fixed payload -- and
      the value the assertion checks can be traced to that stub's
      configuration with none of the subject's own logic in between: the
      constant it was told to return, the payload it was given, its fake's
      arithmetic. The assertion then checks the test's own setup, and the
      claimed behaviour never runs.
    "false": >-
      The stub stands in for a collaborator the code under test calls -- the
      network, the clock, a repository, a mailer, an event bus -- and the
      assertion checks what the real code did with the stub's output rather
      than the output itself: a value it derived, an error it raised, a
      call it made, how many times it tried; or the title is itself about
      the collaborator; or the spy has no replacement value and the real
      method runs.
  note: >-
    A title like "sends an email" whose assertion is about the call on a
    mocked mailer is not this rule's concern: the mailer is the boundary.
    Whether an assertion on a mock's call log is strong enough is a separate
    question.
```

**Corpus**

33 subjects found (11 in `corpus/checkout.test.ts`, the file built for this
rule; 22 in the other two files, all clean for this rule) / 5 bad / 28
clean, of which 8 are hard cleans labelled with reasons. Bad cases, all in
`checkout.test.ts`:

- `:36` "applies the percentage discount to the subtotal": `./discount.ts`
  is under a top-of-file `vi.mock` whose fake returns `subtotal * 0.9`; the
  asserted 90 is the fake's arithmetic.
- `:43` "adds 8% sales tax for California addresses": `computeTax` is a
  top-of-file `vi.mock` returning the constant 8 that the assertion checks.
- `:50` "computes the total from the line items": `vi.spyOn(cart,
  "total").mockReturnValue(100)` and the assertion reads that 100 back.
- `:74` "reserves stock for each line item before charging":
  `inventory.reserveStock` is stubbed with `mockResolvedValue`; the
  assertion is the stub's value echoed per item.
- `:108` "computes the delivery ETA from the carrier's transit days": the
  `fetch` stub hands back `eta: "2024-07-04"` verbatim and that is what is
  asserted; nothing is computed.

Hard cleans: a `vi.spyOn` on the subject's own method with no replacement
(`:56`); the repository mocked while `cancelOrder` runs and rejects
(`:64`); fake timers replacing the clock (`:90`, `:96`); `fetch` stubbed to
fail once while the retry lives in the subject (`:120`); a title about the
boundary itself (`:131`); and every mocked-mailer / mocked-repo test in
`signup.test.ts`.

**Attempts** (state `located` throughout; `gaps` figures from the
one-pass record of each attempt)

1. ask "This test replaces with a mock or stub the very behaviour its name
   claims to verify"; criteria listed the mock shapes; note said assertion
   strength is separate. `gaps`: **rewrite**, gap 0.19 (0.23 on the first
   unrecorded `gaps` run), head +0.06 at 0.70. Bad 0.47-0.95; but the
   mocked-mailer tests in `signup.test.ts` scored 0.29-0.46 ("sends a
   welcome email" read as mocking the sender), and the fetch-ETA bad case
   sat at 0.47 on top of them.
2. ask "... is performed by a mock or stub, and the assertion reads back
   the stub's canned value"; false branch rewritten around collaborators;
   note names the mailer as a boundary. `gaps`: **works**, gap 0.26, head
   +0.04 at 0.70. Mailer cleans fell to 0.10-0.12; bad 0.44-0.92; clean
   top 0.19.
3. ask adds "unchanged"; true branch adds "can be traced to that stub's
   configuration with none of the subject's own logic in between"; false
   branch says "what the real code did with the stub's output rather than
   the output itself". `gaps`: **works**, gap 0.32 (one pass) / 0.30 (three
   passes), head +0.08 at 0.70. Bad 0.42-0.94, clean top 0.16. Kept.

The label-free `gaps` line for the final rule reads `move, suggest 0.79`:
its largest step (0.64 to 0.94) lies between two bad cases, not at the
class boundary (0.16 to 0.42). The labelled fit is what counts here.

**Fit** (`records/family-d-located.json`, 3 passes)

- fitted cutoff 0.29, written as `threshold: 0.30`; precision 1.00, recall 1.00
  (tp 5, fp 0, fn 0)
- scores: bad 0.94 / 0.64 / 0.58 / 0.52 / 0.42; clean top 0.16 (the
  no-replacement spy), then 0.14, 0.13
- headroom: 0.14 above the highest clean, 0.12 below the lowest bad
- decision flips across 3 passes: 0; max spread 0.10, mean 0.01
- `bare` (`records/family-d-bare.json`): the two top-of-file `vi.mock`
  cases fall to 0.28 / 0.28 against a clean top of 0.17 -- fitted 0.23,
  gap 0.11, 0 flips. It separates on this corpus only because the cleans
  are very low; the model cannot see the stub and is guessing from
  `expect(applyDiscount).toHaveBeenCalledWith`. `bare` would not have
  worked; `located` is required.

**Verdict**: SHIP -- separates with 0.14 / 0.12 of headroom and no flips,
and it reports the two clearest defects (the top-of-file `vi.mock` cases)
that the shipped rule cannot see on `bare`; the caveat is that the bad band
is quiet (four of five at 0.42-0.64), so the cutoff has to sit at 0.30 and
a real-world defect that scores 0.35 will be missed.

Shipped `test-name-verifies-claim` (0.53, `bare`) on these five: reports
`:50` (0.95), `:108` (0.86), `:74` (0.85); misses `:36` (0.23) and `:43`
(0.28). It catches the three whose stub is inside the test and misses the
two whose stub is at the top of the file -- exactly the file-context cases
this rule exists for. Two of five is what this rule adds.

**What I would change**: corpus. All five defects are in one file and one
mocking library; add a `jest.mock` / `jest.spyOn` file, a partial mock of
the module under test (`vi.mock` with `importOriginal`), and msw-style
handlers as cleans. The `:108` fetch-ETA case is the arguable one (a
network stub returning a payload the subject passes through) and its
0.42 is the floor of the bad band; a stricter corpus might drop it. The
matcher and `subject` are right; `located` is required.

## test-asserts-on-mock

**Rule**

```yaml
- id: test-asserts-on-mock
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  # `bare` separates identically (records/family-d-bare.json); kept on
  # `located` so the file's mock setup is in view, as the brief asked.
  state: located
  # Fitted 0.51 on records/family-d-located.json (4 bad, 29 clean, 3 passes,
  # 0 flips): clean top 0.19, lowest bad 0.84.
  threshold: 0.50
  rule: *js_test_matcher
  ask: >-
    This test's name claims an outcome, but its assertions only check that a
    mock was called.
  criteria:
    "true": >-
      The title states a result or property of what the code under test
      produces -- content sent, data stored in a certain form, a rejection, a
      state change -- and every assertion is toHaveBeenCalled,
      toHaveBeenCalledTimes, or a toHaveBeenCalledWith whose arguments do not
      include the thing the title claims, so the named outcome could be wrong
      or absent and the test would pass.
    "false": >-
      The title itself claims the interaction -- that something is called,
      how many times, or not at all -- or the code under test is an adapter
      whose whole job is that call, or an assertion checks a return value, a
      thrown error, or call arguments that carry the outcome the title names.
  note: >-
    A toHaveBeenCalledWith whose arguments contain the claimed content is a
    check of the outcome, not a violation. Whether the subject is itself
    mocked is a separate question.
```

**Corpus**

33 subjects (10 in `corpus/signup.test.ts`, the file built for this rule)
/ 4 bad / 29 clean, of which 9 are hard cleans with reasons. Bad cases,
all in `signup.test.ts`:

- `:39` "sends a welcome email with the user's display name": the only
  assertion is `mailer.send` `toHaveBeenCalled()`; an email with no name or
  the wrong template passes.
- `:44` "stores the hashed password, never the plaintext": the only
  assertion is `users.insert` `toHaveBeenCalledTimes(1)`, which holds with
  the plaintext stored.
- `:49` "rejects a duplicate email address": the rejection is swallowed by
  `.catch` and the only assertion is that `findByEmail` was called.
- `:87` "marks the invitation as accepted": `invites.update`
  `toHaveBeenCalled()`, no check of what status was written.

Hard cleans: `toHaveBeenCalledWith` whose args carry the recipient and
template (`:55`); `not.toHaveBeenCalled` where absence is the claim
(`:62`); args carrying the event name and id (`:67`); a claimed call
ordering, asserted as such (`:72`); "calls save exactly once" (`:98`); an
adapter whose whole job is the client call (`:109`); and in
`checkout.test.ts` "retries once" (`:120`) and "posts the payload to the
API" (`:131`).

**Attempts**

1. As above. `gaps`: **works**, gap 0.63 (first `gaps` run) / 0.58 (one
   pass) / 0.65 (three passes), head +0.49 at 0.70. Bad 0.84-0.95, clean
   top 0.19. No rewrite was needed; attempts 2 and 3 were not used.

**Fit** (`records/family-d-located.json`, 3 passes)

- fitted cutoff 0.51, written as `threshold: 0.50`; precision 1.00, recall 1.00
  (tp 4, fp 0, fn 0)
- scores: bad 0.95 / 0.92 / 0.89 / 0.84; clean top 0.19 ("does not send
  any email"), 0.18 ("calls save exactly once"), 0.17
- headroom: 0.31 above the highest clean, 0.34 below the lowest bad
- decision flips: 0; max spread 0.05, mean 0.01
- `bare`: fitted 0.52, gap 0.62, 0 flips, same four reported. `bare` would
  have worked; the model infers "mock" from `toHaveBeenCalled` without
  seeing `vi.fn()`.

**Verdict**: DROP -- it separates cleanly (gap 0.65, no flips), but the
shipped `test-name-verifies-claim` already reports all four of its bad
cases at 0.82-0.96, so as a shipped rule it adds nothing the pack does not
already say.

Shipped rule on these four: `:44` 0.96, `:49` 0.93, `:39` 0.88, `:87`
0.82 -- 4 of 4. What the new wording does have over the shipped rule is
the `false` branch: the shipped rule reports "calls save exactly once even
when the profile has two addresses" (`:98`) at 0.65, a claimed interaction
asserted as such; this rule scores it 0.18. That is an argument for adding
"a title that itself claims the call, its count or its absence" to the
shipped rule's `false` criteria, not for a second rule.

**What I would change**: nothing to the rule; fold its `false` branch into
the shipped rule's criteria and refit that. If it were kept, `bare` is the
right arm.

## snapshot-only-behaviour-claim

**Rule**

```yaml
- id: snapshot-only-behaviour-claim
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  # `bare` separates identically (records/family-d-bare.json); the title and
  # the snapshot call are both inside the node.
  state: located
  # Fitted 0.66 on records/family-d-located.json (4 bad, 29 clean, 3 passes,
  # 0 flips): clean top 0.44, lowest bad 0.88.
  threshold: 0.66
  rule: *js_test_matcher
  ask: >-
    This test's name claims a specific behaviour, but the body only compares
    a snapshot.
  criteria:
    "true": >-
      The title asserts a property of the output -- an ordering, an element
      hidden or shown, a particular state or branch rendered under a
      condition ("renders the empty state when the list is empty"), a format
      or conversion applied -- and the only assertions are toMatchSnapshot,
      toMatchInlineSnapshot or toMatchFileSnapshot over a whole rendering, so
      nothing in the test isolates the named property from everything else
      in the output.
    "false": >-
      The title claims only that the output matches a snapshot, or that
      something renders, or it only names the input the snapshot was taken
      of ("renders the list for three users") without asserting a property
      of the output; or at least one assertion targets the named behaviour
      directly; or the inline snapshot is a short literal that is itself the
      named outcome.
  note: >-
    A snapshot beside a targeted assertion is fine. "Renders X for input Y"
    is a label for the snapshot; "renders X when Y" or "hides/sorts/formats
    X" is a claim the snapshot does not isolate.
```

**Corpus**

33 subjects (12 in `corpus/order-summary.test.ts`, the file built for this
rule) / 4 bad / 29 clean, of which 6 are hard cleans with reasons. Bad
cases, all in `order-summary.test.ts`:

- `:18` "renders the error state when the request fails": whole-output
  `toMatchSnapshot()` only; passes with a recorded loading state.
- `:23` "sorts line items by price, cheapest first": a 15-line
  `toMatchInlineSnapshot` of the whole section, in which the row order is
  one detail among many.
- `:43` "hides the discount row when no discount applies": snapshot only;
  passes whether or not the row is there.
- `:85` "formats the total in the customer's currency": snapshot of the
  whole receipt; passes with the amounts in EUR.

Hard cleans: "matches the snapshot for a three-item order" (`:48`);
"renders" (`:53`); snapshot plus `toContain` of the error message (`:57`);
snapshot plus an assertion on the sku order (`:63`); a one-line inline
snapshot that is itself the empty-cart message (`:70`); "renders the
receipt for a single-item order" (`:90`), a scenario label rather than a
property claim.

**Attempts**

1. ask as above; false branch: snapshot-only titles, a targeted assertion,
   or a short inline literal. `gaps`: **works**, gap 0.30, head +0.29 at
   0.70. Bad 0.89-0.95, but the hard clean "renders the receipt for a
   single-item order" scored 0.77 -- the model reads "renders X for Y" as
   a behaviour claim.
2. false branch adds "names the input or scenario the snapshot was taken
   of, without claiming a particular property of the output". `gaps`:
   **move**, gap 0.43, head +0.02 at 0.70. The `:90` clean fell to 0.18,
   but the canonical bad "renders the error state when the request fails"
   fell to 0.68 -- the exception swallowed "renders X when Y" as well.
3. true branch names "a particular state or branch rendered under a
   condition" with an example; note draws the line between "renders X for
   input Y" (a label) and "renders X when Y" (a claim). `gaps`: **works**,
   gap 0.43, head +0.24 at 0.70. Bad 0.88-0.95, clean top 0.44 (`:90`).
   Kept.

**Fit** (`records/family-d-located.json`, 3 passes)

- fitted cutoff 0.66, written as `threshold: 0.66`; precision 1.00, recall 1.00
  (tp 4, fp 0, fn 0)
- scores: bad 0.95 / 0.90 / 0.90 / 0.88; clean top 0.44 ("renders the
  receipt for a single-item order"), 0.38 (the one-line inline literal),
  0.32
- headroom: 0.22 above the highest clean, 0.22 below the lowest bad
- decision flips: 0; max spread 0.09, mean 0.02
- `bare`: fitted 0.69, gap 0.42, 0 flips, same four reported. `bare` would
  have worked.

**Verdict**: SHIP -- separates with 0.22 of headroom on both sides and no
flips, reports the inline-snapshot defect the shipped rule misses, and does
not report the three snapshot-titled cleans the shipped rule does; the soft
spot is the "renders X for Y" exception, which took two rewrites and holds
the highest clean at 0.44.

Shipped rule on these four: `:18` 0.81, `:43` 0.80, `:85` 0.79 -- reported;
`:23` (the inline snapshot) 0.33 -- missed. The shipped rule also reports
"renders" (0.80), "matches the snapshot for a three-item order" (0.77) and
"renders the receipt for a single-item order" (0.72): it treats every
snapshot-only test as unverified regardless of what the title claims. On
this corpus its `gaps` verdict is `rewrite` (gap 0.20). This rule adds one
defect and removes three findings on titles that claim nothing.

**What I would change**: corpus -- a Tsx file with `render()` /
`asFragment()` snapshots and a `toMatchFileSnapshot` case, since every
snapshot here is over a string; and one more "renders X for Y" clean to
pin the exception. `bare` for cost and cache immunity if it ships.

## Shipped-rule coverage, in one place

`baseline/test-name-verifies-claim.yml` (verbatim, `bare`, 0.53) on the 13
bad cases of this family, from `records/baseline-test-name-verifies-claim.json`:

| family rule | bad cases | shipped reports | shipped misses |
| --- | --- | --- | --- |
| test-mocks-subject | 5 | 3 (`:50` 0.95, `:108` 0.86, `:74` 0.85) | `:36` 0.23, `:43` 0.28 -- both top-of-file `vi.mock` |
| test-asserts-on-mock | 4 | 4 (0.82-0.96) | none |
| snapshot-only-behaviour-claim | 4 | 3 (0.79-0.81) | `:23` 0.33 -- inline snapshot |

The shipped rule also reports four of this family's hard cleans:
`order-summary.test.ts:53` "renders" (0.80), `:48` "matches the snapshot"
(0.77), `:90` "renders the receipt for a single-item order" (0.72), and
`signup.test.ts:98` "calls save exactly once" (0.65). Its `gaps` verdict on
this corpus is `rewrite`, gap 0.20, 0 flips, max spread 0.16.

Unseen-code step (calibration.md step 5) was not done: neither
`corpus/ts/cart.test.ts` nor `test/fixtures/cookbook/cart.test.ts` uses a
mock or a snapshot, so a run there would only confirm a trivially low clean
band. The 0.30 cutoff on `test-mocks-subject` in particular has not met a
real mock-heavy file.

## Cost

Seven paid runs, all `--no-config --cache none`, every one preceded by a
`--dry-run`. From the tool's per-pass summaries (a record's `spent` holds
one pass):

| run | passes | requests | input tok | output tok | usd |
| --- | --- | --- | --- | --- | --- |
| `gaps` attempt 1 (not recorded; `gaps` takes no `--record`) | 1 | 3 | ~71.4k | ~2.0k | 0.00300 |
| `calibrate` attempt 1, `records/attempt1-r1.json` | 1 | 3 | 71.4k | 2.0k | 0.00300 |
| `calibrate` attempt 2, `records/attempt2-r1.json` | 1 | 3 | 74.9k | 2.0k | 0.00315 |
| `calibrate` attempt 3, `records/attempt3-r1.json` | 1 | 3 | 76.7k | 2.0k | 0.00322 |
| `calibrate` final located, `records/family-d-located.json` | 3 | 9 | 230.1k | 6.0k | 0.00966 |
| `calibrate` final `--arm bare`, `records/family-d-bare.json` | 3 | 9 | 218.9k | 6.0k | 0.00918 |
| `calibrate` shipped baseline, `records/baseline-test-name-verifies-claim.json` | 3 | 9 | 59.2k | 2.0k | 0.00249 |
| **total** | | **39** | **~803k** | **~22k** | **~$0.034** |

Well under the $0.50 budget; the largest single run was under $0.01.
