# Family K: commit messages against their diffs

A commit message is the one place a repository writes a claim about every
change it makes, and nothing checks it: `git` accepts any subject line over
any diff, a linter sees neither, and a reviewer who reads the message and
skims the diff is the whole defence. The defect class is the one this tool
exists for -- "Fix the retry loop" over a diff that adds a feature, "no
behaviour change" over a diff that moves a default, "Remove X" over a diff
that deprecates X and leaves it in place, an honest subject over a diff that
also turns `strict` off. There is no AST here: `subject: commit` has no
matcher, `jev-lint commits <range>` builds one subject per non-merge commit
with the message as the subject and the diff (capped, stat kept whole) as
the state, and the model does what the reviewer would -- reads the claim,
reads the body, and says whether someone who read only the message would be
wrong about what changed. What jev adds over a linter is the whole judgment:
that a mutex serves "safe under concurrent calls", that a `Revert "X"`
subject line describes the inverse diff, that a Cargo.lock line beside a
version bump is not a change the message had to name, and that a `strict:
false` hunk under "Add --json" is.

One shipped rule: `rules/git/commit-message-describes-diff`. The accepted
run is `baseline.json` beside it; the unseen-code run is quoted below from
its record (session scratchpad `unseen.json`, run with
`--threshold commit-message-describes-diff=0` so every value printed).

---

## commit-message-describes-diff

### Rule

```yaml
id: commit-message-describes-diff
language: Git
subject: commit
kind: noul
# 0.65, fitted 2026-09-20 on this rule's evals (16 commits: 7 defects, 9
# cleans of which 7 hard, 3 passes, baseline.json). Defects answer
# 0.85-0.97 (quietest: test-added-test-deleted, a test added beside a test
# deleted). Cleans top out at 0.35 (refactor-keeps-default, the same
# extraction as refactor-changes-timeout with the default kept), then 0.18
# (the five-file mechanical rename) and 0.16 (the Cargo version bump). Max
# pass-to-pass spread 0.03, no flips. Midpoint 0.60; 0.65 sits above it
# because the first run on unseen commits (jev-lint's own last 12) put an
# honest 201-file move whose diff was cut to fit at 0.50 -- with only the
# stat to check "the move is mechanical" against, the model sits on the
# fence -- while two commits that swept in thousands of lines of unrelated
# rule candidates under a message about something else answered 0.73 and
# 0.47. 0.65 keeps the 0.73 and passes the fence-sitter; the 0.47 is the
# residue. See experiments/reports/k-commits.
threshold: 0.65
ask: >-
  This commit's message ($SUBJECT) claims something the diff does not do, or
  the diff does something material that the message does not mention.
criteria:
  "true": >-
    Someone who read only the message would be wrong about what this commit
    changed: the message names a fix, a removal, a rename or a "no behaviour
    change" that the diff does not carry out, or attributes the change to the
    wrong thing; or the diff makes a change a reader would need to know about
    -- a changed default, a new dependency, a deleted test, a check turned
    off, a widened permission, a second unrelated change -- that neither the
    subject line nor the body mentions. A message that names only an
    addition while the diff also removes something (a test, a guard, a
    branch, a config flag) is this case, however small the removed hunk.
  "false": >-
    The message describes what the diff does. A subject line is a summary and
    may leave out the mechanical parts of the change it names; a body that
    says "also" or "while here" accounts for a second change; a version bump,
    a lockfile, generated code, a formatting-only hunk, a trailer such as
    Co-Authored-By or Signed-off-by, and a test added for the change described
    are not changes the message had to mention.
note: >-
  Judge the message against the diff, not the diff on its own merits. Whether
  the change is a good one is not the question; whether the message tells
  the truth about it is. A terse but accurate subject line honours the
  claim. A message that describes the intent ("make retries safe") rather
  than the mechanism (a new mutex) is accurate when the mechanism serves the
  intent. "Refactor" and "no behaviour change" are honoured when every
  default, exported name, error, and result is the same after as before:
  moving code, renaming a local or a private field, extracting a private
  helper, and lifting a literal into a constant of the same value are the
  refactor, not a change the message had to report. Compare values, not
  shape: a default whose value changes in the middle of such a diff is the
  change to report. `diff` may be cut to fit; `stat` and `files`
  are always complete, so a change visible in `stat` but absent from `diff`
  did happen.
```

