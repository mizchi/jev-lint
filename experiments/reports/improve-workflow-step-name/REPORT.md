# improve: workflow-step-name

## Rule

`workflow-step-name`, `experiments/rule-candidates/workflow-step-name/`.
GitHub Actions step `name:` versus its `run:`/`uses:`; `subject: node`,
`state: bare`, unchanged.

| | start | end |
| --- | --- | --- |
| subjects | 33 (10 bad, 23 clean, 17 hard) | 68 (18 bad, 50 clean, ~35 distinct hard after dedup) |
| `at:` | 0.44 | 0.62 (fitted midpoint of the final run) |
| P / R | 1.00 / 1.00 | 1.00 / 1.00 |
| flips | 0 | 0 |
| bad band | 0.56-0.95 | 0.68-0.96 |
| clean band | 0.03-0.30 | 0.03-0.27, plus one at 0.42 (0.42-0.59 across runs) |
| headroom clean / bad | 0.14 / 0.12 | 0.20 / 0.06 on the accepted run |

The start numbers reproduced the baseline exactly (step 1). The gap was one
subject wide on each side: `Install dependencies` + `npm audit fix --force`
at 0.56 and the summarising `Bump version` clean at 0.30.

## Attempts

0. Cases only, criteria unchanged: +35 subjects (8 bad, 27 clean) in
   `deploy.yml` and `checks.yml`. P 0.95 R 1.00 at 0.44, 1 flip. The
   subtle-extra-effect class confirmed as a class, not a sample: `Run
   migrations` + seed 0.43 (miss, flip), `audit fix` 0.56. `Verify MoonBit`
   0.32 and `Setup MoonBit` 0.30 (spread 0.21) were the highest cleans.
   Every other new defect >= 0.68, every other new clean <= 0.25.
