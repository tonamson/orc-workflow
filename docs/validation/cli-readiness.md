# Settings CLI diagnostics

Validated on 2026-10-09 using the production preview and actual installed commands. Luna implemented the feature; the parent reviewed the source, requested corrections, and exercised Chrome and the API.

Settings exposes one **Kiểm tra CLI** action per unique provider selected in the current draft. Testing does not save that draft, start an agent, or send an LLM prompt. Results show availability, verifiable version/authentication, timestamp and safe failure information. Runner support is separate and is not part of the test result. A successful version check displays **CLI phản hồi**; unavailable authentication displays the neutral **Đăng nhập chưa xác minh**.

## Actual results

| Provider | Installed version | Local authentication check | ORC runner |
| --- | --- | --- | --- |
| Codex | 0.162.0 | Authenticated | Supported; local diagnostics passed |
| Claude | 2.1.294 | Authenticated | Unsupported |
| agy / Antigravity | Executable found; not invoked | Unknown | Unsupported |
| OpenCode | 1.18.35 | Unknown | Unsupported |

Codex, agy and Claude were tested from the saved configuration. OpenCode was selected in a temporary unsaved review profile, tested through the UI, then discarded. Persisted routing settings remained revision 6 with coding=agy, planning=claude and review=codex. The runtime runs API remained empty.

Chrome desktop and emulated iPhone 16 (393 × 852) showed accessible test buttons, wrapped results and visible close/save controls. A mobile **Kiểm tra lại** updated the Codex timestamp. Chrome Offline produced **Không kết nối được máy chủ kiểm tra. Thử lại.**; restoring No throttling and retesting recovered the successful local result. Device emulation and DevTools were closed afterward.

Evidence: [desktop](images/cli-readiness-desktop.png), [mobile](images/cli-readiness-mobile.png), [offline](images/cli-readiness-offline.png).

Presentation follow-up: removed runner-support wording and the technical footnote from the test section. The production UI was retested with Codex and Claude displaying **CLI phản hồi · [version] · Đã đăng nhập**, and agy displaying **Đã tìm thấy CLI · Đăng nhập chưa xác minh**. The desktop image reflects these final labels; mobile/offline images record the initial diagnostic checks. Production build and TypeScript passed after the wording update.

The API rejected an arbitrary `sh` provider with HTTP 400 and a foreign mutation origin with HTTP 403. Provider names select fixed command argument lists. Output is bounded, commands time out and are terminated, requests for the same provider share an in-flight probe, and concurrency is limited. Raw CLI output, account details and credentials are not returned.

Review caught and corrected stderr-only Codex login status, OpenCode banner output being mistaken for authentication, stale results after closing Settings, and bare versus relative `ORC_CODEX_BIN` resolution. Regressions cover these cases plus missing executables, unsupported runners, invalid requests and timeout termination.

Final checks: `npm test` passed 118 tests across 21 files; `npm run build` passed production compilation and TypeScript; `git diff --check` passed.

These local diagnostics do not establish online LLM connectivity, prove a selected model/effort works, or enable currently unsupported provider runners. The separate native Codex workflow review is recorded in [orc-animation-runtime.md](orc-animation-runtime.md).