The `ask` is the draft's, unchanged. The header comment in the file was
also corrected: it said fixtures were `git format-patch` output, and they
are `fixtures/<case>/{message, before/, after/}` directories (see
`patchRepo` in `src/commits.ts`).

### Corpus

16 commits found as subjects (the eval prints `16 subject(s)` on every
run) / 7 bad / 9 clean, of which 7 hard and 2 easy (`add-coupon`, the
seed, and `fix-pagination-off-by-one`, a fix that is exactly the fix).
Fixtures are TypeScript service code and one Rust CLI; 10-50 lines per
file.

Bad, one defect each:

- `fix-that-adds-a-feature` (seed): "Fix the off-by-one in total" over a
  diff that adds `applyCoupon` and never touches `total`.
- `remove-legacy-exporter`: "Remove the legacy CSV exporter" over a diff
  that adds a `@deprecated` JSDoc and leaves the function and its re-export
  in `index.ts` in place.
- `refactor-changes-timeout`: "Refactor the HTTP client, no behaviour
  change" over a diff that extracts `headers()`/`request()` helpers and, in
  the middle of it, moves the default timeout from 30s to 10s.
- `rename-changes-contract`: "Rename fetchUser to loadUser" over a diff
  that also turns `Promise<User | null>` into a throw of `NotFoundError` on
  a miss and deletes the handler's 404 branch.
- `test-added-test-deleted`: "Add a test for the retry loop's backoff" over
  a diff that adds the backoff test and deletes the abort-signal test.
- `wrong-cause`: "Fix the crash when the cart is empty" over a diff that
  guards a null `session.user`; the empty-cart guard already existed and is
  untouched.
- `flag-plus-strict-off`: "Add --json to the report command" over a diff
  that adds the flag and flips `"strict": true` to `false` in
  `tsconfig.json`.

Hard clean (what a lazy rule would flag):

- `extract-pricing-module`: three-word subject, five files created and one
  rewritten, every function moved and none changed.
- `also-in-body`: a second change (a log-line word) that the body's "while
  here" names.
- `mechanical-rename`: `customerId` -> `buyerId` across five files
  (types, repo, handler, test, JSON fixture); the SQL column is deliberately
  left as `customer_id` so the diff is only the TS rename.
- `refactor-keeps-default`: byte-for-byte the same refactor as
  `refactor-changes-timeout` with the 30s default kept.
- `intent-over-mechanism`: "Make token refresh safe under concurrent
  calls" over a new `mutex.ts` and a double-checked lock in `TokenSource`.
- `version-bump-alongside` (Rust): "Add --json to the report subcommand"
  with `Cargo.toml` 0.4.1 -> 0.5.0 and the matching `Cargo.lock` line the
  message never names.
- `revert-add-coupon`: `Revert "Add coupon codes to the cart"` over the
  exact inverse of `add-coupon`.

### Attempts

Each attempt is one `eval --repeat 1` pass (the eval is `gaps` and `check`
in one for a commit rule; neither takes commit fixtures). Values are
single-pass; the 3-pass numbers are under Fit.

1. **Draft wording** (the rule as it landed). Bad 0.89-0.97 except
   `test-added-test-deleted` 0.49; clean <= 0.18 except
   `refactor-keeps-default` 0.60. Fitted 0.49, "no separating cutoff; best
   trade-off". Gap: none (a 0.49 bad under a 0.60 clean).
   - Corpus check before touching wording: the clean refactor renamed the
     exported `ClientOpts` interface, a public-API change the message did
     not mention. The model was partly right. Fixed the fixture (both
     refactor cases, so they stay parallel) and re-ran the draft wording:
     `refactor-keeps-default` 0.48, `test-added-test-deleted` 0.35 (same
     question; that 0.14 move is pass-to-pass wobble). Fitted 0.35, still
     no separating cutoff. Gap: none.
