# improve: sibling-deviates

**Rule**: `sibling-deviates`, `experiments/rule-candidates/sibling-deviates/`.
`subject: file`, `axis: file`. State `full` -> `graph`. The `score` variant
(`sibling-deviates-score`) was dropped on the evidence below.

The class was split as the family report recommended. The rule now asks
only about signature shape -- how failure is reported, async-ness,
parameter order -- and says in its criteria that a function whose only
difference is its name is not a deviation for it. The four name-level
deviants (`auth_routes`, `notifications`, `lookups`, `permissions`) stay in
the corpus relabelled clean, with the argument that each has one odd item
and identical signatures; they are the hard cleans a lazy rule flags, and
`module-naming-consistent` answers them at 0.72-0.94.

| | start (noul / score) | end (noul) |
| --- | --- | --- |
| cases | 19 modules: 7 bad, 12 clean | 27 modules: 9 bad (3 per shape), 18 clean (14 hard) |
| state / at | full / 0.65 (2.5) | graph / 0.60 |
| P / R (3 passes) | 1.00 / 0.71 (1.00 / 0.57) | 1.00 / 1.00 |
| bad band / clean band | 0.55-0.90 / 0.05-0.58 | 0.71-0.92 / 0.05-0.48 |
| headroom | 0.07 / -0.10 | 0.12 / 0.11 |
| flips | 0 (1 for score) | 0 |

**Attempts**

1. As shipped (both variants, `full`): noul P 1.00 R 0.71 at 0.65,
   `auth_routes` 0.55 and `permissions` 0.32 missed, fitted "no separating
   cutoff"; score P 1.00 R 0.57 at 2.5, the three name-level deviants at
   1.79-2.11 with `project_files` flipping across 2.5.
2. Split + `graph` + six new defects and two new hard cleans (see below),
   both variants rewritten to the signature scope. Confirmed first with the
   outline dump that the subject text carries each export's signature
   (`async function readSchema(root: string): Schema` beside four
   `Promise<...>` siblings; `runExport(input: ExportInput, ctx: Context)`
   beside four `(ctx, input)`; `Promise<Result<Note>>` x5 beside
   `Promise<Note>`). noul: P 1.00 R 1.00 at 0.7, fitted 0.67, bad
   0.76-0.92, clean max 0.57 twice -- `jobs.ts` (the comment explaining
   `noopJob` is not in the outline, so on `graph` the subject cannot show
   the exception the criteria promised) and `sync.ts` (two groups of
   three). Every name-level file 0.05-0.12. score: bad 2.81-2.98, `sync.ts`
   2.65 with confidence 0.65, `preferences`/`jobs` 2.17-2.18: no cutoff
   with 0.10 of headroom on both sides.
3. Same wording, `state: full`: noul fitted 0.61, bad 0.74-0.95, clean max
   0.48 (`sync.ts`), `jobs.ts` 0.20 -- the comment is visible, the gap is
   0.07 wider than on graph. score: `sync.ts` 2.41, bad min 2.75. Cost +15%
   tokens on these 20-40 line files and the whole source on a large one.
