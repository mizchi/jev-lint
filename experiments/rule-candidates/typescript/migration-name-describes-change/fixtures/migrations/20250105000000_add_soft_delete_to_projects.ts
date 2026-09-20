import type { Sequelize, QueryInterface, DataTypes as DT } from "sequelize";

export default {
  async up(queryInterface: QueryInterface, Sequelize: { DataTypes: typeof DT }) {
    await queryInterface.addColumn("projects", "deleted_at", {
      type: Sequelize.DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex("projects", ["deleted_at"], { name: "projects_deleted_at_idx" });
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS project_snapshots`);
  },

  async down(queryInterface: QueryInterface) {
    await queryInterface.removeIndex("projects", "projects_deleted_at_idx");
    await queryInterface.removeColumn("projects", "deleted_at");
  },
};
