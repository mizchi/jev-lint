# Family H: what the tests reach

A function that declares a way to fail -- a `throw` behind a guard, a
`reject`, a `{ ok: false }` on a checked condition -- has made a claim about
itself that its tests either honour or do not: somewhere, some test drives it
down that path. Coverage tools answer a different question (was the line
executed, by anything, at any depth) and cannot say whether the test that hit
it was about it; ast-grep can find the `throw` but not the test; and the test
file is a different file, so no arm that carries only the source can contain
the answer. This is the family the `paired` arm was built for: the state
carries the matched function and excerpts of the test files related to its
module, and the model does what a reviewer with both files open does --
reads the guard, reads the tests, and says whether any of them passes the
input that trips it. What jev adds over a linter is exactly that reading:
`expect(() => f(bad)).toThrow()` reaches the path, `f(good)` under a title
that says "throws" does not, and `assert.throws(() => g(x))` where `g` calls
`f` does.

One candidate: `tests-cover-failure-paths`. Candidate directory
`experiments/rule-candidates/tests-cover-failure-paths/`; the accepted run
is `evals/baseline.json`, per-attempt runs were kept in the session
scratchpad and their per-subject answers are quoted below.

Tooling note: `gaps` writes no record, so each attempt's per-subject numbers
come from that attempt's `eval --repeat 3` (`evals/last.json` at the time),
and its `gaps` line is quoted from its own output. A dry run priced every
paid run first; the corpus run never exceeded $0.004.

---

## tests-cover-failure-paths

### Rule

```yaml
- id: tests-cover-failure-paths
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul
  subject: node
  state: paired
  # 0.68, fitted 2026-09-20 on this rule's evals (27 subjects: 7 defects, 20
  # cleans of which 11 hard, 3 passes, evals/baseline.json). Defects answer
  # 0.85-0.96 (quietest: postEntry, whose throw is reached by an it.each and
  # whose { ok: false } is not). Cleans top out at 0.45 on means and 0.52 on a
  # single pass: truncateSlug, whose guard is reached under a test title that
  # claims something else, then readConfig (only callee throws, 0.38) and
  # assertReportShape (one throw behind four operands, reached through one,
  # 0.28). Midpoint 0.65; 0.68 leans toward precision because a corpus clean
  # answer is an upper bound on its real-code answer only for the case the
  # corpus contains, and the first run on unseen code (jev-lint's own src/)
  # answered 0.76 for a fallback `return captured` that no criteria wording
  # here names as not-a-failure. See experiments/reports/h-tests-reach.
  at: 0.68
  rule:
    any:
      - all:
          - kind: function_declaration
          - inside:
              kind: export_statement
          - has: &fn_name
              field: name
              pattern: $NAME
      - all:
          - kind: variable_declarator
          # Direct nesting only: `export const f = ...` is
          # export_statement > lexical_declaration > variable_declarator.
          # With `stopBy: end` here, a closure declared INSIDE an exported
          # function matched too, and the first run on real code reported
          # a private `const askBatch = async ...` as if it were an export.
          - inside:
              kind: lexical_declaration
              inside:
                kind: export_statement
          - has: *fn_name
          - has:
              field: value
              any:
                - kind: arrow_function
                - kind: function_expression
  ask: >-
    This function ($NAME) has a failure path of its own that none of the
    related tests reaches.
  criteria:
    "true": >-
      The body itself throws, rejects, returns an error value, or refuses an
      input through a guard on some path, and no related test in the state
      drives $NAME down that path: no test passes an input that trips the
      guard, asserts a throw or a rejection from it, or asserts the error
      result -- neither by calling $NAME nor through another function in this
      file that calls it. A related test that never calls $NAME, directly or
      through a caller, while the body has such a path, is that case.
    "false": >-
      Every failure path the body declares is reached by some related test --
      a test passes the bad input, asserts that the call throws or rejects, or
      asserts the error result it returns, whether it calls $NAME itself or
      calls a function in this file that calls $NAME, and in whatever
      vocabulary the runner uses (`toThrow`, `rejects`, `assert.throws`, a
      `try`/`catch` around the call, an `.ok` read as false) -- or the body
      has no failure path of its own: it cannot fail, or the only failures on
      its paths come from callees it does not guard, which are those callees'
      paths and not this function's. A throw behind one condition with
      several operands is one path, and a test that trips any one operand has
      reached it.
  note: >-
    A failure path is one throw, one reject, or one return of an error value
    (`{ ok: false }`, `null`, `undefined` on a checked condition): a single
    throw behind a condition with several `||` operands is one path, reached
    when any operand is tripped. Only the paths this body DECLARES count; a
    callee that may throw is not this function's path unless the body catches
    and re-reports it. Judge what a test's body does, not what its title
    says: a test whose title claims a failure but whose body never trips
    $NAME's guard reaches nothing, and a test whose title is about something
    else but whose body passes the bad input and asserts the throw reaches
    it. The related tests are excerpts, so a call to $NAME counts even when
    the assertion around it was cut; but a call with ordinary input does not
    reach a guard that ordinary input never trips, and a mention of $NAME
    only in an import reaches nothing.
  axis: file
```

