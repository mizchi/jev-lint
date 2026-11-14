import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { listFiles, isExcludedBy } from "./files.ts";
import { relationDigest } from "./relation-contract.ts";
import { parseDocumentManifest, documentSnapshotDigest, type DocumentManifest, type DocumentInput, type DocumentExcerpt, type DocumentSelector } from "./document-contract.ts";

export interface DocumentPlanOptions { cwd?: string; maxComparisons?: number; maxExcerptChars?: number }

function select(content: string, selector: DocumentSelector): { startLine: number; endLine: number; quote: string } {
  const lines = content.split("\n"), headings: Array<{ line: number; level: number; name: string }> = [];
  let fence: { marker: string; size: number } | null = null;
  for (const [i, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = { marker: marker[0], size: marker.length }; else if (marker[0] === fence.marker && marker.length >= fence.size) fence = null; continue; }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) headings.push({ line: i, level: heading[1].length, name: heading[2] });
  }
  let start = 0, end = lines.length;
  if (selector.heading) {
    const found = headings.filter((h) => h.name === selector.heading);
    if (found.length !== 1) throw new Error(found.length ? "ambiguous-selector" : "missing-selector");
    const selected = found[0]; start = selected.line;
    end = headings.find((h) => h.line > start && h.level <= selected.level)?.line ?? end;
  }
  if (selector.contains) {
    const blocks: Array<{ start: number; end: number }> = []; let block = start;
    for (let i = start; i <= end; i++) if (i === end || !lines[i].trim()) { if (i > block) blocks.push({ start: block, end: i }); block = i + 1; }
    const found = blocks.filter((b) => lines.slice(b.start, b.end).join("\n").includes(selector.contains!));
    if (found.length !== 1) throw new Error(found.length ? "ambiguous-selector" : "missing-selector");
    start = found[0].start; end = found[0].end;
  }
  while (end > start && !lines[end - 1].trim()) end--;
  if (end <= start) throw new Error("missing-selector");
  return { startLine: start + 1, endLine: end, quote: lines.slice(start, end).join("\n") };
}

/** A working-tree snapshot carries content digests; it never pretends to be an immutable git commit. */
export function prepareDocuments(raw: DocumentManifest, { cwd = process.cwd(), maxComparisons = 100, maxExcerptChars = 64000 }: DocumentPlanOptions = {}): DocumentInput {
  const manifest = parseDocumentManifest(raw); cwd = resolve(cwd);
  if (![maxComparisons, maxExcerptChars].every((n) => Number.isSafeInteger(n) && n >= 0) || maxComparisons > 1000 || maxExcerptChars > 64000) throw new Error("invalid document budgets");
  const body: Omit<DocumentInput, "snapshotDigest"> = { schema: "jev-lint-documents-input-1", manifestDigest: relationDigest(manifest), sources: [], comparisons: [], issues: [], deferred: [], unboundDocuments: [], expectedComparisons: manifest.comparisons.length };
  const contents = new Map<string, string>(); let total = 0;
  for (const [id, source] of Object.entries(manifest.files)) {
    let contentHash: string | null = null;
    try {
      let path = cwd;
      for (const part of source.path.split("/")) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw new Error(); }
      const stat = lstatSync(path); if (!stat.isFile() || stat.size > 256000) throw new Error();
      const content = readFileSync(path, "utf8"); total += content.length;
      if (total > 2_000_000) { body.issues.push({ path: source.path, code: "source-budget" }); }
      else { contentHash = relationDigest(content); contents.set(id, content); }
    } catch { body.issues.push({ path: source.path, code: "source-unavailable" }); }
    body.sources.push({ id, ...source, contentHash });
  }
  const read = (selector: DocumentSelector): DocumentExcerpt => {
    const source = manifest.files[selector.source], content = contents.get(selector.source);
    if (content === undefined) throw new Error("source-unavailable");
    const selected = select(content, selector);
    if (selected.quote.length > maxExcerptChars) throw new Error("excerpt-budget");
    return { source: selector.source, path: source.path, ...selected, contentHash: relationDigest(selected.quote) };
  };
  const bound = new Set<string>();
  for (const comparison of manifest.comparisons) {
    bound.add(comparison.reference.source); bound.add(comparison.target.source);
    if (body.comparisons.length >= maxComparisons) { body.deferred.push(comparison.id); continue; }
    try {
      const { context, ...definition } = comparison;
      const item = { ...definition, reference: read(comparison.reference), target: read(comparison.target), context: (context ?? []).map(read) };
      if (JSON.stringify(item).length > maxExcerptChars) throw new Error("excerpt-budget");
      body.comparisons.push(item);
    } catch (error) {
      body.issues.push({ comparisonId: comparison.id, path: manifest.files[comparison.target.source].path, code: (error as Error).message as DocumentInput["issues"][number]["code"] });
    }
  }
  body.unboundDocuments = Object.entries(manifest.files).filter(([id, source]) => source.role === "document" && !bound.has(id)).map(([, source]) => source.path).sort();
  for (const root of manifest.roots ?? []) {
    try {
      let full = cwd;
      for (const part of root.split("/")) { full = join(full, part); if (lstatSync(full).isSymbolicLink()) throw new Error(); }
      const stat = lstatSync(full); if (stat.isDirectory()) readdirSync(full); else if (!stat.isFile()) throw new Error();
    } catch { body.issues.push({ path: root, code: "inventory-unavailable" }); continue; }
    for (const path of listFiles([root], cwd).filter((path) => /\.(?:md|mdx|markdown)$/i.test(path))) {
      if (!(manifest.exclude ?? []).some((excluded) => isExcludedBy(path, excluded)) && !body.sources.some((source) => source.path === path)
        && !body.issues.some((issue) => issue.path === path && issue.code === "unregistered-document")) body.issues.push({ path, code: "unregistered-document" });
    }
  }
  return { ...body, snapshotDigest: documentSnapshotDigest(body) };
}
