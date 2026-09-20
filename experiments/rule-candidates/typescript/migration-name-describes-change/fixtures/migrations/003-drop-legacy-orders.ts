import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.renameTable("legacy_orders", "orders_archive");
  await knex.schema.alterTable("orders_archive", (t) => {
    t.index(["customer_id"], "orders_archive_customer_idx");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders_archive", (t) => {
    t.dropIndex(["customer_id"], "orders_archive_customer_idx");
  });
  await knex.schema.renameTable("orders_archive", "legacy_orders");
}
