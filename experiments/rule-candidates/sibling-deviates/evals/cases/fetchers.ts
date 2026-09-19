import type { Result } from "../result.ts";
import { ok, err } from "../result.ts";
import type { Http } from "../http.ts";
import type { Profile, Team, Plan, Usage, Invoice } from "../model.ts";

export async function fetchProfile(http: Http, id: string): Promise<Profile> {
  const res = await http.get(`/profiles/${id}`);
  if (!res.ok) throw new Error(`profile ${id}: ${res.status}`);
  return res.body as Profile;
}

export async function fetchTeam(http: Http, id: string): Promise<Team> {
  const res = await http.get(`/teams/${id}`);
  if (!res.ok) throw new Error(`team ${id}: ${res.status}`);
  return res.body as Team;
}

export async function fetchPlan(http: Http, id: string): Promise<Result<Plan>> {
  const res = await http.get(`/plans/${id}`);
  if (!res.ok) return err(`plan ${id}: ${res.status}`);
  return ok(res.body as Plan);
}

export async function fetchUsage(http: Http, id: string): Promise<Usage> {
  const res = await http.get(`/usage/${id}`);
  if (!res.ok) throw new Error(`usage ${id}: ${res.status}`);
  return res.body as Usage;
}

export async function fetchInvoice(http: Http, id: string): Promise<Invoice> {
  const res = await http.get(`/invoices/${id}`);
  if (!res.ok) throw new Error(`invoice ${id}: ${res.status}`);
  return res.body as Invoice;
}
