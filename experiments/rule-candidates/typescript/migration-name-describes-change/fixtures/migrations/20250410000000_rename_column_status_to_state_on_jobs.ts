import type { Knex } from "knex";

// MySQL 5.7 has no RENAME COLUMN, so the rename is add, copy, drop.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jobs", (t) => {
    t.string("state", 16).notNullable().defaultTo("queued");
  });
  await knex("jobs").update({ state: knex.ref("status") });
  await knex.schema.alterTable("jobs", (t) => {
    t.dropColumn("status");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jobs", (t) => {
    t.string("status", 16).notNullable().defaultTo("queued");
  });
  await knex("jobs").update({ status: knex.ref("state") });
  await knex.schema.alterTable("jobs", (t) => {
    t.dropColumn("state");
  });
}
