import type { DecisionTable } from "./decision-table.ts";

const category = ["hardware", "software", "abstain"] as const;
const catalogFacts = { catalog: category, text: category };
export const catalogRoute = {
  version: 1,
  facts: catalogFacts,
  rows: [
    { when: [["catalog", "hardware"], ["text", "hardware"]], then: "hardware" },
    { when: [["catalog", "software"], ["text", "software"]], then: "software" },
  ],
  otherwise: "review",
} as const satisfies DecisionTable<typeof catalogFacts, "hardware" | "software" | "review">;

const manifestFacts = { check: ["defect", "clean", "defer"], model: ["defect", "clean"] } as const;
export const manifestRoute = {
  version: 1,
  facts: manifestFacts,
  rows: [
    { when: [["check", "defect"]], then: "defect" },
    { when: [["check", "clean"]], then: "clean" },
    { when: [["model", "defect"]], then: "defect" },
  ],
  otherwise: "clean",
} as const satisfies DecisionTable<typeof manifestFacts, "defect" | "clean">;
