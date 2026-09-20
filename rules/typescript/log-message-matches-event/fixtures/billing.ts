import type { Logger } from "./logger";
import type { Gateway, Subscription, Invoice } from "./gateway";
import type { Mailer } from "./mailer";

export class Billing {
  constructor(
    private readonly gateway: Gateway,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
  ) {}

  async cancelSubscription(subscriptionId: string, reason: string): Promise<void> {
    await this.gateway.cancelSubscription(subscriptionId, { reason });
    this.logger.info("order cancelled", { subscriptionId, reason });
  }

  async holdFunds(invoice: Invoice): Promise<string> {
    const auth = await this.gateway.authorize(invoice.customerId, invoice.amount);
    this.logger.info("payment captured", { invoiceId: invoice.id, authId: auth.id });
    return auth.id;
  }

  async settle(invoice: Invoice, authId: string): Promise<void> {
    await this.gateway.capture(authId, invoice.amount);
    this.logger.info("payment captured", { invoiceId: invoice.id, authId });
  }

  async sendInvoice(invoice: Invoice): Promise<boolean> {
    try {
      await this.mailer.send(invoice.customerEmail, renderInvoice(invoice));
      return true;
    } catch (err) {
      this.logger.error("failed to send invoice email", { invoiceId: invoice.id, err });
      return false;
    }
  }

  async refresh(subscription: Subscription): Promise<Subscription> {
    const res = await this.gateway.getSubscription(subscription.id);
    if (res.status === 429) {
      this.logger.warn("rate limited, backing off", { retryAfter: res.retryAfter });
      await sleep(res.retryAfter * 1000);
      return this.refresh(subscription);
    }
    if (res.status === 404) {
      this.logger.info("subscription no longer exists at the gateway, marking cancelled", {
        id: subscription.id,
      });
      return { ...subscription, status: "cancelled" };
    }
    return res.body;
  }

  handleWebhook(event: { id: string; type: string; createdAt: number }): void {
    if (event.createdAt < Date.now() - 24 * 3600 * 1000) {
      this.logger.debug("ignoring stale event", { id: event.id, type: event.type });
      return;
    }
    if (event.type === "invoice.paid") {
      this.logger.info("invoice paid", { id: event.id });
      this.markPaid(event.id);
      return;
    }
    this.logger.debug("unhandled event type", { id: event.id, type: event.type });
  }

  async close(): Promise<void> {
    await this.gateway.disconnect();
    this.logger.info("gateway connection closed");
  }

  private markPaid(eventId: string): void {
    void eventId;
  }
}

function renderInvoice(invoice: Invoice): string {
  return `Invoice ${invoice.id}: ${invoice.amount}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
