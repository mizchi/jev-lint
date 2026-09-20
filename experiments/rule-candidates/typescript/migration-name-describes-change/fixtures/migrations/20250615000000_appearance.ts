import type { Knex } from "knex";

// Replaces the single `theme` column with light/dark appearance settings on
// users and matching defaults on settings.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.string("appearance", 8);
  });
  await knex("users").update({ appearance: "dark" }).where({ theme: "dark" });
  await knex("users").update({ appearance: "light" }).where({ theme: "light" });
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("theme");
    t.string("theme_light", 64);
    t.string("theme_dark", 64);
  });
  await knex.schema.alterTable("settings", (t) => {
    t.string("default_appearance", 8).notNullable().defaultTo("auto");
    t.string("default_theme_light", 64);
    t.string("default_theme_dark", 64);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("settings", (t) => {
    t.dropColumn("default_appearance");
    t.dropColumn("default_theme_light");
    t.dropColumn("default_theme_dark");
  });
  await knex.schema.alterTable("users", (t) => {
    t.string("theme", 8);
  });
  await knex("users").update({ theme: knex.ref("appearance") });
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("appearance");
    t.dropColumn("theme_light");
    t.dropColumn("theme_dark");
  });
}
