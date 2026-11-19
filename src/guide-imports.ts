import ts from "../advisory/compiler.mjs";

const scriptExtensions = new Map(Object.entries({ ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", jsx: "jsx" }));

function* guideReferences(markdown: string) {
  let fence: { marker: string; extension?: string } | undefined;
  let lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) {
      if (marker) {
        const language = marker[2].trim().split(/\s+/)[0];
        fence = { marker: marker[1], extension: scriptExtensions.get(language.toLowerCase()) };
      } else if (line.includes("from")) {
        // Skip longer code spans: the apparent provider inside one is quoted code.
        const prose = line.replace(/(?<!`)(`{2,})(?!`).*?(?<!`)\1(?!`)/g, "…");
        for (const match of prose.matchAll(/(?<![\\`])`([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)`[ \t]+from[ \t]+`([^`\s]+)`(?!`)/gu)) {
          yield { name: match[1], path: match[2], prose: true };
        }
      }
    } else if (marker && marker[1].startsWith(fence.marker) && !marker[2].trim()) {
      if (fence.extension) yield* namedImports(fence.extension, lines.join("\n"));
      fence = undefined;
      lines = [];
    } else if (fence.extension) {
      lines.push(line);
    }
  }
  if (fence?.extension) yield* namedImports(fence.extension, lines.join("\n"));
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
    const names = entries.get(path);
    if (!names) continue;
    includesProse ||= prose;
    const subject = name + " from " + path;
    const typeOnly = names.get(name);
    if (typeOnly !== undefined) {
      rows.add(subject + (typeOnly ? ": exported here as type only" : ": exported here"));
    } else {
      const other = [...entries].filter(([, exports]) => exports.has(name)).map(([entry]) => entry);
      const row = subject + (other.length ? ": absent here; exported by " + other.join(", ") : ": absent from all reviewed entries");
      rows.add(row);
      if (other.length) missing.add(subject);
      else hasUnprovidedName = true;
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