1. Criteria: replaced the closed list ("publishes, pushes, deploys,
   deletes, commits") with the class -- "the script does the named thing
   and then also a separate operation with an effect of its own that the
   name does not cover" -- with five shapes; named the intent-vs-mechanism
   cleans (version print as verification, polling loop as wait, `git diff
   --exit-code` as check, opaque task-runner recipe); reworded the
   summarising-name exemption as "every command is part of doing that
   operation" and added the ensure-creates-what-is-missing shape. P 0.95
   R 1.00, fitted 0.50. `audit fix` 0.56 -> 0.81, seed 0.43 -> 0.79,
   `Smoke test staging` 0.68 -> 0.89, `Build`+commit+push 0.69 -> 0.86.
   But the "ensure" shape spilled onto `Check production queues` (0.74 ->
   0.54) and `Setup MoonBit` rose to 0.45 (false positive).
2. Criteria: check/verification/assertion "changes nothing", so a check
   that creates what is missing or fixes what it finds is a mismatch; the
   exemption is spelled "ensure" or "provision". Added a clause that a
   setup action's identifier not being the tool's name is not evidence.
   P 0.95 R 1.00, fitted 0.69. `Check production queues` 0.54 -> 0.77,
   every bad >= 0.75. `Setup MoonBit` 0.45 -> 0.63 (worse: naming the
   topic makes the model look at "moonup" and decide it is another tool),
   `Test` + `--coverage` drifted 0.11 -> 0.39 on "counts even when it is
   short".
3. Criteria: identifier clause rephrased ("spells only part of it is an
   installer published under its own name, not evidence of a different
   tool"); "a flag or option on the named command is not a second
   operation" replaces "even when it is short". P 0.95 R 1.00. `Test`
   back to <= 0.20; `Setup MoonBit` 0.59.
4. Criteria: identifier clause removed entirely (every version of it made
   the case worse). P 0.95 R 1.00 at 0.44, fitted 0.62. `Setup MoonBit`
   0.53 [0.58 0.49 0.53]; all other cleans <= 0.25; bads 0.71-0.96.
5. `at:` 0.44 -> 0.62 (fitted midpoint). Accept run: P 1.00 R 1.00, 0
   flips; `Setup MoonBit` 0.42 [0.34 0.49 0.44], `Bump version` + canary
   publish 0.68, `Check production queues` 0.72. `--replay` passes.

Final criteria are in `rule.yml`; the `note` is unchanged.

## Cases added

`workflows/deploy.yml` (modelled on agent-cluster's release-cluster.yml):

- 25 clean, conventional Checkout (dedups with the other copies).
- 28 clean hard, `Setup pnpm` over pnpm/action-setup.
- 33 clean hard, `Setup just` over taiki-e/install-action@just: the
  action's name is not the tool's. 0.08.
- 36 clean hard, `Setup MoonBit` over chawyehsu/setup-moonup@v1. The
  stopper, see below.
- 39 clean hard, `Verify MoonBit` over `moon version --all`: the version
  print is the verification. 0.32 -> 0.19 after attempt 1 named the shape.
- 42 clean hard, `Install dependencies` over `pnpm install
  --frozen-lockfile`.
- 45 clean hard, `Build MoonBit JS modules` over `pnpm build`: the name says
  more than the mechanism shows. 0.25-0.27, the highest ordinary clean.
- 48 clean hard, `Release gate` over an opaque `just release-check`.
- 51 clean hard, `Ensure staging queues` over a list-then-create-if-missing
  script: ensure means create what is absent.
- 64 clean hard, `Ensure staging token is configured` over a shell check
  that exits 1.
- 72 clean hard, `Sync staging API token` over two `wrangler secret put`.
- 78 bad, `Check production queues` creates the queue when missing: a check
  changes nothing.
- 85 bad, `Run unit tests` then `wrangler deploy`: a deploy after the tests.
- 90 clean hard, `Deploy staging cluster` over `just release-cluster-staging`.
- 93 bad, `Smoke test staging` runs the production smoke recipe: wrong
  target.
- 102, 105 clean, conventional Checkout / Setup Node.js.
- 111 bad, `Sync production API token` also deploys the worker: a second
  operation after the named one.
- 119 bad, `Run migrations` also executes a seed file: a seed after the
  migrations. The subtle-extra-effect class; 0.43 -> 0.78.
- 124 clean hard, `Push image` over docker build + docker push: the build
  is how the image exists to push.
- 129 clean, `Comment deployment URL` over `gh pr comment`.

`workflows/checks.yml`:

- 11, 14, 19 clean, conventional Checkout / Setup pnpm / Setup Node.js.
- 25 bad, `Setup Deno` over actions/setup-python: a different tool. 0.96.
- 30 clean hard, install.
- 33 clean hard, `Fail if lockfile changed` over `git diff --exit-code`:
  intent vs mechanism. 0.06.
- 36 clean hard, terse `Typecheck` over an opaque `just typecheck`.
- 39 bad, `Check types` runs tsc then `eslint --fix`: a check that rewrites.
- 44 clean hard, terse `Lint` over `biome check .`.
- 47 bad, `Build` then `git add dist`, commit, push.
- 54 clean hard, `Assert clean tree` over `test -z "$(git status
  --porcelain)"`.
- 57 clean hard, `Run control plane smoke` over a `just` recipe with flags.
- 60 clean hard, `Wait for preview` over a curl polling loop.
- 68 clean, upload-artifact of a junit report.

## What stops the bar

Two cases bound the gap, and together leave it 0.15 wide across runs
where the bar wants 0.20:

- `workflows/deploy.yml:36`, labelled clean, `Setup MoonBit` over
  `chawyehsu/setup-moonup@v1`: 0.53 and 0.42 on the two runs with the
  final criteria (0.34-0.59 per pass), 0.45-0.63 with three phrasings of a
  clause about action identifiers, 0.30 with the original criteria. The
  model does not know that moonup is MoonBit's toolchain installer; it
  reads "moonup" as a different tool. That is API knowledge, and every
  clause that tried to supply it made the case worse by drawing attention
  to the identifier. `Setup just` over `taiki-e/install-action@just` is at
  0.08 because "just" appears in the identifier. The label stays clean:
  the step is what agent-cluster actually runs, and on that file in an
  all-clean batch the same step answers 0.15 (see below).
- `workflows/nightly.yml:28`, labelled bad, `Bump version` over `npm
  version prerelease` + `npm publish --tag canary`: 0.68-0.75 across every
  run. The model half-reads a canary publish as part of a nightly bump.

At `at: 0.62` the accepted run has 0.20 of headroom on the clean side and
0.06 on the bad side; the previous run with the same criteria had 0.09
and 0.09. No decision flipped in either run and no mean is within 0.03 of
the cutoff. Precision and recall are 1.00 on 18 defects and 50 cleans.

## Unseen check

`check /Users/mz/ghq/github.com/mizchi/agent-cluster/.github/workflows -R
rule.yml --no-config --cache none --retry 3` with the final rule, decided
at 0.3 to see every value: **0 findings over 39 steps**, highest 0.27
(`Build MoonBit JS modules` over `pnpm build`), then 0.19 (`Ensure staging
token is configured`), 0.18 (`Deploy production cluster` over `just
release-cluster`). The three `Setup MoonBit` steps answer 0.15, against
0.42-0.59 in the corpus file that batches the same step beside eight
defects -- a batch of defects makes the model more suspicious of its
neighbours, which is worth knowing when reading corpus numbers. Nothing
in agent-cluster's workflows is misnamed, and the rule agrees.

## Cost

Eight paid runs: baseline eval 9 requests; five evals of 68 subjects at
15 requests each (cases, attempts 1-4); the accept run, 15; the unseen
check, 12. **111 requests, ~836k input tokens, $0.035.** The two
`Setup MoonBit` phrasings (attempts 2 and 3) were the part that bought
nothing.
