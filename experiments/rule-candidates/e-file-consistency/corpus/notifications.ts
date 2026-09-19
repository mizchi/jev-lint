import { mailer } from "./mailer.ts";
import { smsGateway } from "./sms.ts";
import { pushService } from "./push.ts";
import { httpClient } from "./http.ts";
import type { Notification, DeliveryReceipt } from "../model.ts";

export async function sendEmail(n: Notification): Promise<DeliveryReceipt> {
  const id = await mailer.deliver({ to: n.recipient, subject: n.title, text: n.body });
  return { channel: "email", id, sentAt: new Date() };
}

export async function sendSms(n: Notification): Promise<DeliveryReceipt> {
  const id = await smsGateway.deliver({ to: n.recipient, text: n.body });
  return { channel: "sms", id, sentAt: new Date() };
}

export async function dispatchPush(n: Notification): Promise<DeliveryReceipt> {
  const id = await pushService.deliver({ token: n.recipient, title: n.title, body: n.body });
  return { channel: "push", id, sentAt: new Date() };
}

export async function sendWebhook(n: Notification): Promise<DeliveryReceipt> {
  const res = await httpClient.post(n.recipient, { title: n.title, body: n.body });
  return { channel: "webhook", id: res.headers["x-request-id"] ?? "", sentAt: new Date() };
}
