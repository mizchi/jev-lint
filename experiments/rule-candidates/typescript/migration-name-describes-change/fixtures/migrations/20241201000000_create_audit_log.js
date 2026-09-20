/** @param {import("knex").Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable("audit_log", (t) => {
    t.bigIncrements("id").primary();
    t.string("actor_id", 64).notNullable();
    t.string("action", 64).notNullable();
    t.jsonb("payload");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["actor_id", "created_at"], "audit_log_actor_created_idx");
  });
};

/** @param {import("knex").Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTable("audit_log");
};
