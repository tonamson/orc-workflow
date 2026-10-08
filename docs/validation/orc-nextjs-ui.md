# ORC Studio validation

Controller review completed on 2026-10-08 against product commit `d163845` on `feat/nextjs-ui`. Luna implemented the product; the controller independently reviewed source, ran the final gates, and operated the browser. The production preview is `http://127.0.0.1:3001/`.

## Automated checks

Observed environment: Node.js `v26.0.0`, npm `11.12.1`, Next.js `16.4.0`, PostgreSQL `18.6`, TypeORM `1.1.1`.

| Command | Final result |
| --- | --- |
| `npm test` | 60/60 tests passed across 11 files, including 5 real PostgreSQL integration tests |
| `npm run typecheck` | Passed |
| `npm run build` | Optimized production build passed; `/api/studio` is dynamic |
| `git diff --check` | Passed |
| `npm run db:migrate` | Initial migration applied; subsequent run reported schema current |
| `npm run db:status` | All migrations applied |

The integration suite uses a separate `orc_studio_test` database, unique aggregate IDs, and cleanup. It covers seed-once behavior, persisted notes/models, nullable native conversation references, event history beyond the bounded UI transcript, archived sessions, concurrent/stale revisions, report-acceptance deduplication, idempotency-key payload conflicts, canonical JSON comparison, and transaction rollback after an injected journal-write failure.

Regression tests cover workspace grants and role visibility, capacity and assignment eligibility, four-session overflow without duplicate Lead/session creation, stable seats, out-of-order lifecycle events, room geometry/mirroring, motion cancellation, literal prompt routing, provider metadata, hidden-record guards, approval returning to working state, and room navigation during delayed receipt.

## Browser acceptance

Reviewed the production build in Chrome at desktop 1440×900 and mobile 390×844.

- The approved flat pixel office, matching characters, desk occlusion, and seated anchors are consistent in overview, single-room, three-agent, and mirrored overflow views.
- Desktop and mobile document widths equal their viewport widths. Compact map labels leave the floor visible; the adjacent session roster provides full model/reasoning metadata.
- Merged office is the default. Room cards, room search, single-room/back navigation, an empty workspace, and 64 departments (67 rooms) work. Increasing rooms does not create phantom agents.
- The explicit overflow scenario produces three confirmed agents in one room and one in a second room, with no duplicate Lead. Confirmed session count and global reservations remain visible.
- Receipt and report travel each have 70 timed DOM samples: no hidden or zero-area sprites, no inherited horizontal scaling, visible walking frames, and the expected endpoint. These samples are evidence at sampled times, not an exhaustive frame-by-frame recording. See [receipt samples](receive-motion-samples.json) and [report samples](report-motion-samples.json).
- Changing rooms during receipt preserves the selected room and keeps the panel closed after the callback. Reduced-motion behavior and timer/observer cleanup were reviewed in source and tests; a browser reduced-motion preference toggle was not separately exercised.
- Literal prompt text reaches only the selected demo session. Approval returns the task to working; report submission is a separate action. Disconnect reserves the slot; failed close keeps the actor/slot; confirmed close removes the actor and leaves a readable archive.
- CEO, employee, client-a, client-b, and no-grant views follow the requested UI boundaries. Client-a sees only shared Website records; client-b sees only its granted Mobile workspace; an ungranted client sees no workspace. Employees cannot open the lobby.
- Accepted report progress changes from 8/12 (67%) to 9/12 (75%), including the progress-record summary. Acceptance is deduplicated and does not automatically publish the internal report to customers.
- Final preview shows `Đã lưu`. Observed browser warnings originate from an installed Chrome extension; expected write-error behavior was deliberately exercised below.

Screenshots: [overview](images/overview.png), [three-agent room](images/room-three-agents.png), [mirrored room](images/mirrored-room.png), [Engineering](images/engineering.png), [mobile overview](images/mobile-overview.png), [mobile room](images/mobile-room.png), [client lobby](images/client-records.png), [mobile contract detail](images/mobile-contract.png).

## Persistence and recovery checks

The isolated Compose project `orc-studio-local` binds PostgreSQL only to `127.0.0.1:55432` and uses a named volume. The unrelated database on port 5432 was left untouched. Schema changes use explicit TypeORM migrations with `synchronize: false`; Prisma is not used.

A note edited through the UI remained present after a browser reload. The database aggregate was then inspected before and after both a normal container restart and an abrupt PostgreSQL `SIGKILL` followed by `docker compose ... up -d --wait`. Revision and JSON-state checksum were unchanged:

```text
revision = 3
md5(state::text) = 4acacb4b4c26fbe091e6b1e83fd98fe6
fsync = on
synchronous_commit = on
full_page_writes = on
```

The production UI reopened the preserved note after recovery. This verifies committed demo data across a database-process crash, not physical-server power-loss guarantees or native CLI resumption.

For a write failure, the controller stopped only the ORC database, saved an internal note, and observed `Chưa lưu được thay đổi · 1 đang chờ` with `Thử lưu lại`. After database recovery, the controller switched workspaces before retrying. Retry persisted the original workspace's note, showed `Đã lưu`, and did not redirect the current workspace. There is no silent in-memory success fallback. See [database retry state](images/database-retry.png).

## Scope boundary

PostgreSQL stores all current demo domain information: workspaces, customers/grants, rooms/departments, session configuration and bounded transcripts, tasks/reports, project records/notes, archives, and the append-only event journal. UI role preview, search, navigation, and panel selection remain browser-local. The initial schema uses an aggregate JSONB snapshot plus a transactional event journal; [the database decision](../research/database-decision.md) describes future normalization.

Demo roles are not authentication. The local API returns the aggregate and does not implement production tenant isolation. Secure account/workspace enforcement is required before exposing customer data through a public domain. Native CLI execution, full terminal streaming, uploaded file storage, and resuming the same native conversation remain future integrations. Native conversation IDs are nullable, not fabricated; this implementation does not claim CLI crash-resume support.
