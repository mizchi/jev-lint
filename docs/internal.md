# Internals

How the code works, for changing it. [README](../README.md) is how to use it,
[reference.md](reference.md) is every flag and field, [deepdive.md](deepdive.md)
is what is known and why, [findings.md](findings.md) is the notebook.

Read this before editing anything under `src/`. Most of the non-obvious
decisions here were bought with a measurement, and the file comments say which.

## The pipeline

One pass, five stages, each handing a plain value to the next. Nothing is
stateful except the cache.

```
paths + rules
  │
  ├─ scan.ts     runAstGrep()       one ast-grep invocation, all rules + probes
  │                                 → matches[], probes[], stderr
  │              buildSymbols()     probes → per-file symbol table, call edges
  │
  ├─ run.ts      collectSubjects()  matches → Subject[] (+ sources, symbols)
  │                                 dedupes, resolves subject mode, picks the arm
  │  ignore.ts   parseIgnores()     suppressed subjects are dropped HERE, so a
  │                                 suppression also saves its tokens
  │
  ├─ schedule.ts schedule()         → which axis each rule goes on (only for --group auto)
  │
  ├─ batch.ts    planBatches()      Subject[] → Batch[]  (state + questions, budgeted)
  │              planRuleBatches()  the rule axis variant
  │
  ├─ state.ts    buildState()       one Batch's state payload, per arm
  │  questions.ts buildQuestion()   one Subject's question
  │
  ├─ jev.ts      askSplitting()     one request per batch, halving on too_big
  │  questions.ts readAnswer()      response → {value, confidence, kind} | null
  │  run.ts      mergePasses()      --retry n: n answers per subject → the mean,
  │                                 plus how many passes crossed the cutoff
  │
  ├─ gate.ts     decide() / gate()  answers + cutoffs → Finding[]   (pure, offline)
  │
  └─ report.ts   formatPretty()     Finding[] → text / JSON / GitHub commands
                 formatGaps()
```

`cli.ts` wires it and owns every flag. `calibrate.ts` is a separate offline
consumer of the same `Finding[]`: gap report, stability report, cutoff fit.

**The stage boundary that matters most is `gate.ts`.** Verdicts cost money;
thresholds are what you will change twenty times. Keeping the gate pure is what
makes `jev-lint replay` possible, and replay is what makes a shipped cutoff
auditable.

## Modules

Largest first. No line counts: the last table of them was stale for more than
half the files by the time an audit read it, and `wc -l src/*.ts` is always
right.

