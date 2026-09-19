import type { Request, Response, NextFunction } from "express";
import { sessions } from "./sessions.ts";

export type Middleware = (req: Request, res: Response, next: NextFunction) => void;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.id = req.headers["x-request-id"]?.toString() ?? crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = sessions.lookupSync(req.headers.authorization ?? "");
  if (!session) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  req.session = session;
  next();
}

export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("cache-control", "no-store");
  next();
}

export function jsonOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && !req.is("application/json")) {
    res.status(415).json({ error: "expected application/json" });
    return;
  }
  next();
}

export function timing(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now();
  res.on("finish", () => res.setHeader("server-timing", `total;dur=${performance.now() - started}`));
  next();
}

export function compose(...stack: Middleware[]): Middleware {
  return (req, res, next) => {
    let i = 0;
    const step = (): void => (i < stack.length ? stack[i++](req, res, step) : next());
    step();
  };
}
