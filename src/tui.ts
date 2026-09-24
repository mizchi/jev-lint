/** Terminal navigation over recorded review answers; I/O stays in the command. */
import type { ViewerDataset, ViewerFile, ViewerRow } from "./viewer.ts";

export type TuiView = "findings" | "boundary" | "all" | "unlabeled";
export interface TuiState {
  repoIndex: number;
  fileIndex: number;
  rowIndex: number;
  sourceOffset: number;
  screen: "files" | "answers";
  view: TuiView;
  query: string;
  rule: string;
  prompt: "search" | "rule" | null;
  promptText: string;
  notice: string;
}
export interface TuiKey {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}
export type TuiAction =
  | { type: "quit" }
  | { type: "export"; repoIndex: number }
  | { type: "label"; key: string; value: "defect" | "clean" | "unsure" | null };

const VIEWS: TuiView[] = ["findings", "boundary", "all", "unlabeled"];
const VIEW_NAMES: Record<TuiView, string> = {
  findings: "Findings", boundary: "Near cutoff", all: "All answers", unlabeled: "Unlabeled findings",
};

export function initialTuiState(): TuiState {
  return { repoIndex: 0, fileIndex: 0, rowIndex: 0, sourceOffset: 0, screen: "files", view: "findings", query: "", rule: "", prompt: null, promptText: "", notice: "" };
}

