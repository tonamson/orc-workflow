# ORC Studio UI validation

## Automated checks

Environment observed: Node.js `v26.0.0`, npm `11.12.1`; package engine allows Node 22.12+, 24.x, and 26+.

| Command | Result |
| --- | --- |
| `npm test` | 56 tests passed, including PostgreSQL integration tests |
| `npm run typecheck` | Passed with no TypeScript errors |
| `git diff --check` | Passed |
| `npm run db:migrate` | Applied the initial migration to the isolated local database |
| `npm run db:status` | All migrations are applied |
| `npm run test:integration` | 5 PostgreSQL integration tests passed against `orc_studio_test` |
| HTTP API save/reload smoke | Record update was visible after a fresh GET; original content restored |

The test database verifies seed-once behavior, persisted notes and model settings, nullable native conversation references, transcript event persistence, report acceptance/progress deduplication, event-id conflict handling, stale and concurrent revisions, archived sessions, and transaction rollback on an injected journal failure. Integration state uses a unique test aggregate ID and is removed after each run.

Focused regression coverage includes workspace grants and role visibility, assignment capacity/eligibility, isolated four-session overflow layout and confirmed starts, out-of-order session/report lifecycle events, room geometry and mirroring, motion routes and cancellation, queued-work receipt and adapter disposal, provider metadata and literal prompts, current-task selection, 500-message transcript bound, record audience guards, and accepted-report progress/deduplication.

## Browser acceptance

Controller-owned final CUA review and production build are pending. The preview process is running at `http://127.0.0.1:3001` (`npm run dev -- --hostname 127.0.0.1 --port 3001`) with `.env` loaded and API access to Postgres. The HTTP route returned persisted data; this document does not claim final browser approval.

The controller should verify desktop and 390×844 mobile layouts; approved sprite/head/seat proportions and Supervisor desk occlusion; merged, room-card, single-room and 64-department modes; the explicit overflow scenario and its restore control; task receipt/report travel, reduced motion and room-switch cleanup; visible task/lifecycle labels in map, roster and panel; session prompts/config and explicit close confirmation; record room artwork, derived progress, privacy and client grant boundaries; and acceptance progress from 67% to 75% exactly once. Archive screenshots only after that review.

## Scope boundary

PostgreSQL persists the demo domain aggregate and event journal. UI role, search, selected panels, and room navigation remain browser-local. Demo role selection is not authentication, and this API does not provide production tenant isolation. The nullable native conversation-reference schema is only a future integration seam: no native conversation ID, CLI runtime, or crash-resume behavior exists yet. Uploaded project files are also outside this implementation.
