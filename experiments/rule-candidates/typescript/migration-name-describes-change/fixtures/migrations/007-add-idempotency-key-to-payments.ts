import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("payments", (t) => {
    t.string("idempotency_key", 64).nullable();
    t.unique(["idempotency_key"], { indexName: "payments_idempotency_key_uq" });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("payments", (t) => {
    t.dropUnique(["idempotency_key"], "payments_idempotency_key_uq");
    t.dropColumn("idempotency_key");
  });
}
