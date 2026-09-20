// A module that carries its own tests, vitest in-source style. The tests
// are the block at the bottom, and they are what this file is paired with.

export interface Coupon {
  code: string;
  percent: number;
  expiresAt: number;
}

export function parseCoupon(raw: string): Coupon {
  const [code, percent, expiresAt] = raw.split(":");
  if (!code || !percent || !expiresAt) throw new Error(`malformed coupon: ${raw}`);
  return { code, percent: Number(percent), expiresAt: Number(expiresAt) };
}

export function applyCoupon(total: number, coupon: Coupon, now: number): number {
  if (coupon.expiresAt < now) throw new Error(`coupon ${coupon.code} expired`);
  if (coupon.percent < 0 || coupon.percent > 100) throw new RangeError(`percent out of range: ${coupon.percent}`);
  return total * (1 - coupon.percent / 100);
}

export function describeCoupon(coupon: Coupon): string {
  return `${coupon.code} (${coupon.percent}% off)`;
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("parseCoupon", () => {
    it("reads the three fields", () => {
      expect(parseCoupon("SAVE10:10:2000")).toEqual({ code: "SAVE10", percent: 10, expiresAt: 2000 });
    });

    it("throws on a coupon with a field missing", () => {
      expect(() => parseCoupon("SAVE10:10")).toThrow("malformed coupon");
    });
  });

  describe("applyCoupon", () => {
    it("takes the percent off the total", () => {
      expect(applyCoupon(100, { code: "SAVE10", percent: 10, expiresAt: 2000 }, 1000)).toBe(90);
    });
  });

  describe("describeCoupon", () => {
    it("names the code and the percent", () => {
      expect(describeCoupon({ code: "SAVE10", percent: 10, expiresAt: 2000 })).toBe("SAVE10 (10% off)");
    });
  });
}
