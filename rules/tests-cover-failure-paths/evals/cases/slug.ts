export function slugify(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") {
    throw new Error("cannot slugify an empty title");
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncateSlug(slug: string, max: number): string {
  if (max < 1) {
    throw new RangeError(`max must be at least 1, got ${max}`);
  }
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

const DURATION = /^(\d+)\s*(ms|s|m|h)$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

export function parseDuration(raw: string): number {
  const match = DURATION.exec(raw.trim());
  if (match === null) {
    throw new Error(`unrecognised duration ${JSON.stringify(raw)}; use 250ms, 5s, 2m or 1h`);
  }
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}
