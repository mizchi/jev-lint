# Decision pipeline (Experimental)

**Experimental.** The decision-table format, APIs and CLI flags may change between revisions. Run the examples from a repository checkout.

The manifest inspector measures cost, classification accuracy and elapsed time for a static-first lint pipeline. The support-ticket experiment below explores a different dimension, recursive partitioning of a long input.

## Inspect package manifests

From the repository root:

```sh
just pipeline-inspect package.json packages/pipeline/package.json
just pipeline-inspect --provider jev --evolve --rounds 4
just pipeline-inspect --provider jev --benchmark --repeat 3
just pipeline-inspect --provider jev --budget 0
```

The first command uses an offline lexical fallback. Select `--provider jev` for TypeSafe Jev. The inspector reads package names and descriptions and reports paths whose descriptions fail to identify a concrete purpose. A missing description or a normalized description identical to the name is a static finding. Every other item goes through the active learned rules and then the fallback. Choose `--mode static` for just the built-in checks plus fallback, or `--mode model` for the fallback alone. A normal inspection uses the policy already saved for that provider.

### Cache and retries

The local SQLite database at `.runs/inspection.sqlite` holds observed decisions and the active policy. `--db` selects another database. The key includes the fallback identity, cutoff, question and exact fields seen by the model. A changed description gets a new decision. Re-running after interruption picks up confirmed observations; failures and missing verdicts stay retryable. Network failures, HTTP 429 and 5xx retry with exponential backoff up to `--retries` (default 2). Every attempt consumes the invocation's shared `--budget`. An exhausted budget returns `complete: false`; authentication errors and exhausted retries exit with an error. A response lost before the local commit can incur another provider charge.

### Evolve the inspection policy

`--evolve` learns from `manifests.json` by default. Supply another corpus with `--input corpus.json`; each row has a unique ID, package name, optional description, boolean `expected` (true means a defect), and a `split` of `train`, `validation` or `test`. Ordinary path-based inspection needs no labels.

Each iteration proposes word-prefix rules of two to four tokens supported by at least two agreeing training examples. It replays the candidate on validation observations, requires fewer fallback calls, and rejects increases in false positives, false negatives, estimated cold USD or recorded service time. Among eligible candidates it prefers accuracy, then lower USD and service time. It appends one rule, atomically replaces the active decision list in SQLite, then uses that list in the next iteration. It stops at a fixed point or the round limit. The report includes each accepted rule and its before/after metrics. Concurrent writers detect a changed policy. Use a separate database for independent experiments.

Only the declarative decision list is rewritten. The final test split is evaluated after rule selection. Prefixes can still overgeneralize on unseen packages. A run with the offline fallback increased held-out accuracy from 6/9 to 9/9 on the included synthetic corpus.

### KPI measurements

Cold benchmark on November 19, 2026 with TypeSafe `jev-1.14.0`, eight training, seven validation and nine held-out synthetic manifests. Each arm ran three times with a fresh local decision cache and rotating order. The time is the median wall time for inspecting all nine manifests, including static checks, lookup, provider I/O and aggregation.

| Policy | Correct | Fallback calls per pass | Estimated USD per pass | Median wall time |
| --- | ---: | ---: | ---: | ---: |
| Model only | 9/9 | 9 | 0.000134694 | 2.023 s |
| Built-in checks + model | 9/9 | 7 | 0.000105462 | 1.469 s |
| Evolved checks + model | 9/9 | 4 | 0.000060438 | 0.822 s |

The first evolution run, including validation and the held-out model comparison, cost an estimated USD 0.000224952. A warm active replay used four cached decisions and zero remote calls. `coldUsd` uses input-token usage and the Jev client's configured price. `serviceMs` sums recorded fallback durations. These allow comparison of policies on the same evidence even during replay. `execution.observedUsd` and `execution.wallMs` describe the current invocation. Costs cover successful observations with reported usage. `--benchmark` deliberately remeasures all arms with isolated temporary caches and a shared request budget.

## Support-ticket experiment

