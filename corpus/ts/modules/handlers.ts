import type { Result } from "../result.ts";
import { ok, err } from "../result.ts";
import type { Store, Note, NoteInput } from "../model.ts";

export async function handleCreate(store: Store, input: NoteInput): Promise<Result<Note>> {
  if (!input.title.trim()) return err("title is required");
  return ok(await store.insert(input));
}

export async function handleGet(store: Store, id: string): Promise<Result<Note>> {
  const note = await store.find(id);
  return note ? ok(note) : err(`note ${id} not found`);
}

export async function handleUpdate(store: Store, id: string, input: NoteInput): Promise<Result<Note>> {
  const note = await store.find(id);
  if (!note) return err(`note ${id} not found`);
  return ok(await store.update(id, input));
}

export async function handleDelete(store: Store, id: string): Promise<Result<void>> {
  const removed = await store.remove(id);
  return removed ? ok(undefined) : err(`note ${id} not found`);
}

export async function handleList(store: Store, limit: number): Promise<Result<Note[]>> {
  if (limit < 1 || limit > 200) return err("limit must be between 1 and 200");
  return ok(await store.list(limit));
}

export async function handleArchive(store: Store, id: string): Promise<Note> {
  const note = await store.find(id);
  if (!note) throw new Error(`note ${id} not found`);
  return store.update(id, { ...note, archived: true });
}