2. **Criteria + note** (ask unchanged). Criteria "true" gains "a check
   turned off" and: an addition-only message over a diff that also removes
   something (a test, a guard, a branch, a config flag) is the case however
   small the hunk. Note gains: a refactor is honoured when every default,
   exported name, error and result is the same; moving, renaming a local or
   private field, extracting a private helper, lifting a literal into a
   same-valued constant are the refactor; compare values, not shape.
   `test-added-test-deleted` 0.87; `refactor-keeps-default` 0.52; all
   other bad >= 0.86, all other clean <= 0.19. Fitted 0.69, midpoint. Gap
   0.34 (0.52 -> 0.86), head 0.17 over the clean top.
   - Corpus check again: the clean refactor still dropped the `?? 30_000`
     fallback, so `{ timeoutMs: undefined }` went from a 30s timeout to
     `AbortSignal.timeout(undefined)`. Also a real difference. Fixed (both
     cases), same wording: `refactor-keeps-default` 0.35. Fitted 0.60,
     midpoint. Gap 0.49 (0.35 -> 0.84).

No third attempt: the classes separate with the second wording once the
"no behaviour change" clean actually has none. Two of the three moves on
that hard clean came from fixing the fixture, not the sentence; the
deleted-test move came from the sentence.

### Fit

`eval rules/git --repeat 3 --accept --no-config`, 16 subjects, 3 passes
(baseline.json, draft `f8682af992d5`):

| case | label | mean | passes | spread |
| --- | --- | --- | --- | --- |
| fix-that-adds-a-feature | bad | 0.97 | 0.97 0.97 0.97 | 0.00 |
| remove-legacy-exporter | bad | 0.95 | 0.95 0.94 0.95 | 0.01 |
| refactor-changes-timeout | bad | 0.94 | 0.94 0.94 0.94 | 0.00 |
| rename-changes-contract | bad | 0.93 | 0.93 0.93 0.94 | 0.01 |
| flag-plus-strict-off | bad | 0.92 | 0.92 0.92 0.91 | 0.01 |
| wrong-cause | bad | 0.87 | 0.87 0.89 0.86 | 0.03 |
| test-added-test-deleted | bad | 0.85 | 0.86 0.86 0.83 | 0.03 |
| refactor-keeps-default | clean | 0.35 | 0.35 0.36 0.35 | 0.01 |
| mechanical-rename | clean | 0.18 | 0.19 0.16 0.18 | 0.03 |
| version-bump-alongside | clean | 0.16 | 0.16 0.16 0.16 | 0.00 |
| intent-over-mechanism | clean | 0.12 | 0.13 0.12 0.11 | 0.02 |
| revert-add-coupon | clean | 0.12 | 0.11 0.12 0.12 | 0.01 |
| add-coupon | clean | 0.10 | 0.09 0.11 0.11 | 0.02 |
| extract-pricing-module | clean | 0.10 | 0.10 0.10 0.09 | 0.01 |
| also-in-body | clean | 0.06 | 0.06 0.06 0.06 | 0.00 |
| fix-pagination-off-by-one | clean | 0.03 | 0.03 0.03 0.04 | 0.01 |

- Fitted cutoff (midpoint): 0.60. Shipped `threshold: 0.65`.
- At 0.65: precision 1.00, recall 1.00, tp 7 / fp 0 / fn 0.
- Decision flips across the 3 passes: 0. Max spread: 0.03.
- Gap 0.35 -> 0.85 (0.50 wide). Headroom from clean top to 0.65: 0.30;
  from 0.65 to the quietest defect: 0.20.
- Do-nothing baseline: 9/16 = 56% accuracy, recall 0.
- `eval --replay` after acceptance: "same decisions", all as shipped.

**Unseen code** (calibration step 5): `jev-lint commits HEAD~12..HEAD -R
rules/git --no-config --cache none`, jev-lint's own last 12 commits, 12
subjects, $0.0043. Values: 0.73, 0.50, 0.47, 0.28, 0.27, 0.25, 0.18, 0.15,
0.14, 0.10, 0.09, 0.08.

- 0.73 `3c0ff08` "init --pre-push, and docs for commits": the diff also
  adds four Go/Python rule candidates with fixtures and baselines under
  `experiments/` -- about 1,700 of its 1,991 lines. A true finding; the
  rule's first find on real code.
- 0.50 `3e58543` "Rules by language: typescript/, rust/, javascript/,
  json/": 201 files, diff cut to fit, a detailed and honest message ("the
  move is mechanical"). With only the stat to check that against, the
  model sits on the fence. This is the hole the corpus does not contain:
  an honest commit whose diff is cut answers ~0.50, not ~0.15.