The header comment in `rule.yml` carries the design notes and the attempt
history; the YAML above is the rule as it loads.

### Corpus

27 subjects found (all exported functions; every `.ts` in `evals/cases/` has
a related test beside it, one under `__tests__/`, so nothing was dropped as
unpaired) / 7 bad / 20 clean, of which 11 are labelled hard. Six of the seven
defect shapes named in the brief and one more:

- `basket.ts:23 applyCoupon` -- throws on an empty basket and on an expired
  coupon; both tests pass two lines and an unexpired coupon, and the
  `withEmptyCart` fixture in the same file is only ever passed to other
  functions.
- `session.ts:20 loadSession` -- async, throws `SessionNotFound` when
  `store.get` resolves null; the only test builds the store with
  `storeWith(alice)`, whose `get` always hits.
- `validate-signup.ts:15 validateSignup` -- three rejection branches (email
  shape, password under 12, reserved username); the tests reach the email
  branch once and never the other two.
- `env.ts:3 requireEnv` -- throws when the variable is unset or empty;
  `env.test.ts` imports it on line 2 and never calls it.
- `payments.ts:10 capturePayment` -- throws on a non-positive amount and on a
  gateway status other than `succeeded`; both tests use `gatewayReturning`,
  which always succeeds, and 1999 cents.
- `ledger.ts:14 postEntry` -- a `TypeError` on a non-integer amount, reached
  by an `it.each`, AND `{ ok: false }` for a closed period, never produced;
  the half-covered shape and the quietest defect (0.85).
- `slug.ts:1 slugify` -- throws on an empty title; the test titled "throws on
  an empty title" calls `slugify("hello")` and the throw it asserts is
  `truncateSlug`'s.

Hard cleans (the ones a lazy rule flags): `removeItem` and `checkoutCart`
(guards reached, the second through the `withEmptyCart()` fixture);
`readConfig` (`readFileSync`/`JSON.parse` can throw, it guards neither, only
happy-path tests); `parsePort` (two `{ ok: false }` results, both reached in
`node:assert` style); `fetchWithRetry` (`rejects.toBeInstanceOf`);
`withTimeout` (`try`/`catch` around the `await`, assertion on the caught
error's name); `parseAmount` (never called by name, reached through
`parseEntryLine` with its own message asserted); `truncateSlug` (guard
reached under the wrong title); `parseDuration` (an `it.each` table of bad
inputs); `renderReport` (catches a callee and re-reports `{ ok: false }`,
reached through an `expectFailure` helper); `assertReportShape` (one throw
behind four `||` operands, reached through one, via `assert.throws`). Plus
nine plain cleans that cannot fail (`cartTotal`, `touchSession`, `isExpired`,
`normalizeEmail`, `describeConfig`, `optionalEnv`, `envFlag`, `formatAmount`,
`parseEntryLine`).

Two case files were renamed during the build because the arm paired them
with files elsewhere in this repository (`cart.ts`, `report.ts`; see Arm
notes). The renamed files are `basket.ts` and `tally.ts`.

### Attempts

The `ask` never changed. All three attempts are to `criteria` and `note`;
`subject: node` and `state: paired` were kept throughout, since the excerpts
demonstrably carried every call and assertion the labels rely on (checked by
printing `pairTests` output for every case file).

