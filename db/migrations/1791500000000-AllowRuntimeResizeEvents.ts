import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowRuntimeResizeEvents1791500000000 implements MigrationInterface {
  name = 'AllowRuntimeResizeEvents1791500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE runtime_event DROP CONSTRAINT runtime_event_kind_check');
    await queryRunner.query(`ALTER TABLE runtime_event ADD CONSTRAINT runtime_event_kind_check
      CHECK (kind IN ('status','output','resize','error','exit'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const resizeEvents = await queryRunner.query("SELECT 1 FROM runtime_event WHERE kind = 'resize' LIMIT 1");
    if (resizeEvents.length) throw new Error('Cannot roll back runtime resize event support while resize history exists.');
    await queryRunner.query('ALTER TABLE runtime_event DROP CONSTRAINT runtime_event_kind_check');
    await queryRunner.query(`ALTER TABLE runtime_event ADD CONSTRAINT runtime_event_kind_check
      CHECK (kind IN ('status','output','error','exit'))`);
  }
}
