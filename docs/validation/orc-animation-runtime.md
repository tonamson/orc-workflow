# Native workflow, animation and mobile review

Review date: 2026-10-09. Production preview: `http://127.0.0.1:3001`.

## Actual native run

This review used Chrome and real Codex PTYs, not a simulated CLI response or a browser E2E fixture. Luna implemented fixes; the parent agent reviewed source and exercised the UI.

The successful disposable run was `animation-recovery-workflow` in workspace `animation-review`. Supervisor used `gpt-6.1-sol/high`; Peer used `gpt-6.1-sol/medium`, selected from the persisted review policy at revision 6.

1. Invoked `$superpowers:brainstorming` through the Supervisor's web terminal. Native Codex loaded the skill and asked brainstorming questions. The bounded discussion established that CEO confirmation of the Supervisor summary is the acknowledgement before departure.
2. Supervisor supplied the review routing decision. The UI delegated to a real Peer session, which ran the permitted read-only `nl -ba package.json` command.
3. Peer reported `scripts.start: "next start"` at line 12 and `dependencies.next: "16.4.0"` at line 25. The report explicitly limited its conclusions to this file.
4. The UI handed the real report to Supervisor. Supervisor summarized the same findings. CEO clicked **Chốt nhiệm vụ**.
5. PostgreSQL showed `done/done`, `report_delivered=true`, both report fields populated, both sessions `closed`, exit code 0, and null PIDs. OS checks also showed both owned processes absent.

An earlier disposable run completed the handoff but could not read the file because its prompt over-restricted tools. Its report correctly stated that limitation; it is not counted as a successful file audit.

## Animation observations

Captured actual browser frames during assignment, reporting and departure:

- Assignment: 120 frames over 7.383 seconds; Agent travelled from the room entrance to its chair.
- Reporting: 120 frames over 7.081 seconds; Agent left its chair through the department door, entered the central hall and arrived in front of the Supervisor desk. It remained there through subsequent polling.
- Departure: 120 frames over 6.952 seconds; the closed Agent walked from the desk through the hall and main entrance, then disappeared. Active counts reached zero and did not resurrect the closed session.
- Opening a single department showed a stable handoff badge, without an actor walking outside the cropped room. Returning to the overview kept the Agent at the Supervisor desk rather than replaying its report walk.

Evidence: [report at the desk](images/animation-report-after.png), [single-room handoff](images/animation-report-room.png), [office after departure](images/animation-exit-after.png).

## Network, restart and terminal

Chrome offline testing locked input when a request was unconfirmed. After reconnection, the explicit session check restored input without creating a replacement conversation.

An owned Next process was forcibly terminated. Owned CLI processes stopped; the UI displayed **Chưa xác minh · mất kết nối máy chủ** instead of asserting they were alive. After the preview restarted, both sessions were resumed through the UI with the same native conversation IDs:

- Supervisor: `01a11e33-0588-71d2-994e-4cbb3b5ca294`.
- Peer: `01a11e63-a611-7ae0-8726-9de0390ca9eb`.

Terminal output now persists ordered resize events and replays them after flushing preceding xterm writes. Resize requests are deduplicated per process and size. Cancellation prevents a previous selection's asynchronous replay from modifying the new terminal.

Live native terminal input and output were checked in the desktop side panel, fullscreen, and an emulated iPhone viewport (393 × 852). Native `/status` redraw and an unsent input probe were exercised after resizing. Mobile Enter/Esc/Tab/arrows/Ctrl+C controls and panel close/fullscreen controls remained accessible. The mobile room menu exposed every existing room and retained a separate **Toàn cảnh** button. Settings close/save controls remained visible.

Evidence: [mobile room menu](images/animation-mobile-menu-after.png), [mobile settings](images/animation-mobile-settings.png), [mobile terminal input](images/animation-mobile-terminal.png), [resumed native terminal](images/animation-resume-terminal-after.png).

The inactive-session tab's false SSE reconnect label was also corrected: only the selected terminal uses its SSE connection state; inactive tabs use process status, while unavailable-server warnings retain precedence.

The live screenshots were captured before this final label-only fix. Its regression test first failed with the old label, then passed with the correction; the final production build includes it.

## Final checks

- `npm test`: 19 files, 100 tests passed.
- Real dedicated PostgreSQL persistence suite: 6 tests passed, including resize-event storage under the migrated database constraint.
- `npm run build`: successful production compilation and TypeScript check.
- Forward migration `1791500000000-AllowRuntimeResizeEvents` applied to the preview database; existing migrations were retained.
- A parallel database-test collision was traced to the resize fixture claiming a live Supervisor slot. It now uses a closed session because testing event persistence does not require a live process. The full suite passed after that fix.

## Scope and limits

This proves the exercised Codex Supervisor → one Peer → Supervisor → CEO completion flow. It does not certify Claude, agy/Gemini, OpenCode, automatic multi-Lead orchestration, production RBAC, physical phone keyboards, or a full machine/database power-loss recovery.

The current runtime prototype still enforces a global maximum of one live Supervisor and one live Peer. The UI's expandable departments do not imply that concurrent multi-workspace CLI execution is implemented.

Terminal histories created before resize events were recorded lack their original dimensions. Their old ANSI output cannot be reconstructed exactly; the fallback does not restore information that was never persisted.

Both disposable runs and their application database records were removed after verifying closure. Global routing settings (revision 6), native CLI histories and other workspaces were preserved. Reloading Chrome showed no workspace, agent or running CLI.
