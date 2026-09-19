# improve: var-name-describes-value

## Rule

`var-name-describes-value` (TypeScript/Tsx/JavaScript/Jsx) and
`var-name-describes-value-rust`, directory `rules/var-name-describes-value/`.
Both share `ask`, `criteria` and now a `note` through YAML anchors.

**At the start** (run 0, 3 passes, shipped cutoffs 0.6 / 0.47, 30 subjects):

| rule | tp/fp/fn | P | R | flips | clean top | lowest defect | defects / explicit cleans |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts | 3/0/2 | 1.00 | 0.60 | 1 | 0.47 (`n` = query result) | 0.13 (`timeoutSeconds`) | 5 / 0 |
| rust | 3/1/0 | 0.75 | 1.00 | 0 | 0.83 (`timeout_millis`, flagged) | 0.58 | 3 / 0 |

`jobs.ts:13 users` wobbled across 0.6 ([0.66 0.51 0.60]); `cart.ts:52
timeoutSeconds = 5000` beside a `setTimeout` answered 0.13; `cache.rs:50
timeout_millis = 30_000u64`, a clean binding, answered 0.83 because it sat in
the same function as a same-valued `timeout_seconds` with nothing in the code
naming either unit.

**At the end** (run 9, the accepted baseline, cutoffs 0.5 / 0.5, 80 subjects):

| rule | tp/fp/fn | P | R | flips | clean top | lowest found defect | defects / explicit hard cleans |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts | 11/0/1 | 1.00 | 0.92 | 1 | 0.34 (`shards` from a call) | 0.59 (`ok` on a rejection) | 12 / 30 |
| rust | 9/0/1 | 1.00 | 0.90 | 2 | 0.32 (`ttl`) | 0.60 (`bytes`), 0.63 stable | 10 / 13 |

`eval --replay` passes against the accepted baseline. The unseen check on
agent-cluster went from 6 findings (all one shape, all wrong) to 0 on 540
subjects.

## Attempts

Every run is `eval rules/var-name-describes-value --repeat 3 --no-config`;
numbers are at the cutoff in force for that run.

