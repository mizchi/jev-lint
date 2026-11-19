type Provider = { kind: "unreviewed" | "here" | "absent" } | { kind: "elsewhere"; paths: string[] };

export function lookupProvider(entries: ReadonlyMap<string, { has(name: string): boolean }>, path: string, name: string): Provider {
  const entry = entries.get(path);
  if (!entry) return { kind: "unreviewed" };
  if (entry.has(name)) return { kind: "here" };
  const paths = [...entries].filter(([, exports]) => exports.has(name)).map(([path]) => path);
  return paths.length ? { kind: "elsewhere", paths } : { kind: "absent" };
}
