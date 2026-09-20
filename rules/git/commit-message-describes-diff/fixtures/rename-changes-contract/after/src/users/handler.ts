import type { Request, Response } from "../http.ts";
import { loadUser } from "./repo.ts";

export async function getUser(req: Request, res: Response): Promise<void> {
  const user = await loadUser(req.db, req.params.id);
  res.json(user);
}
