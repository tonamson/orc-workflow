# ORC Studio

Next.js web UI for a pixel office with native CLI terminals. The operational app starts empty: registering a repository creates its base rooms, and an occupied agent seat requires a confirmed CLI process. PostgreSQL in Docker stores workspace registrations, tasks, native conversation IDs, handoff checkpoints and ordered terminal output through TypeORM migrations.

The current runtime is an experimental local Codex workflow with one supervisor and one delegated peer. Its web terminal forwards native input, ANSI output and resize events. Delegation, report delivery and final acceptance are explicit actions; native completed turns provide their content. Closing the panel only detaches its view. Final acceptance closes the task's CLI processes; inactive processes also have a bounded idle timeout.

## Run locally

Requirements: Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`, npm, Docker Compose, and a separately installed and authenticated Codex CLI.

Copy `.env.example` to `.env` and replace the local password. The `orc-studio-local` Compose project binds PostgreSQL to `127.0.0.1:55432`, uses a named volume, and creates a separate integration-test database on first initialization.

```sh
npm install
docker compose -p orc-studio-local up -d --wait
npm run db:migrate
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`, save **Cài đặt → Định tuyến agent**, register an existing repository under an allowed server directory, open Terminal CLI, and enter a small task. By default, the runtime permits the app's current working directory; `ORC_WORKSPACE_ROOTS` can specify additional allowed roots using the operating system's path delimiter. `ORC_CODEX_BIN` can select the installed Codex executable.

Use **Chọn thư mục** to browse allowed directories on the server and fill the workspace path, or enter the path manually. Selecting a directory does not register a workspace or start a CLI. The picker shares registration's canonical path policy, excludes hidden entries and symlink entries, and returns bounded directory listings.

The Codex prototype uses read-only sandboxing and native approval prompts. There is a global limit of one live supervisor and one live peer, a 16 KiB terminal-input limit, a 10 MiB output cap per session, and a default 30-minute idle timeout (`ORC_RUNTIME_IDLE_MS`). Registering a workspace or reopening a terminal does not start an extra CLI.

## Persistence and recovery

Automatic schema synchronization is disabled. Use `npm run db:migrate`, `npm run db:status`, and `npm run db:revert` for schema management. Test fixtures are injected only into tests; application startup does not seed workspaces, agents, contracts or progress.

A task retains its native Codex conversation UUID. After a server interruption, the runtime marks unattached sessions interrupted; recovery must resume that UUID explicitly. It never substitutes `--last` or a new conversation. Terminal events are sequenced in PostgreSQL so a reconnect can replay saved output. Native Codex history lives in the CLI's own storage as well: persist that storage and the repository when deploying; PostgreSQL alone cannot reconstruct provider conversation context.

This is a local prototype, not an authenticated customer service. Runtime endpoints reject non-loopback hosts and mismatched mutation origins. Public-domain deployment, account authentication, server-enforced customer/workspace grants, the Lead layer, automatic handoffs, and Claude/AGY/OpenCode runners remain future work. The UI's domain permission selectors are not a production security boundary.

## Agent routing

Routing settings are global across all workspaces and stored in PostgreSQL. Configure the Supervisor's provider/model/fixed effort, then choose a provider/model and nonempty allowed effort list for Coding, Plan/spec and Review/audit. An empty model uses the native CLI default. The initial draft maps coding to AGY, planning to Claude and review to Codex; it is saved only when you explicitly click Save.

Each new task stores an immutable settings revision and policy snapshot. The native Supervisor returns a category, an allowed effort, a reason and a bounded instruction. ORC derives the provider/model from that task's snapshot and validates the choice before launching the peer. Invalid decisions keep the Supervisor available for correction. An unsupported provider blocks clearly, opens no receiving CLI and never falls back to Codex. Only the Codex runner is currently connected, and the prototype's delegated task remains read-only.

Changing global settings affects future tasks. Existing tasks and exact-conversation resume retain their saved model/effort choices. Native Codex `/status` confirms the effective model and effort before a fresh session receives its task. Concurrent stale saves return a conflict instead of overwriting newer settings.

## Native skills

Use the provider's normal skill folders and syntax inside its native terminal. ORC does not install or translate skills. See [skills configuration](docs/research/skills-configuration.md) for current native conventions. [orc.config.example.json](docs/examples/orc.config.example.json) is a proposed manifest and is **not loaded by the app**.

The [CLI compatibility audit](docs/research/cli-skills-compatibility.md) distinguishes installed skills, actual invocation evidence, and provider adapters. Codex Superpowers autocomplete and a bounded skill invocation were exercised through the web terminal; the other providers have not passed an ORC web workflow.

## Checks

```sh
npm test
npm run test:integration
npm run typecheck
npm run build
npm run start -- --hostname 127.0.0.1
```

The integration suite refuses database URLs without `test` in the database name. Native smoke and recovery results are recorded in [native runtime validation](docs/validation/orc-native-runtime.md). Historical UI validation is in [ORC Next.js UI validation](docs/validation/orc-nextjs-ui.md).
