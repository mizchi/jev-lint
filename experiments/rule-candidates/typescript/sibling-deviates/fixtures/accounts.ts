import type { Pool } from "pg";
import type { Account, Membership, Team } from "../model.ts";

export async function findAccount(db: Pool, id: string): Promise<Account | null> {
  const { rows } = await db.query<Account>("select * from accounts where id = $1", [id]);
  return rows[0] ?? null;
}

export async function findTeam(db: Pool, id: string): Promise<Team | null> {
  const { rows } = await db.query<Team>("select * from teams where id = $1", [id]);
  return rows[0] ?? null;
}

export async function findMembership(db: Pool, id: string): Promise<Membership | null> {
  const { rows } = await db.query<Membership>("select * from memberships where id = $1", [id]);
  return rows[0] ?? null;
}

export async function findAccountByEmail(db: Pool, email: string): Promise<Account | null> {
  const { rows } = await db.query<Account>("select * from accounts where email = $1", [email]);
  return rows[0] ?? null;
}

export async function getAccountOrThrow(db: Pool, id: string): Promise<Account> {
  const account = await findAccount(db, id);
  if (!account) throw new Error(`account ${id} not found`);
  return account;
}
