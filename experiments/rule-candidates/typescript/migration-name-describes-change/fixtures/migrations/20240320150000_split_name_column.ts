import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("first_name", "varchar(100)")
    .addColumn("last_name", "varchar(100)")
    .execute();

  await sql`
    UPDATE users
    SET first_name = split_part(name, ' ', 1),
        last_name  = NULLIF(substring(name from position(' ' in name) + 1), name)
  `.execute(db);

  await db.schema.alterTable("users").dropColumn("name").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("users").addColumn("name", "varchar(200)").execute();
  await sql`UPDATE users SET name = concat_ws(' ', first_name, last_name)`.execute(db);
  await db.schema
    .alterTable("users")
    .dropColumn("first_name")
    .dropColumn("last_name")
    .execute();
}
