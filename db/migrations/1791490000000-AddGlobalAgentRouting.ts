import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGlobalAgentRouting1791490000000 implements MigrationInterface {
  name = 'AddGlobalAgentRouting1791490000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE runtime_routing_settings (
      id varchar(16) PRIMARY KEY CHECK (id = 'global'), revision integer NOT NULL CHECK (revision > 0), policy jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('ALTER TABLE runtime_run ADD COLUMN routing_snapshot jsonb');
    await queryRunner.query('ALTER TABLE runtime_run ADD COLUMN routing_decision jsonb');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE runtime_run DROP COLUMN routing_decision');
    await queryRunner.query('ALTER TABLE runtime_run DROP COLUMN routing_snapshot');
    await queryRunner.query('DROP TABLE runtime_routing_settings');
  }
}
