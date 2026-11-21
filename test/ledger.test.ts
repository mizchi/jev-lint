import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ledger, LEDGER_SCHEMA, ledgerFileName } from "../src/ledger.ts";
import { test } from "./harness.ts";

const num = (raw: unknown): number | null => (typeof raw === "number" ? raw : null);
const temp = () => mkdtempSync(join(tmpdir(), "jev-ledger-"));
const files = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort();

test("ledger: a write adds one new file sorted by key and never rewrites an existing file", () => {
  const dir = temp();
  try {
    const a = Ledger.load(dir, "t", num);
    a.put("b", 2); a.put("a", 1);
    const first = a.flush({ model: "m" });
    assert.ok(first);
    const lines = readFileSync(first!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines[0].schema, LEDGER_SCHEMA); assert.equal(lines[0].namespace, "t");
    assert.deepEqual(lines.slice(1).map((l) => l.key), ["a", "b"], "entries are sorted by key, one per line");
    const before = readFileSync(first!, "utf8");

    const b = Ledger.load(dir, "t", num);
    assert.equal(b.get("a"), 1);
    assert.equal(b.flush(), null, "a run that learned nothing writes nothing");
    b.put("c", 3); b.flush();
    assert.equal(files(dir).length, 2);
    assert.equal(readFileSync(first!, "utf8"), before, "earlier files are never touched");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: files from two branches merge as a union and the latest answer of a key wins", () => {
  const dir = temp();
  try {
    // Simulate two branches writing independently, then a merge: just both files.
    const left = Ledger.load(dir, "t", num), right = Ledger.load(dir, "t", num);
    left.put("shared", 1, "2026-01-01T00:00:00.000Z"); left.put("left", 10);
    right.put("shared", 2, "2026-01-02T00:00:00.000Z"); right.put("right", 20);
    left.flush(); right.flush();
    const merged = Ledger.load(dir, "t", num);
    assert.equal(merged.get("shared"), 2);
    assert.equal(merged.get("left"), 10); assert.equal(merged.get("right"), 20);
    assert.equal(new Set(files(dir)).size, 2, "file names do not collide");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: malformed lines, foreign schemas and other namespaces are misses, never throws", () => {
  const dir = temp();
  try {
    writeFileSync(join(dir, "20260101T000000000Z-00000000.jsonl"), `${JSON.stringify({ schema: LEDGER_SCHEMA, namespace: "t" })}\n{not json\n${JSON.stringify({ key: "ok", at: "2026-01-01T00:00:00.000Z", value: 1 })}\n${JSON.stringify({ key: "bad", at: "x", value: "nope" })}\n`);
    writeFileSync(join(dir, "20260101T000000000Z-00000001.jsonl"), `${JSON.stringify({ schema: "other", namespace: "t" })}\n${JSON.stringify({ key: "foreign", at: "2026-01-01T00:00:00.000Z", value: 9 })}\n`);
    writeFileSync(join(dir, "20260101T000000000Z-00000002.jsonl"), `${JSON.stringify({ schema: LEDGER_SCHEMA, namespace: "other" })}\n${JSON.stringify({ key: "elsewhere", at: "2026-01-01T00:00:00.000Z", value: 9 })}\n`);
    writeFileSync(join(dir, "notes.txt"), "ignored");
    const l = Ledger.load(dir, "t", num);
    assert.equal(l.get("ok"), 1);
    assert.equal(l.get("bad"), null); assert.equal(l.get("foreign"), null); assert.equal(l.get("elsewhere"), null);
    assert.ok(l.loadErrors.length >= 2);
    assert.equal(Ledger.load(join(dir, "missing"), "t", num).loadErrors.length, 0, "a missing ledger is empty, not an error");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: compaction keeps the latest live entry per key in one file and removes only what it read", () => {
  const dir = temp();
  try {
    const one = Ledger.load(dir, "t", num); one.put("k", 1, "2026-01-01T00:00:00.000Z"); one.put("dead", 0); one.flush();
    const two = Ledger.load(dir, "t", num); two.put("k", 2, "2026-01-02T00:00:00.000Z"); two.flush();
    const compactor = Ledger.load(dir, "t", num);
    // A file another branch adds after the compactor read the directory must survive.
    const late = Ledger.load(dir, "t", num); late.put("late", 7); const latePath = late.flush()!;
    const result = compactor.compact({ live: ["k", "late"] });
    assert.equal(result.kept, 1); assert.equal(result.dropped, 1); assert.equal(result.removed.length, 2);
    const left = files(dir);
    assert.equal(left.length, 2);
    assert.ok(left.includes(latePath.split("/").pop()!));
    const after = Ledger.load(dir, "t", num);
    assert.equal(after.get("k"), 2); assert.equal(after.get("dead"), null); assert.equal(after.get("late"), 7);
    const compacted = readFileSync(join(dir, left.find((n) => !latePath.endsWith(n))!), "utf8").split("\n")[0];
    assert.equal(JSON.parse(compacted).compacted, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: compaction without a live set only deduplicates, and an empty ledger compacts to nothing", () => {
  const dir = temp();
  try {
    assert.deepEqual(Ledger.load(dir, "t", num).compact(), { kept: 0, dropped: 0, removed: [], path: null });
    const a = Ledger.load(dir, "t", num); a.put("x", 1); a.flush();
    const b = Ledger.load(dir, "t", num); b.put("x", 2); b.put("y", 3); b.flush();
    const r = Ledger.load(dir, "t", num).compact();
    assert.equal(r.kept, 2); assert.equal(r.dropped, 0); assert.equal(files(dir).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: file names sort chronologically and stay unique within one millisecond", () => {
  const at = new Date("2026-11-22T01:02:03.004Z");
  const a = ledgerFileName(at), b = ledgerFileName(at);
  assert.match(a, /^20261122T010203004Z-[0-9a-f]{8}\.jsonl$/);
  assert.notEqual(a, b);
  assert.ok(ledgerFileName(new Date("2026-11-22T01:02:03.005Z")) > a.slice(0, 19));
  const dir = temp();
  try { mkdirSync(join(dir, "nested")); assert.equal(Ledger.load(dir, "t", num).loadErrors.length, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger: times compare as instants, and an older pending answer never displaces a newer stored one", () => {
  const dir = temp();
  try {
    writeFileSync(join(dir, "20260101T000000000Z-00000000.jsonl"), [
      JSON.stringify({ schema: LEDGER_SCHEMA, namespace: "t" }),
      JSON.stringify({ key: "k", at: "2026-01-01T00:30:00.000Z", value: 1 }),
    ].join("\n"));
    writeFileSync(join(dir, "20260101T000000001Z-00000000.jsonl"), [
      JSON.stringify({ schema: LEDGER_SCHEMA, namespace: "t" }),
      // 00:00 UTC: earlier, although its text sorts after the entry above.
      JSON.stringify({ key: "k", at: "2026-01-01T01:00:00+01:00", value: 2 }),
    ].join("\n"));
    const l = Ledger.load(dir, "t", num);
    assert.equal(l.get("k"), 1);
    l.put("k", 3, "2025-12-31T00:00:00.000Z");
    assert.equal(l.get("k"), 1, "an older answer recorded now does not win");
    assert.deepEqual(l.entries().map((e) => e.value), [1]);
    l.compact();
    assert.equal(Ledger.load(dir, "t", num).get("k"), 1, "compaction keeps the newer answer");
    l.put("k", 4); assert.equal(l.get("k"), 4, "a newer pending answer still wins");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
