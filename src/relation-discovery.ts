import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname, relative } from "node:path";
import { buildSymbols, runAstGrep } from "./scan.ts";
import { normalizeRule } from "./rules.ts";
import { parseRelationInput, relationDigest, type RelationInput, type RelationEvidence, type RelationSubject } from "./relation-contract.ts";

export interface RelationChunk { id: string; evidence: RelationEvidence; name: string | null; references: string[] }
export interface RelationCatalog {
  schema: "jev-lint-relation-catalog-1"; sourcesDigest: string; chunks: RelationChunk[];
  unindexed: Array<{ sourceId: string; reason: "index-failed" | "excerpt-budget" }>;
}
export interface RelationDiscoveryOptions { maxCandidates?: number; maxCandidatesPerClaim?: number; terms?: Record<string, string[]> }
export interface RelationDiscovery {
  schema: "jev-lint-relation-discovery-1"; inputDigest: string;
  proposals: Array<{ id: string; relation: RelationSubject; matchedTerms: string[] }>;
  missingClaimIds: string[]; unmatchedClaimIds: string[]; deferredClaimIds: string[];
  excluded: Array<{ claimId: string; chunkId: string; reason: "outside-scope" | "candidate-budget" | "already-linked" }>;
  unindexed: RelationCatalog["unindexed"];
}

/** Catalog entries remain exact source lines, even when an AST node starts mid-line. */
export async function indexRelationSources(raw: RelationInput): Promise<RelationCatalog> {
  const input = parseRelationInput(raw);
  const catalog: RelationCatalog = { schema: "jev-lint-relation-catalog-1", sourcesDigest: relationDigest(input.sources), chunks: [], unindexed: [] };
  const cwd = mkdtempSync(join(tmpdir(), "jev-relations-index-"));
  const languages: Record<string, string> = { ".ts": "TypeScript", ".tsx": "Tsx", ".js": "JavaScript", ".mjs": "JavaScript", ".jsx": "Jsx" };
  const files = new Map<string, RelationInput["sources"][number]>();
  const add = (sourceId: string, startLine: number, endLine: number, name: string | null) => {
    const source = input.sources.find((s) => s.id === sourceId)!;
    const quote = source.content.split("\n").slice(startLine - 1, endLine).join("\n");
    if (!quote.trim()) return;
    if (quote.length > 64000) {
      if (!catalog.unindexed.some((entry) => entry.sourceId === sourceId && entry.reason === "excerpt-budget")) catalog.unindexed.push({ sourceId, reason: "excerpt-budget" });
      return;
    }
    const evidence = { sourceId, startLine, endLine, quote };
    const id = relationDigest(evidence);
    if (!catalog.chunks.some((chunk) => chunk.id === id)) catalog.chunks.push({ id, evidence, name,
      references: [...new Set(quote.match(/[A-Za-z_$][\w$]*/g) ?? [])] });
  };
  try {
    // No repository configuration, parser library or lifecycle script enters this directory.
    writeFileSync(join(cwd, "sgconfig.yml"), "ruleDirs: []\n");
    for (const [i, source] of input.sources.entries()) {
      if (source.kind !== "code" && source.kind !== "test" || !languages[extname(source.path)]) continue;
      const path = join(cwd, `s${i}`, source.path); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source.content); files.set(relative(cwd, path), source);
    }
    const grammars = [...new Set([...files.keys()].map((path) => languages[extname(path)]))];
    const rules = grammars.map((language) => {
      const { rule, error } = normalizeRule({ id: `relation-index-${language}`, language, rule: { kind: "variable_declarator" }, ask: "Index source containers." });
      if (!rule || error) throw new Error("invalid trusted index rule");
      return rule;
    });
    try {
      const scan = await runAstGrep(rules, [...files.keys()], { cwd, maxBuffer: 16 * 1024 * 1024 });
      for (const match of scan.matches) {
        const source = files.get(match.file), name = /^\s*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/.exec(match.text)?.[1];
        if (source && name) add(source.id, match.range.start.line + 1, match.range.end.line + 1, name);
      }
      for (const [path, symbols] of buildSymbols(scan.probes, grammars)) {
        const source = files.get(path); if (!source) continue;
        for (const symbol of symbols.symbols) if (symbol.role !== "module" && symbol.name) add(source.id, symbol.line, symbol.endLine, symbol.name);
      }
    } catch {
      for (const source of files.values()) catalog.unindexed.push({ sourceId: source.id, reason: "index-failed" });
    }
    for (const source of input.sources) if (!catalog.chunks.some((chunk) => chunk.evidence.sourceId === source.id)) add(source.id, 1, source.content.split("\n").length, null);
    catalog.chunks.sort((a, b) => a.evidence.sourceId.localeCompare(b.evidence.sourceId) || a.evidence.startLine - b.evidence.startLine || a.id.localeCompare(b.id));
    return catalog;
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

export function validateRelationCatalog(input: RelationInput, catalog: RelationCatalog): void {
  const fail = () => { throw new Error("invalid or stale relation catalog"); };
  if (!catalog || catalog.schema !== "jev-lint-relation-catalog-1" || catalog.sourcesDigest !== relationDigest(input.sources)
    || !Array.isArray(catalog.chunks) || !Array.isArray(catalog.unindexed) || new Set(catalog.chunks.map((c) => c.id)).size !== catalog.chunks.length) fail();
  for (const chunk of catalog.chunks) {
    const e = chunk.evidence, source = input.sources.find((s) => s.id === e?.sourceId);
    if (!source || !Number.isSafeInteger(e.startLine) || !Number.isSafeInteger(e.endLine) || e.startLine < 1 || e.endLine < e.startLine
      || e.endLine > source.content.split("\n").length || !e.quote.trim() || e.quote.length > 64000
      || source.content.split("\n").slice(e.startLine - 1, e.endLine).join("\n") !== e.quote || chunk.id !== relationDigest(e)
      || !(chunk.name === null || typeof chunk.name === "string" && chunk.name.trim().length > 0 && chunk.name.length <= 1000)
      || !Array.isArray(chunk.references) || chunk.references.some((name) => typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name))) fail();
  }
  if (catalog.unindexed.some((entry) => !input.sources.some((s) => s.id === entry.sourceId) || !["index-failed", "excerpt-budget"].includes(entry.reason))) fail();
}

