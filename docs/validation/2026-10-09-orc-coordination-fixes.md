# Bàn giao sửa lỗi điều phối ORC — 2026-10-09

## Phạm vi và chủ sở hữu

- Yêu cầu: sửa 4 lỗi logic đã audit, có test hồi quy và review độc lập.
- Implementer: `/root/coordination_fix`.
- Root: điều phối, kiểm tra bằng chứng và giao reviewer độc lập.
- Trạng thái: implementer hoàn tất; reviewer PASS/APPROVE; root nghiệm thu tự động.
- Baseline HEAD: `ac74e1e290779ebd77ac639a76e409347661e86e`.
- Working tree có thay đổi trước bàn giao; giữ nguyên, đặc biệt runtimeEventNotifier/SSE trong service.ts.
- Ownership: `server/runtime/service.ts`, test hồi quy runtime coordination; chỉ sửa API error mapping nếu cần.
- Ngoài phạm vi: UI/animation, runner mới, authentication/trust, production DB, commit/push/deploy, refactor rộng, dependency mới.

## Bằng chứng audit và giới hạn

Audit chạy logic NativeRuntimeService thực tế qua doubles trong bộ nhớ cho DB/CLI.
Không dùng kết quả này để khẳng định đã tái hiện qua UI/CLI thật.

```json
{"probe":"peer_status_capture_failed","afterFailure":{"phase":"peer_running","status":"error","peerNativeId":null},"spawnCountAfterDelegateRetry":1,"resumeError":"native_conversation_unknown"}
{"probe":"close_during_delegation","launchesAfterClose":["p"],"phase":"peer_running","status":"active"}
{"probe":"resume_while_other_run_active","resumed":["p"],"otherRunStatus":"active"}
{"probe":"repeat_report_before_history_ack","writes":2,"reportDelivered":false}
```

25 test routing policy/runtime status/security/lifecycle và 5 routing-settings integration test đã pass ở thời điểm audit.
Đó là baseline, không phải bằng chứng các lỗi đã được sửa. Code đã có thay đổi song song sau audit.

Graph Tier 2: project `Volumes-Code-Opensource-orc-workflow`, generation `2026-10-09T03:22:37Z`.
Coverage không ghi nhận gap cho service.ts, entities.ts, routing-settings.integration.test.ts, API helpers;
đây là tín hiệu best-effort, cần đối chiếu source mới nhất.

## F1 — P1: peer lỗi bootstrap không tiếp tục được

- Source: delegatePeer, spawnSession/failStatusCapture, resumeSession trong service.ts.
- Trigger: peer spawn trả về; run chuyển peer_running; /status thất bại trước khi lưu UUID.
- Actual: peer error/UUID null; delegate retry không khởi chạy; resume báo native_conversation_unknown.
- Expected: có đường retry bootstrap chưa gửi task, giữ nguyên cached routing decision/snapshot.
- Acceptance: lỗi trước UUID và restart trước UUID phục hồi được; peer đang chạy hoặc đã có UUID không bị tạo conversation mới ngoài ý muốn.
- Regression: kiểm tra state, số launch và UUID qua public lifecycle methods; không chỉ kiểm tra helper.

## F2 — P1: báo cáo gửi trùng trong lúc chờ native history

- Source: submitReport, confirmReportHandoff trong service.ts.
- Trigger: gọi report lại sau terminal.write nhưng trước history ack.
- Actual: cùng run/report token được ghi hai lần.
- Expected: chỉ một handoff pending cho cùng run/token; native history xác nhận delivery.
- Acceptance: overlap và sequential retry trước ack không gửi trùng; timeout/failure/unavailable Supervisor có đường retry; restart đối soát history; finalize vẫn xác minh token ở completed turn.
- Regression: đếm side effect ở terminal boundary và kiểm tra persisted delivery state.

## F3 — P1: close không fence thao tác launch đang chờ

- Source: closeRun, delegatePeer, resumeSession, spawnSession trong service.ts.
- Trigger: delegate đang chờ nativeTurn; close trả về; nativeTurn resolve.
- Actual: peer launch sau close và run được ghi active.
- Expected: close chặn in-flight launch và stale state write; explicit resume sau close vẫn được phép.
- Acceptance: delayed delegate và delayed resume/bootstrapping không tạo tiến trình muộn; không ghi active/done bằng dữ liệu cũ; không deadlock close/finalize/error cleanup.
- Regression: dùng deferred promise ở boundary, kiểm tra ordering close versus spawn và persisted state.

