export const contract = "ci/select-cover@1";
export interface Group {
  required: string[];
  limit: number;
  suites: { id: string; covers: string[] }[];
}
export interface Program { order: "listed" | "gain"; budget: number }

export function validateGroup(group: Group) {
  const strings = (xs: unknown): xs is string[] => Array.isArray(xs) && xs.every(x => typeof x === "string" && x.length > 0);
  if (!group || !strings(group.required) || !Array.isArray(group.suites) || !Number.isSafeInteger(group.limit) || group.limit < 0 ||
    !group.suites.every(s => s && typeof s.id === "string" && s.id.length > 0 && strings(s.covers)) ||
    new Set(group.suites.map(s => s.id)).size !== group.suites.length) throw Error("Invalid cover task");
}

export function instanceKey(group: Group) {
  validateGroup(group);
  const tags = (values: string[]) => [...new Set(values)].sort();
  const suites = group.suites.map(s => JSON.stringify([s.id, tags(s.covers)])).sort();
  return JSON.stringify([contract, group.limit, tags(group.required), suites]);
}

export function covers(group: Group, answer: unknown): answer is string[] {
  if (!Array.isArray(answer) || answer.length > group.limit || new Set(answer).size !== answer.length) return false;
  const known = new Map(group.suites.map(s => [s.id, s.covers]));
  const covered = new Set<string>();
  for (const id of answer) {
    const tags = known.get(id);
    if (!tags) return false;
    for (const tag of tags) covered.add(tag);
  }
  return group.required.every(tag => covered.has(tag));
}

export function search(group: Group, program: Program) {
  validateGroup(group);
  if (!Number.isSafeInteger(program.budget) || program.budget < 0 ||
    !["listed", "gain"].includes(program.order)) throw Error("Invalid search program");
  let expansions = 0;
  let exhausted = false;
  function visit(remaining: string[], chosen: string[]): string[] | null {
    if (!remaining.length) return chosen;
    if (chosen.length === group.limit) return null;
    const candidates = group.suites.filter(suite => suite.covers.includes(remaining[0]));
    const gain = (suite: Group["suites"][number]) => remaining.filter(tag => suite.covers.includes(tag)).length;
    if (program.order === "gain") candidates.sort((a, b) => gain(b) - gain(a));
    for (const suite of candidates) {
      if (expansions >= program.budget) { exhausted = true; break; }
      expansions++;
      const found = visit(remaining.filter(tag => !suite.covers.includes(tag)), [...chosen, suite.id]);
      if (found) return found;
    }
    return null;
  }
  const answer = visit([...new Set(group.required)], []);
  return { answer, expansions, exhausted };
}

export function compileCover(development: readonly Group[], budget: number) {
  if (new Set(development.map(instanceKey)).size !== development.length || development.length < 2) {
    throw Error("Compilation requires at least two distinct verified historical instances");
  }
  const candidates = (["listed", "gain"] as const).map(order => {
    const program = { order, budget };
    const runs = development.map(group => search(group, program));
    return { program, verified: runs.filter((run, i) => covers(development[i], run.answer)).length,
      expansions: runs.reduce((n, run) => n + run.expansions, 0) };
  });
  candidates.sort((a, b) => b.verified - a.verified || a.expansions - b.expansions);
  return { program: candidates[0].program, candidates };
}

export interface TeacherEvent {
  contract: string; model: string; group: Group; selected: unknown;
}

export function collectHistory(events: readonly TeacherEvent[], model: string) {
  const seen = new Set<string>();
  const verified = new Map<string, Group>();
  const witnesses = new Map<string, string[]>();
  let calls = 0;
  for (const event of events) {
    if (event.contract !== contract || event.model !== model) continue;
    calls++;
    const key = instanceKey(event.group);
    seen.add(key);
    if (covers(event.group, event.selected)) {
      verified.set(key, event.group);
      witnesses.set(key, event.selected);
    }
  }
  return { calls, seen, witnesses, verified: [...verified.values()] };
}

/** The task owns its acceptance predicate. A transport error and a rejected answer both leave it unresolved. */
export async function verifiedFallback<Input, Answer>(input: Input, teacher: (input: Input) => Promise<unknown>,
  accepts: (input: Input, answer: unknown) => answer is Answer) {
  let answer: unknown;
  try { answer = await teacher(input); }
  catch { return { route: "unresolved" as const, answer: null, reason: "teacher unavailable" }; }
  if (accepts(input, answer)) return { route: "teacher" as const, answer };
  return { route: "unresolved" as const, answer: null, reason: "invalid witness" };
}

export async function solveGroup(group: Group, program: Program | null, teacher: (group: Group) => Promise<unknown>,
  witnesses?: ReadonlyMap<string, string[]>) {
  validateGroup(group);
  const previous = witnesses?.get(instanceKey(group));
  if (covers(group, previous)) return { route: "history" as const, answer: previous, expansions: 0 };
  const local = program ? search(group, program) : { answer: null, exhausted: true, expansions: 0 };
  if (covers(group, local.answer)) return { route: "local" as const, answer: local.answer, expansions: local.expansions };
  // Complete enumeration with no witness is a proof of infeasibility for this contract.
  if (!local.exhausted) return { route: "infeasible" as const, answer: null, expansions: local.expansions };
  return { ...await verifiedFallback(group, teacher, covers), expansions: local.expansions };
}
