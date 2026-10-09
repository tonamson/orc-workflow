# Global agent routing settings

The CEO configures which native CLI handles coding, plan/spec and review/audit. Settings apply to every workspace. The Supervisor selects a task category and an effort from the configured allowed values; it cannot invent a provider, model or effort outside that policy. CLI skills and tool calls remain inside the native terminal.

## Settings and persistence

Add **Cài đặt → Phân công agent** to desktop and mobile navigation. Show a Supervisor launch profile and three task profiles, each with a CLI logo, provider selector and model input (empty means the native CLI default). Supervisor has a fixed launch effort; task profiles have selectable allowed effort values. Explain the global scope once. Use explicit Save, error/retry feedback and dirty-state protection; never start agents from this screen.

Use a singleton PostgreSQL settings row through TypeORM, with a revision checked on save. GET does not seed a database row. The initial draft maps coding to `agy`, planning to Claude, review to Codex; these are configuration suggestions, not running agents. `agy` means the installed Antigravity CLI. No provider authentication/configuration is copied into this database.

## Runtime

Each new task requires saved settings and snapshots their revision and policy in its run row. Existing tasks with no snapshot retain the previous Codex flow. Launch Supervisor with its configured model/effort. Its native prompt receives the snapshot and requests JSON `{taskKind, effort, reason, instruction}`. The server validates this result and derives provider/model from the saved task profile, never from model-generated executable arguments.

Persist the validated routing decision and show it beside the task: category, CLI, configured model/native default, chosen effort and reason. Pass the selected model/effort into the native Codex peer launcher. Preserve the same native UUID and actual captured model/effort on resume. Changing global settings must not alter an existing run or resume.

Only Codex currently has a runtime adapter. Other providers can be configured but show **Runner chưa kết nối**. A selected unsupported provider must block delegation explicitly without launching a Codex substitute, closing the Supervisor or losing the decision. Invalid native JSON or out-of-policy effort must likewise preserve a recoverable Supervisor. This change does not implement new provider runners or automatic multi-stage/Lead workflows.

## Acceptance

Save/reload settings globally with no workspace selected; reject stale writes and invalid/empty effort lists. Real Codex Supervisor chooses review and an allowed effort; the real peer uses that configured effort and completes its report. An unsupported provider selection creates no peer process and remains visible. A run keeps its original policy across settings changes/restart. Review desktop/mobile controls, focus, overflow and scroll. Do not add mock tasks or occupants.
