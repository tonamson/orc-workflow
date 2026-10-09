import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNativeRuntime1791460000000 implements MigrationInterface {
  name = 'AddNativeRuntime1791460000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE runtime_workspace (
      id varchar(100) PRIMARY KEY, name varchar(160) NOT NULL, path varchar(2048) NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE runtime_run (
      id varchar(100) PRIMARY KEY, workspace_id varchar(100) NOT NULL REFERENCES runtime_workspace(id) ON DELETE CASCADE,
      task_id varchar(160) NOT NULL, prompt text NOT NULL, status varchar(24) NOT NULL
        CHECK (status IN ('starting','active','reporting','done','error','interrupted','closing')),
      phase varchar(32) NOT NULL CHECK (phase IN ('supervisor_delegation','delegating','peer_running','supervisor_reporting','done')),
      delegation text, delegation_turn_id varchar(128), report text, report_turn_id varchar(128), report_delivered boolean NOT NULL DEFAULT false,
      final_report text, final_turn_id varchar(128), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX runtime_run_workspace_created_idx ON runtime_run (workspace_id, created_at DESC)');
    await queryRunner.query(`CREATE TABLE runtime_session (
      id varchar(100) PRIMARY KEY, run_id varchar(100) NOT NULL REFERENCES runtime_run(id) ON DELETE CASCADE,
      role varchar(16) NOT NULL CHECK (role IN ('supervisor','peer')), provider varchar(32) NOT NULL CHECK (provider = 'codex'),
      cwd varchar(2048) NOT NULL, native_conversation_id varchar(128), model varchar(160), reasoning_effort varchar(32),
      status varchar(24) NOT NULL CHECK (status IN ('queued','starting','active','closing','closed','error','interrupted')),
      pid integer, exit_code integer, last_sequence integer NOT NULL DEFAULT 0, output_bytes integer NOT NULL DEFAULT 0, started_at timestamptz, ended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT runtime_session_run_role_uq UNIQUE (run_id, role)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX runtime_session_active_peer_uq ON runtime_session ((role)) WHERE status IN ('starting','active','closing')`);
    await queryRunner.query(`CREATE TABLE runtime_event (
      session_id varchar(100) NOT NULL REFERENCES runtime_session(id) ON DELETE CASCADE, sequence integer NOT NULL CHECK (sequence > 0),
      kind varchar(16) NOT NULL CHECK (kind IN ('status','output','error','exit')), text text, data_base64 text, status varchar(24),
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (session_id, sequence)
    )`);
    await queryRunner.query('CREATE INDEX runtime_event_created_idx ON runtime_event (session_id, created_at)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE runtime_event');
    await queryRunner.query('DROP INDEX runtime_session_active_peer_uq');
    await queryRunner.query('DROP TABLE runtime_session');
    await queryRunner.query('DROP TABLE runtime_run');
    await queryRunner.query('DROP TABLE runtime_workspace');
  }
}
