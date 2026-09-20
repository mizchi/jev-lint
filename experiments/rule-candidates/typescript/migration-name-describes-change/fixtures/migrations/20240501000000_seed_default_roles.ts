import type { Knex } from "knex";

const ROLES = [
  { name: "admin", description: "Full access" },
  { name: "editor", description: "Can change content" },
  { name: "viewer", description: "Read only" },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("roles", (t) => {
    t.increments("id").primary();
    t.string("name", 32).notNullable().unique();
    t.string("description", 255);
  });
  await knex.schema.alterTable("users", (t) => {
    t.integer("role_id").unsigned().references("roles.id");
  });
  await knex("roles").insert(ROLES);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("role_id");
  });
  await knex.schema.dropTable("roles");
}
