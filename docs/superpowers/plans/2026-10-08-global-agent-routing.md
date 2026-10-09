# Global Agent Routing Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the scoped tasks; user selected Luna implementation and root review/testing. Do not build/start/commit from workers.

**Goal:** Persist global routing settings and constrain Supervisor decisions to their configured providers, models and allowed efforts.

**Architecture:** A pure shared policy module defines validation and the client/server contract. TypeORM stores global settings and immutable per-run policy snapshots. The existing native Supervisor/peer flow consumes these snapshots; unsupported runners block clearly.

**Tech Stack:** Existing Next.js, React, PostgreSQL, TypeORM and node-pty; no new dependencies.

**Spec:** [Design](../specs/2026-10-08-global-agent-routing-design.md)

## Global constraints

- Global settings; task groups `coding`, `planning`, `review`; provider IDs `codex`, `claude`, `agy`, `opencode`.
- Empty model means native CLI default. Supervisor launch effort is fixed; task effort must belong to a nonempty configured allowed list.
- Keep native approval policy and exact conversation resume; do not install providers or alter authentication/trust settings.
- Settings alone never create a process or office actor; no unsupported-provider fallback.

## Review focus

- Invalid/out-of-policy Supervisor output preserves a retryable native session.
- Unsupported provider decision is persisted/displayed but opens no peer process.
- Global save during a running task cannot alter its snapshot/resume choices.
- Stale settings save fails clearly rather than overwriting another save.
- Mobile dialog has visible Save/Close controls, focus containment and no horizontal overflow.

### Task 1: Shared policy, persistence and runtime integration — backend Luna

- [x] Define `features/settings/routing-policy.ts`: `RoutingProvider`, `TaskKind`, `RoutingPolicy`, `RoutingDecision`, `RoutingSettingsEnvelope`; provider catalog, initial draft, validation and native decision parser.
- [x] Write failing policy tests for unknown category, invalid provider/model, empty efforts and disallowed native effort; implement validators and JSON parsing.
- [x] Add TypeORM migration/settings entity, settings GET/PUT route with expected revision and existing local request guard. Add run snapshot/decision JSON columns; support null legacy snapshots.
- [x] Write PostgreSQL integration tests for global save/reload, stale revision and snapshots; implement store operations.
- [x] Feed saved policy to native Supervisor; launch configured Supervisor and supported peer model/effort. Validate decision before spawn. Persist blocked decisions without provider substitution or closing Supervisor.
- [x] Add tests for immutable snapshot, invalid decision retry, unsupported no-spawn and launch arguments. Run focused tests/typecheck, report limitations.

### Task 2: Settings screen and decision display — frontend Luna

- [x] Consume GET/PUT `/api/runtime/settings` envelope `{configured, revision, policy, providers}`; PUT `{expectedRevision, policy}`. Shared backend-owned module supplies exact types/catalog.
- [x] Add global settings dialog and desktop/mobile navigation entry. Supervisor profile and three task cards have provider/model inputs and effort controls, explicit save/status/conflict feedback and dirty close handling.
- [x] Update terminal run types and show optional routing snapshot/decision; human-readable errors for missing policy, invalid decision and unsupported runner. Refresh run after blocked delegation to display persisted decision.
- [x] Exercise pure form transformations when they contain real invariants; avoid CSS mirror tests. Root owns actual browser review.

### Task 3: Root review and real verification

- [x] Review all changes and migrations. Run full tests/typecheck/build after stopping production preview.
- [x] Apply migration, review actual settings UI at desktop and mobile; save/reload global policy and stale-save case.
- [x] Run a lightweight native Codex review routing workflow; verify chosen effort in native `/status`, unsupported routing no-spawn, snapshot stability after settings change and restart.
- [x] Stop own test sessions, remove only disposable test runs, preserve the user's chosen settings, save screenshots and validation notes. Restart production preview for handoff.
