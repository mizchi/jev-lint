import { describe, expect, it, vi } from "vitest";
import { capturePayment, formatAmount, type Gateway } from "./payments";

function gatewayReturning(captured: number): Gateway {
  return { capture: vi.fn(async () => ({ status: "succeeded" as const, captured })) };
}

describe("capturePayment", () => {
  it("captures the requested amount through the gateway", async () => {
    const gateway = gatewayReturning(1999);
    await expect(capturePayment(gateway, "pi_1", 1999)).resolves.toBe(1999);
    expect(gateway.capture).toHaveBeenCalledWith("pi_1", 1999);
  });

  it("returns whatever the gateway reports as captured", async () => {
    const gateway = gatewayReturning(1500);
    await expect(capturePayment(gateway, "pi_2", 1999)).resolves.toBe(1500);
  });
});

describe("formatAmount", () => {
  it("prints whole units and two minor digits", () => {
    expect(formatAmount(1999, "USD")).toBe("USD 19.99");
    expect(formatAmount(5, "EUR")).toBe("EUR 0.05");
  });
});
