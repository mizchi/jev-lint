/**
 * The matcher: a thin driver over the real `ast-grep` binary.
 *
 * Every rule a user writes, plus a set of reserved structural probes, is
 * emitted into ONE multi-document rule file and matched in ONE `ast-grep scan`
 * invocation. That matters for two reasons: the rules stay genuine ast-grep
 * rules (so `pattern`, `kind`, `regex`, `all`/`any`/`not`, the relational
 * `inside`/`has`/`follows`/`precedes`, `utils` and `constraints` work with no
 * reimplementation on our side), and matching a whole repository costs one
 * subprocess rather than one per rule.
 *
 * The structural probes are the other half. They carry reserved ids and their
 * matches never become findings -- they build the per-file symbol table that
 * `subject: enclosing` and the `graph` state arm need: which named container
 * holds each match, what the file imports, what it exports, and which symbols
 * call which. Doing that with ast-grep queries rather than a second parser is
 * what keeps the tool language-agnostic: adding a language is adding a row to
 * the table below, not writing an analyzer.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import YAML from "yaml";
import { PROBE_PREFIX } from "./types.ts";
import type {
  AstGrepMatch,
  FileSymbols,
  Language,
  ModuleIdentity,
  Rule,
  SymbolIndex,
  SymbolInfo,
} from "./types.ts";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

/** Reserved id prefix; `rules.ts` rejects a user rule that starts with it. */
export { PROBE_PREFIX };

/** ast-grep's own exit code when a scan produced findings. Not an error. */
const EXIT_FOUND = 1;

/** A rule set ast-grep would not accept. Carries the reason, not a stack. */
export class AstGrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AstGrepError";
  }
}

/**
 * Per-language structure, as ast-grep queries.
 *
 * `containers` are the named things a match can sit inside, ordered narrowest
 * first is NOT required -- containment is computed from ranges. `nameField` is
 * the tree-sitter field holding the identifier; it differs across grammars
 * (Rust's `impl_item` calls it `type`, not `name`), which is exactly why it is
 * data here rather than an assumption in code.
 *
 * `via` handles the shape where the name lives on a parent: a TypeScript arrow
 * function has no name of its own, so the container is the `variable_declarator`
 * that names it.
 */
/** One named container kind, and where its identifier lives in the grammar. */
interface ContainerProbe {
  kind: string;
  role: string;
  nameField: string | null;
  /** For a container named by a parent, e.g. an arrow function's declarator. */
  via?: Record<string, unknown>;
}

interface LanguageStructure {
  containers: ContainerProbe[];
  imports: string[];
  exports: string[];
  /** Set when visibility is readable from the item's own text, as in Rust. */
  exportedIf: ((text: string) => boolean) | null;
  testMarker: RegExp | null;
}

export const STRUCTURE: Partial<Record<Language, LanguageStructure>> = {
  Rust: {
    containers: [
      { kind: "function_item", role: "function", nameField: "name" },
      { kind: "impl_item", role: "impl", nameField: "type" },
      { kind: "struct_item", role: "struct", nameField: "name" },
      { kind: "enum_item", role: "enum", nameField: "name" },
      { kind: "trait_item", role: "trait", nameField: "name" },
      { kind: "mod_item", role: "module", nameField: "name" },
    ],
    imports: ["use_declaration"],
    /** Rust announces visibility in the item's own text, so no probe is needed. */
    exportedIf: (text: string) => /^\s*pub(\s|\()/.test(text),
    exports: [],
    testMarker: /#\[\s*(test|tokio::test|async_std::test)\s*\]|#\[\s*cfg\s*\(\s*test\s*\)\s*\]/,
  },
  // The four ECMAScript grammars share most kinds, but not all: `ast-grep`
  // REJECTS a rule naming a kind absent from the target grammar, and one
  // rejected probe fails the whole scan rather than just itself. So the
  // TypeScript-only kinds are gated rather than shared.
  TypeScript: tsStructure({ typed: true }),
  Tsx: tsStructure({ typed: true }),
  JavaScript: tsStructure({ typed: false }),
  Jsx: tsStructure({ typed: false }),
  Python: {
    containers: [
      { kind: "function_definition", role: "function", nameField: "name" },
      { kind: "class_definition", role: "class", nameField: "name" },
    ],
    imports: ["import_statement", "import_from_statement"],
    exportedIf: (text: string) => !/^\s*(async\s+)?def\s+_/.test(text),
    exports: [],
    testMarker: /^\s*(async\s+)?def\s+test_/,
  },
  Go: {
    containers: [
      { kind: "function_declaration", role: "function", nameField: "name" },
      { kind: "method_declaration", role: "method", nameField: "name" },
      { kind: "type_declaration", role: "type", nameField: null },
    ],
    imports: ["import_declaration"],
    exportedIf: (text: string) => /\b(func|type)\s+\(?[^)]*\)?\s*[A-Z]/.test(text),
    exports: [],
    testMarker: /\bfunc\s+Test[A-Z_]/,
  },
};

