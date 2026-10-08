# ORC Studio UI validation

## Automated checks

Environment observed: Node.js `v26.0.0`, npm `11.12.1`; package engine allows Node 22.12+, 24.x, and 26+.

| Command | Result |
| --- | --- |
| `npm test` | 7 files, 42 tests passed |
| `npm run typecheck` | Passed with no TypeScript errors |
| `npm run build` | Passed; `/` and `/_not-found` generated as static routes |
| `git diff --check` | Passed |

Focused regression coverage includes workspace grants and role visibility, assignment capacity/eligibility, out-of-order session/report lifecycle events, room geometry and mirroring, motion routes and cancellation, queued-work receipt and adapter disposal, provider metadata and literal prompts, 500-message transcript bound, record audience guards, and accepted-report progress/deduplication.

## Browser acceptance

Controller-owned CUA review is pending. The development preview is available at `http://127.0.0.1:3001` (`npm run dev -- --hostname 127.0.0.1 --port 3001`). No browser screenshot or console result is claimed here.

The controller should verify desktop and 390×844 mobile layouts; approved sprite/head/seat proportions and Supervisor desk occlusion; merged, room-card, single-room and 64-department modes; task receipt/report travel, reduced motion and room-switch cleanup; session prompts/config and explicit close confirmation; record privacy and client grant boundaries; and acceptance progress from 67% to 75% exactly once. Archive screenshots only after that review.

## Scope boundary

The UI uses mock state and local interactions. Real CLI processes, authentication, persistence, server APIs and uploaded project files remain outside this implementation.
