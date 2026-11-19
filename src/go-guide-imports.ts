import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lookupProvider } from "./provider-lookup.ts";
import { guideBlocks } from "./guide-blocks.ts";

interface Package {
  path: string;
  name: string;
  exports: Set<string>;
}

interface Selector {
  Path: string;
  Qualifier: string;
  Name: string;
  Inferred: boolean;
}

export function goGuideLookups(guides: string[], packages: Package[]): string[] {
  if (!packages.length) return [];
  const examples = guides.map(guide => Array.from(guideBlocks(guide))
    .filter(block => block.language === "go" || block.language === "golang").map(block => block.text));
  if (!examples.some(blocks => blocks.length)) return [];
  const input = { packages: Object.fromEntries(packages.map(pkg => [pkg.path, pkg.name])), guides: examples };
  const helper = fileURLToPath(new URL("../advisory/go-guide/main.go", import.meta.url));
  const results: Selector[][] = JSON.parse(execFileSync("go", ["run", helper], {
    input: JSON.stringify(input), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    // The parser runs on this host, even when go list inventories a cross-compiled target.
    env: {
      ...process.env, GOOS: "", GOARCH: "", GOENV: "off", GOFLAGS: "",
      GO111MODULE: "off", GOWORK: "off", GOTOOLCHAIN: "local", CGO_ENABLED: "0",
    },
  }));
  const byPath = new Map(packages.map(pkg => [pkg.path, pkg.exports]));
  return results.map(selectors => {
    if (!selectors.length) return "";
    const rows = new Set<string>();
    const misplaced = new Set<string>();
    let hasMissingName = false;
    for (const { Path: path, Qualifier: qualifier, Name: name, Inferred: inferred } of selectors) {
      const subject = qualifier + "." + name;
      const provider = lookupProvider(byPath, path, name);
      if (provider.kind === "unreviewed") continue;
      let status = "exported here";
      if (provider.kind === "elsewhere") {
        status = "absent here; exported by " + provider.paths.join(", ");
        misplaced.add(subject);
      } else if (provider.kind === "absent") {
        status = "absent from all reviewed packages";
        hasMissingName = true;
      }
      const source = inferred ? "matched package name" : "explicit import";
      rows.add(subject + " from " + path + " (" + source + "): " + status);
    }
    const summary = misplaced.size ? "Selectors absent from the documented package and exported by a different reviewed package: " + [...misplaced].join(", ") + "."
      : hasMissingName ? "No reviewed package supplies the missing selectors." : "Each checked selector is exported from its matched package.";
    return "\nGo package selector lookup:\n" + [summary, ...rows].join("\n") + "\n";
  });
}
