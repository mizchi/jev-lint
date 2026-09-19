import { readFile, writeFile } from "node:fs/promises";
import type { Preferences, PreferenceKey } from "../model.ts";

const DEFAULTS: Preferences = { theme: "system", locale: "en", fontScale: 1 };

export async function loadPreferences(path: string): Promise<Preferences> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(path, "utf8")) };
  } catch (err: any) {
    if (err.code === "ENOENT") return { ...DEFAULTS };
    throw err;
  }
}

export async function savePreferences(path: string, prefs: Preferences): Promise<void> {
  await writeFile(path, JSON.stringify(prefs, null, 2) + "\n");
}

export function getPreference<K extends PreferenceKey>(prefs: Preferences, key: K): Preferences[K] {
  return prefs[key] ?? DEFAULTS[key];
}

export function setPreference<K extends PreferenceKey>(prefs: Preferences, key: K, value: Preferences[K]): Preferences {
  return { ...prefs, [key]: value };
}

export function resetPreferences(): Preferences {
  return { ...DEFAULTS };
}
