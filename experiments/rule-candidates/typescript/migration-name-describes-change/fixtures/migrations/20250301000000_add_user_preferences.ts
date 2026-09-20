import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class AddUserPreferences1740000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "user_preferences",
        columns: [
          { name: "user_id", type: "uuid", isPrimary: true },
          { name: "locale", type: "varchar", length: "8", default: "'en'" },
          { name: "timezone", type: "varchar", length: "64", isNullable: true },
          { name: "marketing_opt_in", type: "boolean", default: false },
        ],
      }),
    );
    await queryRunner.createForeignKey(
      "user_preferences",
      new TableForeignKey({ columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("user_preferences");
  }
}
