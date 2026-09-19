import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogSink, consume, createLogger, loadConfig, plan, stagedFiles, subjects } from "./log_sink.ts";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

test("prune removes entries older than the retention window", async () => {
  const sink = new LogSink({ retentionMs: 1000 });
  // Append two events, one on each side of the window.
  await sink.append({ level: "info", message: "old", at: 0 });
  await sink.append({ level: "info", message: "new", at: 5000 });

  const pruned = await sink.prune({ now: 5000 });
  assert.equal(pruned, 1);

  // Verify only the new one remains.
  const events = await sink.query({});
  assert.equal(events.length, 1);
  assert.equal(events[0].message, "new");
});

test("query returns newest first", async () => {
  const sink = new LogSink({ retentionMs: 60_000 });
  await sink.append({ level: "info", message: "first", at: 1 });
  await sink.append({ level: "error", message: "second", at: 2 });

  const events = await sink.query({});
  // newest first
  assert.equal(events[0].message, "second");
  assert.equal(events[1].message, "first");
});

test("config: the file is found by walking up from a nested directory", () => {
  // Resolved, because process.cwd() is: on macOS the temp dir is a symlink
  // under /var and cwd reports the /private/var target.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "log-sink-")));
  const here = process.cwd();
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "log-sink.yaml"), "retention: 5m\n");
    process.chdir(join(dir, "a", "b"));
    assert.equal(loadConfig()?.retentionMs, 300_000);
  } finally {
    process.chdir(here);
  }
});

test("createLogger is a no-op without a sink binding", async () => {
  // A worker deployed without LOG_SINK bound used to throw on its first log
  // line and take the request down with it. Logging must never be the reason
  // a request fails.
  const logger = createLogger({} as never, "test-worker");
  await logger.info("hello");
  await logger.error("still fine");
});

test("poll: the consumer stops after two empty polls", async () => {
  let polls = 0;
  const fetchImpl = async (url: string) => {
    if (url.includes("/poll")) {
      polls += 1;
      if (polls <= 2) {
        // First two polls return an open issue.
        return jsonResponse({ ok: true, messages: [{ kind: "issue", id: "issue:1" }] });
      }
      return jsonResponse({ ok: true, messages: [] });
    }
    return jsonResponse({ ok: true });
  };
  const seen = await consume({ fetch: fetchImpl, maxEmpty: 2 });
  assert.equal(seen.length, 2);
  assert.equal(polls, 4);
});

test("staged review sees only what the commit will contain", async () => {
  // A pre-commit hook runs `review --staged`. Before this, that also swept in
  // every untracked file -- not part of the commit -- and, with a configured
  // paths:, scanned the whole tree to discard most of it.
  const { execFileSync } = await import("node:child_process");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "log-sink-git-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(dir, "tracked.ts"), "export const a = 1;\n");
  git("add", "tracked.ts");
  writeFileSync(join(dir, "untracked.ts"), "export const b = 2;\n");
  const files = await stagedFiles(dir);
  assert.deepEqual(files, ["tracked.ts"]);
});

test("batches never exceed the request budget", () => {
  const batches = plan(subjects(40), { budget: 8_000 });
  // Against the BUDGET, not the ceiling: the ceiling is what the server
  // enforces, the budget is the ceiling less the margin that absorbs the
  // estimate's undercount. Packing to the ceiling passes here and loses
  // verdicts on the server.
  for (const b of batches) {
    if (b.subjects.length === 1) continue; // irreducible: nothing left to split
    assert.ok(b.estimatedTokens <= 8_000, `batch of ${b.subjects.length} over budget`);
  }
});

test("grouping per rule yields one batch per rule", () => {
  const batches = plan(subjects(6, { rules: ["a", "b"] }), { budget: 8_000, axis: "rule" });
  assert.ok(batches.some((x) => x.subjects.length > 1), "the planner must actually group");
  // "Grouped per rule" is a claim about the batch COUNT: two rules, two
  // batches, whatever files the subjects came from. Asserting only that no
  // batch mixes rules left "rule a spread over three batches" passing.
  assert.equal(batches.length, 2, "one batch per rule, since neither rule fills a batch");
  for (const x of batches) {
    assert.equal(new Set(x.subjects.map((s) => s.rule)).size, 1);
  }
});
