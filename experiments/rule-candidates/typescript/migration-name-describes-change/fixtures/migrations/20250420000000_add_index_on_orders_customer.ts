import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex("order_lines_customer_id_idx")
    .on("order_lines")
    .column("customer_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("order_lines_customer_id_idx").execute();
}