Find every unresolved duplicate settled payment in a collection of independent support tickets. The model answers one question about the tickets in front of it. TypeScript controls traversal, input limits, the call budget and the final list of ticket IDs.

## Run from the repository root

```sh
just pipeline                                      # offline lexical baseline
just pipeline --provider jev --group-size 1         # exhaustive baseline
just pipeline --provider jev --group-size 4 --budget 3
just pipeline --provider jev --group-size 4         # resume
just pipeline --provider jev --group-size 4 --budget 0  # replay only
```

Live calls use TypeSafe Jev and read `TYPESAFE_API_KEY`. The sample in `cases.json` is synthetic. To supply tickets, pass `--input tickets.json` with an array of objects containing a unique string `id` and a string `text`. Add a boolean `expected` to every ticket to enable scoring. Only IDs and text reach the decision function.

Group size 1 asks about every ticket. Larger groups ask whether **any** ticket qualifies. A group score below `--prune-below` (default 0.1) skips the group. Otherwise the runner visits both halves, in order. A single ticket scores positive at 0.5 or higher. Both cutoffs are experiment settings. The runner splits a group before asking if its serialized records exceed 8,192 UTF-8 bytes. An oversized individual ticket fails validation before the first call. The predicate must be decidable within an individual ticket. Joining evidence across tickets would require a different workflow.

The call budget applies to new decisions per invocation. On exhaustion the runner returns `complete: false`, partial matches and no quality metrics. SQLite commits each valid score before traversal continues. The checkpoint key covers provider identity, question and ordered input. Repeating the command reconstructs the traversal using saved scores. A crash after the provider responds but before commit can repeat the outstanding request. Use separate `--db` files or `--db :memory:` for cold comparisons. The default database under `.runs/` is shared across strategies, so matching leaves can be reused.

## Measurements

Cold runs against TypeSafe `jev-1.14.0` on the 16 tickets in this directory (2 positives), November 19, 2026. The lexical baseline uses the same individual-ticket cutoff.

| Method | Decisions | Input tokens | True positives | False positives | False negatives |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lexical, group size 4 | 16 | 0 | 2 | 2 | 0 |
| Jev, individual tickets | 16 | 6,051 | 2 | 0 | 0 |
| Jev, group size 4 | 12 | 5,118 | 2 | 0 | 0 |

A replay of the grouped run made zero provider calls. The offline scaling test uses an exact synthetic decision function and finds both positives among 4,096 tickets in 148 decisions (group size 32). It tests traversal and termination. Live model quality is measured only on the 16-ticket example. A false negative at a parent can hide every positive below it. Dense positives can make the tree more expensive than the exhaustive baseline.

## Related implementations and the next comparison

