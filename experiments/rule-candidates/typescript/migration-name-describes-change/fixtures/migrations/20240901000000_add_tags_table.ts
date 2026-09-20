import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("tags")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("slug", "varchar(64)", (col) => col.notNull().unique())
    .addColumn("label", "varchar(128)", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo("now()"))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("tags").execute();
}
