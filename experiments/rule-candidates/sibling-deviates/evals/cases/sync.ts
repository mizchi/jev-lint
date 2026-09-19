import type { Remote, Local, Change, PushReport } from "../model.ts";

export function diffLocal(local: Local, remote: Remote): Change[] {
  return local.records
    .filter((r) => !remote.has(r.id) || remote.version(r.id) < r.version)
    .map((r) => ({ kind: "upsert", id: r.id, version: r.version }));
}

export function diffRemote(local: Local, remote: Remote): Change[] {
  return remote
    .ids()
    .filter((id) => !local.has(id) || local.version(id) < remote.version(id))
    .map((id) => ({ kind: "upsert", id, version: remote.version(id) }));
}

export function diffTombstones(local: Local, remote: Remote): Change[] {
  return local.tombstones.filter((id) => remote.has(id)).map((id) => ({ kind: "delete", id, version: 0 }));
}

export async function pushChanges(remote: Remote, changes: Change[]): Promise<PushReport> {
  const accepted = await remote.apply(changes.filter((c) => c.kind === "upsert"));
  return { accepted, rejected: changes.length - accepted };
}

export async function pushDeletes(remote: Remote, changes: Change[]): Promise<PushReport> {
  const accepted = await remote.apply(changes.filter((c) => c.kind === "delete"));
  return { accepted, rejected: changes.length - accepted };
}

export async function pushSnapshot(remote: Remote, local: Local): Promise<PushReport> {
  const all = local.records.map((r) => ({ kind: "upsert" as const, id: r.id, version: r.version }));
  const accepted = await remote.apply(all);
  return { accepted, rejected: all.length - accepted };
}
