export type Users = {
  id: string;
  email: string;
  displayName: string;
};

export interface HealthReport {
  isHealthy: string;
  checkedAt: number;
  latencyMs: number;
}

export interface Timestamps {
  createdAt: number;
  updatedAt: number;
}

export type Row = { id: number; cells: string[] };

export type Handler = (req: Request) => Promise<Response>;

export type Props = {
  user: Users;
  onSelect: (id: string) => void;
  compact?: boolean;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export async function findUser(db: { query: (sql: string, args: unknown[]) => Promise<Row[]> }, id: string): Promise<Users | null> {
  const rows = await db.query("select id, email, display_name from users where id = $1", [id]);
  if (rows.length === 0) return null;
  const [row] = rows;
  return { id: row.cells[0], email: row.cells[1], displayName: row.cells[2] };
}

export async function probe(url: string): Promise<HealthReport> {
  const started = Date.now();
  let status: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    status = res.ok ? "ok" : "degraded";
  } catch {
    status = "down";
  }
  return { isHealthy: status, checkedAt: started, latencyMs: Date.now() - started };
}

export function withTimestamps<T extends object>(record: T, now: number): T & Timestamps {
  return { ...record, createdAt: now, updatedAt: now };
}

export const listUsers: Handler = async (req) => {
  const cursor = new URL(req.url).searchParams.get("cursor");
  const page: Page<Users> = { items: [], nextCursor: cursor ? null : "1" };
  return Response.json(page);
};

export function renderUserCard({ user, onSelect, compact }: Props): string {
  const name = compact ? user.displayName : `${user.displayName} <${user.email}>`;
  return `<button data-id="${user.id}" onclick="${onSelect.name}">${name}</button>`;
}