| file | responsibility |
| --- | --- |
| `cli.ts`, `cli/` | the entry, and one module per step: `args.ts` (every flag, `USAGE` -- a second source of truth for flag docs, change both), `context.ts` (the config, found and folded in), `select.ts` (which rules: loaded, or `run`'s one), `targets.ts` (which files, or which commits), `check.ts` + `dry-run.ts` (the run and its report, or its plan), and `eval.ts`, `calibrate.ts`, `replay.ts`, `init.ts`, `rules.ts` for those commands; `main.ts` is only the order |
| `cost.ts` | a plan's price per rule: each rule's questions, and its share of every batch's state |
| `scan.ts` | the ast-grep driver: rule translation, structural probes, the symbol table and call graph |
| `run.ts` | `collectSubjects`, `run`, `mergePasses`, `buildRecord` |
| `state.ts` | the five state arms, subject resolution, the module outline |
| `rules.ts` | rule schema, validation, defaults, `defaultRulePaths()`, `ruleTextHash()` |
| `types.ts` | every shared type. Unions derive from `as const` arrays so the validator and the type cannot diverge. `Rule` is `RuleBase & RuleJudgment & RuleSource`: the fields a kind or a subject has, and the other's as null, narrow on `rule.kind` and `rule.subject`; `isMatcherRule` is the guard for the rules ast-grep runs. |
| `batch.ts` | packing subjects into requests under two token budgets |
| `calibrate.ts` | gap report, stability report, cutoff fit, label resolution |
| `report.ts` | the three output formats and the two report tables |
| `schedule.ts` | the per-rule axis decision for `--group auto` |
| `config.ts` | `.jev-lint.yaml`: discovery, validation, and the flag-beats-file merge |
| `evals.ts` | per-rule evals: suite discovery, scoring at the shipped cutoff, baseline comparison, the record |
| `jev.ts` | the API client: retry, split-on-too-big, spend accounting |
| `gate.ts` | answers + cutoffs → findings. Pure. |
| `cache.ts` | the verdict cache and `verdictKey` |
| `questions.ts` | one subject → one question payload, and `readAnswer()` for the reply |
| `diff.ts` | unified-diff parsing for review mode |
| `ignore.ts` | `jev-lint-ignore-file` and `-next-line`, parsed from raw text |

### `scan.ts` — the matcher, and the probes

One `ast-grep scan --json=stream` invocation carries **every rule for every
language plus a set of structural probes**, because process startup dominates
and a second invocation would double it.

Three things here are easy to break:

- **Rule ids are per grammar.** A rule for four ECMAScript grammars becomes four
  ast-grep rules, `id@Language`, mapped back by `baseRuleId()`. Emitting one id
  for several languages silently merges their matches.
- **ast-grep rejects a rule naming a node kind absent from the target grammar,
  and one rejected rule fails the whole scan.** That is why `STRUCTURE` gates
  the TypeScript-only kinds and why the packs split Rust from ECMAScript. The
  failure surfaces as `AstGrepError`, which `cli.ts` prints as a message
  without a stack, because it is a configuration mistake and the stack buries
  it.
- **`.js` and `.mjs` are claimed by both the JavaScript and Jsx grammars**, so
  every node matches twice. `collectSubjects` dedupes on (file, byte range,
  rule); removing that doubles every subject count.

The probes are how the `graph` arm gets built without a second tool: reserved
ids under `PROBE_PREFIX` match containers, imports and exports, and
`buildSymbols()` turns them into a per-file symbol table. A container is
usually a `kind` plus the field its name lives in; a probe can also carry a
whole rule with `$JEVNAME` in it, which is how a `test("title", () => {...})`
call is a container named by its title — without that, a statement inside a
test body had nothing to promote to under `subject: enclosing`, and the
comment rules judged one line and its comment. `computeCalls()` then
adds edges **by name occurrence inside each symbol's own text** — deliberately
approximate, and only ever shown to the model, never used to decide anything.
Symbols with `role: "module"` are excluded from the edge graph and still carry
empty `calls`/`calledBy` arrays.

### `state.ts` — the arms

`buildState()` builds one payload for one batch. What each arm adds is a small
`if` ladder; the subtle parts are elsewhere:

- **`state.subjects` grows with the batch.** It is per-subject metadata, so a
  state's size is *not* fixed overhead — which is what `batch.ts` gets wrong if
  you let it measure the state once per file.
- **A subject's `id` is part of the state's text.** Size a state with the ids
  assigned, exactly as `makeBatch` will assign them, or you undercount every
  subject by the width of its id.
- **`context` is only attached when the subject is a fragment.** `resolveSubject`
  sets `context: encl && !isNamedSymbol(...) ? truncate(encl.text) : null`, so a
  rule whose subject is already a whole function gets no enclosing context and
  the `local` arm is effectively `bare` for it. This is the correction that made
  the rule axis's arm loss sharper than first described.
- **Report location and judged subject are separate.** `subject: enclosing`
  judges the container but must still report at the match's own line, or every
  match in a function collapses onto one line. `matchText` carries the promoted
  subject's own text.

### `batch.ts` — two budgets, two margins

| constant | value | where it is compared |
| --- | --- | --- |
| `MAX_REQUEST_TOKENS` | 65,536 | `REQUEST_BUDGET` |
| `MAX_STATE_TOKENS` | 32,768 | `STATE_BUDGET` |
| `STATE_MARGIN` | 1.25 | `STATE_BUDGET = floor(MAX_STATE_TOKENS / STATE_MARGIN)` |
| `REQUEST_MARGIN` | 1.1 | `REQUEST_BUDGET = floor(MAX_REQUEST_TOKENS / REQUEST_MARGIN)` |
| `CHARS_PER_TOKEN_TEXT` | 3.4 | strings of `TEXT_LIKE_LENGTH` or more |
| `CHARS_PER_TOKEN_STRUCT` | 2.2 | keys, punctuation, short string values |
| `TEXT_LIKE_LENGTH` | 64 | the prose/label boundary |
| `QUESTION_ENTRY_OVERHEAD` | 4 | per question, for its record key |
| `DEFAULT_BATCH_SIZE` | 256 | the self-imposed cap; **not** a server limit |
| `INLINE_LIMIT` (state.ts) | 900 | above it the code travels with the question only when the arm carries no source |
| `SUBJECT_TEXT_LIMIT` (state.ts) | 4,000 | the truncation point for a long subject |
| `OUTLINE_TEXT_LIMIT` (state.ts) | 16,000 | the cap on a module outline: every export, then private symbols until the budget, then "… and N more private symbols not shown". A 25k-line module rendered at 127,000 characters and got no verdict; ordinary modules render under 12,000 |
| `USD_PER_MTOK` (jev.ts) | 0.042 | the only place the price is spelled; `--dry-run` and `--explain-schedule` both read it |

What breaks in each direction:

- **State budget too high** → the request is refused and *the verdicts are
  lost*. Halving the questions is the only recovery the client has, and it
  leaves the state untouched. This is the asymmetry the two margins exist for.
- **State budget too low** → smaller batches, so the state is sent more times.
  Costs tokens, loses nothing.
- **Request budget too high** → one wasted round trip, then `askSplitting`
  recovers.
- **Chars-per-token too generous** → same as a state budget too high. The two
  constants are the *measured* values (3.37 and 2.18); the safety lives in the
  margins, not in the ratios, because `--dry-run` quotes with the same
  estimator and padding the ratios overstated a real bill by 22%.

`planBatches` guarantees, and `test/test.ts` asserts each one:

1. every subject lands in exactly one batch
2. no batch is empty
3. no batch holds more than `batchSize` subjects
4. no batch's estimated total exceeds the request budget, unless it holds a
   single subject that cannot be split further
5. no batch's state exceeds the state budget, under the same exception

The tests assert 4 and 5 against `REQUEST_BUDGET` and `STATE_BUDGET`, exported
for that purpose, and not against the ceilings. They used to assert the
ceilings, which a planner packing to `MAX_STATE_TOKENS` exactly would have
passed while losing verdicts on the server — the margins were the one thing in
this table no test checked. Swapping the planner's budgets for the ceilings now
fails two tests, and that swap is the regression the margins exist to catch.

**The arm is chosen by the state's irreducible floor**, what one subject alone
costs, not by the whole group. A file with much *source* has to step down,
because every split still carries that source; a file with many *matches* is
split instead. Probing the whole group conflated the two and reported a
"fallback from `bare` to `bare`", which is not a fallback at all.

A `degraded` mark means the arm actually changed. Never set it when
`from === to`.

### `schedule.ts` — the axis decision

`FILE_BEARING_ARMS = {located, full}`. A rule on one of those is **pinned to the
file axis structurally**, because a rule-axis state spans files and cannot carry
one. A rule's own `axis:` pin is never overruled. Everything else is a greedy
hill-climb over `planMixed`'s cost.

Two traps, both of them bugs that existed:

- **Decide the axis once, over one set of subjects.** Deciding it again on the
  uncached remainder stores a verdict under the key of an axis it was not asked
  on.
- **Cost the plan you will run.** The cost report and the plan must be computed
  over the same subject set, or the report describes a run nobody made.

### `ignore.ts` — suppression comments

One anchored regex over the raw text, so a new language needs nothing here. Two
traps, both of which bit:

- **The rule-id list must not exclude `-` from its character class.** Excluding
  the closers inline looks right and truncates every shipped rule id at its
  first hyphen, so `fn-name-promises` silenced a rule called `fn`. The closer is
  stripped afterwards instead.
- **The marker must be anchored to the start of the line.** Unanchored, a test
  fixture containing the marker as a string literal silences the file it is
  written in — invisibly, because every rule still loads and nothing is
  reported.

`unknownIgnoredRules` exists because a typo in a suppression fails the worst
way: the rule keeps firing and the author believes it is handled.

### `run.ts` — asking more than once

`--retry n` loops only the ask phase: the matcher, the planner and the question
ids are identical across passes, which is what makes the answers comparable.
`mergePasses` then collapses them to the MEAN, because a single pass both over-
and under-reports near a cutoff, and keeps `over`/`of` beside it because three
of three and one of three are different claims.

Two rules there:

- **The cache is bypassed when n > 1**, not merely ignored on read. A cached
  answer reproduces itself; and writing one pass's answer while the report
  decided on a mean would leave the cache holding a verdict nobody used.
- **A pass that returned nothing is not a disagreement.** It is a failed
  request, which `missing` already reports; counting it would make a flaky
  network look like an unstable rule.
- **The mean is left unrounded and the spread is rounded.** The mean decides,
  and rounding a decision input can flip it; the spread is only printed.

### `config.ts` — the precedence, and the two refusals

`applyConfig` takes the set of flags that were **actually passed**, not the
parsed options. That is the whole mechanism: `opts.concurrency` is already
the default before any file is read, so a merge that compared against the default would let
the file win over a flag that happened to match it.

Two things the file will not do, both enforced as errors rather than as silent
drops:

- **`apiKey:` is rejected.** A config file belongs in version control and a
  secret does not. `apiKeyEnv:` names the variable instead, which is a
  location rather than a secret.
- **An unknown key is rejected**, and a bad value with it, and the run exits 2.
  A configuration that quietly does something other than what it says is worse
  than no configuration — the same argument as for an unknown rule field.

`at:` merges rather than replaces, so `--at one=0.5` overrides that rule and
leaves the file's other cutoffs standing.

The starter file `init` writes is entirely commented out, and a test asserts
both that it parses clean and that it sets nothing — a starter config that
errors, or that silently changes behaviour, is worse than none.

### `cache.ts` — what a key must cover

```
verdictKey = sha256(SCHEMA, rule.id, ruleTextHash(rule), arm, group, subjectText)
```

Every component is load-bearing:

| in the key | so that |
| --- | --- |
| `ruleTextHash` | editing the sentence is editing the question; an old verdict must not answer a new one. The matcher is in it too, with `constraints` and `utils`: the node kind it selects and the names it captures go into the question, and neither is in `subjectText` |
| `arm` | the same subject at a different arm was shown different evidence |
| `group` | file grouping puts a subject next to its own file's matches, rule grouping next to unrelated ones |
| `subjectText` | not the line number, which moves for free |

**`at` is deliberately excluded**, which is what makes recalibration free:
changing a cutoff invalidates nothing. `ruleTextHash` covers everything the
model is shown and nothing else — which is why the matcher went in: it is
shown, as `node` and `matcher_captured`, and until it was hashed a matcher
edit that changed what was captured served the old question's verdicts. Object
key order is canonicalised first, so re-spelling a matcher is not a new draft.

Consequence worth knowing: switching `--group` invalidates every entry, and the
CLI never calls `Cache.prune()`, so the file grows. The cache is also **trusted
input** — anything that can write it can silence a rule.

### `jev.ts` — the client

`ask()` retries on 5xx with backoff; `askSplitting()` halves the question
set on the server's own `max_tokens_exceeded` and recurses. Error kinds:
`too_big` (send fewer questions), `auth` (retrying will not help), `transient`
(retry), `other` (give up on this batch).

A 429 is none of those. The server limits **input tokens**, not requests --
40 small requests at once go through, 20 of the largest at once go through,
and the same 20 a second later lose 4, then 14, then 16 -- and it answers
with a bare 429: no `retry-after`, no ratelimit headers. The fit is a token
bucket of about 1.6M refilling at 200-250k per second. `Pacer` mirrors it:
each request is charged its estimate when sent (the planner's
`estimateTokens`, corrected to the server's `usage.input_tokens` on return)
and waits until the mirror can pay. A 429 empties the mirror and lowers its
rate by a quarter; a success while requests have had to wait raises the rate
by two percent, at most once per 500 ms, so a key with a higher limit finds
it without a run's worth of 429s. The mirror starts at 1.2M / 200k a second
-- under the measurement, so a run that begins with a full bucket draws no
429 -- and `JEV_LINT_TOKEN_BURST` / `JEV_LINT_TOKENS_PER_SECOND` override
it. A 429 that does arrive is waited out (300 ms, growing by half, jittered)
and re-sent up to `rateLimitRetries` (8) times; it is counted in
`spent.rateLimited` and does not spend `retries`.

Concurrency is separate from pacing: `run()` bounds requests in flight with
`mapLimit` at `--concurrency` (32). Latency is 260 ms plus 5.7 ms per
thousand tokens, and the server's latency grows with what it is holding, so
on the full self-lint (79 requests, 2.15M tokens) 4 abreast is 9.6 s, 16 is
4.8, 32 is 3.6-5.1 and 64 no better. The `--retry` passes are not run one
after another: every (pass, batch) pair is one job in the same map, so an
eval's three passes over fifteen requests are forty-five in flight together.
`spent.ms` is the sum of request latencies; `spent.wallMs` is what the
asking took.

Measured facts about the endpoint that the code depends on: the two budgets
above are independent; question count is not a limit (1,220 work) and 255 is the
cap on `choice` *options*, which this tool never uses; and the server charges
about 270 tokens per request plus 13 per question beyond the payload.

### `rules.ts` — validation, and where rules come from

Validation never throws: a bad rule is dropped with a reason, and `cli.ts`
prints every reason loudly, because a rule that silently failed to load looks
exactly like a rule that found nothing. An unknown field is an error, so a typo
cannot quietly do nothing.

`defaultRulePaths()` resolves `./rules` first and the installed package's own
`rules/` second, never both. Merging them would judge someone's code against
rules they did not write.

## Known imprecisions

Four of these are deliberate and documented in place; the rest are gaps an
audit of the source found, listed so nobody rediscovers them the expensive way.

- **A cache key does not cover the whole file.** Two subjects with identical
  text in different files share one verdict, and on the file axis the state was
  built from one of those files. The dedupe is what makes a repository with
  duplicated code cost less than its size, and it is a real imprecision: the
  second file's verdict was formed while looking at the first file's source.
  Invisible in the output, because each twin prints its own file and line.
- **A verdict is looked up under the declared arm and stored under the
  effective one.** They differ when a batch steps down. Storing under the arm
  the question was asked at is what makes a mismatch a *miss* rather than a
  wrong answer, at the cost of asking again every run while a file stays over
  budget.
- **`margin` is a ratio, not a difference** (`value / at`, gate.ts). It reads
  like a subtraction and "correcting" it to one would reorder every report. A
  0.9 answer against a 0.2 cutoff outranks a 2.2 against a 2.0, which is the
  point — cross-rule ranking has to be scale-free.
- **`batch.file` and `batch.language` mean different things per axis.** On the
  file axis `file` is a path; on the rule axis it is a synthetic label,
  `"<rule.id> (N file(s))"`, and it flows into error rows, the json output and
  the progress callback. `language` is the first subject's even when a rule-axis
  batch spans languages, while the state itself correctly carries an array.
  Code that treats either as authoritative works on one axis only.
- **The symbol list's sort order is an undeclared precondition.**
  `enclosingSymbol` and `pickEnclosing` both `break` on the first symbol
  starting after the target, which is only correct because `buildSymbols`
  sorted start-ascending and end-descending. Filtering, appending to or
  hand-building a `FileSymbols` gives silently wrong enclosing symbols rather
  than an error. `enclosingChain` re-sorts defensively; the other two do not.
- **`replay` reconstructs rules with empty matchers and nulled user-facing
  fields**, which is correct for re-gating recorded answers but means any new
  gate behaviour reading `rule.message` or `rule.unsureBelow` behaves
  differently under replay. `npm run ci` ends in a replay, so a divergence
  surfaces as a confusing CI difference rather than a test failure.
- **The estimator's constants are tested for direction, never for value.** A
  wrong ratio passes CI, and the same `estimateTokens` is what `--dry-run`
  quotes a bill with.

## Build contract

`"type": "module"`, so plain `.ts` files are ESM. Three settings keep one source
tree runnable three ways — through `tsc` for the published build, through
`node --experimental-strip-types` for development, and from `dist/` once
installed:

- `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` — source
  imports `./x.ts`, the emit rewrites to `./x.js`.
- `erasableSyntaxOnly` — anything TypeScript cannot simply erase is a compile
  error here, so the stripped-types run and the compiled run cannot diverge.

`package.json` ships `dist`, `rules`, `README.md` and `LICENSE`. **`rules` has
to stay in that list**, or a fresh install has no packs to fall back to. It
ships the evals with them — `rules/<id>/evals/` is under `rules/` — which is
a few hundred kilobytes of cases and baselines a user can replay.

`npm run ci` is `typecheck && test && build && eval --replay`. The last step
re-scores every rule's accepted baseline at the cutoffs as they are now,
with no request, and fails on a case that was right when the baseline was
accepted and is wrong now, or on a rule whose question changed since. It
replaced a `replay` of one whole-corpus record, which had to accept exit 1
because the corpus held deliberate violations; the eval gate compares
decisions to decisions, so its exit code means what it says.

## Testing

`test/` needs no API key and no network, and is run directly by Node:
`test/test.ts` imports one file per module under test, in order, and
`test/helpers.ts` holds the harness and the fixture builders. The suite was
one file until it was the largest thing the tool judged, and the file every
module paired with on the `paired` arm; `npm test <substring>` runs the
tests whose name contains it.

Two conventions to keep:

- **Test what a failure would cost, not what the code does.** Several tests
  carry a comment naming the bug they exist for; that comment is the reason the
  test is not deleted in a future refactor.
- **A guard against vacuous passing.** Several planner tests assert that the
  planner actually grouped something before asserting a property of the groups,
  because a planner returning one subject per batch satisfies most such loops
  trivially. Both of those guards were added after jev-lint flagged the test
  names for promising more than the bodies checked.

For anything involving verdicts, record and replay rather than mocking the API:
a rule's `evals/baseline.json` is its regression record, `jev-lint eval
--replay` re-scores it, and `run()` takes a `client` so a test can hand in a
fake that answers without a network. The records in `docs/data/` are the
measurements the docs quote, each replayable.
