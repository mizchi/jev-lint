// Join Jev answers to routed observations before comparing with the held-out labels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const [mode, corpus, directory, split, cutoff] = process.argv.slice(2);
assert.ok(["fit", "score"].includes(mode) && ["develop", "evaluation"].includes(split));
const read = path => JSON.parse(readFileSync(path, "utf8"));
const cases = read(corpus).filter(c => c.split === split);
const routes = read(join(directory, "decisions.json")).filter(r => r.split === split);
const record = read(join(directory, split, "text/rulepipe-commit-imperative/last.json"));
assert.equal(record.passes.length, 3);
assert.deepEqual(routes.map(r => r.id), cases.map(c => c.id));
const files = routes.filter(r => r.action === "judge").map(r => basename(r.subject)).sort();
const passes = record.passes.map(pass => {
  assert.deepEqual(pass.map(a => basename(a.file)).sort(), files);
  return new Map(pass.map(a => {
    assert.equal(a.rule, "rulepipe-commit-imperative");
    return [basename(a.file), a.value];
  }));
});
const rows = cases.map((c, i) => {
  const route = routes[i];
  const values = route.subject ? passes.map(p => p.get(basename(route.subject))) : [];
  const complete = values.length === 3 && values.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
  return { id: c.id, expected: c.expected.verdict, action: route.action, staticVerdict: route.verdict,
    expectedAction: c.expectedAction, values, mean: complete ? values.reduce((a,b) => a+b, 0) / 3 : null };
});
if (mode === "fit") {
  assert.equal(split, "develop");
  const judged = rows.filter(r => r.action === "judge");
  assert.ok(judged.every(r => r.mean !== null));
  const cleanTop = Math.max(...judged.filter(r => r.expected === "pass").flatMap(r => r.values));
  const badBottom = Math.min(...judged.filter(r => r.expected === "fail").flatMap(r => r.values));
  assert.ok(Number.isFinite(cleanTop) && Number.isFinite(badBottom));
  const threshold = cleanTop < badBottom ? (cleanTop + badBottom) / 2 : 0.7;
  console.log(JSON.stringify({ cleanTop, badBottom, separated: cleanTop < badBottom, threshold }, null, 2));
} else {
  const threshold = Number(cutoff);
  assert.ok(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1);
  const results = rows.map(r => {
    const predicted = r.mean === null ? r.staticVerdict : r.mean >= threshold ? "fail" : "pass";
    const flip = r.mean !== null && r.values.some(v => v >= threshold) && r.values.some(v => v < threshold);
    return { ...r, predicted, flip };
  });
  console.log(JSON.stringify({ split, threshold, model: record.model, draft: record.rules[0].draft,
    spent: record.spent, correct: results.filter(r => r.predicted === r.expected).length, total: results.length,
    semanticCorrect: results.filter(r => r.action === "judge" && r.expected === r.predicted).length,
    semanticTotal: files.length, flips: results.filter(r => r.flip).length,
    routeErrors: results.filter(r => r.expectedAction && r.expectedAction !== r.action).map(r => r.id), results }, null, 2));
}
