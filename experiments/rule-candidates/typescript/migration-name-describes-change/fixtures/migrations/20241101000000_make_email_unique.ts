import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.unique(["email"], { indexName: "users_email_uq" });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.dropUnique(["email"], "users_email_uq");
  });
}
