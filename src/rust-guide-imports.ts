import { scanPublicSource } from "../advisory/public-api.mjs";
import { guideBlocks } from "./guide-blocks.ts";
import { lookupProvider } from "./provider-lookup.ts";

// ast-grep supplies a complete use declaration. Expand each named leaf of the
// Rust use tree; a glob has no individual import to verify.
interface ImportLeaf { path: string[]; local: string; absolute: boolean; spelling: string; item: string }

function usePaths(declaration: string): ImportLeaf[] {
  const tokens: string[] = declaration.match(/(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*|::|[^\s]/gu) ?? [];
  let i = tokens.indexOf("use") + 1;
  const paths: ImportLeaf[] = [];
  function tree(prefix: string[], parentAbsolute: boolean): boolean {
    const absolute = parentAbsolute || tokens[i] === "::";
    const path = [...prefix];
    if (tokens[i] === "::") i++;
    while (i < tokens.length) {
      const token = tokens[i++];
      if (token === "{") {
        while (tokens[i] !== "}") {
          if (!tree(path, absolute)) return false;
          if (tokens[i] !== ",") break;
          i++;
        }
        return tokens[i++] === "}";
      }
      if (token === "*") return true;
      if (!/^(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(token)) return false;
      if (token !== "self" || !path.length) path.push(token);
      if (tokens[i] !== "::") {
        const item = path.at(-1)!;
        let local = item;
        let alias = "";
        if (tokens[i] === "as") {
          if (!tokens[i + 1]) return false;
          local = tokens[i + 1];
          alias = " as " + local;
          i += 2;
        }
        paths.push({ path: path.map(part => part.replace(/^r#/, "")), local: local.replace(/^r#/, ""), absolute,
          spelling: (absolute ? "::" : "") + path.join("::") + alias, item: item + alias });
        return true;
      }
      i++;
    }
    return false;
  }
  return tree([], false) && tokens[i] === ";" ? paths : [];
}

function rustdocExample(info: string): boolean {
  return info === "" || info.split(/[,\s]+/).every(tag =>
    /^(?:rust|no_run|should_panic|standalone_crate|test_harness|edition(?:2015|2018|2021|2024))$/.test(tag));
}

function rustdocSource(text: string) {
  const hidden: number[] = [];
  const code = text.split("\n").map((line, index) => {
    // rustdoc compiles hidden setup. Its names can shadow a crate in visible lines.
    if (/^\s*#(?: |$)/.test(line)) {
      hidden.push(index);
      return line.replace(/^(\s*)# ?/, "$1");
    }
    return line.replace(/^(\s*)##/, "$1#");
  }).join("\n");
  return { code, hidden };
}

function misplacedImport(
  { absolute, spelling, item }: ImportLeaf, name: string, path: string, providers: string[], group?: string,
): string {
  const alternatives = providers.map(p => "`use " + (absolute ? "::" : "") + p + "::" + item + ";`").join(" or ");
  if (group) {
    return [
      "The guide tells the caller to add `" + group + "`.",
      "Failing setup step: import " + name + " from " + path + ".",
      "Documented provider: " + providers.join(" or ") + ".",
      "Smallest caller reproducer (expanded from the guide):",
      "```rust", "use " + spelling + ";", "```",
      "Public API resolution: " + path + " has no documented " + name +
        ". The caller would have to replace this statement with " + alternatives + " to finish the guide's setup.",
    ].join("\n");
  }
  return "To reproduce this use declaration against the reviewed modules, the caller must change the import for " + name +
    " from " + path + " to " + providers.join(" or ") + ". Documented: `use " + spelling + ";`. Available: " + alternatives + ".";
}

export function rustGuideLookup(guide: string, entries: Map<string, Set<string>>, binary: string, format: "markdown" | "rustdoc" = "markdown"): string {
  const rows = new Set<string>();
  const misplaced = new Set<string>();
  const failingGroups = new Set<string>();
  const lookupRows: { row: string; resolvedGroup?: string }[] = [];
  for (const { language, info, text } of guideBlocks(guide)) {
    if (language === null || (format === "rustdoc" ? !rustdocExample(info ?? "") : language.split(",")[0] !== "rust")) continue;
    const { code, hidden } = format === "rustdoc" ? rustdocSource(text) : { code: text, hidden: [] };
    const hits = scanPublicSource(binary, "Rust", code, {
      use: { kind: "use_declaration" },
      module: { kind: "identifier", inside: { kind: "mod_item", field: "name" } },
    });
    const imports = hits.filter(hit => hit.ruleId === "use").flatMap(hit => {
      const visible = !hidden.some(line => hit.range.start.line <= line && line <= hit.range.end.line);
      const leaves = usePaths(hit.text);
      const group = leaves.length > 1 ? hit.text : undefined;
      return leaves.map(leaf => ({ ...leaf, visible, group }));
    });
    // Without name resolution a local module or imported alias can hide a crate.
    const localNames = new Set(hits.filter(hit => hit.ruleId === "module").map(hit => hit.text.replace(/^r#/, "")));
    for (const { path, local } of imports) {
      if (path.length > 1 || local !== path[0]) localNames.add(local);
    }
    for (const leaf of imports) {
      const { path: parts, absolute, visible, group } = leaf;
      if (!visible || parts.length < 2 || (!absolute && localNames.has(parts[0]))) continue;
      const name = parts.at(-1)!;
      const path = parts.slice(0, -1).join("::");
      const provider = lookupProvider(entries, path, name);
      if (provider.kind === "unreviewed") continue;
      if (provider.kind === "elsewhere") {
        if (group) failingGroups.add(group);
        misplaced.add(misplacedImport(leaf, name, path, provider.paths, group));
      }
      const status = provider.kind === "here" ? "exported here" : provider.kind === "elsewhere"
        ? "absent here; exported by " + provider.paths.join(", ") : "absent from all reviewed modules";
      const row = name + " from " + path + ": " + status;
      lookupRows.push({ row, resolvedGroup: provider.kind === "here" ? group : undefined });
    }
  }
  for (const { row, resolvedGroup } of lookupRows) {
    if (!resolvedGroup || !failingGroups.has(resolvedGroup)) rows.add(row);
  }
  if (!rows.size) return "";
  const summary = misplaced.size ? [...misplaced].join("\n") + "\n" : "";
  const scope = failingGroups.size ? "" : "Rust resolves every named use import before compiling the example, including imports of structs and traits. Availability is scoped to the supplied rustdoc build.\n";
  return "\nRust use lookup:\n" + summary + scope + [...rows].join("\n") + "\n";
}
