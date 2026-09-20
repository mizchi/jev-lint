import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("fax");
    t.dropColumn("pager");
    t.dropColumn("icq_number");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.string("fax", 32);
    t.string("pager", 32);
    t.string("icq_number", 16);
  });
}
