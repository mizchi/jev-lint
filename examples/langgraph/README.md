# Resume a catalog decision with LangGraph

This example uses the **Experimental** decision pipeline in `packages/pipeline`.

This standalone example runs the pipeline's [catalog policy](../../packages/pipeline/routes.ts) inside a LangGraph node. It asks for a missing category, checkpoints to a local SQLite database, and exits. Another Node process can supply the answer using the thread ID. The example takes category labels from the command line and needs no model key.

From the repository root, install the example on Node 24 or later:

```sh
cd examples/langgraph
pnpm install --frozen-lockfile
node catalog.mjs start hardware
```

The command prints `{"thread":"…","need":"text"}`. Copy its thread ID into the next command:

```sh
node catalog.mjs resume THREAD_FROM_START software
```

The result is `{"thread":"…","done":"review"}` because the two categories disagree. Passing `hardware` instead would complete that pending run with `hardware`. Starting with `abstain` immediately returns `review`. Each start creates a new thread. Use the same working directory for both commands or pass the same absolute path via `--db`.

[graph.mjs](./graph.mjs) stores the decision table and observations in graph state. On resume the node evaluates the **stored table**, so edits to the default catalog policy apply to new threads. Resuming requires an evaluator compatible with the stored DSL version. The CLI validates an answer before submitting it to the interrupt; a typo leaves the thread pending. [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) · [SQLite checkpointer](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite)

Run `pnpm test` in this directory for the cross-process test. It also starts a thread with an older policy and checks that the original disagreement outcome survives restart. LangGraph, its SQLite driver and their lockfile belong to this example.
