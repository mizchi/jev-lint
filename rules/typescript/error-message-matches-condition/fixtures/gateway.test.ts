import { describe, expect, it, vi } from "vitest";
import { charge, type ChargeRequest, type Gateway } from "../billing";

class FakeGateway implements Gateway {
  calls: ChargeRequest[] = [];

  async charge(req: ChargeRequest): Promise<{ id: string }> {
    this.calls.push(req);
    if (req.amountCents === 999) {
      throw new Error("card declined");
    }
    return { id: `ch_${this.calls.length}` };
  }
}

describe("charge", () => {
  it("returns the gateway's charge id", async () => {
    const gateway = new FakeGateway();
    const result = await charge(gateway, { amountCents: 1200, customerId: "c_1" });
    expect(result).toEqual({ ok: true, chargeId: "ch_1" });
  });

  it("reports a declined card as a failure", async () => {
    const gateway = new FakeGateway();
    const result = await charge(gateway, { amountCents: 999, customerId: "c_1" });
    expect(result).toEqual({ ok: false, reason: "card declined" });
  });

  it("retries once on a reset connection", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (fetchImpl.mock.calls.length === 1) {
        throw new Error("ECONNRESET");
      }
      return new Response(JSON.stringify({ id: "ch_9" }));
    });
    const result = await charge({ charge: (req) => fetchImpl(`/charge/${req.customerId}`).then((r) => r.json()) }, { amountCents: 500, customerId: "c_2" });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("charge with an inline gateway", () => {
  it("surfaces a gateway outage as a failure", async () => {
    const gateway: Gateway = {
      async charge(req) {
        if (req.customerId === "c_down") {
          throw new Error("gateway unavailable");
        }
        return { id: "ch_ok" };
      },
    };
    const result = await charge(gateway, { amountCents: 100, customerId: "c_down" });
    expect(result).toEqual({ ok: false, reason: "gateway unavailable" });
  });
});