1. Draft criteria/note as written in the candidate. On the first 19-subject
   corpus: `gaps` `matched 19 reported 5 median 0.09 top<at 0.28 head +0.42
   gap 0.63 suggest 0.6 works`; eval P 1.00 R 1.00, 0 flips, defects
   0.91-0.95, cleans at or under 0.27, fitted 0.58. Too easy, so eight
   subjects were added (ledger, slug, tally). Same sentence on 27:
   `matched 27 reported 7 median 0.13 top<at 0.51 head +0.19 gap 0.37
   suggest 0.7 works`; eval P 1.00 R 1.00, 0 flips, fitted 0.69; three hard
   cleans at 0.49-0.51 -- `assertReportShape` 0.51 (0.47-0.58), `truncateSlug`
   0.51 (0.49-0.55), `parseAmount` 0.49 (0.37-0.60, the widest spread of the
   run). Each is a hole in the definition, not the threshold: "reached"
   did not say whether a same-file caller counts, the criteria said nothing
   about titles, and "a guard" could be read as one per operand.
2. Criteria: reaching the path through another function in the file counts,
   both branches. Note: a failure path is one throw / reject / error return,
   a compound condition is one path; judge the test's body, not its title.
   `gaps` `matched 27 reported 7 median 0.16 top<at 0.49 head +0.21 gap 0.36
   suggest 0.67 works`; eval P 1.00 R 1.00, 0 flips, fitted 0.66.
   `truncateSlug` 0.51 -> 0.34, `parseAmount` 0.49 -> 0.27,
   `assertReportShape` 0.51 -> 0.47 (unmoved). Defects 0.85-0.96; `slugify`
   0.91 -> 0.87 and `loadSession` 0.91 -> 0.88 gave up a little.
3. The false branch names the assertion vocabularies (`toThrow`, `rejects`,
   `assert.throws`, `try`/`catch`, `.ok` read as false) and repeats that a
   throw behind several operands is one path, reached through any operand.
   `gaps` `matched 27 reported 7 median 0.15 top<at 0.52 head +0.18 gap 0.32
   suggest 0.68 works`; eval P 1.00 R 1.00, 0 flips, fitted 0.65.
   `assertReportShape` 0.47 -> 0.28; `truncateSlug` 0.34 -> 0.45 (0.41-0.52);
   `readConfig` 0.32 -> 0.38. Defects unchanged (0.85-0.95). Attempts 2 and 3
   have the same separation with two hard cleans trading places; that is the
   residue, and attempt 3 is the rule because it moved the mass of the three
   downward (0.47/0.34/0.27 -> 0.28/0.45/0.22) rather than because it won.

After attempt 3 the matcher was tightened (not a sentence attempt): the
`inside: export_statement` with `stopBy: end` on the `const` branch let a
closure declared inside an exported function match, which the run on unseen
code surfaced (`src/run.ts:393`, a private `askBatch`). It is now direct
nesting only; the corpus still finds 27, `src/` drops from 113 to 88.

### Fit

Accepted run (`evals/baseline.json`, 3 passes, after the matcher change):
fitted cutoff 0.65 (midpoint); shipped `at: 0.68`. Precision 1.00, recall
1.00, tp 7 / fp 0 / fn 0 at 0.68 and at any cutoff in 0.47-0.84. Decision
flips across the 3 passes: 0. Max spread 0.07 (`retry.ts:15`); defects
0.85-0.96 with spread at most 0.02. Clean band: top 0.44 on means
(`truncateSlug`, 0.42-0.46), then 0.39 (`readConfig`), 0.30
(`assertReportShape`), 0.25, 0.21, and sixteen cleans at 0.16 and under.
Headroom: 0.24 above the highest clean mean, 0.22 above the highest single
clean pass (0.46), 0.17 below the lowest defect. `eval --replay`: same
decisions.

Unseen code, one pass, `src/` before the matcher change (113 subjects,
$0.0067): 7 over 0.70, 15 between 0.50 and 0.70, the rest a long tail under
0.5 -- a continuum, not a band, which is what real code looks like. Read
against the code: `runAstGrep` 0.90 (throws `AstGrepError` on a non-1 exit;
no test raises it), `runEval` 0.86 (throws on suite errors; only good suites
are run), `readEvalRecord` 0.82 (`null` on a bad file; tests `!` the result),
`loadSuite` 0.71 are right. `run.ts:393` 0.84 was the nested `askBatch`, the
matcher bug above. `discoverEvals` 0.73 is a swallowed `readdirSync` in a
nested visitor, borderline. `widenCommentCapture` 0.76 is wrong: its
`return captured` on a non-comment is a fallback, not a failure, and
`test.ts:946` trips it anyway. One wrong and one arguable in seven, at
0.73-0.76: above the cutoff, inside the corpus's defect band. That is the
number to expect from this rule on real code, and the wrong one names the
criteria's remaining hole (below).