- 0.47 `cc1c372` "jev-lint commits: judge commit messages against their
  diffs": a long, accurate body about the feature, and thousands of lines
  of Go/Python rule candidates swept in unmentioned. Defensibly true, and
  it passes at 0.65. The residue.

0.65 was chosen over the 0.60 midpoint for the fence-sitter: 0.15 above
0.50 while keeping the 0.73. The draft's 0.7 would have kept it by 0.03.

### Verdict

**SHIP** -- the corpus separates with 0.30 of headroom under the clean top
and no flips, and the first unseen run produced one true finding and no
false positive at the shipped cutoff; the known soft spot (a cut diff over
an honest big commit lands at 0.50) is 0.15 under the cutoff and named in
the rule's comment.

### What I would change

- **Corpus**: a case for the cut-diff hole -- an honest commit whose patch
  exceeds `MAX_DIFF_CHARS` (48k) so the state is stat-only for most files
  -- and its bad twin, the same big commit with one unrelated file in the
  stat. The fixture would be ~50 files of 1k each; the eval handles it,
  the repository just gets heavier. Without it the 0.50 is known only from
  the unseen run.
- **Corpus**: the task's item 7 named three shapes (widened permission,
  new dependency, check turned off) and `flag-plus-strict-off` covers one.
  A "new dependency in package.json + lockfile" twin would test the
  criteria's other clause directly, since the false branch also says a
  lockfile is fine and the model has to tell the two apart.
- **State**: when the diff is cut, the model should get the full diff of
  the files the message names and the stat of the rest, rather than the
  first 48k characters in path order. `3e58543`'s cut fell inside
  `rules/` and the model never saw `src/`. That is a `src/commits.ts`
  change, out of scope here.
- Nothing in the sentence. The ask never moved and two criteria/note
  passes were enough.

---

## Cost

From the tool's own summaries, every run in this session:

| run | requests | input tokens | usd |
| --- | --- | --- | --- |
| eval `--repeat 1 --dry-run` on the 2 seeds (see Tooling: not a dry run) | 2 | 1,961 | $0.00008 |
| attempt 1, 16 cases, 1 pass | 16 | 22,702 | $0.00095 |
| attempt 1 after corpus fix, 1 pass | 16 | ~22,700 | $0.00095 |
| attempt 2, 1 pass | 16 | ~25,000 | $0.00105 |
| attempt 2 after corpus fix, 1 pass | 16 | ~24,800 | $0.00104 |
| attempt 2, 3 passes (fit) | 48 | 74,592 | $0.00313 |
| `commits HEAD~12..HEAD` (unseen) | 12 | 102,287 | $0.00430 |
| attempt 2, 3 passes, `--accept` (baseline) | 48 | 74,592 | $0.00313 |
| **total** | **174** | **~349k** | **$0.0146** |

## Tooling

- `eval --dry-run` is accepted and ignored. `node --experimental-strip-types
  src/cli.ts eval rules/git --repeat 1 --no-config --dry-run` printed
  `git/commit-message-describes-diff: 1 pass(es), 2 subject(s), 2
  request(s), $0.00008, 585 ms` and a scored table with fresh values -- it
  had made the 2 requests. `cmdEval` in `src/cli.ts` never reads
  `opts.dryRun` (`src/evals.ts` has no `dryRun` at all). Harmless at these
  prices, but the BRIEF's "`--dry-run` before every paid run" cannot be
  followed for a commit suite; `--repeat 1` is the pricing run.
- `gaps` and `check` do not take commit fixtures, so the BRIEF's step 4
  has no free form for this rule: every attempt is a paid `eval --repeat 1`
  (about $0.001 for 16 cases). The eval prints the fitted cutoff and
  `cleanTop` but not the gap width, the defect floor or a verdict word;
  per-case values had to be read out of `last.json` with a script. A
  `gaps`-style line (median, gap, verdict) in the eval table would remove
  that step.
- `commits --record` writes an `answers` record, not an eval-style
  `passes` record, so `eval --compare` cannot put the unseen run beside the
  baseline; the values above were grepped out of the record.
- Not jev-lint, but it cost time: a long Bash heredoc script that ended in
  `diff -u` under `set -e` aborted at the first differing pair (exit 1) and
  the tool then reported the command as hung; the revert case was
  double-copied by the partial run and had to be cleaned up.
