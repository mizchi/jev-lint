import type { Api, Customer, Invoice, Mailer, ParseError, Result } from "../types";
import { logger } from "../logger";

export class BillingError extends Error {}

const EMPTY_INVOICE: Invoice = { id: "", customerId: "", lines: [], totalCents: 0 };

export async function listInvoices(api: Api, customerId: string): Promise<Invoice[]> {
  try {
    const res = await api.get(`/customers/${customerId}/invoices`);
    return res.data.items;
  } catch (e) {
    logger.warn("listInvoices failed", { customerId, error: e });
    return [];
  }
}

export async function fetchExchangeRate(api: Api, base: string, quote: string): Promise<number> {
  try {
    const res = await api.get(`/rates/${base}/${quote}`);
    return res.data.rate;
  } catch {
    return 1;
  }
}

export async function recordPayment(repo: { insert: (p: unknown) => Promise<void> }, payment: { invoiceId: string; amountCents: number }): Promise<void> {
  try {
    await repo.insert(payment);
  } catch (e) {
    logger.error("failed to record payment", { invoiceId: payment.invoiceId, error: e });
  }
}

export function parseInvoice(text: string): Invoice {
  try {
    return JSON.parse(text) as Invoice;
  } catch {
    return EMPTY_INVOICE;
  }
}

export function parseInvoiceResult(text: string): Result<Invoice, ParseError> {
  try {
    return { ok: true, value: JSON.parse(text) as Invoice };
  } catch (e) {
    return { ok: false, error: { kind: "parse", message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function findInvoice(api: Api, id: string): Promise<Invoice | null> {
  try {
    const res = await api.get(`/invoices/${id}`);
    return res.data;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function loadCustomer(api: Api, id: string): Promise<Customer> {
  try {
    const res = await api.get(`/customers/${id}`);
    return res.data;
  } catch (e) {
    throw new BillingError(`failed to load customer ${id}`, { cause: e });
  }
}

export async function sendReceipt(mailer: Mailer, invoice: Invoice, to: string): Promise<void> {
  try {
    await mailer.send({ to, subject: `Receipt for ${invoice.id}`, body: renderReceipt(invoice) });
  } catch (e) {
    logger.error("receipt not sent", { invoiceId: invoice.id, to, error: e });
    throw e;
  }
}

export async function tryChargeCard(api: Api, invoice: Invoice): Promise<string | null> {
  try {
    const res = await api.post("/charges", { invoiceId: invoice.id, amountCents: invoice.totalCents });
    return res.data.id;
  } catch {
    return null;
  }
}

export async function loadPlanOrDefault(api: Api, customerId: string): Promise<string> {
  try {
    const res = await api.get(`/customers/${customerId}/plan`);
    return res.data.plan;
  } catch {
    return "free";
  }
}

function renderReceipt(invoice: Invoice): string {
  return invoice.lines.map((l) => `${l.description}: ${(l.amountCents / 100).toFixed(2)}`).join("\n");
}
