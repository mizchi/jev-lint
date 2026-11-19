import { scanPublicSource } from "../advisory/public-api.mjs";
import { guideBlocks } from "./guide-blocks.ts";
import { lookupProvider } from "./provider-lookup.ts";

// ast-grep supplies a complete use declaration. Expand each named leaf of the
// Rust use tree; a glob has no individual import to verify.
interface ImportLeaf { path: string[]; local: string; absolute: boolean }

function usePaths(declaration: string): ImportLeaf[] {
  const tokens: string[] = declaration.match(/(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*|::|[^\s]/gu) ?? [];
  let i = tokens.indexOf("use") + 1;
  const absolute = tokens[i] === "::";
  const paths: ImportLeaf[] = [];
  function tree(prefix: string[]): boolean {
    const path = [...prefix];
    if (tokens[i] === "::") i++;
    while (i < tokens.length) {
      const token = tokens[i++];
      if (token === "{") {
        while (tokens[i] !== "}") {
          if (!tree(path)) return false;
          if (tokens[i] !== ",") break;
          i++;
        }
        return tokens[i++] === "}";
      }
      if (token === "*") return true;
      if (!/^(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(token)) return false;
      if (token !== "self" || !path.length) path.push(token.replace(/^r#/, ""));
      if (tokens[i] !== "::") {
        let local = path.at(-1)!;
        if (tokens[i] === "as") {
          local = tokens[i + 1]?.replace(/^r#/, "");
          i += 2;
        }
        paths.push({ path, local, absolute });
        return true;
      }
      i++;
    }
    return false;
  }
  return tree([]) && tokens[i] === ";" ? paths : [];
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

export function rustGuideLookup(guide: string, entries: Map<string, Set<string>>, binary: string, format: "markdown" | "rustdoc" = "markdown"): string {
  const rows = new Set<string>();
  const misplaced = new Set<string>();
  for (const { language, info, text } of guideBlocks(guide)) {
    if (language === null || (format === "rustdoc" ? !rustdocExample(info ?? "") : language.split(",")[0] !== "rust")) continue;
    const { code, hidden } = format === "rustdoc" ? rustdocSource(text) : { code: text, hidden: [] };
    const hits = scanPublicSource(binary, "Rust", code, {
      use: { kind: "use_declaration" },
      module: { kind: "identifier", inside: { kind: "mod_item", field: "name" } },
    });
    const imports = hits.filter(hit => hit.ruleId === "use").flatMap(hit => {
      const visible = !hidden.some(line => hit.range.start.line <= line && line <= hit.range.end.line);
      return usePaths(hit.text).map(leaf => ({ ...leaf, visible }));
    });
    // Without name resolution a local module or imported alias can hide a crate.
    const localNames = new Set(hits.filter(hit => hit.ruleId === "module").map(hit => hit.text.replace(/^r#/, "")));
    for (const { path, local } of imports) {
      if (path.length > 1 || local !== path[0]) localNames.add(local);
    }
    for (const { path: parts, absolute, visible } of imports) {
      if (!visible || parts.length < 2 || (!absolute && localNames.has(parts[0]))) continue;
      const name = parts.at(-1)!;
      const path = parts.slice(0, -1).join("::");
      const provider = lookupProvider(entries, path, name);
      if (provider.kind === "unreviewed") continue;
      if (provider.kind === "elsewhere") {
        const alternatives = provider.paths.map(p => "`use " + p + "::" + name + ";`");
        misplaced.add("To reproduce this use declaration against the reviewed modules, the caller must change the import for " + name +
          " from " + path + " to " + provider.paths.join(" or ") + ". Documented: `use " + path + "::" + name + ";`. Available: " + alternatives.join(" or ") + ".");
      }
      const status = provider.kind === "here" ? "exported here" : provider.kind === "elsewhere"
        ? "absent here; exported by " + provider.paths.join(", ") : "absent from all reviewed modules";
      rows.add(name + " from " + path + ": " + status);
    }
  }
  if (!rows.size) return "";
  const summary = misplaced.size ? [...misplaced].join("\n") + "\n" : "";
  return "\nRust use lookup:\n" + summary + "Rust resolves every named use import before compiling the example, including imports of structs and traits. Availability is scoped to the supplied rustdoc build.\n" + [...rows].join("\n") + "\n";
}