const stop = new Set("a an and are as at be by can code const days do export for from function has have if in is it must of on only or payloads raw return shall should specification that the this to use with".split(" "));
function termsOf(text: string): Set<string> {
  return new Set((text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word).filter((word) => word.length > 2 && !stop.has(word)));
}

/** Lexical retrieval proposes comparisons. Neither a match nor a missing match is a semantic verdict. */
export function discoverRelations(raw: RelationInput, catalog: RelationCatalog, options: RelationDiscoveryOptions = {}): RelationDiscovery {
  const input = parseRelationInput(raw); validateRelationCatalog(input, catalog);
  const { maxCandidates = 100, maxCandidatesPerClaim = 3, terms = {} } = options;
  if (![maxCandidates, maxCandidatesPerClaim].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000)
    || !terms || typeof terms !== "object" || Array.isArray(terms) || Object.entries(terms).some(([id, values]) => !input.claims.some((c) => c.id === id)
      || !Array.isArray(values) || values.some((v) => typeof v !== "string" || !v.trim() || v.length > 200))) throw new Error("invalid relation discovery options");
  const result: RelationDiscovery = { schema: "jev-lint-relation-discovery-1", inputDigest: relationDigest(input), proposals: [],
    missingClaimIds: input.expectedClaimIds.filter((id) => !input.claims.some((c) => c.id === id)), unmatchedClaimIds: [], deferredClaimIds: [], excluded: [], unindexed: structuredClone(catalog.unindexed) };
  for (const claim of input.claims) {
    const query = termsOf([claim.id, claim.statement, ...(terms[claim.id] ?? [])].join(" "));
    const approved = claim.evidence.map((e) => input.sources.find((s) => s.id === e.sourceId)!).filter((s) => s.authority === "approved");
    const ranked = catalog.chunks.flatMap((chunk) => {
      if (claim.evidence.some((e) => e.sourceId === chunk.evidence.sourceId)) return [];
      const source = input.sources.find((s) => s.id === chunk.evidence.sourceId)!;
      const vocabulary = termsOf(`${chunk.name ?? source.path} ${chunk.evidence.quote}`);
      const matchedTerms = [...query].filter((term) => vocabulary.has(term)).sort();
      return matchedTerms.length ? [{ chunk, source, matchedTerms }] : [];
    }).sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.chunk.evidence.quote.length - b.chunk.evidence.quote.length || a.chunk.id.localeCompare(b.chunk.id));
    let linked = input.relations.some((r) => r.claimId === claim.id), count = 0;
    for (const { chunk, source, matchedTerms } of ranked) {
      const existing = input.relations.some((r) => r.claimId === claim.id && r.targets.some((e) => e.sourceId === source.id && e.startLine <= chunk.evidence.startLine && e.endLine >= chunk.evidence.endLine));
      const reason = approved.length && !approved.some((s) => s.scope.some((root) => root === "." || source.path === root || source.path.startsWith(`${root}/`))) ? "outside-scope"
        : existing ? "already-linked" : count >= maxCandidatesPerClaim || result.proposals.length >= Math.min(maxCandidates, 1000 - input.relations.length) ? "candidate-budget" : null;
      if (reason) {
        result.excluded.push({ claimId: claim.id, chunkId: chunk.id, reason });
        if (reason === "candidate-budget" && !result.deferredClaimIds.includes(claim.id)) result.deferredClaimIds.push(claim.id);
        continue;
      }
      const id = `discovered-${relationDigest({ claimId: claim.id, chunkId: chunk.id }).slice(0, 32)}`;
      result.proposals.push({ id, relation: { id, subject: "relation", claimId: claim.id, targets: [structuredClone(chunk.evidence)], context: [] }, matchedTerms });
      count++; linked = true;
    }
    if (!linked && !result.deferredClaimIds.includes(claim.id)) result.unmatchedClaimIds.push(claim.id);
  }
  return result;
}
