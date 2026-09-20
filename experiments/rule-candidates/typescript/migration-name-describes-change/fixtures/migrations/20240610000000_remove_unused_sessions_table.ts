import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.deleteFrom("sessions").where("expires_at", "<", new Date()).execute();
  await db.schema
    .createIndex("sessions_expires_at_idx")
    .on("sessions")
    .column("expires_at")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("sessions_expires_at_idx").execute();
}
