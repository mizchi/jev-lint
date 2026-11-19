export interface Sample {
  id: string;
  name: string;
  description?: string;
  expected?: boolean;
}
export interface Observation { defect: boolean; usd: number; ms: number }
export interface Rule { prefix: string; defect: boolean }

function words(text: string) {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function facts(item: Sample) {
  const tokens = words(item.description ?? "");
  const name = words(item.name);
  const nameOnly = tokens.length === name.length && tokens.every((word, i) => word === name[i]);
  const prefixes = [];
  for (let length = 2; length <= Math.min(tokens.length, 4); length++) {
    prefixes.push(tokens.slice(0, length).join(" "));
  }
  return { emptyOrName: !tokens.length || nameOnly, prefixes };
}

export function staticVerdict(input: ReturnType<typeof facts>, rules: readonly Rule[]) {
  if (input.emptyOrName) return true;
  return rules.find(rule => input.prefixes.includes(rule.prefix))?.defect;
}

export function evaluate(items: readonly Sample[], observations: ReadonlyMap<string, Observation>, rules: readonly Rule[] | null) {
  let correct = 0, labelled = 0, falsePositives = 0, falseNegatives = 0;
  let coldUsd = 0, serviceMs = 0, modelCalls = 0;
  const matches: string[] = [];
  for (const item of items) {
    let defect = rules === null ? undefined : staticVerdict(facts(item), rules);
    if (defect === undefined) {
      const observation = observations.get(item.id);
      if (!observation) throw Error("Missing model observation for " + item.id);
      defect = observation.defect;
      coldUsd += observation.usd;
      serviceMs += observation.ms;
      modelCalls++;
    }
    if (defect) matches.push(item.id);
    if (item.expected === undefined) continue;
    labelled++;
    if (item.expected === defect) correct++;
    else if (defect) falsePositives++;
    else falseNegatives++;
  }
  return { accuracy: labelled ? correct / labelled : null, labelled, falsePositives, falseNegatives,
    coldUsd, serviceMs, modelCalls, staticCallsAvoided: items.length - modelCalls, matches };
}

function proposals(train: readonly Sample[], rules: readonly Rule[]) {
  const support = new Map<string, { positive: number; negative: number }>();
  for (const item of train) {
    const input = facts(item);
    if (staticVerdict(input, rules) !== undefined) continue;
    for (const prefix of input.prefixes) {
      const votes = support.get(prefix) ?? { positive: 0, negative: 0 };
      if (item.expected) votes.positive++;
      else votes.negative++;
      support.set(prefix, votes);
    }
  }
  const candidates: Rule[] = [];
  for (const [prefix, { positive, negative }] of support) {
    if (positive + negative >= 2 && !(positive && negative)) candidates.push({ prefix, defect: positive > 0 });
  }
  return candidates.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
}

export function evolve(train: readonly Sample[], validation: readonly Sample[], observations: ReadonlyMap<string, Observation>,
  initial: readonly Rule[], rounds: number, onRewrite?: (previous: readonly Rule[], next: readonly Rule[]) => void) {
  if (!Number.isSafeInteger(rounds) || rounds < 0) throw Error("Invalid round limit");
  if (![train, validation].every(rows => rows.length && rows.every(item => typeof item.expected === "boolean"))) {
    throw Error("Evolution requires labelled training and validation data");
  }
  let rules = [...initial];
  let current = evaluate(validation, observations, rules);
  const history = [];
  for (let i = 0; i < rounds; i++) {
    let best: { rule: Rule; score: typeof current } | undefined;
    for (const rule of proposals(train, rules)) {
      const score = evaluate(validation, observations, [...rules, rule]);
      if (score.modelCalls >= current.modelCalls || score.falsePositives > current.falsePositives ||
        score.falseNegatives > current.falseNegatives || score.coldUsd > current.coldUsd || score.serviceMs > current.serviceMs) continue;
      if (!best || score.accuracy! > best.score.accuracy! ||
        (score.accuracy === best.score.accuracy && (score.coldUsd < best.score.coldUsd ||
          (score.coldUsd === best.score.coldUsd && score.serviceMs < best.score.serviceMs)))) best = { rule, score };
    }
    if (!best) break;
    const next = [...rules, best.rule];
    onRewrite?.(rules, next);
    rules = next;
    history.push({ rule: best.rule, before: current, after: best.score });
    current = best.score;
  }
  return { rules, history };
}
