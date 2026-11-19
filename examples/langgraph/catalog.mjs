import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Command } from "@langchain/langgraph";
import { nextDecision } from "../../packages/pipeline/decision-table.ts";
import { catalogRoute } from "../../packages/pipeline/routes.ts";
import { createCatalogGraph } from "./graph.mjs";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true, options: { db: { type: "string", default: "catalog.sqlite" } },
  });
  const [action, first, answer] = positionals;
  const start = action === "start" && positionals.length === 2;
  if (!start && !(action === "resume" && positionals.length === 3)) {
    throw Error("Usage: node catalog.mjs [--db PATH] start CATEGORY | resume THREAD CATEGORY");
  }
  const graph = createCatalogGraph(values.db);
  const thread = start ? randomUUID() : first;
  const config = { configurable: { thread_id: thread } };
  let input;
  if (start) {
    input = { policy: catalogRoute, observations: { catalog: first } };
    nextDecision(input.policy, input.observations);
  } else {
    const state = await graph.getState(config);
    const pending = state.tasks.flatMap(task => task.interrupts ?? [])[0];
    if (!pending) throw Error("No pending decision for thread " + thread);
    // Validate before passing the answer to the resumable interrupt.
    nextDecision(state.values.policy, { ...state.values.observations, [pending.value]: answer });
    input = new Command({ resume: answer });
  }
  const result = await graph.invoke(input, config);
  const pending = result.__interrupt__?.[0];
  console.log(JSON.stringify(pending ? { thread, need: pending.value } : { thread, done: result.outcome }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
