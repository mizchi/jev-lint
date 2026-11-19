import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { nextDecision } from "../../packages/pipeline/decision-table.ts";

const state = Annotation.Root({
  policy: Annotation(),
  observations: Annotation(),
  outcome: Annotation(),
});

export function createCatalogGraph(path) {
  return new StateGraph(state)
    .addNode("route", ({ policy, observations }) => {
      const decision = nextDecision(policy, observations);
      if ("done" in decision) return { outcome: decision.done };
      const answer = interrupt(decision.need);
      return { observations: { ...observations, [decision.need]: answer } };
    })
    .addEdge(START, "route")
    .addConditionalEdges("route", ({ outcome }) => outcome === undefined ? "route" : END)
    .compile({ checkpointer: SqliteSaver.fromConnString(path) });
}
