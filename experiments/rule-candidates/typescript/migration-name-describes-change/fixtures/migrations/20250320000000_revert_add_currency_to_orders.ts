import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("orders").dropColumn("currency").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .addColumn("currency", "char(3)", (col) => col.notNull().defaultTo("USD"))
    .execute();
}