### Verdict

SHIP -- separates with 0.17-0.24 of headroom on either side of the cutoff
and no flips across three passes on a corpus whose eleven hard cleans
include the shapes the brief named and three it did not -- with the caveat
that promoting it ships the `paired` arm, and the arm's pairing heuristic
mis-paired two of ten case files in this very repository (Arm notes), which
wants fixing in `src/paired.ts` before the rule is on by default.

### What I would change

- Criteria: name the fallback. "Returns the input unchanged, a default, or
  an empty result when a condition is not met" is not a failure path; the
  one real-code false positive (0.76) is exactly that and nothing in the
  three attempts says so. A fourth attempt was outside the brief's budget of
  three; this is the first thing to try, with `widenCommentCapture` copied
  into the corpus as a labelled clean.
- Corpus: add a swallowed-error case (`catch { return; }` in a walker) with a
  position taken in the label, since the model reads it at 0.73 and the
  criteria do not say whether silently skipping is "declaring" a failure.
  Add a lookup that returns `undefined` for "absent" as a clean, to pin that
  the note's `null`/`undefined` clause means an error result and not a
  domain answer.
- Matcher: done (direct `export const` only). Consider `method_definition`
  under `export class` later; not in this corpus.
- State: see Arm notes. The rule is fine on the excerpts as they are; the
  pairing is what needs work.

### Cost

From the tool's own summaries, corpus runs on the file axis:

| run | subjects | requests | tokens | USD |
| --- | --- | --- | --- | --- |
| gaps, attempt 1, 19 subjects | 19 | 7 | ~18k | 0.00074 |
| eval --repeat 3, attempt 1, 19 subjects | 19 | 21 | ~54k | 0.00222 |
| gaps, attempt 1, 27 subjects (run twice by mistake) | 27 | 20 | ~50k | 0.00212 |
| eval --repeat 3, attempt 1, 27 | 27 | 30 | 75,801 | 0.00318 |
| gaps, attempt 2 | 27 | 10 | ~30k | ~0.00124 (dry-run estimate; total line not captured) |
| eval --repeat 3, attempt 2 | 27 | 30 | 84,063 | 0.00353 |
| gaps, attempt 3 | 27 | 10 | ~32k | ~0.00133 (dry-run estimate) |
| eval --repeat 3, attempt 3 | 27 | 30 | 89,490 | 0.00376 |
| check src/ --record, unseen code | 113 | 17 | 159,756 | 0.00671 |
| eval --repeat 3 --accept (baseline) | 27 | 30 | 89,490 | 0.00376 |

Total: about 205 requests, about 680k input tokens, **$0.0286** of the
$0.50 budget. Nothing was cached (`--cache none` throughout).

---

## Arm notes

What the excerpts looked like. For test files of 25-60 lines whose every
`it` calls the module, the excerpt IS the file: the stem and the exported
names land on almost every line, the +/-2 lines fill the gaps, and the only
cuts were fixture bodies (`twoLines`'s line list, `writeTempConfig`'s body,
`gatewayReturning`'s body, `expectFailure`'s body) and the tail of a
multi-line `toEqual`. Sizes 900-1,650 chars per file against an 8,000
budget. Every call site and every assertion the labels depend on was
present, including the `try`/`catch` in `retry.test.ts` (kept because
`TimeoutError` is an exported name and the assertion mentions it) and the
`it.each` tables.

