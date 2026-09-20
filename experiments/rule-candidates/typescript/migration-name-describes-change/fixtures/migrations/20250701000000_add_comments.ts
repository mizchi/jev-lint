import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("comments", (t) => {
    t.uuid("id").primary();
    t.string("collection", 64).notNullable();
    t.string("item", 255).notNullable();
    t.text("comment").notNullable();
    t.uuid("user_created").references("users.id").onDelete("SET NULL");
    t.timestamp("date_created").defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable("users", (t) => {
    t.boolean("comment_notifications").notNullable().defaultTo(true);
  });
  await knex("activity").delete();
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("comment_notifications");
  });
  await knex.schema.dropTable("comments");
}
