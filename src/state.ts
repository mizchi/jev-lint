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
import { moduleIdentity } from "./scan.ts";
import { STATE_ARMS } from "./types.ts";
import type {
  FileSymbols,
  ModuleIdentity,
  Rule,
  ResolvedSubject,
  StateArm,
  Subject,
  StatePayload,
  SymbolIndex,
  SymbolInfo,
  AstGrepMatch,
} from "./types.ts";

export const ARMS = STATE_ARMS;

export const ARM_BLURB: Record<StateArm, string> = {
  bare: "the matched code only -- no file, no graph",
  local: "the matched code plus its enclosing function; no whole file",
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
function symbolSummary(s: SymbolInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
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
export interface BuildStateArgs {
  file: string;
  source: string;
  entry: FileSymbols | null;
  subjects: Subject[];
  arm: StateArm;
  language: string;
}

export function buildState({
  file,
  source,
  entry,
  subjects,
  arm,
  language,
}: BuildStateArgs): StatePayload {
  const state: StatePayload = {
    language,
    reviewing: "source code, against project-specific rules stated in the questions",
    subjects: subjects.map((s) => {
      const from = s.subjectLine ?? s.line;
      const to = s.subjectEndLine ?? s.endLine;
      const out: Record<string, unknown> = {
        id: s.id,
        rule: s.rule?.id,
        node: s.nodeKind,
        lines: from === to ? `${from}` : `${from}-${to}`,
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

  if (arm === "local") {
    // Per-subject context instead of the whole file: each subject's enclosing
    // function, deduplicated, since several matches usually share one.
    const seen = new Map<string, string | null>();
    for (const s of subjects) {
      if (!s.context || seen.has(s.context)) continue;
      seen.set(s.context, s.contextName ?? null);
    }
    if (seen.size > 0) {
      state.enclosing_code = [...seen.entries()].map(([code, name]) => ({
        ...(name ? { name } : {}),
        code,
      }));
    }
  }

  return state;
}

/**
 * The state for a RULE-grouped batch: one rule, many matches, many files.
 *
 * The file-grouped state above sends a file once and asks about everything in
 * it. This one inverts that: it sends only what the matcher caught, from
 * wherever it caught it, and asks the same question of each item.
 *
 * Which is better is a question about MATCH DENSITY, not about which is nicer.
 * File-grouping amortises a file's source over the matches inside it, so it
 * wins when a rule matches many things per file and loses when it matches few
 * -- and "few per file" is the normal case for a narrow rule on a large
 * repository. A rule matching one node in a 2000-line file pays 2000 lines for
 * one question, once per file, forever.
 *
 * The risk it takes is contamination. Two hundred unrelated snippets sitting
 * side by side in one state could anchor each other -- a mediocre name looking
 * fine next to a terrible one. Published measurement on the file-grouped case
 * found this small (mean absolute difference 0.082, 3.6% of decisions), but
 * that was neighbours from the same file, which is a much weaker form of the
 * same thing. `note_on_independence` below states the requirement explicitly,
 * and `tools/grouping.ts` measures whether it holds by comparing against
 * one-request-per-match.
 */
export interface BuildRuleStateArgs {
  rule: Rule;
  subjects: Subject[];
  arm: StateArm;
  symbols?: SymbolIndex | null;
}

export function buildRuleState({
  rule,
  subjects,
  arm,
  symbols,
}: BuildRuleStateArgs): StatePayload {
  const languages = [...new Set(subjects.map((s) => s.language))];

  // Shared context, referenced by id rather than repeated.
  //
  // Several matches usually sit in one function -- five bindings in one body is
  // ordinary -- so inlining each subject's enclosing code would send that body
  // five times. Measured on tokio, not deduplicating was the difference
  // between rule grouping costing less than file grouping and costing more.
  const contexts = new Map<string, { id: string; name: string | null }>();
  if (arm === "local") {
    for (const s of subjects) {
      if (!s.context || contexts.has(s.context)) continue;
      contexts.set(s.context, { id: `c${contexts.size}`, name: s.contextName ?? null });
    }
  }

  const state: StatePayload = {
    language: languages.length === 1 ? languages[0]! : languages,
    reviewing:
      "code selected from across one codebase by a single structural matcher, to be judged item by item against the one rule stated in the questions",
    // The items are unrelated, and the model has to be told so. In the
    // file-grouped state the neighbours are genuinely context; here they are
    // just other work that happens to share a request.
    note_on_independence:
      "These items come from different files and have nothing to do with one another. Judge each one only on its own merits; do not compare them, rank them against each other, or let one item's quality influence another's.",
    subjects: subjects.map((s) => {
      const from = s.subjectLine ?? s.line;
      const to = s.subjectEndLine ?? s.endLine;
      const out: Record<string, unknown> = {
        id: s.id,
        file: s.file,
        lines: from === to ? `${from}` : `${from}-${to}`,
        node: s.nodeKind,
      };
      if (languages.length > 1) out.language = s.language;
      if (s.enclosing?.name) out.inside = `${s.enclosing.role} \`${s.enclosing.name}\``;
      if (s.captured && Object.keys(s.captured).length > 0) out.captured = s.captured;
      if (arm === "local" && s.context) out.enclosed_by = contexts.get(s.context)!.id;
      if ((arm === "graph" || arm === "full") && s.rule.subject !== "file") {
        const entry = symbols?.get(s.file);
        if (entry) out.module = compactOutline(s.file, entry);
      }
      return out;
    }),
  };

  if (contexts.size > 0) {
    state.enclosing_code = [...contexts.entries()].map(([code, meta]) => ({
      id: meta.id,
      ...(meta.name ? { name: meta.name } : {}),
      code,
    }));
    state.note_on_enclosing_code =
      "Each subject's `enclosed_by` names the entry in `enclosing_code` it appears inside. Several subjects can share one.";
  }

  if (rule?.id) state.matcher = `all items matched one structural matcher for the rule \`${rule.id}\``;
  return state;
}

/**
 * A one-line-per-symbol outline, for the `graph` arm under rule grouping.
 *
 * The file-grouped `graph` arm can afford the full symbol table because it
 * sends it once per file. Here a file's outline would be repeated for every
 * match in it, so this is deliberately thinner: names and roles, no ranges and
 * no call edges.
 */
function compactOutline(file: string, entry: FileSymbols | null): Record<string, unknown> {
  const id = moduleIdentity(file);
  const named = (entry?.symbols ?? []).filter((s) => s.name);
  return {
    path: id.path,
    ...(id.named_by_directory ? { subject: id.named_by_directory } : {}),
    exports: named.filter((s) => s.exported).map((s) => s.name),
    locals: named.filter((s) => !s.exported).map((s) => s.name),
  };
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
export function resolveSubject(
  match: AstGrepMatch,
  rule: Rule,
  entry: FileSymbols | null,
): ResolvedSubject {
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
        // The finding is reported where the MATCH is, not where the judged
        // subject starts. Those are two different concerns and conflating them
        // costs twice: a reader sent to the top of a 60-line function has to
        // find the line that actually matched, and every match inside one
        // function collapses onto the same reported line -- which made
        // per-line corpus labels unable to tell them apart.
        line,
        endLine,
        subjectLine: encl.line,
        subjectEndLine: encl.endLine,
        // The matched node itself, kept alongside the container.
        //
        // Without it a promoted subject is unanswerable whenever the container
        // holds several candidates: a rule about a comment and the lines under
        // it hands over a whole function with three comments in it and no way
        // to say which one is under test. Measured on the comment pack, that
        // failure looked exactly like a threshold problem -- every answer came
        // back near 0.95, a gap of 0.03 -- and no cutoff could have fixed it.
        matchText: truncate(match.text),
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
    // The `local` arm's context: the smallest named thing containing the match,
    // but ONLY when the match is a fragment inside one.
    //
    // For a binding rule this is the payload that matters. `const
    // timeoutSeconds = 5000` is only wrong if you can see 5000 used as
    // milliseconds, and the use is in the enclosing function -- so this is a
    // candidate for the cheapest context that still contains the answer, which
    // is the standard the whole arm design is held to.
    //
    // When the match IS a named symbol, though, it is already a complete unit
    // and its "enclosing" symbol is the class or `impl` block around it --
    // which is most of the file, carries no extra evidence about this
    // function's name, and was measured costing 37% more tokens than sending
    // the file once. So for those, `local` adds nothing and equals `bare`.
    context: encl && !isNamedSymbol(entry, start, end) ? truncate(encl.text) : null,
    contextName: encl?.name ?? null,
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
export function matcherLabel(rule: Rule): string {
  const m = (rule.matcher ?? {}) as Record<string, unknown>;
  if (typeof m.kind === "string") return m.kind;
  if (typeof m.pattern === "string") return "pattern match";
  if (m.all || m.any) return "composite match";
  return "node";
}

/** Is this exact range a named symbol -- i.e. already a complete unit? */
function isNamedSymbol(entry: FileSymbols | null, start: number, end: number): boolean {
  return (entry?.symbols ?? []).some((s) => s.name && s.start === start && s.end === end);
}

function pickEnclosing(
  entry: FileSymbols | null,
  start: number,
  end: number,
  self: { start: number; end: number },
): SymbolInfo | null {
  let best: SymbolInfo | null = null;
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
export function capturedMetavariables(match: AstGrepMatch): Record<string, string> {
  const out: Record<string, string> = {};
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

function truncate(text: string): string {
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
export function renderOutline(file: string, entry: FileSymbols | null): string {
  const id = moduleIdentity(file);
  const lines = [`path: ${id.path}`];
  if (id.named_by_directory) {
    lines.push(`this file is named by its directory, so its subject is: ${id.named_by_directory}`);
  }
  const symbols = (entry?.symbols ?? []).filter((s) => s.name);
  const exported = symbols.filter((s) => s.exported);
  const local = symbols.filter((s) => !s.exported && !s.isTest);
  const tests = symbols.filter((s) => s.isTest);

  const render = (list: SymbolInfo[]) =>
    list.map((s) => `${s.name} (${s.role}, lines ${s.line}-${s.endLine})`).join("\n  ");

  if (exported.length) lines.push(`public API:\n  ${render(exported)}`);
  if (local.length) lines.push(`private to this module:\n  ${render(local)}`);
  if (tests.length) lines.push(`tests:\n  ${render(tests)}`);
  if (entry?.imports?.length) lines.push(`imports:\n  ${entry.imports.join("\n  ")}`);
  if (symbols.length === 0) lines.push("this module declares no named items");
  return lines.join("\n");
}
