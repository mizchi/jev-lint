export interface CaptureResult {
  status: "succeeded" | "requires_action" | "failed";
  captured: number;
}

export interface Gateway {
  capture(intentId: string, amountCents: number): Promise<CaptureResult>;
}

export async function capturePayment(gateway: Gateway, intentId: string, amountCents: number): Promise<number> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`amount must be a positive integer number of cents, got ${amountCents}`);
  }
  const result = await gateway.capture(intentId, amountCents);
  if (result.status !== "succeeded") {
    throw new Error(`capture of ${intentId} ${result.status}`);
  }
  return result.captured;
}

export function formatAmount(cents: number, currency: string): string {
  const units = Math.trunc(cents / 100);
  const minor = Math.abs(cents % 100).toString().padStart(2, "0");
  return `${currency} ${units}.${minor}`;
}
