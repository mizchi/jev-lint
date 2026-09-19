/**
 * The state: what the model gets to look at.
 *
 * One state per (file, arm), carrying every question for that file. The whole
 * cost argument of this tool rests on that: the state is sent once and each
 * extra question costs only its own text, so asking about 40 matches in a file
 * costs barely more than asking about one.
 *
 * ## Arms, and why this is a choice rather than a default
 *
 * More context is not simply better. Published measurements on this exact
 * shape -- a per-function review verdict with and without the surrounding file
 * -- found that adding the file cut false positives to a fifth AND increased
 * misses. Two other experiments found structured state to be the single
 * largest lever, and a third found repository context moved not one verdict.
 * All three are the same phenomenon: more context makes the judgment MILDER.
 *
 * So the arm is not a quality knob, it is a choice of which error you would
 * rather have:
 *
 *   bare      subject code only. Harshest, noisiest. Highest recall.
 *   located   + the whole file. Fewer false positives, more misses.
 *   graph     + path identity, imports, and the symbol table with call edges,
 *             but NOT the file text. The cheap arm, and the only one that can
 *             answer a question about a name's relationship to its
 *             surroundings -- a file's text never mentions its own path, and a
 *             function's text never lists its callers.
 *   full      everything. Most tokens; the state ceiling arrives soonest.
 *
 * `graph` exists because of what this tool is aimed at. A judgment like "does
 * this function's name describe what it does for the code that calls it" or
 * "is this module named for what it contains" is unanswerable from the
 * subject's own text at any threshold -- not because the model is weak, but
 * because the evidence is genuinely absent. Supplying the hierarchy is not
 * decoration there; it is the difference between a question that can be
 * answered and one that cannot.
 */
import { moduleIdentity } from "./scan.mjs";

export const ARMS = ["bare", "located", "graph", "full"];

export const ARM_BLURB = {
  bare: "the matched code only -- no file, no graph",
  located: "the matched code plus the whole file source",
  graph: "path identity, imports and the symbol table with call edges; no file source",
  full: "the file source and the graph",
};

/** Cap on a single symbol's body reproduced into a subject. */
const SUBJECT_TEXT_LIMIT = 4000;

/**
 * Inline the subject's source into the question when it is small enough.
 *
 * Above this the question names it by line range and lets the model find it in
 * the state -- which only works on an arm that carries the source. A line range
 * alone is a weak subject for a short node, so the limit is generous.
 */
export const INLINE_LIMIT = 900;

/**
 * Strip a symbol down to what is worth spending tokens on.
 *
 * Bodies are deliberately excluded: the symbol table is the file's shape, and
 * on the `graph` arm its whole value is being small enough that a 2000-line
 * file's structure fits in a few hundred tokens when its text would not fit at
 * all.
 */
function symbolSummary(s) {
  const out = {
    name: s.name,
    role: s.role,
    lines: s.line === s.endLine ? `${s.line}` : `${s.line}-${s.endLine}`,
  };
  if (s.exported) out.exported = true;
  if (s.isTest) out.test = true;
  if (s.calls?.length) out.calls = s.calls;
  if (s.calledBy?.length) out.called_by = s.calledBy;
  return out;
}

/**
 * Build the state for one file's worth of subjects.
 *
 * `subjects` is the index that lets a question say "subject q003" and have the
 * state agree about what that is. Every question in the request appears here,
 * even on `bare`, because a question whose subject the state does not
 * acknowledge is a question about nothing.
 */
export function buildState({ file, source, entry, subjects, arm, language }) {
  const state = {
    language,
    reviewing: "source code, against project-specific rules stated in the questions",
    subjects: subjects.map((s) => {
      const out = {
        id: s.id,
        rule: s.ruleId,
        node: s.nodeKind,
        lines: s.line === s.endLine ? `${s.line}` : `${s.line}-${s.endLine}`,
      };
      if (s.enclosing) out.inside = `${s.enclosing.role} \`${s.enclosing.name}\``;
      if (s.captured && Object.keys(s.captured).length > 0) out.captured = s.captured;
      return out;
    }),
  };

  if (arm === "graph" || arm === "full") {
    state.module = moduleIdentity(file);
    if (entry?.imports?.length) state.imports = entry.imports;
    const symbols = (entry?.symbols ?? []).filter((s) => s.name);
    if (symbols.length > 0) state.symbols = symbols.map(symbolSummary);
  } else {
    // Even the lean arms name the file. It is a handful of tokens and without
    // it nothing can be said about naming at all.
    state.file = file;
  }

  if (arm === "located" || arm === "full") {
    state.source = source;
  }

  return state;
}

/**
 * The code a question is actually about.
 *
 * Returns `{text, line, endLine, nodeKind, enclosing}`. `subject: enclosing`
 * promotes the subject to the narrowest named container, because a predicate
 * often needs the body around the matched node: "this `fetch` has no timeout"
 * is about the call, but "this function does what its name promises" is not
 * about the identifier that happens to match.
 *
 * Falling back to the node when there is no container is deliberate. The
 * alternative -- dropping the match -- would make the matcher fail silently in
 * a second way, and silent is the one failure mode this design spends effort
 * to avoid.
 */
