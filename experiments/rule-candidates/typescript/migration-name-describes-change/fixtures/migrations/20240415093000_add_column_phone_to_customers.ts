import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("customers")
    .alterColumn("phone", (col) => col.setDataType("text"))
    .execute();
  await db.schema
    .alterTable("customers")
    .alterColumn("phone", (col) => col.dropNotNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("customers")
    .alterColumn("phone", (col) => col.setNotNull())
    .execute();
  await db.schema
    .alterTable("customers")
    .alterColumn("phone", (col) => col.setDataType("varchar(32)"))
    .execute();
}
