// Print per-subject answers from a record, joined with labels, sorted by value.
import { readFileSync } from "node:fs";
const [rec, labelsPath] = process.argv.slice(2);
const r = JSON.parse(readFileSync(rec, "utf8"));
const labels = labelsPath ? JSON.parse(readFileSync(labelsPath, "utf8")) : {};
const passes = Array.isArray(r.passes) && r.passes.length ? r.passes : [r.answers];
const key = (a) => `${a.rule}|${a.file}`;
const agg = new Map();
for (const pass of passes) for (const a of pass) {
  const v = typeof a.value === "number" ? a.value : (a.answer?.value);
  const rule = a.rule ?? a.subject?.rule?.id; const file = a.file ?? a.subject?.file;
  const k = `${rule}|${file}`;
  if (!agg.has(k)) agg.set(k, { rule, file, vals: [] });
  if (typeof v === "number") agg.get(k).vals.push(v);
}
const rows = [...agg.values()].map((x) => {
  const lab = (labels[x.file] ?? []).find((l) => l.rule === x.rule)?.label ?? labels.$default ?? "clean";
  const mean = x.vals.reduce((a, b) => a + b, 0) / x.vals.length;
  return { ...x, lab, mean, spread: Math.max(...x.vals) - Math.min(...x.vals) };
});
for (const rule of [...new Set(rows.map((r) => r.rule))]) {
  console.log(`\n${rule}`);
  for (const x of rows.filter((r) => r.rule === rule).sort((a, b) => b.mean - a.mean))
    console.log(`  ${x.mean.toFixed(2)}  ${x.lab.padEnd(5)}  ${x.file.split("/").pop().padEnd(20)} [${x.vals.map((v) => v.toFixed(2)).join(" ")}]`);
}