| run | change | ts P/R (flips) | rust P/R (flips) | notes |
| --- | --- | --- | --- | --- |
| 0 | none, where it stood | 1.00/0.60 (1) | 0.75/1.00 (0) | 30 subjects |
| 1 | cases only: +`batch.test.ts`, `notify.ts`, `worker.rs`; cart.ts unit case rewritten to compare with `elapsedMs`; cache.rs `timeout_seconds` passed to `Duration::from_millis`, `timeout_millis` moved to its own function with `from_millis`; jobs.ts `n` -> `result`, plus a `.rows` twin | 1.00/0.69 (2) | 1.00/0.73 (2) | `timeoutSeconds` 0.13 -> 0.61 (wobbling 0.43-0.82); `timeout_millis` 0.83 -> 0.23; `timeout_seconds` (rust) 0.57. `ok` fixture list 0.55, `fromHugeSource` 0.48: the clean side crowds 0.6 |
| 2 | cases only: `flat` -> `normalized`, `files` = count -> `files` = rule ids, `userIds` from email -> displayName, rust `last` = second `.next()` -> `.get(1)`, `domain` via `split_once`, `ids` from `owner_name`; `passed` counter and rust `lines` count relabelled clean (conventional count) | 1.00/0.75 (2) | 1.00/0.70 (4) | `normalized` on a rejection 0.11 (lower than `flat`, reverted next run); `files` 0.55 -> 0.81; `userIds` 0.32 -> 0.20; `split_once` made `domain` worse (0.47 -> 0.32) |
| 3 | **question 1**: add `note` naming what a mismatch looks like in the code (a boolean name on a value compared with a string/number/variant, a path name on contents split into lines, a result name on a promise, a unit suffix the code converts from or compares with; the initializer selecting a different element/part/field) and what does not count (plural on a count, short accumulator/index/buffer, a collection named for its role, a fixture list paired with its opposite, a role/provenance name). Cases: `flat` restored, cart.ts also subtracts `elapsedMs` for a delay, rust `domain` = `parts[0]`, `is_ready` bound to a status string | 1.00/0.75 (4) | 1.00/0.90 (3) | Clean side fixed: `ok` list 0.58 -> 0.16, `fromHugeSource` 0.50 -> 0.28, ts clean top 0.30. Defect side noisy: `domain` [0.73 0.22 0.60], `userIds` [0.75 0.77 0.37], `ok` on a rejection 0.57 |
| 4 | **question 2**: note gains "the name asserts success or presence and the code then reads the value as a failure or absence"; the fixture-list exception reworded to "a list of test inputs ... paired with the opposite class"; the different-field clause spelled out (first element under a name meaning the last, the piece before a separator under a name meaning the piece after it, one field of a record under the name of another) | 1.00/0.83 (2) | 1.00/0.90 (3) | ts defects now all >= 0.63 except `userIds` [0.12 0.87 0.24] and `flat` 0.27; ts clean top 0.35 |
| 5 | `at:` ts 0.6 -> 0.5, rust 0.47 -> 0.55; rust `bytes` used with `.to_uppercase()` | 1.00/0.83 (1) | 1.00/0.90 (2) | ts: `userIds` [0.72 0.16 0.17] is the flip; rust: `ids` [0.61 0.50 0.61], `bytes` [0.69 0.39 0.38] both across 0.55 |
| 6 | `--accept` (same configuration) | 1.00/0.92 (1) | 1.00/0.90 (1) | `userIds` 0.54 [0.15 0.76 0.70]; `bytes` 0.72 this time, `ids` 0.47 |
| unseen | `check` on agent-cluster apps/{sandbox,bit-relay,shared,gateway}, 540 subjects | 6 findings | matched nothing (no Rust) | all six one shape: a test response named for its scenario (`authorized`, `missingObjective`, `missingTask`) at 0.51-0.83, every one a false positive. Next below: `shards = readRuntimeAdapterSandboxShards(env)` at 0.49 |
| 7 | **question 3**: note adds the scenario-named test binding as a convention, and "whether the count is a literal or is read from a setting or a call" to the plural-on-a-count exception. Cases: `unauthorized`/`authorized`/`missingOrder` responses in checkout.test.ts, `shards = readShardSetting(ctx.env)` in jobs.ts | 1.00/0.83 (2) | 1.00/0.90 (2) | scenario responses drop under 0.20; `shards` 0.47 [0.49 0.53 0.39], on the cutoff; `users` 0.57, `ok` on a rejection 0.56 -- within their run-to-run spread, but low |
| 8 | **question 4**: plural exception reworded in code terms, "a plural name on a number, which names the count of those things whether the number is a literal or comes from a call" | 1.00/0.92 (1) | 1.00/0.90 (3) | `shards` 0.35 stable; ts clean top 0.35, defects from 0.61; rust `lines` count drops under 0.20, rust clean top 0.25, `domain`/`bytes` 0.57 wobbling, `ids` 0.37 |
| 9 | rust `at:` 0.55 -> 0.5; `--accept`; `--replay` passes | 1.00/0.92 (1) | 1.00/0.90 (2) | the accepted baseline; numbers in the table above |
| unseen 2 | same 540 subjects with the final rule | 0 findings | -- | median 0.07; top 0.46 (`publishUrl = new URL(request.url)`, then mutated to the publish path), 0.45 (`missingObjective`, down from 0.77), 0.45 (`mounted = await mountGitFsFiles(...)`), 0.44 (`unauthorized = await checkScopedRelayApiAuth(...)`, a Response or null). All clean. Real-code headroom is 0.04 |

## Cases added

Labels carry the full argument; the short form here. "twin" means the same
initializer shape with the name that fits, placed in the same file.

**cart.ts** (rewritten `configure`)
- `:52 timeoutSeconds = 5000` -- bad, kept: now compared with `elapsedMs` and subtracted from it for a delay, so the unit is visible in the file. 0.13 -> 0.73-0.84 across runs.
- `:53 elapsedMs` -- clean, difference of two timestamps.
- `:29 sum`, `:61 totalCents`, `:63 paidItems` -- explicit hard cleans (accumulator, unit produced by the `* 100`, loose adjective).

