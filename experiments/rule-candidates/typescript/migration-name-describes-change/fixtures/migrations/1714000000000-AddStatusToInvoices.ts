import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddStatusToInvoices1714000000000 implements MigrationInterface {
  name = "AddStatusToInvoices1714000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "payments",
      new TableColumn({
        name: "status",
        type: "varchar",
        length: "16",
        default: "'pending'",
        isNullable: false,
      }),
    );
    await queryRunner.query(`CREATE INDEX "payments_status_idx" ON "payments" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "payments_status_idx"`);
    await queryRunner.dropColumn("payments", "status");
  }
}
