import { strict as assert } from "node:assert";
import { initialTuiState, renderTui, updateTui, visibleAnswers, visibleFiles } from "../src/tui.ts";
import type { ViewerDataset, ViewerRow } from "../src/viewer.ts";
import { test } from "./harness.ts";

function row(overrides: Partial<ViewerRow>): ViewerRow {
  return {
    key: "first", ruleKey: "typescript/fn-name-promises", rule: "fn-name-promises", ask: "The name misleads.",
    file: "src/a.ts", line: 10, endLine: 20, kind: "noul", value: 0.9, confidence: null,
    cutoff: 0.6, severity: "warning", arm: "located", reported: true, nearCutoff: false,
    message: "The name misleads.", ...overrides,
  };
}

const dataset: ViewerDataset = {
  repo: "mizchi/example", revision: "abcdef0",
  summary: { subjects: 3, findings: 1, missing: 0, unpaired: 0, degraded: 0 },
  files: [
    { path: "src/a.ts", subjects: 2, findings: 1, nearCutoff: 1, unpaired: false, topConcern: "fn-name-promises" },
    { path: "src/b.ts", subjects: 1, findings: 0, nearCutoff: 1, unpaired: false, topConcern: null },
  ],
  rows: [
    row({}),
    row({ key: "second", rule: "catch-hides-failure", ruleKey: "typescript/catch-hides-failure", line: 15, endLine: 18, value: 0.58, reported: false, nearCutoff: true, message: null }),
    row({ key: "third", file: "src/b.ts", line: 5, endLine: 8, value: 0.59, reported: false, nearCutoff: true, message: null }),
  ],
};

test("tui: files and answers change with the selected view and search", () => {
  const data = [dataset];
  let state = initialTuiState();
  assert.deepEqual(visibleFiles(data, state, {}).map((f) => f.path), ["src/a.ts"]);
  state = updateTui(data, state, {}, { name: "f" }).state;
  assert.equal(state.view, "boundary");
  assert.deepEqual(visibleFiles(data, state, {}).map((f) => f.path), ["src/a.ts", "src/b.ts"]);
  state = { ...state, query: "b.ts" };
  assert.deepEqual(visibleFiles(data, state, {}).map((f) => f.path), ["src/b.ts"]);
  assert.deepEqual(visibleAnswers(data, { ...state, screen: "answers" }, {}).map((r) => r.key), ["third"]);
});

test("tui: navigation, labelling, and export are explicit actions", () => {
  const data = [dataset];
  let state = updateTui(data, initialTuiState(), {}, { name: "return" }).state;
  assert.equal(state.screen, "answers");
  const labelled = updateTui(data, state, {}, { name: "1" });
  assert.deepEqual(labelled.action, { type: "label", key: "first", value: "defect" });
  state = updateTui(data, state, { first: "defect" }, { name: "f" }).state;
  assert.equal(state.view, "boundary");
  assert.deepEqual(updateTui(data, state, {}, { name: "e" }).action, { type: "export", repoIndex: 0 });
  assert.match(renderTui(data, state, { first: "defect" }, 100, 25), /Near cutoff/);
  assert.match(renderTui(data, state, { first: "defect" }, 100, 25), /The name misleads/);
});

test("tui: selected answer shows pinned source lines and can scroll through them", () => {
  const data = [dataset];
  const source = Array.from({ length: 35 }, (_, i) => `source line ${i + 1}`);
  let state = updateTui(data, initialTuiState(), {}, { name: "return" }).state;
  assert.match(renderTui(data, state, {}, 100, 25, source), /10  source line 10/);
  state = updateTui(data, state, {}, { name: "]" }).state;
  assert.equal(state.sourceOffset, 6);
  assert.match(renderTui(data, state, {}, 100, 25, source), /16  source line 16/);
});

test("tui: color distinguishes findings, boundary answers, selection, and human labels", () => {
  const data = [dataset];
  const files = renderTui(data, initialTuiState(), {}, 100, 25);
  assert.match(files, /\x1b\[7;31m[^\n]*src\/a\.ts/);

  let state = updateTui(data, initialTuiState(), {}, { name: "f" }).state;
  state = updateTui(data, state, {}, { name: "return" }).state;
  const colored = renderTui(data, state, { second: "clean" }, 100, 25);
  assert.match(colored, /\x1b\[7;32m[^\n]*L15/);
  assert.match(colored, /~ near cutoff/);

  const plain = renderTui(data, state, { second: "clean" }, 100, 25, undefined, false);
  assert.doesNotMatch(plain, /\x1b\[[\d;]*m/);
  assert.match(plain, /L15/);
});
