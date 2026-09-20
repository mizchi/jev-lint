import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("customers").renameTo("accounts").execute();
  await db.schema.dropIndex("customers_email_idx").execute();
  await db.schema.createIndex("accounts_email_idx").on("accounts").column("email").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("accounts_email_idx").execute();
  await db.schema.alterTable("accounts").renameTo("customers").execute();
  await db.schema.createIndex("customers_email_idx").on("customers").column("email").execute();
}
