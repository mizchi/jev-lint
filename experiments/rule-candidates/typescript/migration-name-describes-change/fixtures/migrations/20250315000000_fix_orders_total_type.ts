import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .alterColumn("total_cents", (col) => col.setDataType("bigint"))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .alterColumn("total_cents", (col) => col.setDataType("integer"))
    .execute();
}
