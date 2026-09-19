import type { Request, Response } from "express";
import { db } from "./db";
import { jobs } from "./jobs";

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const invite = await db.invites.find(req.params.token);
  if (!invite || invite.acceptedAt || invite.expiresAt < Date.now()) {
    res.status(410).json({ message: "This invitation has already been accepted" });
    return;
  }
  await db.invites.update(invite.id, { acceptedAt: new Date() });
  await db.memberships.create({ userId: req.user.id, teamId: invite.teamId });
  res.sendStatus(204);
}

export async function redeemInvite(req: Request, res: Response): Promise<void> {
  const invite = await db.invites.find(req.params.token);
  if (!invite || invite.acceptedAt || invite.expiresAt < Date.now()) {
    res.status(410).json({ message: "This invitation is no longer valid" });
    return;
  }
  await db.invites.update(invite.id, { acceptedAt: new Date() });
  await db.memberships.create({ userId: req.user.id, teamId: invite.teamId });
  res.sendStatus(204);
}

export async function reindexTeam(req: Request, res: Response): Promise<void> {
  await jobs.enqueue("search.reindex", { teamId: req.params.teamId });
  res.status(202).json({ message: "Reindex queued" });
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  const membership = await db.memberships.find(req.params.id);
  if (!membership) {
    res.status(404).json({ message: "Membership not found" });
    return;
  }
  await db.memberships.update(membership.id, { removedAt: new Date() });
  res.json({ message: "Member removed" });
}

export async function anonymizeUser(req: Request, res: Response): Promise<void> {
  const user = await db.users.find(req.params.id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  await jobs.enqueue("gdpr.anonymize", { userId: user.id });
  res.json({ message: "All personal data has been erased" });
}

export async function rotateApiKey(req: Request, res: Response): Promise<void> {
  const key = await db.apiKeys.rotate(req.params.id);
  if (!key) {
    res.status(404).json({ message: "API key not found" });
    return;
  }
  res.json({ message: "API key rotated", key: key.secret });
}

export async function importCatalog(req: Request, res: Response): Promise<void> {
  let rows: unknown[];
  try {
    rows = parseCatalog(req.body as string);
  } catch (err) {
    res.status(400).json({ message: "Catalog file could not be parsed" });
    return;
  }
  const job = await jobs.enqueue("catalog.import", { rows });
  res.status(202).json({ message: `Import started (${rows.length} rows)`, jobId: job.id });
}

declare function parseCatalog(body: string): unknown[];