What was cut that mattered, or nearly. `gatewayReturning`'s body -- the line
saying `status: "succeeded"` -- was cut in `payments.test.ts`, so the model
had to infer from the helper's name that the gateway only ever succeeds; it
did (0.95), but the evidence for `capturePayment`'s second guard being
unreached was in the cut. `expectFailure`'s body (`assert.equal(result.ok,
false)`) was cut in `tally.test.ts`, so for `renderReport` the model saw a
helper call and a message assertion, not the `.ok` read; still 0.12. The
`withTimeout` `try`/`catch` would have lost its `expect` lines had the error
class not been exported: the assertion sits 4-5 lines below the call, past
the +/-2 window, and only survived because `TimeoutError` matched a keyword.
An assertion on a non-exported error name in the same position is cut.

Pairing, which is where the arm actually failed. Two of ten case files paired
with files outside the corpus, in a repository whose layout is ordinary:

- `evals/cases/cart.ts` paired with `test/fixtures/cookbook/cart.ts`,
  `cart.rs` and `cart.test.ts`. Cause: `findTestFiles` walks the conventional
  root `test/` from cwd regardless of the paths given, `isTestFile` counts
  anything under `test/` -- a fixture `.ts` with no test in it, a `.rs` --
  and `relatedTestFiles` matches by substring of the basename. The budget was
  then split four ways and the model was shown a Rust fixture whose test is
  titled "rejects an expired token" next to `applyCoupon`'s expired-coupon
  guard. Fixtures are the common content of a `test/` directory.
- `evals/cases/report.ts` paired with `test/test.ts` (3,000 chars of
  jev-lint's own report tests) because `importsModule` compares the last
  segment of `"../src/report.ts"` to the stem `report` and nothing else. Any
  module named `report`, `config`, `index`, `utils` anywhere in a repository
  pairs with the tests of every other module of that name.

Both are the heuristic doing what its comment says; neither is a crash and
neither dropped a subject that should have paired, which is why the corpus
was renamed around them rather than the run stopped. What I would change in
`src/paired.ts`, in order:

1. `importsModule`: resolve the specifier relative to the test file's
   directory and compare the resulting path to the module's path (a
   `dirname(test) + spec` join and a `normalize`, not a build system);
   fall back to the stem only for a bare specifier. Also let `relatedTestFiles`
   prefer a same-directory or mirrored match over a cross-tree import when
   both exist, rather than scoring them equally.
2. `isTestFile`: under a conventional root, still require the name pattern
   (`*.test.*`, `*.spec.*`, `*_test.*`) or a `test`/`spec` marker inside the
   file; a `.ts` under `test/fixtures/` that opens no test is not a test.
   `compactTest` already knows when nothing in a file opened a test.
3. `relatedTestFiles`: match the stem as a whole path segment or a
   dot-separated segment of the basename (`cart.test.ts`, `cart.spec.ts`,
   `cart_test.go`), not as a substring, so `cart` does not pair with
   `cartography.test.ts`.
4. `compactTest`: when a kept call line sits inside an `it(`/`test(` body,
   keep through the end of that body (or up to N lines) rather than +/-2, so
   an assertion after a `try`/`catch` survives; and keep the body of a
   same-file helper whose name a kept line calls (`gatewayReturning`,
   `withEmptyCart`, `expectFailure`), since the fixture's body is the bad
   input the rule is asking about.
5. Say in `note_on_related_tests` which signal paired each file (name,
   import, mirrored directory), so the model can weigh a cross-tree import
   pairing as the weak evidence it is -- the header comment promises this and
   the state does not currently carry it.

## Post-report: what changed before shipping

Written by the integrator after the report above, on the same day.

- The three arm changes proposed under **Arm notes** were made in
  `src/paired.ts`: a file under a test directory but not named as a test
  must contain a test opener (the `test/fixtures/cookbook/cart.ts` pairing);
  a relative import specifier is resolved from the importing file and
  compared as a path (the `../src/report.ts` pairing); a name matches as a
  whole `.`/`_`-separated segment; and a test of forty lines or fewer that
  names the module is kept whole from its opener to its closing brace. The
  pairing signal is on each entry as `paired_by`.
- The note gained one sentence for the real-code false positive: returning
  the input unchanged, or a default, when a condition is not met is a
  fallback and not a failure path.
- Refit on the same 27 subjects, 3 passes, $0.004: P 1.00 / R 1.00, 0
  flips, max spread 0.08. Defects 0.88–0.95; cleans top at 0.36
  (`readConfig`), 0.28 (`retry`), 0.27 (`truncateSlug`, down from 0.44 now
  that its whole test travels). Fitted midpoint 0.62; `at: 0.68` kept.
- Promoted: `rules/tests-cover-failure-paths/`, baseline accepted
  2026-09-20. The candidate directory this report names no longer exists.