- TypeSafe's WorkflowEvals implements invoice processing, customer-service routing and agent-trace review. Its expense example delegates receipt interpretation to typed questions and applies the amount threshold in code. Its runner saves cases and resumes interrupted runs. Our decision function and traversal can be evaluated separately in the same way. [WorkflowEvals](https://github.com/typesafe-ai/WorkflowEvals) · [Expense example](https://evals.typesafe.ai/invoice-processing)
- Dorfman's group testing screens a pool before testing its members. The experiment uses recursive bisection after a positive screen. Its central empirical question is whether a model can reliably recognize one positive among many negatives. [Dorfman, 1943](https://www.jstor.org/stable/2235930)
- Recursive Language Models let a model inspect external context through a REPL and issue subqueries. Here code chooses each split. A further experiment could give the model a finite choice of partition strategies under the same input and call budgets and score its final ticket IDs. [RLM authors' implementation](https://github.com/alexzhang13/rlm)
- DSPy's MIPRO optimizes instructions and demonstrations against a downstream metric. A comparable experiment here would tune the question, group size and pruning threshold on a development corpus, freeze them, then compare recall and input tokens on held-out cases. Include rare positives at different positions, resolved lookalikes and dense-positive groups. The 16 worked examples provide a smoke test for this protocol. [MIPRO paper](https://hai.stanford.edu/research/optimizing-instructions-and-demonstrations-for-multi-stage-language-model-programs)

## Cloudflare execution design

For a scheduled batch, start a Cloudflare Workflow per immutable input shard. Put large input manifests in R2 and pass the object key and content hash to the Workflow. Add an Agent when a client needs to start a run, subscribe to progress, or pause and resume it. The documented Agent API starts and tracks an `AgentWorkflow` with `runWorkflow()`. [Agents and Workflows](https://developers.cloudflare.com/agents/concepts/workflows/) · [Run Workflows](https://developers.cloudflare.com/agents/agent-class/run-workflows/)

The traversal in `pipeline.ts` uses Web Crypto and a `DecisionStore` interface. The Node CLI supplies SQLite and the Jev client. For a Worker adapter, wrap the external fetch and persistent score update in a named `step.do` keyed by the decision hash. Persist accepted scores by hash for replay across workflow instances, and keep the TypeSafe key in a Worker secret. Return a score per step and a result reference per shard. Record distinct run and shard IDs for progress. A failed step can retry the external request before its score becomes durable. [Workflow retry semantics](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

With one step per decision and a group of size N, a fully expanded tree costs up to 2N−1 steps. Reserve headroom for input and result steps when sizing shards. Cloudflare documents 1,024 steps per Free workflow, a 1 MiB event payload and a 1 MiB non-stream step result. Before deploying, test a forced failure between response and persistence and compare the resumed IDs against local replay on the same frozen scores. Cloud execution remains a design proposal. [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)

## A portable decision table inside an AI workflow

A third pattern routes products using a category from the catalog and a classification of the product description. Agreement assigns the category. Disagreement or an explicit abstention sends the item for review. An absent observation asks the host for the next fact. The example accepts supplied answers and can be run offline.

```sh
just pipeline-route --catalog hardware                  # {"need":"text"}
just pipeline-route --catalog hardware --text hardware  # {"done":"hardware"}
just pipeline-route --catalog hardware --text software  # {"done":"review"}
just pipeline-route --catalog abstain                   # {"done":"review"}
```

[decision-table.ts](./decision-table.ts) evaluates an ordered list of conjunctions over a finite vocabulary. A known mismatch eliminates a row, even when an earlier fact in that row is missing. The first possible row either returns an outcome or requests its first missing fact. If all rows fail, the table returns its fallback. Row order and condition order are part of the policy. The first-match behavior has a precedent in DMN's FIRST hit policy. [DMN hit policies](https://docs.camunda.io/docs/components/modeler/dmn/decision-table-hit-policy/)

[routes.ts](./routes.ts) has two JSON-serializable policies authored in typed TypeScript. One uses catalog and text labels. The other demonstrates the existing manifest inspector's static-first routing with the vocabulary `defect | clean | defer`. The compiler checks the built-in tables, and the evaluator checks observations at runtime. Importing independently authored JSON would also need a table loader that checks the schema, allowed operations and version before evaluation.

### Where to separate the library

| Component | Owns |
| --- | --- |
| Portable decision library | Fact vocabulary, ordered rules, outcomes, deterministic evaluation of partial observations. The prototype's evaluator has no runtime imports. |
| Application such as jev-lint | Input extraction, Jev questions, label meanings, rule proposals, labelled corpora, thresholds and promotion criteria. |
| Workflow host | Resolving each requested fact, provider access, execution budgets, retries, persistence, human review and concurrency. |

The evaluator can be called as `nextDecision(policy, observations)` inside an existing library's step. Persist the policy revision and observations with the run. When a fact is requested, the host resolves it and evaluates again. A crash after an external request but before persistence can repeat that request. Give one layer ownership of retries and count attempts there. Keep the run checkpoint distinct from the reusable observation cache: include the input content, resolver version, prompt and model in the observation identity. Pin a policy revision for replay, and record the transition to each promoted revision during evolution.

| Host | Integration to try |
| --- | --- |
| Mastra | A typed workflow step evaluates the table. Branch on the returned fact or outcome. Suspend or resume in the review branch. [Control flow](https://mastra.ai/docs/workflows/control-flow) · [Suspend and resume](https://mastra.ai/blog/resumeworkflows) |
| LangGraph JS | A node evaluates the policy over state. Conditional edges route fact requests; a checkpointer preserves thread progress. Dynamic fan-out suits the ticket partitioner. [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) · [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) |
| Cloudflare Workflows | Keep pure evaluation between durable steps and wrap each external resolver in a named step. An Agent can expose progress and accept review decisions. [Workflow execution rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) · [Agents with Workflows](https://developers.cloudflare.com/agents/concepts/workflows/) |

The [standalone LangGraph example](../../examples/langgraph/README.md) uses a SQLite checkpointer. Start with `catalog=hardware`, exit when the graph requests `text`, then resume from another process with `text=software` to get `review`. The checkpoint stores the policy used at start. A regression test starts a thread with a different disagreement outcome and verifies that the same outcome is returned after restart. Install the example's dependencies in its own directory. [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

For these experiments, an embeddable decision library has a smaller contract than a general workflow engine. Recursive partitioning needs a collection, split strategy and traversal budget. Evolution needs labelled splits and a KPI gate. Both can call a decision table while keeping their own control flow. Separate npm publication makes sense once a second application imports the same core and a durable-host run reproduces the local trace after interruption. The current private package is a place to test that boundary.

### Compare catalog routing policies

```sh
just pipeline-route-eval
just pipeline-route-eval --details
just pipeline-route-eval --record packages/pipeline/.runs/new-catalog.json
just pipeline-route-eval --replay packages/pipeline/.runs/new-catalog.json
```

The default command replays the bundled [Jev observations](./catalog-replay.json) offline. Only `--record` contacts TypeSafe Jev. Each nonempty description is classified once, using its text alone. Empty descriptions abstain locally. All policies use the same observations, so the comparison measures how the routing decision changes the outcome.

The [synthetic corpus](./catalog-cases.json) has two cases for each of seven patterns: consistent sources, stale catalog metadata, misleading listing copy, an absent catalog category, an empty description, a mixed bundle requiring review, and a stale upstream feed shared by both sources. The reference outcome comes from a separate fictional fulfillment record or bundle policy. `--details` reports metrics per pattern and the outcome of each case. A changed model, question or input invalidates the recording.

| Policy | Automatically routed | Wrong among automatic | Sent for review | Jev calls | Estimated USD | Recorded model time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Catalog only | 11/14 | 6/11 | 3 | 0 | 0 | 0 s |
| Description only | 10/14 | 4/10 | 4 | 12 | 0.000193 | 2.138 s |
| Description when catalog abstains | 13/14 | 6/13 | 1 | 2 | 0.000032 | 0.378 s |
| Require agreement | 4/14 | 2/4 | 10 | 10 | 0.000161 | 1.760 s |

The agreement policy deferred both mixed bundles and all four cases with a single misleading source. Its two automatic errors were the shared-feed cases. These numbers describe a deliberately balanced stress suite. Estimating production accuracy or workload requires the real frequency of each pattern. Cases sent for review have no assumed reviewer verdict or cost. Accuracy among automatic decisions is null when a pattern sends every case for review.

USD uses the observed input tokens and the recorded Jev input rate. Time sums the observed request durations for the lookups each policy needs under serial cold execution. Local routing time, human review time and cache replay time are outside that measure.

## Can a repeated high-end task be formalized?

The `ci/select-cover@1` experiment models a recurring CI planning request. For each environment in a release, select at most K distinct test suites whose declared coverage includes every required tag. Many selections can be correct. The verifier checks the actual IDs, the limit and the union of the selected suites' tags. Correctness here depends on the supplied coverage declarations accurately describing the suites.

```sh
just pipeline-repeat-eval --budget 2 --require verified
just pipeline-repeat-eval --budget 2 --require local   # fails: one held-out group needed help
just pipeline-repeat-eval --budget 8 --require local
```

A job is decomposed by environment. Each environment has its own suite limit. Within a group, the local program takes an uncovered requirement, visits suites that cover it and recurses on the remaining obligations. This is RLM-inspired subproblem decomposition implemented in TypeScript. The DSPy-inspired compilation step compares two candidate programs on verified historical examples, choosing the program with the most valid answers, then the fewest branch expansions. The model-managed REPL of RLM and the DSPy compiler are outside this implementation. The branch budget is set before evaluation; the held-out jobs are disjoint from development instances.

### Measure substitution separately from recovery

Three distinct development requests were answered by `gpt-5.5-2026-04-23`. With two expansions, input order solved one development instance and ordering by uncovered tags gained solved all three. The chosen program ran on three fresh jobs containing five environment tasks. The high-end baseline also saw each of these five inputs separately. The bundled [receipts](./cover-replay.json) and [inputs](./cover-cases.json) make the comparison replayable offline.

| Route on held-out inputs | Verified groups | Fully local jobs | High-end calls | High-end input / output tokens | Recorded high-end service time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Always high-end | 5/5 | 0/3 | 5 | 572 / 308 | 9.607 s |
| Two expansions then high-end | 5/5 (4 local) | 2/3 | 1 | 139 / 111 | 2.401 s |
| Eight expansions then high-end | 5/5 (5 local) | 3/3 | 0 | 0 / 0 | 0 s |

The mixed storage job was also executed with a fresh live fallback. Its storage group exhausted the budget and the teacher supplied a valid pair; its smoke group finished locally. The table sums the original model observations requested by each route. It excludes training, local CPU and human time. Sample size is five and the work specification is synthetic.

**Guarantee.** Every accepted selection passes the same independent checker, regardless of who proposed it. If exhaustive search finishes without a witness, the group is infeasible: any valid solution must include a suite covering the first remaining tag, and the search visits every such choice. Budget exhaustion prevents that inference and triggers one teacher request for that group. An invalid or missing teacher answer leaves that group unresolved; sibling groups still run. The CLI exits unsuccessfully when any group lacks a witness. The stricter local gate also requires every witness to come from the local program. An independent subset enumerator tests all 512 three-suite/three-tag matrices at four limits for both search orders. The eight-expansion result applies to the evaluated corpus. New semantic tasks need their own acceptance criterion; model agreement alone cannot supply this guarantee.

### Run new jobs and learn from history

`--run` reads one job of the form used under `test` in the corpus. The program and fallback take only the current group as input. The enclosing job, expected answers and other environments are not needed by the provider. The high-end adapter uses the OpenAI Responses API and `OPENAI_API_KEY`. The local program and replay need no API key.

```sh
# Use the bundled development examples, record only real calls made during deployment.
just pipeline-repeat-eval --run job.json --live --trace-out history.jsonl

# Fit from your own calls. An empty history starts in teacher-only mode for previously unseen inputs.
touch history.jsonl
just pipeline-repeat-eval --run job.json --history history.jsonl --live --trace-out history.jsonl

# Collect an all-teacher reference for a new disjoint development/test corpus.
just pipeline-repeat-eval --corpus corpus.json --record receipts.json
just pipeline-repeat-eval --corpus corpus.json --replay receipts.json --require local
```

A JSONL event has `contract`, `model`, `group` and `selected`. History ingestion groups by explicit task contract and provider model. It counts invocations, deduplicates equivalent suite inventories, and admits only distinct inputs with verified witnesses for fitting. At least two verified distinct instances are needed for compilation. A repeated request with identical obligations and inventory reuses its independently checked witness (the report counts it as `reused`). It supplies only one development example and earns no credit toward the local-only generalization gate. Arbitrary untagged chat transcripts require an upstream extraction step. Use a fresh holdout when evaluating an imported history; overlapping inputs are rejected. Baseline recording checkpoints each completed model response to disk. Normal execution asks the teacher only on a local miss or a cold start.
