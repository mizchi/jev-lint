// Print per-subject values across passes from a calibrate record.
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const by = new Map();
for (const [i, p] of r.passes.entries()) for (const f of p) {
  const k = `${f.rule}|${f.file.replace(/.*corpus\//, "")}:${f.line}|${f.captured?.NAME ?? ""}`;
  if (!by.has(k)) by.set(k, []);
  by.get(k)[i] = f.value;
}
for (const [k, v] of [...by.entries()].sort()) console.log(k.padEnd(70), v.map((x) => (x == null ? "  -  " : x.toFixed(2))).join(" "));
