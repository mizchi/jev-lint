import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex("users_email_idx")
    .on("users")
    .column("email")
    .execute();

  await db.schema
    .alterTable("users")
    .dropColumn("legacy_login")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("legacy_login", "varchar(64)")
    .execute();
  await db.schema.dropIndex("users_email_idx").execute();
}
