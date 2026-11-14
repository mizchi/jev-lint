import { posix } from "node:path";
import { parseRelationInput, relationDigest, type RelationInput, type RelationEvidence } from "./relation-contract.ts";
import { validateRelationCatalog, type RelationCatalog, type RelationChunk } from "./relation-discovery.ts";

export interface RelationContextOptions { maxAddedChars?: number; maxExcerpts?: number }
export interface RelationContextExpansion {
  input: RelationInput; added: Array<{ relationId: string; evidence: RelationEvidence }>;
  deferred: Array<{ relationId: string; chunkId: string; reason: "character-budget" | "excerpt-budget" | "relation-budget" }>;
}

function dependencies(input: RelationInput, catalog: RelationCatalog, evidence: RelationEvidence): RelationChunk[] {
  const source = input.sources.find((s) => s.id === evidence.sourceId)!;
  const references = new Set(evidence.quote.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const found: RelationChunk[] = [];
  const take = (sourceId: string, name: string) => {
    const matches = catalog.chunks.filter((c) => c.evidence.sourceId === sourceId && c.name === name);
    if (matches.length === 1) found.push(matches[0]);
  };
  for (const name of references) take(source.id, name);
  // Only explicit relative named imports connect files; a global same-name search is ambiguous.
  for (const match of source.content.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!match[2].startsWith(".")) continue;
    const bindings = match[1].split(",").flatMap((binding) => {
      const named = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(binding);
      return named && references.has(named[2] ?? named[1]) ? [named[1]] : [];
    });
    if (!bindings.length) continue;
    const startLine = source.content.slice(0, match.index).split("\n").length;
    const endLine = startLine + match[0].split("\n").length - 1;
    const imported = { sourceId: source.id, startLine, endLine, quote: source.content.split("\n").slice(startLine - 1, endLine).join("\n") };
    // The alias-to-definition binding is evidence too; a detached helper body cannot establish it.
    found.push({ id: relationDigest(imported), evidence: imported, name: null, references: [] });
    const path = posix.normalize(posix.join(posix.dirname(source.path), match[2]));
    const stem = path.replace(/\.(?:m?js|tsx?)$/, "");
    const sources = input.sources.filter((s) => s.ref === input.sourceSha && (s.kind === "code" || s.kind === "test")
      && [path, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${path}/index.ts`, `${path}/index.js`].includes(s.path));
    if (sources.length !== 1) continue;
    for (const name of bindings) take(sources[0].id, name);
  }
  return found;
}

export function expandRelationContext(raw: RelationInput, catalog: RelationCatalog, relationIds: string[], { maxAddedChars = 24000, maxExcerpts = 20 }: RelationContextOptions = {}): RelationContextExpansion {
  const input = parseRelationInput(raw); validateRelationCatalog(input, catalog);
  if (![maxAddedChars, maxExcerpts].every((n) => Number.isSafeInteger(n) && n >= 0) || !Array.isArray(relationIds)
    || new Set(relationIds).size !== relationIds.length || relationIds.some((id) => !input.relations.some((r) => r.id === id))) throw new Error("invalid relation context options");
  const result: RelationContextExpansion = { input, added: [], deferred: [] }; let chars = 0;
  for (const relation of input.relations.filter((r) => relationIds.includes(r.id))) {
    const supplied = [...relation.targets, ...relation.context];
    const seen = new Set(supplied.map((e) => relationDigest(e)));
    for (const chunk of supplied.flatMap((e) => dependencies(input, catalog, e))) {
      if (seen.has(chunk.id) || supplied.some((e) => e.sourceId === chunk.evidence.sourceId && e.startLine <= chunk.evidence.startLine && e.endLine >= chunk.evidence.endLine)) continue;
      seen.add(chunk.id);
      const reason = relation.context.length >= 20 ? "relation-budget" : result.added.length >= maxExcerpts ? "excerpt-budget" : chars + chunk.evidence.quote.length > maxAddedChars ? "character-budget" : null;
      if (reason) { result.deferred.push({ relationId: relation.id, chunkId: chunk.id, reason }); continue; }
      relation.context.push(structuredClone(chunk.evidence)); chars += chunk.evidence.quote.length;
      result.added.push({ relationId: relation.id, evidence: structuredClone(chunk.evidence) });
    }
  }
  return result;
}
