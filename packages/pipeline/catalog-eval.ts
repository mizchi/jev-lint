import { nextDecision, type DecisionTable } from "./decision-table.ts";
import { catalogRoute } from "./routes.ts";

type Vocabulary = typeof catalogRoute.facts;
type Category = Vocabulary["text"][number];
type Outcome = Exclude<Category, "abstain"> | "review";
export interface CatalogCase {
  id: string;
  pattern: string;
  catalog: Category;
  description: string;
  expected: Outcome;
}
export interface Reading { label: Category; tokens: number; ms: number }

function fromSource(source: keyof Vocabulary) {
  return [
    { when: [[source, "hardware"]], then: "hardware" },
    { when: [[source, "software"]], then: "software" },
  ] as const;
}
const catalogRows = fromSource("catalog");
const textRows = fromSource("text");

function summarize(rows: { outcome: Outcome; expected: Outcome; reading?: Reading }[]) {
  const auto = rows.filter(row => row.outcome !== "review");
  const wrong = auto.filter(row => row.outcome !== row.expected).length;
  const calls = rows.flatMap(row => row.reading ? [row.reading] : []);
  return { cases: rows.length, auto: auto.length, reviews: rows.length - auto.length, wrong,
    coverage: auto.length / rows.length, autoAccuracy: auto.length ? (auto.length - wrong) / auto.length : null,
    calls: calls.length, inputTokens: calls.reduce((n, call) => n + call.tokens, 0),
    serviceMs: calls.reduce((n, call) => n + call.ms, 0) };
}

export function scoreCatalog(cases: readonly CatalogCase[], answers: Readonly<Record<string, Reading>>) {
  if (!cases.length || new Set(cases.map(row => row.id)).size !== cases.length) throw Error("Expected nonempty cases with unique IDs");
  function evaluate(table: DecisionTable<Vocabulary, Outcome>) {
    const rows = cases.map(item => {
      const observations: Record<string, string> = { catalog: item.catalog };
      let reading: Reading | undefined;
      let result = nextDecision(table, observations);
      if ("need" in result) {
        if (result.need !== "text") throw Error("Unexpected fact " + result.need);
        if (item.description.trim()) {
          reading = answers[item.id];
          if (!reading || !Number.isSafeInteger(reading.tokens) || reading.tokens < 0 ||
            !Number.isFinite(reading.ms) || reading.ms < 0) throw Error("Missing or invalid observation: " + item.id);
        }
        observations.text = reading ? reading.label : "abstain";
        result = nextDecision(table, observations);
      }
      if (!("done" in result)) throw Error("Incomplete decision for " + item.id);
      return { id: item.id, pattern: item.pattern, expected: item.expected, outcome: result.done, reading };
    });
    const patterns = Object.fromEntries([...new Set(rows.map(row => row.pattern))].map(pattern =>
      [pattern, summarize(rows.filter(row => row.pattern === pattern))]));
    return { summary: summarize(rows), patterns, outcomes: Object.fromEntries(rows.map(row => [row.id, row.outcome])) };
  }
  return {
    catalog: evaluate({ ...catalogRoute, rows: catalogRows }),
    text: evaluate({ ...catalogRoute, rows: textRows }),
    fallback: evaluate({ ...catalogRoute, rows: [...catalogRows, ...textRows] }),
    consensus: evaluate(catalogRoute),
  };
}
