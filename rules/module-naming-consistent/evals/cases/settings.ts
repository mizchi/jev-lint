import type { Settings, Theme, Density } from "../model.ts";

export function updateTheme(settings: Settings, theme: Theme): Settings {
  return { ...settings, theme };
}

export function setLocale(settings: Settings, locale: string): Settings {
  return { ...settings, locale };
}

export function changeTimezone(settings: Settings, timezone: string): Settings {
  return { ...settings, timezone };
}

export function modifyDensity(settings: Settings, density: Density): Settings {
  return { ...settings, density };
}

export function setFontScale(settings: Settings, fontScale: number): Settings {
  return { ...settings, fontScale: Math.min(2, Math.max(0.5, fontScale)) };
}
