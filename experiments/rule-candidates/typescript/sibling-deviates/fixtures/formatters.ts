import type { Money, Locale } from "../model.ts";

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date);
}

export async function formatMoney(money: Money, locale: Locale): Promise<string> {
  return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency }).format(money.cents / 100);
}

export function formatPercent(ratio: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(ratio);
}

export function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { notation: "compact" }).format(n);
}