function tsStructure({ typed }: { typed: boolean }): LanguageStructure {
  return {
    containers: [
      { kind: "function_declaration", role: "function", nameField: "name" },
      { kind: "generator_function_declaration", role: "function", nameField: "name" },
      { kind: "method_definition", role: "method", nameField: "name" },
      { kind: "class_declaration", role: "class", nameField: "name" },
      ...(typed
        ? [
            { kind: "interface_declaration", role: "interface", nameField: "name" },
            { kind: "type_alias_declaration", role: "type", nameField: "name" },
          ]
        : []),
      // An arrow function is named by the declarator that holds it.
      {
        kind: "variable_declarator",
        role: "function",
        nameField: "name",
        via: { any: [{ kind: "arrow_function" }, { kind: "function_expression" }] },
      },
    ],
    imports: ["import_statement"],
    // A TypeScript declaration does not carry its own visibility: `export`
    // lives on an `export_statement` that WRAPS it, so the declaration's text
    // starts with `function`, not `export`. Visibility therefore has to come
    // from a containment test against a separate probe, not from the text.
    exportedIf: null,
    exports: ["export_statement"],
    testMarker: null,
  };
}

interface ProbeMeta {
  type: "container" | "import" | "export";
  role?: string;
  language: Language;
}

interface ProbeRule {
  id: string;
  language: Language;
  rule: Record<string, unknown>;
  __probe: ProbeMeta;
}

/** Rules whose matches are structure, not findings. */
function probeRules(languages: Language[]): ProbeRule[] {
  const out: ProbeRule[] = [];
  for (const language of languages) {
    const s = STRUCTURE[language];
    if (!s) continue;
    s.containers.forEach((c, i) => {
      const rule: Record<string, unknown> = { kind: c.kind };
      const inner: Array<Record<string, unknown>> = [];
      if (c.nameField) inner.push({ field: c.nameField, pattern: "$JEVNAME" });
      if (c.via) inner.push(c.via);
      if (inner.length === 1) rule.has = inner[0];
      else if (inner.length > 1) rule.all = inner.map((h) => ({ has: h }));
      out.push({
        id: `${PROBE_PREFIX}c${i}_${language}`,
        language,
        rule,
        __probe: { type: "container", role: c.role, language },
      });
    });
    (s.imports ?? []).forEach((kind, i) => {
      out.push({
        id: `${PROBE_PREFIX}i${i}_${language}`,
        language,
        rule: { kind },
        __probe: { type: "import", language },
      });
    });
    (s.exports ?? []).forEach((kind, i) => {
      out.push({
        id: `${PROBE_PREFIX}e${i}_${language}`,
        language,
        rule: { kind },
        __probe: { type: "export", language },
      });
    });
  }
  return out;
}

/**
 * Separator between a jevlint rule id and the grammar an emitted ast-grep rule
 * was specialised for. ast-grep ids must be unique, but a multi-language rule
 * is ONE rule as far as cutoffs, drafts and the cache are concerned, so the
 * suffix is stripped again when matches come back.
 */
const LANG_SUFFIX = "@";

export function astGrepRuleId(ruleId: string, language: Language): string {
  return `${ruleId}${LANG_SUFFIX}${language}`;
}

