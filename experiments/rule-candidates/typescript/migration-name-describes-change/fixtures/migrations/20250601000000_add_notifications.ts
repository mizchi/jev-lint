import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("notifications", (t) => {
    t.uuid("id").primary();
    t.uuid("recipient").notNullable().references("users.id").onDelete("CASCADE");
    t.string("subject", 255).notNullable();
    t.text("message");
    t.string("status", 16).notNullable().defaultTo("inbox");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["recipient", "status"], "notifications_recipient_status_idx");
  });
  await knex.schema.alterTable("users", (t) => {
    t.boolean("email_notifications").notNullable().defaultTo(true);
  });
  await knex.schema.alterTable("settings", (t) => {
    t.integer("notification_retention_days").notNullable().defaultTo(30);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("settings", (t) => {
    t.dropColumn("notification_retention_days");
  });
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("email_notifications");
  });
  await knex.schema.dropTable("notifications");
}
