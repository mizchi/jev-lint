import type { Request, Response } from "express";
import { sessions } from "./sessions.ts";
import { users } from "./users.ts";

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const user = await users.verify(req.body.email, req.body.password);
  if (!user) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  res.json({ token: await sessions.issue(user.id) });
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  await sessions.revoke(req.headers.authorization ?? "");
  res.status(204).end();
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const token = await sessions.refresh(req.headers.authorization ?? "");
  if (!token) {
    res.status(401).json({ error: "session expired" });
    return;
  }
  res.json({ token });
}

export async function profileHandler(req: Request, res: Response): Promise<void> {
  const session = await sessions.lookup(req.headers.authorization ?? "");
  if (!session) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  res.json(await users.profile(session.userId));
}

export async function handleSignup(req: Request, res: Response): Promise<void> {
  const user = await users.create(req.body.email, req.body.password);
  res.status(201).json({ token: await sessions.issue(user.id) });
}