## F4 — P2: resume bỏ qua global admission

- Source: createRun, resumeSession trong service.ts.
- Trigger: một run có starting/active/closing session; resume session của run khác.
- Actual: resume được phép.
- Expected: runtime_busy được kiểm tra trong cùng transaction/advisory lock với chuyển status.
- Acceptance: chặn cả starting/active/closing ở run khác; vẫn cho Supervisor và peer cùng run hoạt động; không thay đổi native UUID/model/effort.
- Regression: kiểm tra rejected launch và state không đổi, cùng test positive same-run.

## Quy trình và gate nghiệm thu

- [x] Audit có bằng chứng, mức ưu tiên, phạm vi và giới hạn.
- [x] Giao implementer có ownership rõ; yêu cầu bảo toàn thay đổi song song.
- [x] Tái hiện trên source hiện tại và ghi nhận test RED trước khi sửa production code.
- [x] Sửa tối thiểu cả 4 lỗi; chạy focused regression GREEN.
- [x] Reviewer độc lập kiểm tra spec compliance và chất lượng; xử lý finding quan trọng.
- [x] Root chạy gates phù hợp trên code cuối: focused regression, routing integration, typecheck, build khi hợp lệ.
- [x] Ghi kết quả thực tế và giới hạn; không đánh dấu native/UI E2E đã pass nếu chưa chạy.
- [x] Nghiệm thu; chưa commit/push/deploy.

## Theo dõi

2026-10-09: worker coordination_fix đã nhận nhiệm vụ sửa. Animation ORC hiện theo dõi CLI do ứng dụng tạo;
agent điều phối của phiên Codex không nằm trong datasource animation. Không thêm actor giả.

## Kết quả nghiệm thu cuối

- Implementer: `/root/coordination_fix`; reviewer: `/root/coordination_review`.
- Phạm vi sửa: `server/runtime/service.ts`, `tests/runtime-coordination.integration.test.ts`. Giữ nguyên các thay đổi có sẵn/đồng thời.
- F1: retry bootstrap error/interrupted/closed trước UUID, giữ cached routing; không tạo conversation mới cho peer đã có UUID.
- F2: một handoff pending theo token, đối soát history trước retry; polling lỗi thời dừng; delivery update không ghi đè lifecycle.
- F3: invocation/close generation fence cho delegate/resume/report/finalize, bootstrap timers, UUID persistence, model mismatch và task entry. Explicit resume sau close vẫn được phép.
- F4: kiểm tra run khác starting/active/closing trong admission transaction; cho phép Supervisor/peer cùng run. Unique index theo role không thay thế admission.
- RED: ban đầu 6 fail/2 pass; mở rộng 3 fail/20 pass; UUID-save expected closed/got active; residual cuối 3 fail/24 skipped.
- GREEN: 27 coordination regression tests PASS.
- Root `npm test -- --no-file-parallelism`: 23 files / 163 tests PASS, exit 0.
- Root `./node_modules/.bin/tsc --noEmit --incremental false`: PASS, exit 0.
- Root `git diff --check`: PASS, exit 0.
- Production build Next.js16.4.0/Webpack trong `/private/tmp/orc-coordination-build-o0mLnC`: PASS, exit 0; `.next` preview không bị ghi đè.
- Lần build đầu xung đột ambient TURBOPACK=1/--webpack; lần cuối bỏ biến này riêng trong child build. Không dùng kết quả để khẳng định gate Turbopack mặc định.
- Reviewer requirements PASS F1–F4; quality APPROVE; không còn material finding.
- Review artifacts: `/private/tmp/orc-coordination-service-before.ts`, `/private/tmp/orc-coordination-service-delta.patch`.

## Giới hạn và trạng thái phát hành

- Service và PostgreSQL thật trên DB test; PTY/app-server mô phỏng. Chưa xác minh native/UI end-to-end.
- Phạm vi local single-process; không cam kết multi-process hoặc exactly-once xuyên mọi provider failure/độ trễ.
- Handoff guard chống gửi trùng trong cửa sổ pending; sau expiry đối soát history trước retry.
- Tests tạo/dọn row riêng trên DB test. Không thay production DB/authentication/trust hoặc khởi chạy native agent cho nhiệm vụ này.
- Animation chỉ phản ánh CLI do ORC tạo, không hiển thị collaboration subagent; không thêm actor giả.
- User đã yêu cầu commit/push sau nghiệm thu; trạng thái Git sẽ được xác minh và báo riêng.
