import assert from "node:assert/strict";
import { guideBlocks } from "../src/guide-blocks.ts";
import { test } from "./harness.ts";

test("guide-blocks preserves fence boundaries and the language of an unclosed example", () => {
  const input = ["Prose", "~~~~md", "~~~go", "p.Call()", "~~~", "~~~~", "```Go title", "q.Call()"].join("\n");
  assert.deepEqual([...guideBlocks(input)], [
    {language: null, text: "Prose"}, {language: "md", text: "~~~go\np.Call()\n~~~"}, {language: "go", text: "q.Call()"},
  ]);
});
