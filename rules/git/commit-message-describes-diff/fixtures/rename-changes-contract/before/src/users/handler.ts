import type { Request, Response } from "../http.ts";
import { fetchUser } from "./repo.ts";

export async function getUser(req: Request, res: Response): Promise<void> {
  const user = await fetchUser(req.db, req.params.id);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  res.json(user);
}