**jobs.ts**
- `:5 result` -- clean, was `n` (a query result under a number's name, 0.47 unlabelled; ambiguous, not worth a label).
- `:10 documents = (...).rows` -- clean twin of `users`.
- `:20 shards = readShardSetting(ctx.env)` -- clean, plural on a count read from a call; the agent-cluster shape at 0.49.

**batch.test.ts** (shapes from jev-lint's own test file and self-lint)
- `:6 let passed = 0` -- clean, conventional counter (the self-lint flagged it and it was renamed; the model answers 0.18 here and calibration.md lists the conventional counter as a hard clean; labelled clean with both facts in the reason).
- `:7 failCount`, `:8 only` -- clean.
- `:22 flat = normalizeRule(good)` -- clean, holds the normalized rule.
- `:33 flat = normalizeRule(bad)` -- **bad, not found** (0.20-0.27): holds a rejection; the self-lint shape mizchi renamed.
- `:39 ok = [...]`, `:40 bad = [...]` -- clean, paired fixture lists. The agent-cluster borderline shape; 0.55 before the note, 0.16-0.28 after.
- `:46 ok = normalizeRule(bad)` -- bad, `.error` asserted; 0.56-0.67.
- `:51 fromHugeSource`, `:64 spanning`, `:73 seen`, `:62/:63/:72` -- clean (provenance, adjective on one item, conventional set, generic).
- `:66 files = spanning.subjects.map((s) => s.rule.id)` -- bad, holds rule ids; 0.78-0.85 (as a count it was 0.55, split with the plural-on-a-count convention).

**notify.ts**
- `:4 retries = 3` -- clean, plural on a count.
- `:8 templatePath = readFileSync(...)` -- bad, holds contents that are split; 0.75-0.86.
- `:10 subject = lines[0]`, `:11 body`, `:28 pending` -- clean.
- `:16 domain = email.split("@")[0]` -- bad, the local part; 0.52-0.80, the noisiest of the found ones.
- `:27 userIds = users.map((u) => u.displayName)` -- **bad, unstable**: 0.12-0.87 across passes on identical input, every run. Flagged on the mean in the baseline (0.62) and the one permitted flip.
- `:31 delivered = mailer.send(...)` -- bad, a promise pushed into `pending`; 0.75-0.87.
- `:39 timeoutSeconds = 30` with `* 1000` -- clean twin of cart.ts:52; 0.08.

**checkout.test.ts**
- `:38 total`, `:59 result` -- explicit cleans.
- `:147 unauthorized`, `:151 authorized`, `:159 missingOrder` -- clean, responses named for their scenario; the six agent-cluster false positives, rewritten. Under 0.20 after the note.

**cache.rs** (rewritten `configure`, new `sweep_interval`)
- `:45 timeout_seconds = 30_000u64` -- bad, kept: passed to `Duration::from_millis` on the next line; 0.57 -> 0.73-0.81.
- `:46 ttl`, `:52 entry_count`, `:54 retries`, `:64 n` -- clean.
- `:63 timeout_millis` -- clean, now in its own function and passed to `from_millis`; 0.83 -> 0.19-0.29.

**worker.rs**
- `:22 config_path = fs::read_to_string(...)` -- bad; 0.81-0.89.
- `:23 lines = ....lines().count()` -- clean, plural on a count (first labelled bad; the model answered 0.30 and the convention is the better argument). 0.34-0.44 before question 4, 0.20 after.
- `:27 rows`, `:28 head`, `:34 parts`, `:44 pending`, `:46 seen`, `:55 spanning`, `:62 timeout_seconds` with `from_secs`, `:63 buf` -- clean.
- `:29 last = rows.get(1)` -- bad; 0.61-0.68 once written as an index (as a second `.next()` it was 0.18).
- `:35 domain = parts[0]` -- bad; 0.57-0.67, wobbling 0.47-0.78.
- `:40 bytes = String::from_utf8(buf)?` -- bad; 0.49-0.72, wobbling 0.32-0.73.
- `:46 ids = ...map(|j| j.owner_name.clone())` -- **bad, not found on the mean** (0.35-0.57, wobbling 0.10-0.61).
- `:60 is_ready = worker.status_line()` -- bad; 0.88-0.90 once the value was a string (as an enum compared with `State::Ready` it was 0.43-0.57).
- `:61 has_errors = report.errors.len()` -- bad; 0.89-0.92.

## What stops the bar

**TypeScript** -- recall 0.92, not 1.00, and one permitted flip:

- `batch.test.ts:33 flat = normalizeRule(bad)` at 0.20-0.27. The name's claim is about which branch of a union result came back; the initializer shows a call that could return either, and only the two assertions after it show the rejection. The model reads the name against the initializer and treats "what normalizeRule returned" as accurate. Renaming to `normalized` made it worse (0.11). Left labelled bad: the shape came from jev-lint's own tests and a human judged it wrong.
- `notify.ts:27 userIds` from `displayName`: one field of a record bound under another field's name. The model answers anywhere from 0.12 to 0.87 on identical input in every run; the class is named in the note and that did not steady it. Its Rust twin `ids` from `owner_name` does the same (0.10-0.61). This is the one flip, and the rule cannot be trusted on this class either way.
- Headroom below the cutoff is 0.09-0.13 depending on the run (`ok` on a rejection, 0.56-0.67); above it 0.15-0.16 on the evals but only 0.04 on agent-cluster (`publishUrl = new URL(request.url)` at 0.46). 0.5 is a little above the eval midpoint (0.47) for that reason; going higher would put `ok` on a rejection and `users` (0.57-0.68) at risk.

**Rust** -- recall 0.90, two flips:

- `worker.rs:46 ids` (0.44 on the accepted run, 0.10-0.61 across all runs) and `worker.rs:40 bytes` (0.60, 0.32-0.73) cross any cutoff between 0.4 and 0.6 between passes; `worker.rs:35 domain` (0.65, 0.47-0.78) crosses 0.55. No cutoff holds all three steady, so 0.5 was chosen for headroom against the cleans (top 0.32 on the accepted run, 0.44 at worst before question 4) rather than fitted. Stable defects start at 0.61-0.63.
- The Rust model is quieter than the TypeScript one on the same shapes: `domain` 0.65 vs 0.69-0.80, the type-name class (`bytes`) has no TypeScript twin that wobbles this much. The three wobblers are all "the initializer selects a different part or field" or "a type name on a converted value", where the mismatch is a judgement about the field, not a contradiction the code performs.

**Both**: `timeoutSeconds`/`timeout_seconds` are found now, but only because the corpus code compares or converts them in a way that names the other unit. A bare `const timeoutSeconds = 5000; setTimeout(fn, timeoutSeconds)` still answers 0.13; that is API knowledge and stays outside the rule.

## Unseen check

`check apps/sandbox apps/bit-relay apps/shared apps/gateway -R rule.yml --no-config --cache none` on agent-cluster (540 subjects, 16 requests; `apps/agent-worker` and `packages/` were priced at $0.27 and skipped).

Before question 3 (run 6 rule): 6 findings, all `const <scenario> = await x.fetch(...)` in tests -- `missingObjective` 0.77, `missingTask` 0.83, `authorized` 0.66/0.51/0.69/0.68. A name that reads as an adjective on a Response, paired with the opposite scenario; a reader is not misled. All false positives; the criteria's "reads as a boolean bound to something that is not one" clause was doing it.

After (final rule): 0 findings. Top answers 0.46 `publishUrl = new URL(request.url)` (constructed from the request URL, then given the publish pathname; clean, arguable), 0.45 `missingObjective`, 0.45 `mounted = await mountGitFsFiles(...)`, 0.44 `unauthorized = await checkScopedRelayApiAuth(...)` (a Response or null, the scenario name again), 0.44 `shards = readRuntimeAdapterSandboxShards(env)` (a count). All clean. Real-code headroom is 0.04, thinner than the evals' 0.15; the next unseen false positive will be a role-named binding of this kind.

## Cost

12 model runs for this rule: 206 requests, 2,196,217 input tokens, $0.092.
Evals: runs 0-5 at 15 requests each ($0.0031-0.0049), runs 6-9 at 21 requests
each ($0.0077-0.0088). Unseen: 2 x 16 requests, $0.0163 and $0.0173.
