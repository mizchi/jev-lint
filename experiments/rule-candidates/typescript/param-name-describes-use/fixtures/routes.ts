import type { Express, Request, Response, NextFunction } from "express";
import type { Db, Session } from "./types";

export function registerRoutes(app: Express, db: Db): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/users/:id", async (req, res, next) => {
    try {
      const user = await db.users.get(req.params.id);
      if (!user) return res.status(404).end();
      res.json(user);
    } catch (e) {
      next(e);
    }
  });
}

export function readFileCb(
  fs: { readFile(path: string, cb: (err: Error | null, data?: string) => void): void },
  path: string,
  cb: (err: Error | null, data?: string) => void,
): void {
  fs.readFile(path, (err, data) => {
    if (err) return cb(err);
    cb(null, data);
  });
}

export function requireRole(role: string) {
  return (req: Request & { session?: Session }, res: Response, next: NextFunction): void => {
    if (req.session?.role !== role) {
      res.status(403).end();
      return;
    }
    next();
  };
}

export function resolveUpload(
  { baseDir, allowAbsolute }: { baseDir: string; allowAbsolute: boolean },
  path: string,
): string {
  if (path.startsWith("/") && allowAbsolute) return path;
  return `${baseDir}/${path.replace(/^\.\//, "")}`;
}

export async function markRead(
  db: Db,
  messageId: string,
  session: Session,
): Promise<boolean> {
  const message = await db.messages.get(messageId);
  if (!message || message.owner !== session.userId) return false;
  await db.messages.update(messageId, { readAt: new Date() });
  return true;
}

export function redirectTo(
  res: Response,
  url: string,
): void {
  res.redirect(302, url);
}

export async function purgeSessions(
  db: Db,
  userIds: string[],
): Promise<number> {
  const session = await db.sessions.get(userIds[0]);
  if (!session) return 0;
  await db.sessions.delete(session.id);
  return 1;
}
