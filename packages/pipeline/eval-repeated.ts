import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { askTeacher, model, receiptKey, validReceipt, type Receipt } from "./cover-teacher.ts";
import { collectHistory, compileCover, contract, covers, instanceKey, solveGroup, type Group, type TeacherEvent } from "./repeated-task.ts";

interface Job { id: string; groups: Group[] }
interface Corpus { development: Group[]; test: Job[] }
interface Archive { contract: string; model: string; receipts: Record<string, Receipt> }
const read = (path: string | URL) => JSON.parse(readFileSync(path, "utf8"));
const { values } = parseArgs({ options: {
  corpus: { type: "string" }, replay: { type: "string" }, record: { type: "string" },
  require: { type: "string", default: "verified" }, history: { type: "string" }, "trace-out": { type: "string" },
  run: { type: "string" }, live: { type: "boolean" }, budget: { type: "string", default: "2" },
} });
if (values.record && (values.replay || values.run || values.live)) throw Error("Record historical calls separately from replay or deployment");
if (values.live && !values.run) throw Error("Use --live with --run JOB.json");
if (values["trace-out"] && !(values.record || values.live)) throw Error("Trace output requires live teacher calls");
if (values.history && values.record) throw Error("Use history for evaluation or deployment, and record for baseline collection");
if (!["verified", "local"].includes(values.require)) throw Error("Choose --require verified or local");
const budget = Number(values.budget);
if (!values.budget.trim() || !Number.isSafeInteger(budget) || budget < 0) throw Error("Expected a nonnegative expansion budget");
const corpus: Corpus = read(values.corpus ?? new URL("./cover-cases.json", import.meta.url));
const jobs: Job[] = values.run ? [read(values.run)] : corpus.test;
if (!Array.isArray(jobs) || !jobs.length || new Set(jobs.map(j => j.id)).size !== jobs.length ||
  jobs.some(j => !j.id || !Array.isArray(j.groups) || !j.groups.length)) throw Error("Expected nonempty jobs with unique IDs and groups");
const imported: TeacherEvent[] | undefined = values.history
  ? readFileSync(values.history, "utf8").split(/\r?\n/).filter(s => s.trim()).map(line => JSON.parse(line))
  : undefined;
const devKeys = imported ? collectHistory(imported, model).seen : new Set(corpus.development.map(instanceKey));
const held = new Set<string>();
for (const job of jobs) for (const group of job.groups) {
  const key = instanceKey(group);
  if (!values.run && (devKeys.has(key) || held.has(key))) throw Error("Duplicate development or held-out instance");
  held.add(key);
}

const path = values.record ?? values.replay ?? new URL("./cover-replay.json", import.meta.url);
const archive: Archive = values.record && !existsSync(path) ? { contract, model, receipts: {} } : read(path);
if (archive.contract !== contract || archive.model !== model || !archive.receipts ||
  !Object.values(archive.receipts).every(validReceipt)) throw Error("Incompatible teacher archive");
async function request(group: Group) {
  const receipt = await askTeacher(group);
  if (values["trace-out"]) appendFileSync(values["trace-out"], JSON.stringify({ contract, model, group, ...receipt }) + "\n");
  return receipt;
}
if (values["trace-out"]) mkdirSync(dirname(values["trace-out"]), { recursive: true });
if (values.record) {
  mkdirSync(dirname(values.record), { recursive: true });
  for (const group of [...corpus.development, ...jobs.flatMap(job => job.groups)]) {
    const key = receiptKey(group);
    if (archive.receipts[key]) continue;
    archive.receipts[key] = await request(group);
    const tmp = values.record + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(archive, null, 2) + "\n");
    renameSync(tmp, values.record);
  }
}
function recorded(group: Group) {
  const receipt = archive.receipts[receiptKey(group)];
  if (!receipt) throw Error("Missing historical observation for " + receiptKey(group));
  return receipt;
}
const historical = collectHistory(imported ?? corpus.development.map(group =>
  ({ group, contract, model, selected: recorded(group).selected })), model);
const compiled = historical.verified.length >= 2 ? compileCover(historical.verified, budget) : null;
function usage() { return { calls: 0, inputTokens: 0, outputTokens: 0, serviceMs: 0 }; }
function add(total: ReturnType<typeof usage>, r: Receipt) {
  total.calls++;
  total.inputTokens += r.inputTokens;
  total.outputTokens += r.outputTokens;
  total.serviceMs += r.ms;
}
const baseline = { ...usage(), verified: 0 };
const fallback = usage();
let escalationAttempts = 0;
const reports = [];
for (const job of jobs) {
  const groups = [];
  for (const group of job.groups) {
    if (!values.run) {
      const r = recorded(group);
      add(baseline, r);
      if (covers(group, r.selected)) baseline.verified++;
    }
    const result = await solveGroup(group, compiled?.program ?? null, async input => {
      escalationAttempts++;
      const receipt = values.live ? await request(input) : recorded(input);
      add(fallback, receipt);
      return receipt.selected;
    }, historical.witnesses);
    groups.push(result);
  }
  reports.push({ id: job.id, groups, fullyLocal: groups.every(g => g.route === "local"),
    verified: groups.every(g => g.route === "local" || g.route === "history" || g.route === "teacher") });
}
const results = reports.flatMap(job => job.groups);
const gate = { require: values.require, passed: reports.every(j => values.require === "local" ? j.fullyLocal : j.verified) };
if (!gate.passed) process.exitCode = 1;
console.log(JSON.stringify({ contract, model, gate, fallbackSource: values.live ? "live" : "replay",
  history: { calls: historical.calls, distinct: historical.seen.size, verified: historical.verified.length }, compiled, baseline: values.run ? undefined : baseline,
  fallback: { ...fallback, attempts: escalationAttempts },
  summary: { jobs: reports.length, fullyLocalJobs: reports.filter(j => j.fullyLocal).length,
    verifiedJobs: reports.filter(j => j.verified).length, groups: results.length,
    reused: results.filter(g => g.route === "history").length, local: results.filter(g => g.route === "local").length, teacher: results.filter(g => g.route === "teacher").length,
    infeasible: results.filter(g => g.route === "infeasible").length, unresolved: results.filter(g => g.route === "unresolved").length },
  jobs: reports }, null, 2));
