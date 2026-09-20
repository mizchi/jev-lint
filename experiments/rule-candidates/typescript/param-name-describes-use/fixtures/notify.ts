import type { Mailer, UserRepository, Logger } from "./types";

const DEFAULT_LOGGER = { level: "info", json: false, name: "app" } as const;

export async function sendInvite(
  mailer: Mailer,
  userId: string,
  inviterName: string,
): Promise<void> {
  if (!userId.includes("@")) {
    throw new Error(`invalid recipient: ${userId}`);
  }
  await mailer.send({
    to: userId,
    subject: `${inviterName} invited you`,
    text: `Hi ${userId.split("@")[0]}, ${inviterName} has invited you to join.`,
  });
}

export async function sendWelcome(
  mailer: Mailer,
  users: UserRepository,
  userId: string,
): Promise<void> {
  const user = await users.get(userId);
  if (!user) throw new Error(`no such user: ${userId}`);
  await mailer.send({
    to: user.email,
    subject: "Welcome",
    text: `Hi ${user.displayName}, thanks for joining.`,
  });
}

export function poll(
  task: () => Promise<void>,
  options: number,
): () => void {
  const handle = setInterval(() => {
    task().catch(() => {});
  }, options);
  return () => clearInterval(handle);
}

export function createLogger(
  options?: Partial<typeof DEFAULT_LOGGER>,
): Logger {
  const cfg = { ...DEFAULT_LOGGER, ...options };
  return {
    level: cfg.level,
    log(msg: string) {
      process.stdout.write(cfg.json ? JSON.stringify({ name: cfg.name, msg }) + "\n" : `[${cfg.name}] ${msg}\n`);
    },
  };
}

export function subscribe(
  topic: string,
  handler: (payload: unknown) => void,
  registry: Map<string, Set<(payload: unknown) => void>>,
): () => void {
  let set = registry.get(topic);
  if (!set) {
    set = new Set();
    registry.set(topic, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function forwardEvent(
  emitter: { emit(name: string, payload: unknown): void },
  event: { name: string; payload: unknown },
): void {
  emitter.emit(event.name, event.payload);
}
