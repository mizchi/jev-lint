import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { collectPublicApi, collectPublicNames, writePublicApiInputs } from "../advisory/public-api.mjs";
import { selectDocumentExcerpt } from "./document-input.ts";
import { goGuideLookups } from "./go-guide-imports.ts";
import { rustGuideLookup } from "./rust-guide-imports.ts";
import { MAX_BLOCK_CHARS } from "./text.ts";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function publicApiLayoutInputs(out: string, manifest: string, binary: string, bindingGuide?: string | null, workflowsOnly = false) {
  const layout: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (!object(layout) || !object(layout.entries) || !Object.keys(layout.entries).length ||
      !Array.isArray(layout.workflows) || !layout.workflows.length) {
    throw new Error("layout needs an entries object mapping import paths to sources and a nonempty workflows array");
  }
  const root = dirname(resolve(manifest));
  const entries = Object.entries(layout.entries).map(([publicPath, source]) => {
    if (!nonempty(publicPath) || /\s/.test(publicPath) || !nonempty(source)) throw new Error("invalid public entry or source path");
    return { publicPath, source };
  });
  const guides = layout.workflows.map((item: unknown) => {
    if (!object(item) || Object.keys(item).some(k => k !== "guide" && k !== "heading" && k !== "guideFormat") || !nonempty(item.guide) ||
        (item.heading !== undefined && !nonempty(item.heading))) {
      throw new Error("each workflow needs a guide path and an optional heading");
    }
    const format = item.guideFormat;
    if (format !== undefined && format !== "markdown" && format !== "rustdoc") throw new Error("guideFormat must be markdown or rustdoc");
    const content = readFileSync(resolve(root, item.guide), "utf8");
    const heading = item.heading;
    try {
      return { guide: item.guide, heading, format, ...selectDocumentExcerpt(content, { heading }) } as const;
    } catch (error) {
      throw new Error(`${item.guide}${heading ? " / " + heading : ""}: ${(error as Error).message}`);
    }
  });
  const sources = entries.map(entry => resolve(root, entry.source));
  const detailed = workflowsOnly ? undefined : await collectPublicApi(sources, binary);
  const surfaces = detailed ?? await collectPublicNames(sources, binary);
  const entryMap = surfaces.map((surface, i) => {
    const names = surface.entries.map(binding => (binding.typeOnly ? "type " : "") + binding.name +
      (binding.alias ? " (alias of " + binding.alias + ")" : "")).sort();
    return `${entries[i].publicPath}: ${names.join(", ") || "(no exported names)"}`;
  }).join("\n");
  const tsEntries = new Map<string, Map<string, boolean>>();
  for (const [i, surface] of surfaces.entries()) {
    if (surface.language === "typescript") {
      tsEntries.set(entries[i].publicPath, new Map(surface.entries.map(binding => [binding.name, !!binding.typeOnly])));
    }
  }
  const rustEntries = new Map(surfaces.flatMap((surface, i) => surface.language === "rust"
    ? [[entries[i].publicPath, new Set(surface.entries.map(binding => binding.name))] as const] : []));
  const lookup = tsEntries.size ? (await import("./guide-imports.ts")).guideImportLookup : undefined;
  const goPackages = surfaces.flatMap((surface, i) => surface.packageName
    ? [{ path: entries[i].publicPath, name: surface.packageName, exports: new Set(surface.entries.map(entry => entry.name)) }]
    : []);
  const goLookups = goGuideLookups(guides.map(guide => guide.quote), goPackages);
  const workflows = guides.map(({ guide, heading, startLine, endLine, quote, format }, index) => {
    const title = Array.from(heading ?? basename(guide)).slice(0, 48).join("").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    const file = `workflow-${index + 1}-${title}.apiworkflow`;
    const text = `Guide: ${guide}:${startLine}-${endLine}\n${quote}\n\nReviewed import paths and their exports (other paths were not inspected):\n${entryMap}\n` + (lookup?.(quote, tsEntries) ?? "") + (goLookups[index] ?? "") +
      (rustEntries.size ? rustGuideLookup(quote, rustEntries, binary, format) : "");
    // A missing export is meaningful only when the model receives the entire selected map.
    if (text.length > MAX_BLOCK_CHARS) throw new Error(`${file} exceeds the text budget; narrow the guide section or selected entry map`);
    return { file, guide, heading, ...(format && { guideFormat: format }), startLine, endLine, text };
  });
  const inventories = writePublicApiInputs(out, detailed ?? [], bindingGuide, workflows);
  const records = entries.map(({ source, publicPath }, i) => ({
    ...(inventories[i] ?? { count: surfaces[i].entries.length }), target: source, publicPath,
  }));
  return {
    entries: records,
    workflows: workflows.map(({ text, ...info }) => info),
  };
}
