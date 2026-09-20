import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillOrderTotals1720000000000 implements MigrationInterface {
  name = "BackfillOrderTotals1720000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE orders o
      SET total_cents = t.sum
      FROM (
        SELECT order_id, SUM(price_cents * qty) AS sum
        FROM order_lines
        GROUP BY order_id
      ) t
      WHERE o.id = t.order_id AND o.total_cents IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The backfilled values are derived; nothing to restore.
    void queryRunner;
  }
}
