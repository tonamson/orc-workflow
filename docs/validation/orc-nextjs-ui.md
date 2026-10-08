# ORC Studio validation

Controller review completed on 2026-10-08. Workflow/persistence acceptance was reviewed at `d163845`; final readability/scrollbar polish and local integration were reviewed at `00d48ec` on `main`. Luna implemented the product; the controller independently reviewed source, ran the final gates from the main checkout, and operated the browser. The production preview is `http://127.0.0.1:3001/`.

## Automated checks

Final main-checkout environment: Node.js `v24.19.0`, npm `12.0.2`, Next.js `16.4.0`, PostgreSQL `18.6`, TypeORM `1.1.1`. The initial worktree review also ran under Node.js `v26.0.0` and npm `11.12.1`.

| Command | Final result |
| --- | --- |
| `npm test` | 61/61 tests passed across 11 files, including 5 real PostgreSQL integration tests |
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


## Readability, scrollbar polish, and local integration

The user approved local integration into `main`, then requested larger text, less dense content, and scrollbars matching the office theme. Final source commits are `b18620c`, `6adbae7`, `cbe9537`, `f7905bd`, and `00d48ec`.

- Normal navigation/search/form controls use 14–15px text and 40–44px targets; content and record text use 15px, and roster metadata uses 13px. Pixel-map labels remain compact to preserve room/actor proportions; full model/reasoning details are available through the roster and selected-session panel.
- A fresh page opens on the office with no selected detail panel. Simulator controls sit below the office; full rosters and configuration use closed disclosures with visible chevrons. The selected-session terminal remains visible and follows new output.
- At 1440×900, the merged map ends at y831.36, before the footer at y848. The simulator starts after the map and roster, without overlapping the artwork. At 390×844, the map is fully visible at y319–539.16; document width is 390, with no horizontal page overflow.
- Workspace/panel/room-navigation/records scrollbars use thin muted green-gray styling. Terminal scrollbars use dark-green track/thumb colors. Computed styles and screenshots confirm both themes; the 44×44px panel close target remains usable on mobile.
- The client view has one category filter, in the records navigation. The contract filter returns only the shared contract; the detail remains read-only with 15px content. Simulator/agent controls remain absent from the client view.
- The controller sent a literal demo prompt to Nova and observed its echo immediately in the visible terminal. This exercises the simulated UI, not native CLI execution.
- PostgreSQL Compose was recreated from the main checkout against the same named volume; the database is healthy, all migrations remain applied, and the existing 9/12 progress is preserved. Final main gates: 61 tests, typecheck, production build, and diff check passed.

Final screenshots: [clean desktop overview](images/overview-clean.png), [clean mobile overview](images/mobile-clean.png), [visible mobile terminal](images/mobile-terminal-clean.png), and [mobile records filter](images/mobile-records-clean.png). Earlier screenshots document the preceding workflow/artwork review.
