# ORC Studio UI validation

## Automated checks

Environment observed: Node.js `v26.0.0`, npm `11.12.1`; package engine allows Node 22.12+, 24.x, and 26+.

| Command | Result |
| --- | --- |
| `npm test` | 7 files, 46 tests passed |
| `npm run typecheck` | Passed with no TypeScript errors |
| `npm run build` | Passed; `/` and `/_not-found` generated as static routes |
| `git diff --check` | Passed |

Focused regression coverage includes workspace grants and role visibility, assignment capacity/eligibility, isolated four-session overflow layout and confirmed starts, out-of-order session/report lifecycle events, room geometry and mirroring, motion routes and cancellation, queued-work receipt and adapter disposal, provider metadata and literal prompts, current-task selection, 500-message transcript bound, record audience guards, and accepted-report progress/deduplication.

## Browser acceptance

Controller-owned CUA review is pending. The preview process is running at `http://127.0.0.1:3001` (`npm run dev -- --hostname 127.0.0.1 --port 3001`). No browser screenshot or console result is claimed here.

The controller should verify desktop and 390×844 mobile layouts; approved sprite/head/seat proportions and Supervisor desk occlusion; merged, room-card, single-room and 64-department modes; the explicit overflow scenario and its restore control; task receipt/report travel, reduced motion and room-switch cleanup; visible task/lifecycle labels in map, roster and panel; session prompts/config and explicit close confirmation; record room artwork, derived progress, privacy and client grant boundaries; and acceptance progress from 67% to 75% exactly once. Archive screenshots only after that review.

## Scope boundary

The UI uses mock state and local interactions. It does not persist or resume CLI conversations. A future backend must durably retain the ORC session-to-native CLI conversation ID and resume the same conversation after server reset; it must not silently start a fresh chat for unfinished work. Real CLI processes, authentication, persistence, server APIs and uploaded project files remain outside this implementation.
