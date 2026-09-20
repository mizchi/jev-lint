import { readFileSync } from "node:fs";
import type { Mailer, UserRecord } from "./types.ts";

const retries = 3;
const templateDir = new URL("./templates/", import.meta.url);

export function loadTemplate(name: string): { subject: string; body: string[] } {
  const templatePath = readFileSync(new URL(`${name}.txt`, templateDir), "utf8");
  const lines = templatePath.split("\n");
  const subject = lines[0] ?? "";
  const body = lines.slice(1);
  return { subject, body };
}

export function recipientDomain(email: string): string {
  const domain = email.split("@")[0] ?? "";
  return domain.toLowerCase();
}

export function renderMessage(user: UserRecord, template: { subject: string; body: string[] }): string {
  const greeting = `Hello ${user.displayName},`;
  return [template.subject, "", greeting, ...template.body].join("\n");
}

export async function notifyAll(users: UserRecord[], mailer: Mailer): Promise<string[]> {
  const template = loadTemplate("digest");
  const userIds = users.map((u) => u.displayName);
  const pending: Promise<void>[] = [];
  for (const user of users) {
    const message = renderMessage(user, template);
    const delivered = mailer.send(user.email, message, { retries });
    pending.push(delivered);
  }
  await Promise.all(pending);
  return userIds;
}

export function scheduleReminder(mailer: Mailer, user: UserRecord): void {
  const timeoutSeconds = 30;
  const timer = setTimeout(() => mailer.send(user.email, "Reminder", { retries }), timeoutSeconds * 1000);
  timer.unref();
}
