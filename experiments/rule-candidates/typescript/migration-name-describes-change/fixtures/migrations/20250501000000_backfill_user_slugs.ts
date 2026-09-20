import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE users
    SET slug = lower(regexp_replace(display_name, '[^a-zA-Z0-9]+', '-', 'g'))
    WHERE slug IS NULL
  `.execute(db);
  await db.schema
    .createIndex("users_slug_uq")
    .unique()
    .on("users")
    .column("slug")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("users_slug_uq").execute();
}