export function resolveSubject(match, rule, entry) {
  const start = match.range.byteOffset.start;
  const end = match.range.byteOffset.end;
  const line = match.range.start.line + 1;
  const endLine = match.range.end.line + 1;
  const captured = capturedMetavariables(match);

  if (rule.subject === "file") {
    return {
      text: renderOutline(match.file, entry),
      line: 1,
      endLine,
      nodeKind: "module",
      enclosing: null,
      promoted: false,
      isOutline: true,
      captured,
    };
  }

  if (rule.subject === "enclosing") {
    const self = { start, end };
    const encl = pickEnclosing(entry, start, end, self);
    if (encl) {
      return {
        text: truncate(encl.text),
        line: encl.line,
        endLine: encl.endLine,
        nodeKind: encl.role,
        enclosing: null,
        promoted: true,
        captured,
      };
    }
  }

  const encl = pickEnclosing(entry, start, end, { start, end });
  return {
    text: truncate(match.text),
    line,
    endLine,
    nodeKind: matcherLabel(rule),
    enclosing: encl ? { name: encl.name, role: encl.role } : null,
    promoted: false,
    captured,
  };
}

/**
 * A short name for what the matcher selected.
 *
 * `ast-grep scan --json` reports the matched text and range but not the node's
 * grammar kind, so this comes from the rule's own matcher rather than from the
 * match. It is only a label in the question; nothing decides on it.
 */
export function matcherLabel(rule) {
  const m = rule.matcher ?? rule.rule ?? {};
  if (typeof m.kind === "string") return m.kind;
  if (typeof m.pattern === "string") return "pattern match";
  if (m.all || m.any) return "composite match";
  return "node";
}

function pickEnclosing(entry, start, end, self) {
  let best = null;
  for (const s of entry?.symbols ?? []) {
    if (!s.name) continue;
    if (s.start > start) break;
    if (s.end < end) continue;
    // A symbol that IS the match is not its own container.
    if (s.start === self.start && s.end === self.end) continue;
    if (!best || s.end - s.start <= best.end - best.start) best = s;
  }
  return best;
}

/**
 * Named captures from the matcher, which are the sharpest state this tool has.
 *
 * A rule that captures `$NAME` and `$TITLE` has told us exactly which two
 * things the question is comparing, so the question can name them instead of
 * hoping the model picks the same pair out of the text. For the naming
 * judgments this tool is built for that is the difference between a question
 * answerable from the subject and one that is not -- and a question whose
 * condition is not visible in its subject comes back mid-scale for every
 * input, which no threshold repairs.
 *
 * Reserved captures are hidden: `$JEVNAME` belongs to the structural probes.
 */
export function capturedMetavariables(match) {
  const out = {};
  const single = match.metaVariables?.single ?? {};
  for (const [k, v] of Object.entries(single)) {
    if (k === "JEVNAME" || k.startsWith("_")) continue;
    if (typeof v?.text !== "string") continue;
    out[k] = v.text.length > 600 ? `${v.text.slice(0, 600)}…` : v.text;
  }
  const multi = match.metaVariables?.multi ?? {};
  for (const [k, list] of Object.entries(multi)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    if (k === "JEVNAME" || k.startsWith("_")) continue;
    out[k] = list.map((n) => n.text).join(", ").slice(0, 600);
  }
  return out;
}

function truncate(text) {
  return text.length > SUBJECT_TEXT_LIMIT
    ? `${text.slice(0, SUBJECT_TEXT_LIMIT)}\n/* … truncated … */`
    : text;
}

/**
 * A module as an outline: its path, what it exports, what it keeps private,
 * and what it pulls in.
 *
 * This is the subject for `subject: file`, and using it rather than the file's
 * text is not only a token economy. "Is this module named for what it holds" is
 * a question about the module's shape, and the outline IS the shape -- with the
 * useful side effect that the verdict stays valid across every edit that does
 * not change it. Renaming a local, fixing a comment, reordering statements: all
 * of them leave this outline, and therefore the cached verdict, untouched.
 */
export function renderOutline(file, entry) {
  const id = moduleIdentity(file);
  const lines = [`path: ${id.path}`];
  if (id.named_by_directory) {
    lines.push(`this file is named by its directory, so its subject is: ${id.named_by_directory}`);
  }
  const symbols = (entry?.symbols ?? []).filter((s) => s.name);
  const exported = symbols.filter((s) => s.exported);
  const local = symbols.filter((s) => !s.exported && !s.isTest);
  const tests = symbols.filter((s) => s.isTest);

  const render = (list) =>
    list.map((s) => `${s.name} (${s.role}, lines ${s.line}-${s.endLine})`).join("\n  ");

  if (exported.length) lines.push(`public API:\n  ${render(exported)}`);
  if (local.length) lines.push(`private to this module:\n  ${render(local)}`);
  if (tests.length) lines.push(`tests:\n  ${render(tests)}`);
  if (entry?.imports?.length) lines.push(`imports:\n  ${entry.imports.join("\n  ")}`);
  if (symbols.length === 0) lines.push("this module declares no named items");
  return lines.join("\n");
}
