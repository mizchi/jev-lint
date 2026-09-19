import type { Env } from "../env.ts";
import { jsonResponse } from "../http.ts";

export async function handleHealth(env: Env, request: Request): Promise<Response> {
  return jsonResponse({ ok: true, region: env.REGION }, 200);
}

export async function handleListJobs(env: Env, request: Request): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const rows = await env.DB.prepare("select * from jobs limit ?").bind(limit).all();
  return jsonResponse({ ok: true, jobs: rows.results }, 200);
}

export async function handleGetJob(env: Env, request: Request): Promise<Response> {
  const id = new URL(request.url).pathname.split("/").pop();
  const row = await env.DB.prepare("select * from jobs where id = ?").bind(id).first();
  return row ? jsonResponse({ ok: true, job: row }, 200) : jsonResponse({ ok: false, error: "not found" }, 404);
}

export async function handleCancelJob(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).pathname.split("/").pop();
  await env.DB.prepare("update jobs set status = 'cancelled' where id = ?").bind(id).run();
  return jsonResponse({ ok: true }, 200);
}

export async function handleRetryJob(env: Env, request: Request): Promise<Response> {
  const id = new URL(request.url).pathname.split("/").pop();
  await env.QUEUE.send({ kind: "retry", id });
  return jsonResponse({ ok: true }, 202);
}
