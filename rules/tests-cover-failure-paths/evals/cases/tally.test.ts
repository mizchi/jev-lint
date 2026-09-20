import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertReportShape, renderReport, type RenderResult } from "./tally";

function expectFailure(result: RenderResult): string {
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
}

describe("renderReport", () => {
  it("lays rows out under an underlined title", async () => {
    const result = await renderReport("Sales", async () => [
      { label: "north", value: 12 },
      { label: "southwest", value: 3 },
    ]);
    assert.deepEqual(result, { ok: true, text: "Sales\n=====\nnorth      12\nsouthwest  3" });
  });

  it("reports a row-loading failure instead of throwing", async () => {
    const result = await renderReport("Sales", async () => {
      throw new Error("warehouse offline");
    });
    const error = expectFailure(result);
    assert.match(error, /warehouse offline/);
  });
});

describe("assertReportShape", () => {
  it("passes a well-formed report through", () => {
    assert.doesNotThrow(() => assertReportShape({ title: "x", rows: [] }));
  });

  it("rejects a value without rows", () => {
    assert.throws(() => assertReportShape({ title: "x" }), /rows array/);
  });
});
