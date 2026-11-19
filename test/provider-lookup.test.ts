import assert from "node:assert/strict";
import { lookupProvider } from "../src/provider-lookup.ts";
import { test } from "./harness.ts";

test("provider-lookup keeps an unreviewed path distinct from a missing export", () => {
  const entries = new Map([["root", new Set(["read"])], ["other", new Set(["write"])], ["adapter", new Set(["write"])]]);
  assert.deepEqual(lookupProvider(entries, "root", "read"), { kind: "here" });
  assert.deepEqual(lookupProvider(entries, "root", "write"), { kind: "elsewhere", paths: ["other", "adapter"] });
  assert.deepEqual(lookupProvider(entries, "root", "open"), { kind: "absent" });
  assert.deepEqual(lookupProvider(entries, "external", "read"), { kind: "unreviewed" });
});