4. Back on `graph`, one wording change so the outline can carry the
   answer: the false branch names a no-op or placeholder ("a noop* name,
   an unused parameter, an empty body"), and says a sibling that takes a
   *different* parameter is not a reordering (which is what `pushSnapshot
   (remote, local)` beside `(remote, changes)` was being read as). noul:
   P 1.00 R 1.00, fitted 0.60, bad 0.71-0.92, clean 0.05-0.49; `jobs.ts`
   0.17, `sync.ts` 0.49. The clauses cost 0.05 at the bottom of the bad
   band (`formatters` 0.77 -> 0.71, `handlers` 0.82 -> 0.78). score:
   `sync.ts` 2.67 (confidence 0.65-0.68) against a bad band from 2.81 --
   worse than on `full` and narrower than the noul. Dropped.
5. Score variant removed, `at: 0.60`, fresh `--accept` run (noul only, 27
   requests per pass): P 1.00 R 1.00, fitted 0.60, bad 0.71-0.92, clean
   0.05-0.48, 0 flips, headroom 0.12 / 0.11. Same decisions as attempt 4.

Why `graph` over `full`: the outline separates within 0.02-0.07 of the
source once placeholders are named, and it is the arm that survives a
3000-line module; the family report asked for exactly this. What `graph`
gives up is stated in the rule: a comment beside the odd item is not
visible, so the exception rests on the item looking like a placeholder.

Why the score variant is dropped: with names out of scope the reason for
it -- routing a mid-confidence name-level band to a person -- is gone, and
on the same corpus its one wrong clean (`sync.ts`) carries confidence
0.65, so `unsureBelow` would not route it either.

**Cases added** (labels carry the argument)

- `parsers.ts` bad (failure mode): four `parse*` return `T | null`,
  `parseVersion` throws for the same regex parse -- 0.79.
- `fetchers.ts` bad (failure mode): four `fetch*` throw on `!res.ok`,
  `fetchPlan` returns `Promise<Result<Plan>>` -- 0.87.
- `formatters.ts` bad (async-ness): four pure Intl formatters, `formatMoney`
  is `async` for the same pure work -- 0.71, the weakest defect (passes
  0.67-0.75); an async wrapper around a pure function is the shape the
  model is least sure is a mistake.
- `session_events.ts` bad (async-ness): four `on*` await `audit.write` and
  `metrics.increment`, `onLogout` calls both un-awaited and returns void --
  0.75.
- `serializers.ts` bad (parameter order): four `write*(out, value)`,
  `writeDate(value, out)` -- 0.81.
- `worker_routes.ts` bad (parameter order): four `handle*(env, request)`,
  `handleCancelJob(request, env)`, the Workers shape -- 0.86.
- `accounts.ts` clean (hard): `getAccountOrThrow` throws where four
  `find*` return `T | null`, but its name states the failure mode and it
  is built on `findAccount` (visible as a call edge) -- 0.30.
- `uploads.ts` clean (hard): `putExport` takes an extra optional `opts`;
  the shared `(bucket, key, body) => Promise<void>` is intact -- 0.13.
- Relabelled clean for this rule: `auth_routes` 0.05, `notifications`
  0.05, `lookups` 0.05, `permissions` 0.12 (name-only deviants);
  `user_repository` 0.05, `factories` 0.08, `settings` 0.05 (many verbs,
  one signature shape).

**What stops the bar**: nothing on the corpus; the margins are the thinnest
of the three rules. `sync.ts` (0.48, passes to 0.53) is 0.12 under and
`formatters.ts` (0.71, passes from 0.67) is 0.11 over. A "two deviants
among six" module was deliberately not added: whether two are a slip or a
second convention is a label opinion the brief did not ask for, and the
rule says "one".

**Unseen check** (agent-cluster `apps/` + `packages/`, 58 modules, one
pass, $0.0087, after attempt 4): **0 findings at 0.60**, 57 answered.
`apps/agent-worker/worker.ts` (25k lines) got no verdict: its outline alone
exceeds the request budget even after the step-down to `bare`
(`max_tokens_exceeded`), which is a tool limit, not a rule one. Highest
answers, each judged:

- 0.45 `apps/shared/auth.ts` -- `isInternalServiceBindingRequest(request):
  boolean` is the one sync function among async token helpers; it reads
  headers while the others go through a lazily imported module. Clean; the
  odd item is the odd operation.
- 0.44 `apps/agent-worker/loop-service.ts` -- six `executeLoopIterate*Phase`
  take a single `params` object, `executeLoopIterateSubmitPhase(request,
  baseCommit, deps)` takes positionals. This is the one answer I would call
  a real finding the rule under-answers: positional-versus-options-object
  is a parameter-shape deviation the ask does not name (it says "order").
  Worth a clause and a corpus case in a later revision; not changed here
  because the wording budget was spent.
- 0.43 `apps/agent-worker/loop-domain.ts`, 0.40 `apps/shared/observability.ts`,
  0.39 `hub-pr-watch.ts` -- large mixed modules with no single odd item.
  Clean.

Headroom on real code: 0.15 above the highest clean.

**Cost**

| run | passes | requests | USD |
| --- | --- | --- | --- |
| eval, as shipped (19 modules x 2 rules) | 3 | 57 | 0.0054 |
| eval, split, graph (27 x 2) | 3 | 81 | 0.0072 |
| eval, split, full | 3 | 81 | 0.0083 |
| eval, placeholder clause, graph | 3 | 81 | 0.0074 |
| check, unseen (58 modules) | 1 | 57 | 0.0087 |
| eval --accept, noul only (27) | 3 | 81 | 0.0050 |
| **total** | | **438** | **~$0.042** (~0.95M input tokens) |

Across the three rules of this brief: ~610 requests, ~2.7M input tokens,
~$0.12 of the $0.60 budget.
