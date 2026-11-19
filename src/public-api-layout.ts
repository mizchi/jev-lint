import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { collectPublicApi, writePublicApiInputs } from "../advisory/public-api.mjs";
import { selectDocumentExcerpt } from "./document-input.ts";
import { MAX_BLOCK_CHARS } from "./text.ts";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function publicApiLayoutInputs(out: string, manifest: string, binary: string, bindingGuide?: string | null) {
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
    if (!object(item) || Object.keys(item).some(k => k !== "guide" && k !== "heading") || !nonempty(item.guide) ||
        (item.heading !== undefined && !nonempty(item.heading))) {
      throw new Error("each workflow needs a guide path and an optional heading");
    }
    const content = readFileSync(resolve(root, item.guide), "utf8");
    const heading = item.heading;
    try {
      return { guide: item.guide, heading, ...selectDocumentExcerpt(content, { heading }) };
    } catch (error) {
      throw new Error(`${item.guide}${heading ? " / " + heading : ""}: ${(error as Error).message}`);
    }
  });
  const surfaces = await collectPublicApi(entries.map(entry => resolve(root, entry.source)), binary);
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
  const lookup = tsEntries.size ? (await import("./guide-imports.ts")).guideImportLookup : undefined;
  const workflows = guides.map(({ guide, heading, startLine, endLine, quote }, index) => {
    const title = Array.from(heading ?? basename(guide)).slice(0, 48).join("").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    const file = `workflow-${index + 1}-${title}.apiworkflow`;
    const text = `Guide: ${guide}:${startLine}-${endLine}\n${quote}\n\nReviewed import paths and their exports (other paths were not inspected):\n${entryMap}\n` + (lookup?.(quote, tsEntries) ?? "");
    // A missing export is meaningful only when the model receives the entire selected map.
    if (text.length > MAX_BLOCK_CHARS) throw new Error(`${file} exceeds the text budget; narrow the guide section or selected entry map`);
    return { file, guide, heading, startLine, endLine, text };
  });
  const inventories = writePublicApiInputs(out, surfaces, bindingGuide, workflows);
  return {
    entries: inventories.map((inventory, i) => ({ ...inventory, target: entries[i].source, publicPath: entries[i].publicPath })),
    workflows: workflows.map(({ text, ...info }) => info),
  };
}
