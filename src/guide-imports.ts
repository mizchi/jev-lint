import ts from "../advisory/compiler.mjs";

const scriptExtensions = new Map(Object.entries({ ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", jsx: "jsx" }));

function* scriptExamples(markdown: string) {
  let fence: { marker: string; extension?: string } | undefined;
  let lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) {
      if (marker) {
        const language = marker[2].trim().split(/\s+/)[0];
        fence = { marker: marker[1], extension: scriptExtensions.get(language.toLowerCase()) };
      }
    } else if (marker && marker[1].startsWith(fence.marker) && !marker[2].trim()) {
      if (fence.extension) yield { extension: fence.extension, code: lines.join("\n") };
      fence = undefined;
      lines = [];
    } else if (fence.extension) {
      lines.push(line);
    }
  }
  if (fence?.extension) yield { extension: fence.extension, code: lines.join("\n") };
}

export function guideImportLookup(guide: string, entries: Map<string, Map<string, boolean>>): string {
  const rows = new Set<string>();
  const missing = new Set<string>();
  let hasUnprovidedName = false;
  for (const example of scriptExamples(guide)) {
    const file = ts.createSourceFile("example." + example.extension, example.code, ts.ScriptTarget.Latest);
    for (const node of file.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const path = node.moduleSpecifier.text;
      const bindings = node.importClause?.namedBindings;
      const names = entries.get(path);
      if (!names || !bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        const name = (item.propertyName ?? item.name).text;
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
    }
  }
  if (!rows.size) return "";
  const summary = missing.size ? "Named imports missing at their documented entries: " + [...missing].join(", ") + "."
    : hasUnprovidedName ? "No missing named import has a provider on another reviewed entry." : "Every checked named import is listed at its documented entry.";
  return "\nImport lookup for the documented example:\n" + [summary, ...rows].join("\n") + "\n";
}