function matches(row: ViewerRow, state: TuiState, labels: Record<string, string>): boolean {
  if (state.view === "findings" && !row.reported) return false;
  if (state.view === "boundary" && !row.nearCutoff) return false;
  if (state.view === "unlabeled" && (!row.reported || labels[row.key])) return false;
  if (state.rule && !row.ruleKey.toLowerCase().includes(state.rule.toLowerCase())) return false;
  if (state.query) {
    const needle = state.query.toLowerCase();
    if (!row.file.toLowerCase().includes(needle) && !row.ruleKey.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export function visibleFiles(datasets: ViewerDataset[], state: TuiState, labels: Record<string, string>): ViewerFile[] {
  const data = datasets[state.repoIndex];
  if (!data) return [];
  const paths = new Set(data.rows.filter((row) => matches(row, state, labels)).map((row) => row.file));
  return data.files.filter((file) => paths.has(file.path) || (
    state.view === "all" && !state.rule && file.unpaired && (!state.query || file.path.toLowerCase().includes(state.query.toLowerCase()))
  ));
}

export function visibleAnswers(datasets: ViewerDataset[], state: TuiState, labels: Record<string, string>): ViewerRow[] {
  const data = datasets[state.repoIndex];
  const file = visibleFiles(datasets, state, labels)[state.fileIndex];
  if (!data || !file) return [];
  return data.rows.filter((row) => row.file === file.path && matches(row, state, labels))
    .sort((a, b) => Number(b.reported) - Number(a.reported) || a.line - b.line || a.ruleKey.localeCompare(b.ruleKey));
}

function clamp(state: TuiState, datasets: ViewerDataset[], labels: Record<string, string>): TuiState {
  state.fileIndex = Math.max(0, Math.min(state.fileIndex, visibleFiles(datasets, state, labels).length - 1));
  state.rowIndex = Math.max(0, Math.min(state.rowIndex, visibleAnswers(datasets, state, labels).length - 1));
  return state;
}

/** The same transition drives keyboard use and deterministic tests. */
export function updateTui(
  datasets: ViewerDataset[], previous: TuiState, labels: Record<string, string>, key: TuiKey,
): { state: TuiState; action?: TuiAction } {
  const state = { ...previous, notice: "" };
  const name = key.name ?? key.sequence ?? "";
  if (key.ctrl && name === "c") return { state, action: { type: "quit" } };

  if (state.prompt) {
    if (name === "escape") { state.prompt = null; state.promptText = ""; }
    else if (name === "return" || name === "enter") {
      state[state.prompt === "search" ? "query" : "rule"] = state.promptText.trim();
      state.prompt = null;
      state.promptText = "";
      state.fileIndex = 0;
      state.rowIndex = 0;
      state.sourceOffset = 0;
    } else if (name === "backspace" || name === "delete") state.promptText = state.promptText.slice(0, -1);
    else if (!key.ctrl && !key.meta && key.sequence?.length === 1 && key.sequence >= " ") state.promptText += key.sequence;
    return { state: clamp(state, datasets, labels) };
  }

  if (name === "q") return { state, action: { type: "quit" } };
  if (name === "tab") return { state: clamp({ ...state, repoIndex: (state.repoIndex + 1) % Math.max(1, datasets.length), fileIndex: 0, rowIndex: 0, sourceOffset: 0, screen: "files" }, datasets, labels) };
  if (name === "f") {
    state.view = VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]!;
    state.fileIndex = 0;
    state.rowIndex = 0;
    state.sourceOffset = 0;
    return { state: clamp(state, datasets, labels) };
  }
  if (name === "/") return { state: { ...state, prompt: "search", promptText: state.query } };
  if (name === "r") return { state: { ...state, prompt: "rule", promptText: state.rule } };
  if (name === "e") return { state, action: { type: "export", repoIndex: state.repoIndex } };
  if (name === "escape" && state.screen === "answers") return { state: { ...state, screen: "files", rowIndex: 0, sourceOffset: 0 } };

  if (state.screen === "answers" && (name === "[" || name === "]")) {
    state.sourceOffset += name === "]" ? 6 : -6;
    return { state };
  }

  if (name === "up" || name === "k") {
    if (state.screen === "files") state.fileIndex -= 1;
    else state.rowIndex -= 1;
    state.sourceOffset = 0;
    return { state: clamp(state, datasets, labels) };
  }
  if (name === "down" || name === "j") {
    if (state.screen === "files") state.fileIndex += 1;
    else state.rowIndex += 1;
    state.sourceOffset = 0;
    return { state: clamp(state, datasets, labels) };
  }
  if ((name === "return" || name === "enter") && state.screen === "files" && visibleFiles(datasets, state, labels).length > 0) {
    return { state: { ...state, screen: "answers", rowIndex: 0, sourceOffset: 0 } };
  }
  if (state.screen === "answers" && ["0", "1", "2", "3"].includes(name)) {
    const row = visibleAnswers(datasets, state, labels)[state.rowIndex];
    if (row) {
      const value = ({ "0": null, "1": "defect", "2": "clean", "3": "unsure" } as const)[name as "0" | "1" | "2" | "3"];
      return { state, action: { type: "label", key: row.key, value } };
    }
  }
  return { state: clamp(state, datasets, labels) };
}

function clip(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function paint(value: string, style: string, color: boolean): string {
  return color ? `\x1b[${style}m${value}\x1b[0m` : value;
}

function rowColor(row: ViewerRow, labels: Record<string, string>): string {
  const decision = labels[row.key];
  if (decision === "defect") return "31";
  if (decision === "clean") return "32";
  if (decision === "unsure") return "33";
  return row.reported ? "31" : row.nearCutoff ? "33" : "2";
}

function windowStart(length: number, index: number, count: number): number {
  return Math.max(0, Math.min(index - Math.floor(count / 2), length - count));
}

/** Render only the visible page, so a 21k-answer record stays fast in a terminal. */
export function renderTui(
  datasets: ViewerDataset[], state: TuiState, labels: Record<string, string>, columns: number, height: number,
  sourceLines?: string[],
  color = true,
): string {
  const data = datasets[state.repoIndex];
  if (!data) return "No review records loaded.\n";
  const width = Math.max(60, columns);
  const files = visibleFiles(datasets, state, labels);
  const selectedFile = files[state.fileIndex];
  const rows = visibleAnswers(datasets, state, labels);
  const selectedRow = rows[state.rowIndex];
  const screen: string[] = [
    paint(clip(`jev-lint review  |  ${data.repo}@${data.revision.slice(0, 8)}  |  Tab: repository`, width), "1;36", color),
    clip(`${data.summary.subjects.toLocaleString()} subjects  ·  ${data.summary.findings} findings  ·  ${data.summary.missing} missing  ·  ${data.summary.unpaired} unpaired  ·  ${data.summary.degraded} degraded batches`, width),
    paint(clip(`${VIEW_NAMES[state.view]}  |  search: ${state.query || "(all)"}  |  rule: ${state.rule || "(all)"}  |  ! finding  ~ near cutoff`, width), "1;33", color),
    paint("─".repeat(width), "2", color),
  ];
  if (state.screen === "files") {
    screen.push(paint(clip(`Files (${files.length})     findings  near  subjects  top concern`, width), "1", color));
    const count = Math.max(3, height - 8);
    const start = windowStart(files.length, state.fileIndex, count);
    for (let i = start; i < Math.min(files.length, start + count); i += 1) {
      const file = files[i]!;
      const line = `${i === state.fileIndex ? ">" : " "} ${String(file.findings).padStart(3)} ${String(file.nearCutoff).padStart(5)} ${String(file.subjects).padStart(8)}  ${file.path}  · ${file.topConcern ?? (file.unpaired ? "unpaired" : "—")}`;
      const tint = file.findings > 0 ? "31" : file.nearCutoff > 0 ? "33" : "2";
      screen.push(paint(clip(line, width), i === state.fileIndex ? `7;${tint}` : tint, color));
    }
    if (files.length === 0) screen.push("No files match. Press f for another view, / to change search, or r to clear the rule filter.");
    screen.push(paint("─".repeat(width), "2", color));
    screen.push(paint("↑↓/jk move  Enter answers  f view  / search  r rule  e export labels  q quit", "2", color));
  } else {
    screen.push(paint(clip(`${selectedFile?.path ?? "(no file)"}  ·  ${rows.length} shown`, width), "1", color));
    const count = Math.max(3, height - 18);
    const start = windowStart(rows.length, state.rowIndex, count);
    for (let i = start; i < Math.min(rows.length, start + count); i += 1) {
      const row = rows[i]!;
      const verdict = row.reported ? "!" : row.nearCutoff ? "~" : " ";
      const decision = labels[row.key] ? ` [${labels[row.key]}]` : "";
      const line = `${i === state.rowIndex ? ">" : " "} ${verdict} L${String(row.line).padEnd(5)} ${row.rule.padEnd(33)} ${row.value?.toFixed(2) ?? "—"}/${Number.isFinite(row.cutoff) ? row.cutoff.toFixed(2) : "—"}${decision}`;
      const tint = rowColor(row, labels);
      screen.push(paint(clip(line, width), i === state.rowIndex ? `7;${tint}` : tint, color));
    }
    if (!rows.length) screen.push(selectedFile?.unpaired ? "No answer: related test evidence was not found." : "No answers match this view.");
    screen.push(paint("─".repeat(width), "2", color));
    if (selectedRow) {
      const tint = rowColor(selectedRow, labels);
      screen.push(paint(clip(`Selected: ${selectedRow.ruleKey}  ·  ${selectedRow.arm ?? "unknown"}  ·  ${selectedRow.severity}`, width), `1;${tint}`, color));
      screen.push(clip(selectedRow.message ?? selectedRow.ask, width));
      screen.push(paint(clip(`Label: ${labels[selectedRow.key] ?? "unlabeled"}  ·  L${selectedRow.line}-${selectedRow.endLine}`, width), tint, color));
      screen.push(paint(clip(`Source at ${data.revision.slice(0, 8)}  ·  [ ] scroll  ·  https://github.com/${data.repo}/blob/${data.revision}/${selectedRow.file}#L${selectedRow.line}`, width), "2", color));
      if (sourceLines?.length) {
        const previewCount = Math.max(3, Math.min(7, height - 18));
        const start = Math.max(0, Math.min(selectedRow.line - 2 + state.sourceOffset, sourceLines.length - previewCount));
        for (let i = start; i < Math.min(sourceLines.length, start + previewCount); i += 1) {
          const mark = i + 1 >= selectedRow.line && i + 1 <= selectedRow.endLine ? ">" : " ";
          screen.push(paint(clip(`${mark}${String(i + 1).padStart(4)}  ${sourceLines[i]}`, width), mark === ">" ? "36" : "2", color));
        }
      } else screen.push("Source preview unavailable.");
    }
    screen.push(paint("↑↓/jk move  [ ] source  1 defect  2 clean  3 unsure  0 clear  Esc files  f view  e export  q quit", "2", color));
  }
  if (state.prompt) screen.push(paint(clip(`${state.prompt === "search" ? "Search" : "Rule filter"} (Enter apply, Esc cancel): ${state.promptText}▏`, width), "1;36", color));
  else if (state.notice) screen.push(paint(clip(state.notice, width), "36", color));
  return screen.slice(0, Math.max(10, height)).join("\n") + "\n";
}
