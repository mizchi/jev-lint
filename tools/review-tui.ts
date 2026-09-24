#!/usr/bin/env node
/** Browse recorded reviews and label cases without sending API requests. */
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initialTuiState, renderTui, updateTui, visibleAnswers, type TuiKey } from "../src/tui.ts";
import { buildViewerModel, toCalibrationLabels, type ViewerRunInput } from "../src/viewer.ts";

interface RunManifest {
  repo: string;
  revision: string;
  checkout: string;
  record: string;
  result: string;
  supplements?: string[];
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("review-tui needs an interactive terminal.\n");
  process.exit(2);
}

const manifestPath = resolve(process.argv[2] ?? "experiments/dogfood/tui.json");
const base = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { runs: RunManifest[] };
if (!Array.isArray(manifest.runs) || manifest.runs.length === 0) throw new Error("TUI manifest needs at least one run");

const inputs: ViewerRunInput[] = [];
for (const run of manifest.runs) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(run.repo) || !/^[a-f\d]{7,40}$/i.test(run.revision) || !run.checkout) {
    throw new Error(`invalid repository or revision: ${run.repo}@${run.revision}`);
  }
  const record = JSON.parse(await readFile(resolve(base, run.record), "utf8")) as ViewerRunInput["record"];
  const result = JSON.parse(await readFile(resolve(base, run.result), "utf8")) as ViewerRunInput["result"];
  const supplements = await Promise.all((run.supplements ?? []).map(async (path) =>
    JSON.parse(await readFile(resolve(base, path), "utf8")) as { answers: ViewerRunInput["record"]["answers"] },
  ));
  inputs.push({ repo: run.repo, revision: run.revision, record, result, supplements });
}
const datasets = buildViewerModel(inputs);
const git = promisify(execFile);
const sourceCache = new Map<string, string[]>();
const draftPath = resolve(base, "viewer-labels.local.json");
let labels: Record<string, string> = {};
try {
  const draft = JSON.parse(await readFile(draftPath, "utf8")) as { schema: string; decisions: Record<string, string> };
  if (draft.schema !== "jev-lint-tui-labels-1" || !draft.decisions || typeof draft.decisions !== "object") {
    throw new Error(`invalid label draft: ${draftPath}`);
  }
  labels = draft.decisions;
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

let state = initialTuiState();
let closed = false;
let pending = Promise.resolve();
async function sourceForSelection(): Promise<string[] | undefined> {
  if (state.screen !== "answers") return undefined;
  const row = visibleAnswers(datasets, state, labels)[state.rowIndex];
  if (!row) return undefined;
  const key = `${state.repoIndex}:${row.file}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const run = manifest.runs[state.repoIndex]!;
  try {
    const { stdout } = await git("git", ["-C", resolve(base, run.checkout), "show", `${run.revision}:${row.file}`], { maxBuffer: 16 * 1024 * 1024 });
    const lines = stdout.split(/\r?\n/);
    sourceCache.set(key, lines);
    return lines;
  } catch (error) {
    state.notice = `Source preview unavailable: ${String(error).slice(0, 100)}`;
    sourceCache.set(key, []);
    return [];
  }
}
const redraw = async () => {
  if (closed) return;
  const sourceLines = await sourceForSelection();
  if (!closed) process.stdout.write("\x1b[2J\x1b[H" + renderTui(
    datasets, state, labels, process.stdout.columns ?? 80, process.stdout.rows ?? 24, sourceLines,
    process.env.NO_COLOR === undefined && process.env.TERM !== "dumb",
  ));
};
const close = () => {
  if (closed) return;
  closed = true;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
};
async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
async function onKey(key: TuiKey): Promise<void> {
  if (closed) return;
  const result = updateTui(datasets, state, labels, key);
  state = result.state;
  if (result.action?.type === "quit") { close(); return; }
  if (result.action?.type === "label") {
    if (result.action.value === null) delete labels[result.action.key];
    else labels[result.action.key] = result.action.value;
    await atomicWrite(draftPath, { schema: "jev-lint-tui-labels-1", decisions: labels });
    state = updateTui(datasets, state, labels, { name: "noop" }).state;
    state.notice = "Label saved to viewer-labels.local.json";
  }
  if (result.action?.type === "export") {
    const data = datasets[result.action.repoIndex]!;
    const file = resolve(base, `labels-${data.repo.split("/")[1]}.json`);
    await atomicWrite(file, toCalibrationLabels(data, labels));
    state.notice = `Exported ${file}`;
  }
  await redraw();
}

emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("\x1b[?1049h\x1b[?25l");
process.stdin.on("keypress", (_text: string, key: TuiKey) => {
  pending = pending.then(() => onKey(key)).catch((error: unknown) => {
    close();
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
});
process.stdout.on("resize", () => { pending = pending.then(redraw); });
process.on("SIGINT", close);
process.on("SIGTERM", close);
pending = redraw();
