import assert from "node:assert/strict";
import { goGuideLookups } from "../src/go-guide-imports.ts";
import { test } from "./harness.ts";

test("go-guide-imports isolates snippet scopes and omits unparseable Go", () => {
  const packages = [{ path: "example.org/io", name: "wire", exports: new Set(["Open", "Handle.Close"]) }];
  const guide = [
    "~~~go", 'import w "example.org/io"', "func read(w Handle) { w.Close() }", "~~~",
    "~~~go", "w.Open()", "~~~", "~~~go", "wire.Open(", "~~~",
    "~~~md", "```go", "wire.Open()", "```", "~~~",
  ].join("\n");
  const [unresolved, resolved] = goGuideLookups([guide, "~~~go\nwire.Open()\n~~~"], packages);
  assert.equal(unresolved, "");
  assert.match(resolved, /wire\.Open from example\.org\/io \(matched package name\): exported here/);
});
