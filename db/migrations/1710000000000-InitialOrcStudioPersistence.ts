import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialOrcStudioPersistence1710000000000 implements MigrationInterface {
  name = 'InitialOrcStudioPersistence1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE studio_snapshot (
        state_id varchar(100) PRIMARY KEY,
        revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE studio_event (
        state_id varchar(100) NOT NULL REFERENCES studio_snapshot(state_id) ON DELETE CASCADE,
        event_id varchar(160) NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        event_type varchar(80) NOT NULL,
        payload jsonb NOT NULL,
        actor_role varchar(16) NOT NULL CHECK (actor_role IN ('ceo', 'employee', 'client')),
        workspace_id varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (state_id, event_id),
        CONSTRAINT studio_event_state_revision_uq UNIQUE (state_id, revision)
      )
    `);
    await queryRunner.query(`CREATE INDEX studio_event_workspace_created_idx ON studio_event (workspace_id, created_at)`);
    await queryRunner.query(`
      CREATE TABLE cli_conversation_reference (
        state_id varchar(100) NOT NULL,
        session_id varchar(160) NOT NULL,
        workspace_id varchar(160) NOT NULL,
        provider varchar(32) NOT NULL,
        native_conversation_id varchar(512),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (state_id, session_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX cli_conversation_workspace_idx ON cli_conversation_reference (workspace_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE cli_conversation_reference');
    await queryRunner.query('DROP TABLE studio_event');
    await queryRunner.query('DROP TABLE studio_snapshot');
  }
}
