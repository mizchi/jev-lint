type Vocabulary = Readonly<Record<string, readonly string[]>>;
type Fact<S> = Extract<keyof S, string>;
type Condition<S extends Vocabulary> = {
  [K in Fact<S>]: readonly [K, S[K][number]];
}[Fact<S>];

export interface DecisionTable<S extends Vocabulary, Result extends string> {
  readonly version: 1;
  readonly facts: S;
  readonly rows: readonly {
    readonly when: readonly [Condition<S>, ...Condition<S>[]];
    readonly then: Result;
  }[];
  readonly otherwise: Result;
}

export function nextDecision<S extends Vocabulary, R extends string>(
  table: DecisionTable<S, R>, observations: Readonly<Record<string, unknown>>,
): { need: Fact<S> } | { done: R } {
  if (table.version !== 1) throw Error("Unsupported decision table version");
  for (const [key, value] of Object.entries(observations)) {
    if (!Object.hasOwn(table.facts, key) || typeof value !== "string" || !table.facts[key].includes(value)) {
      throw Error("Unknown observation: " + key);
    }
  }
  for (const row of table.rows) {
    let missing: Fact<S> | undefined;
    let possible = true;
    for (const [key, value] of row.when) {
      if (!Object.hasOwn(observations, key)) missing ??= key;
      else if (observations[key] !== value) {
        possible = false;
        break;
      }
    }
    if (possible) return missing === undefined ? { done: row.then } : { need: missing };
  }
  return { done: table.otherwise };
}
