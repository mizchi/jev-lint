import { describe, expect, it } from "vitest";
import { drawSparkline, parseChartConfig } from "./sparkline.ts";
import { hasInk, pixelAt, renderToCanvas } from "./test-utils/canvas.ts";

const points = [
  { day: 0, value: 0.2 },
  { day: 1, value: 0.6 },
  { day: 2, value: 0.4 },
];

describe("drawSparkline", () => {
  it("draws without throwing when a point has no value", () => {
    const withGap = [...points, { day: 3, value: null }];
    expect(() => renderToCanvas(120, 40, (ctx) => drawSparkline(ctx, withGap))).not.toThrow();
  });

  it("draws the line", () => {
    const canvas = renderToCanvas(120, 40, (ctx) => drawSparkline(ctx, points));
    expect(hasInk(canvas)).toBe(true);
  });

  it("does not draw the marker for a point with no value", () => {
    const withGap = [{ day: 0, value: null }, ...points];
    const canvas = renderToCanvas(120, 40, (ctx) => drawSparkline(ctx, withGap, { marker: 0 }));
    expect(hasInk(canvas)).toBe(true);
  });

  it("draws the marker in the accent colour", () => {
    const canvas = renderToCanvas(120, 40, (ctx) => drawSparkline(ctx, points, { marker: 1 }));
    expect(pixelAt(canvas, 60, 16)).toEqual([37, 99, 235, 255]);
  });

  it("offsets the chart by the given padding", () => {
    expect(() => renderToCanvas(140, 60, (ctx) => drawSparkline(ctx, points, { padding: 10 }))).not.toThrow();
  });
});

describe("parseChartConfig", () => {
  it("accepts the default config", () => {
    expect(() => parseChartConfig({ min: 0, max: 1 })).not.toThrow();
  });

  it("clamps a max below the min to the min", () => {
    expect(() => parseChartConfig({ min: 0.5, max: 0.1 })).not.toThrow();
  });
});
