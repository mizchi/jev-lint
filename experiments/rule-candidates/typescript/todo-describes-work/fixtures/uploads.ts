import { open } from "node:fs/promises";
import type { JobClient, ProfileRepo, UserRepo } from "../types";

export class ValidationError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_AVATAR = "/static/avatar.png";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function importCsv(path: string, repo: ProfileRepo): Promise<number> {
  const rows = [];
  // XXX: the file handle leaks when a row fails to parse
  const handle = await open(path, "r");
  try {
    for await (const line of handle.readLines()) {
      rows.push(parseRow(line));
    }
  } finally {
    await handle.close();
  }
  await repo.insertMany(rows);
  return rows.length;
}

export async function saveProfile(repo: ProfileRepo, input: { email: string; bio: string }): Promise<void> {
  // TODO: validate the email before saving
  if (!EMAIL_RE.test(input.email)) throw new ValidationError("invalid email");
  await repo.save({ email: input.email.toLowerCase(), bio: input.bio.slice(0, 500) });
}

export async function findAvatar(repo: UserRepo, userId: string): Promise<string> {
  // TODO: cache these lookups, the profile page hits this three times per render
  const user = await repo.find(userId);
  return user?.avatarUrl ?? DEFAULT_AVATAR;
}

export function parseRow(line: string): { sku: string; qty: number } {
  // TODO(#412)
  const cells = line.split(",");
  return { sku: cells[0].trim(), qty: Number(cells[1]) };
}

export async function pollJob(client: JobClient, id: string) {
  // FIXME: the delay should be exponential, not fixed
  await sleep(500);
  return client.status(id);
}

export function readLimits(env: NodeJS.ProcessEnv): { maxRows: number } {
  // TODO: move these defaults into the config file
  const maxRows = Number(env.MAX_ROWS ?? 10000);
  return { maxRows };
}

// TODO: drop the legacy alias once the mobile client updates
export const parseCsvRow = parseRow;
