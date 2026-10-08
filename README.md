# ORC Studio UI

ORC Studio is a Next.js demo of the approved pixel-office workflow. Workspace data, sessions and their bounded transcripts, tasks, reports, records, archives, and an append-only domain event journal persist in local PostgreSQL. The browser still uses demo roles and simulated CLI interactions; this app does not start or authenticate a real CLI, and does not store uploaded files.

## Requirements

- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`
- npm
- Docker Compose

Observed for this implementation: Node.js `v26.0.0`, npm `11.12.1`.

## Run

Copy `.env.example` to `.env` and replace the local password before starting. The Compose project `orc-studio-local` binds PostgreSQL to `127.0.0.1:55432`, uses a named volume, and creates a separate integration-test database on first initialization. It does not use the default PostgreSQL port.

```sh
npm install
docker compose -p orc-studio-local up -d --wait
npm run db:migrate
npm run dev
```

Then open `http://localhost:3000`. Use the workspace and role selectors to review CEO, employee and client views. The seeded client accounts are `client-a` (customer-a), `client-b` (customer-b), and `client-none` (no grants). Employees can browse meeting records; clients can browse only shared records in explicitly granted workspaces. This is a local demo API with browser-selected roles, no authentication, and no production tenant isolation; do not expose it to untrusted users or use it for customer data. Use `docker compose -p orc-studio-local ps` to inspect the database service.

Schema changes use TypeORM migrations with automatic synchronization disabled. Use `npm run db:migrate`, `npm run db:status`, and `npm run db:revert`. Run the scratch-database integration suite with `npm run test:integration`; it refuses database URLs without `test` in the database name. Data is seeded only when the workspace snapshot is first created, and ordinary app startup does not overwrite existing state.

The persistence table reserves a nullable native CLI conversation ID for each ORC session/workspace/provider. It is empty in this demo. Crash recovery and resuming the same native conversation require a future CLI runtime integration and are not claimed here.

The office controls switch between the merged map and room cards, resize the demo to 64 departments, create a department on demand, and search rooms. Click an agent to open its exact session panel. Demo controls assign queued work, submit and review reports, trigger approval, disconnect/reconnect, and request or confirm session closure. Progress changes only after report acceptance. Every panel labels its content as simulated.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run start
```

Validation details are in [docs/validation/orc-nextjs-ui.md](docs/validation/orc-nextjs-ui.md).