export function baseRuleId(astGrepId: string): string {
  const i = astGrepId.lastIndexOf(LANG_SUFFIX);
  return i < 1 ? astGrepId : astGrepId.slice(0, i);
}

/** Strip jevlint-only fields; what is left is a valid ast-grep rule. */
export function toAstGrepRule(rule: Rule, language: Language): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: astGrepRuleId(rule.id, language),
    language,
    // ast-grep requires a message; ours is never shown to a user (the finding
    // text is built from the rule's own `ask`), so it is only a marker.
    message: "jevlint",
    severity: "hint",
    rule: rule.matcher,
  };
  if (rule.constraints) out.constraints = rule.constraints;
  if (rule.utils) out.utils = rule.utils;
  return out;
}

/**
 * Every language any loaded rule asks for, in the order first seen.
 *
 * The probes do not add any: `probeRules` is given this list and emits probes
 * FOR these languages, so there is nothing to union in here.
 */
export function ruleLanguages(rules: Rule[]): Language[] {
  const out: Language[] = [];
  for (const r of rules) {
    for (const l of r.languages ?? [r.language]) {
      if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

export function emitRuleFile(rules: Rule[], languages: Language[]): string {
  const docs: Array<Record<string, unknown>> = [];
  for (const rule of rules) {
    for (const language of rule.languages ?? [rule.language]) {
      docs.push(toAstGrepRule(rule, language));
    }
  }
  for (const { __probe, ...r } of probeRules(languages)) {
    docs.push({ ...r, message: "jevlint-probe" });
  }
  return docs.map((d) => YAML.stringify(d)).join("---\n");
}

/**
 * Locate the `ast-grep` binary.
 *
 * Four places, in order, because the layout differs between working in this
 * repository and being installed as a dependency -- where npm hoists
 * `node_modules` to the consumer's root and `../node_modules/.bin` beside the
 * package does not exist. Resolving through `@ast-grep/cli`'s own package
 * location is what works in both, and the pinned version is preferred over
 * whatever happens to be on PATH so a scan cannot silently change behaviour
 * with the user's shell.
 */
function astGrepBin(): string {
  if (process.env.JEVLINT_AST_GREP) return process.env.JEVLINT_AST_GREP;

  const candidates: string[] = [];
  try {
    const require_ = createRequire(import.meta.url);
    const pkgJson = require_.resolve("@ast-grep/cli/package.json");
    const pkgDir = dirname(pkgJson);
    // The platform package ships the executable; the wrapper re-exports it.
    candidates.push(join(pkgDir, "ast-grep"), join(pkgDir, "bin", "ast-grep"));
    // The bin shim that npm links, found from the resolved package upwards.
    candidates.push(join(pkgDir, "..", "..", ".bin", "ast-grep"));
  } catch {
    // Not resolvable: fall through to the layout-based guesses.
  }
  candidates.push(join(HERE, "..", "node_modules", ".bin", "ast-grep"));
  candidates.push(join(HERE, "..", "..", "node_modules", ".bin", "ast-grep"));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: whatever is on PATH. If that is missing too, execFile fails
  // with ENOENT and `runAstGrep` turns it into a named configuration error.
  return "ast-grep";
}

/**
 * Run one scan. Returns `{matches, probes, stderr}`.
 *
 * `--json=stream` is newline-delimited JSON, which means a large repository
 * does not have to be buffered as one array before parsing.
 */
export interface ScanResult {
  matches: AstGrepMatch[];
  probes: AstGrepMatch[];
  stderr: string;
}

export async function runAstGrep(
  rules: Rule[],
  paths: string[],
  { cwd = process.cwd(), maxBuffer = 512 * 1024 * 1024 } = {},
): Promise<ScanResult> {
  if (rules.length === 0 || paths.length === 0) {
    return { matches: [], probes: [], stderr: "" };
  }
  const languages = ruleLanguages(rules);
  const dir = mkdtempSync(join(tmpdir(), "jevlint-"));
  const rulePath = join(dir, "rules.yml");
  try {
    writeFileSync(rulePath, emitRuleFile(rules, languages));
    const args = ["scan", "--rule", rulePath, "--json=stream", "--", ...paths];
    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(astGrepBin(), args, { cwd, maxBuffer });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (raw: unknown) {
      // Not intersected with ErrnoException: execFile reports the process exit
      // status in `code` as a NUMBER, while ErrnoException types it as a string,
      // and the intersection collapses to string and never matches.
      const err = raw as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      // Exit 1 means "findings were produced", which is the normal case here.
      if (err.code === EXIT_FOUND && typeof err.stdout === "string") {
        stdout = err.stdout;
        stderr = err.stderr ?? "";
      } else {
        // ast-grep rejects a rule naming a node kind the target grammar does
        // not have, and it fails the WHOLE file rather than the offending rule.
        // A raw exec stack trace would bury that, and the actionable part is
        // the one line naming the kind, so it is surfaced as a plain error.
        const detail = String(err.stderr ?? err.message ?? err)
          .split("\n")
          .map((l) => l.replace(/^[╰✖▻\s]+/, "").trim())
          .filter((l) => l !== "" && !l.startsWith("See also") && !l.startsWith("Usage"))
          .slice(0, 6)
          .join("; ");
        throw new AstGrepError(
          `ast-grep rejected the rule set: ${detail}\n` +
            "One invalid rule fails every rule in the run. If it names a node kind, " +
            "check that kind exists in that language's grammar -- `languages:` on a rule " +
            "requires the matcher to be valid in each one.",
        );
      }
    }

    const matches: AstGrepMatch[] = [];
    const probes: AstGrepMatch[] = [];
    for (const line of stdout.split("\n")) {
      if (line.trim() === "") continue;
      let j: AstGrepMatch;
      try {
        j = JSON.parse(line) as AstGrepMatch;
      } catch {
        continue;
      }
      (j.ruleId?.startsWith(PROBE_PREFIX) ? probes : matches).push(j);
    }
    return { matches, probes, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Map probe rule ids back to what they were probing for. */
function probeIndex(languages: Language[]): Map<string, ProbeMeta> {
  return new Map(probeRules(languages).map((r) => [r.id, r.__probe]));
}

const byteStart = (m: AstGrepMatch) => m.range.byteOffset.start;
const byteEnd = (m: AstGrepMatch) => m.range.byteOffset.end;

function metaName(m: AstGrepMatch): string | null {
  const t = m.metaVariables?.single?.JEVNAME?.text;
  return typeof t === "string" && t.trim() !== "" ? t.trim() : null;
}

/**
 * Build the per-file symbol table from probe matches.
 *
 * Containment is by byte range, so the nesting chain falls out of sorting
 * without any tree walking: the narrowest container containing a position is
 * the last one that starts before it and ends after it.
 */
export function buildSymbols(probes: AstGrepMatch[], languages: Language[]): SymbolIndex {
  const index = probeIndex(languages);
  const byFile: SymbolIndex = new Map();
  for (const p of probes) {
    const meta = index.get(p.ruleId);
    if (!meta) continue;
    if (!byFile.has(p.file)) {
      byFile.set(p.file, { symbols: [], imports: [], exportRanges: [], language: p.language });
    }
    const entry = byFile.get(p.file)!;
    if (meta.type === "import") {
      entry.imports.push(p.text.trim().replace(/\s+/g, " ").slice(0, 200));
      continue;
    }
    if (meta.type === "export") {
      entry.exportRanges.push([byteStart(p), byteEnd(p)]);
      continue;
    }
    const struct = STRUCTURE[p.language as Language];
    entry.symbols.push({
      name: metaName(p),
      // Only container probes reach here; imports and exports returned above.
      role: meta.role ?? "container",
      start: byteStart(p),
      end: byteEnd(p),
      line: p.range.start.line + 1,
      endLine: p.range.end.line + 1,
      text: p.text,
      exported: struct?.exportedIf ? struct.exportedIf(p.text) : false,
      isTest: struct?.testMarker ? struct.testMarker.test(p.text) : false,
      // Filled in by computeCalls once the whole file's symbols are known.
      calls: [],
      calledBy: [],
    });
  }

  for (const entry of byFile.values()) {
    // Narrowest-last ordering makes `enclosingSymbol` a single scan.
    entry.symbols.sort((a, b) => a.start - b.start || b.end - a.end);
    entry.imports = [...new Set(entry.imports)];
    for (const s of entry.symbols) {
      if (!s.exported) {
        s.exported = entry.exportRanges.some(([a, b]) => a <= s.start && b >= s.end);
      }
    }
    computeCalls(entry);
  }
  return byFile;
}

/**
 * Within-file call edges, by name occurrence inside each symbol's own text.
 *
 * Deliberately approximate: it is a name-occurrence test, not a resolved call
 * graph, so a shadowed local or a string literal holding a symbol name will
 * produce an edge that a real analyzer would not. It is used only as state
 * shown to the model -- never to decide anything -- and for the one judgment it
 * serves ("does this function's name describe its role among its callers?") an
 * over-inclusive edge list is the safer error. Cross-file edges are out of
 * scope here; `imports` is the cross-file signal instead.
 */
function computeCalls(entry: FileSymbols): void {
  for (const s of entry.symbols) {
    s.calls = [];
    s.calledBy = [];
  }
  const named = entry.symbols.filter((s) => s.name && s.role !== "module");
  // One name can belong to several symbols -- in Rust a `struct Cache` and its
  // `impl Cache` share one -- so the index holds every symbol under a name and
  // same-name pairs never form an edge.
  const index = new Map<string, SymbolInfo[]>();
  for (const s of named) {
    if (!index.has(s.name!)) index.set(s.name!, []);
    index.get(s.name!)!.push(s);
  }
  for (const s of named) {
    const seen = new Set();
    for (const m of s.text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = m[0];
      if (name === s.name || seen.has(name)) continue;
      const targets = index.get(name);
      if (!targets) continue;
      // A nested symbol's own name occurring in its parent is its definition,
      // not a call, so an edge only counts when the target is not inside the
      // source.
      const outside = targets.filter((t) => !(t.start >= s.start && t.end <= s.end));
      if (outside.length === 0) continue;
      seen.add(name);
      s.calls.push(name);
      for (const t of outside) t.calledBy.push(s.name!);
    }
  }
  for (const s of entry.symbols) {
    s.calls = [...new Set(s.calls)];
    s.calledBy = [...new Set(s.calledBy)];
  }
}

/** The narrowest symbol whose range contains `[start, end)`, or null. */
export function enclosingSymbol(
  entry: FileSymbols | null,
  start: number,
  end: number,
  { skipSelf = null }: { skipSelf?: { start: number; end: number } | null } = {},
): SymbolInfo | null {
  let best: SymbolInfo | null = null;
  for (const s of entry?.symbols ?? []) {
    if (s.start > start) break;
    if (s.end < end) continue;
    if (skipSelf && s.start === skipSelf.start && s.end === skipSelf.end) continue;
    if (!best || s.end - s.start <= best.end - best.start) best = s;
  }
  return best;
}

/** Every symbol containing the position, outermost first. */
export function enclosingChain(
  entry: FileSymbols | null,
  start: number,
  end: number,
): SymbolInfo[] {
  return (entry?.symbols ?? [])
    .filter((s) => s.start <= start && s.end >= end)
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * What the file's own path says it is.
 *
 * This is one of the cheapest pieces of state with real signal, and it is the
 * only one that can answer "is this module named for what it contains?" --
 * a judgment the file's text alone cannot support, because the text never
 * mentions its own path.
 */
export function moduleIdentity(file: string): ModuleIdentity {
  const ext = extname(file);
  const base = basename(file, ext);
  const segments = dirname(file).split(sep).filter((s) => s !== "" && s !== ".");
  return {
    path: file,
    stem: base,
    directories: segments,
    // `mod.rs`, `index.ts` and `__init__.py` are named by their directory.
    named_by_directory: ["mod", "index", "__init__", "lib", "main"].includes(base)
      ? (segments.at(-1) ?? null)
      : null,
  };
}
