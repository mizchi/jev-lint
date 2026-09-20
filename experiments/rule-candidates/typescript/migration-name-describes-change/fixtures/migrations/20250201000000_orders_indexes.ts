import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createIndex("orders_customer_id_idx").on("orders").column("customer_id").execute();
  await db.schema.createIndex("orders_created_at_idx").on("orders").column("created_at").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("orders_created_at_idx").execute();
  await db.schema.dropIndex("orders_customer_id_idx").execute();
}
