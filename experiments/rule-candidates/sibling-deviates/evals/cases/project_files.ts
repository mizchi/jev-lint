import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Secrets, Manifest, Lockfile, Schema } from "../model.ts";

export async function readConfig(root: string): Promise<Config> {
  return JSON.parse(await readFile(join(root, "config.json"), "utf8"));
}

export async function readSecrets(root: string): Promise<Secrets> {
  return JSON.parse(await readFile(join(root, ".secrets.json"), "utf8"));
}

export async function readManifest(root: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
}

export async function readLockfile(root: string): Promise<Lockfile> {
  return JSON.parse(await readFile(join(root, "lock.json"), "utf8"));
}

export function readSchema(root: string): Schema {
  return JSON.parse(readFileSync(join(root, "schema.json"), "utf8"));
}
