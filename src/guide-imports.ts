import { lookupProvider } from "./provider-lookup.ts";
import { guideBlocks } from "./guide-blocks.ts";
import ts from "../advisory/compiler.mjs";

const scriptExtensions = new Map(Object.entries({ ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", jsx: "jsx" }));

function* guideReferences(markdown: string) {
  for (const { language, text } of guideBlocks(markdown)) {
    if (language !== null) {
      const extension = scriptExtensions.get(language);
      if (extension) yield* namedImports(extension, text);
    } else if (text.includes("from")) {
      // Skip longer code spans: the apparent provider inside one is quoted code.
      const prose = text.replace(/(?<!`)(`{2,})(?!`).*?(?<!`)\1(?!`)/g, "…");
      for (const match of prose.matchAll(/(?<![\\`])`([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)`[ \t]+from[ \t]+`([^`\s]+)`(?!`)/gu)) {
        yield { name: match[1], path: match[2], prose: true };
      }
    }
  }
}

function* namedImports(extension: string, code: string) {
  const file = ts.createSourceFile("example." + extension, code, ts.ScriptTarget.Latest);
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      yield { name: (item.propertyName ?? item.name).text, path: node.moduleSpecifier.text, prose: false };
    }
  }
}

export function guideImportLookup(guide: string, entries: Map<string, Map<string, boolean>>): string {
  const rows = new Set<string>();
  const missing = new Set<string>();
  let hasUnprovidedName = false;
  let includesProse = false;
  for (const { name, path, prose } of guideReferences(guide)) {
    const provider = lookupProvider(entries, path, name);
    if (provider.kind === "unreviewed") continue;
    includesProse ||= prose;
    const subject = name + " from " + path;
    if (provider.kind === "here") {
      rows.add(subject + (entries.get(path)?.get(name) ? ": exported here as type only" : ": exported here"));
    } else if (provider.kind === "elsewhere") {
      rows.add(subject + ": absent here; exported by " + provider.paths.join(", "));
      missing.add(subject);
    } else {
      rows.add(subject + ": absent from all reviewed entries");
      hasUnprovidedName = true;
    }
  }
  if (!rows.size) return "";
  if (includesProse) {
    const summary = missing.size ? "Documented providers missing the claimed name: " + [...missing].join(", ") + "."
      : hasUnprovidedName ? "A documented name is absent from all reviewed entries." : "Every checked name is listed at its documented provider.";
    return "\nProvider lookup for explicit names and paths in the guide:\n" + [summary, ...rows].join("\n") + "\n";
  }
  const summary = missing.size ? "Named imports missing at their documented entries: " + [...missing].join(", ") + "."
    : hasUnprovidedName ? "No missing named import has a provider on another reviewed entry." : "Every checked named import is listed at its documented entry.";
  return "\nImport lookup for the documented example:\n" + [summary, ...rows].join("\n") + "\n";
}
