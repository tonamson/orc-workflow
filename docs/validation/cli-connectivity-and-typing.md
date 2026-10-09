# CLI connectivity and terminal typing verification

Verified on 2026-10-09 against an isolated production preview at port 3002 and a separately migrated PostgreSQL database. The user's active `orc-workflow` task on port 3001 was preserved throughout verification.

## Native AGY

The installed `agy` wrapper launches native AGY 1.3.2. A bounded, noninteractive prompt returned exit 0, JSON `status: SUCCESS`, `num_turns: 1`, and `response` matching `ORC_AGY_OK` after trimming the native trailing newline. A direct prompt took approximately 7.7–8.7 seconds. The fixed application probe also returned `connectionVerified: true` and `diagnostic: complete` using its default command runner and isolated temporary working directory. Version/file presence alone is not treated as a verified connection.

The production Settings button was exercised in Chrome: AGY displayed **CLI phản hồi · 1.3.2 · Kết nối đã xác minh** and Claude displayed **CLI phản hồi · 2.1.294 · Đã đăng nhập**. No unsupported-runner notes remain in the Settings cards. The test did not save the draft or create an ORC agent. [Screenshot](images/agy-connectivity-verified.png).

Review corrected two issues missed by mocked tests: forwarding the command timeout/working directory to the default runner, and reading AGY's actual `status`/`response` JSON fields. Regression tests now exercise the default runner with a fixture lasting beyond the ordinary 2.5-second diagnostic timeout, as well as newline handling, malformed responses, failed exits, timeouts and temporary-directory cleanup.

## Native typing latency

A disposable Codex Supervisor was created in the isolated database. The same saved native conversation was resumed after updating the preview. No test input was submitted as a new LLM prompt: the timing probe typed draft characters into the actual PTY and cleared them afterward.

| Measurement | Before | After |
| --- | ---: | ---: |
| Input POST acknowledgment, median | 9 ms | 5 ms |
| Input to native echo received over SSE, median | 266 ms | 45 ms |
| Input to native echo received over SSE, p95 | 274 ms | 52 ms |
| Persisted event to SSE receipt, median | 227 ms | 9 ms |

Each run sampled 15 draft characters on this local machine. These measurements cover the real HTTP → PTY → PostgreSQL → SSE path; they do not claim an end-to-end browser paint benchmark or guarantee the same latency over a remote network.

The input queue batches printable input for 12 ms, flushes control input promptly, serializes acknowledgments, bounds pending data and preserves UTF-8 chunk boundaries. Disconnects/session changes discard unsent data; uncertain acknowledgments are not retried. Committed runtime events now wake same-process SSE subscribers immediately while retaining the 250 ms polling fallback for external writers. The stream also sends an immediate initial comment so an idle terminal does not wait for the 15-second heartbeat before opening its connection; the production endpoint returned this comment in 3 ms. Tests cover wakeup/query races, failed transactions, ordering and listener/timer cleanup. Draft typing and Backspace were exercised directly in the Chrome terminal and the draft was cleared without submitting it.

## Scope

CLI connection testing does not add provider runners or change the ORC handoff workflow. The existing handoff still opens only a Codex peer in read-only mode and requires the UI action. Codex-internal subagents are not represented as independently tracked ORC CLI sessions. Those limitations remain distinct from CLI installation/connectivity.

Code checks before the initial-comment follow-up: 135 tests across 22 files passed. The follow-up's 9 SSE tests passed. A final run of the isolated connectivity/typing snapshot passed 125 tests, with 11 database integration tests skipped because that copy did not load the dedicated test URL. The isolated production Webpack build and TypeScript passed; `git diff --check` passed. Concurrent coordination changes from the user's running session are outside this connectivity/typing validation snapshot.

The user chose to keep the active port-3001 session and update it later. The fixed preview remains on port 3002; all native CLI sessions created for this verification have been closed. No production-session restart was performed.
