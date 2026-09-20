import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`UPDATE users SET email = concat('unknown-', id, '@example.invalid') WHERE email IS NULL`.execute(db);
  await db.schema
    .alterTable("users")
    .alterColumn("email", (col) => col.setDefault(""))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .alterColumn("email", (col) => col.dropDefault())
    .execute();
}
