# ORC Next.js UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển giao diện pixel văn phòng bản 11 thành frontend Next.js chạy độc lập, giữ đầy đủ các workflow đã duyệt với dữ liệu mô phỏng.

**Architecture:** App Router giữ layout tĩnh; một Client Component điều phối store bằng reducer, các view đọc cùng store và geometry. Demo adapter phát sự kiện có ID, tách khỏi animation để sau này thay bằng runner thật. Giữ CSS và SVG/pixel asset đã duyệt, loại bỏ chuỗi override của mockup.

**Tech Stack:** Next.js 16.4.0, React/React DOM 19.3.0, TypeScript 7.0.2, Vitest 5.0.3, CSS và Web Animations API. Dùng npm với package-lock.json; môi trường đang có Node 24.19.0 và npm 12.0.2, đặt Node engine `^22.12.0 || ^24.0.0 || >=26.0.0` theo Vitest. Phiên bản stable đã tra npm ngày 2026-10-08; không dùng canary.

**Spec:** [Thiết kế đã duyệt](../specs/2026-10-08-orc-nextjs-ui-design.md). Đọc cả spec và plan trước khi thực hiện.

## Global Constraints

- “Next.js App Router và TypeScript.”
- “Mỗi phòng làm việc chứa tối đa 3 agent/phiên, tính cả Lead.”
- “Một nhân vật xuất hiện khi và chỉ khi có một phiên CLI tồn tại; Supervisor cũng tuân theo quy tắc này.”
- “Chỉ cập nhật phần việc đã xác nhận hoàn thành.”
- “Khách không được nhìn thấy terminal, bản đồ phòng ban, log hoặc báo cáo nội bộ.”
- “Mỗi workspace tương ứng một project/repo của một khách hàng riêng, được chọn trên server.”
- “Một tài khoản khách chỉ được truy cập các workspace thuộc khách hàng đó và đã được cấp phép cho tài khoản; không suy ra quyền truy cập từ vai trò “Khách”.”
- “Trang không tràn ngang ở kích thước 390×844.”
- “Tối thiểu phải kiểm tra 64 phòng ban cộng các phòng mặc định.”
- “Không mang các lớp override JS/CSS nối tiếp của mockup sang ứng dụng.”
- “Chạy CLI, đăng nhập thật, lưu hồ sơ và triển khai server thuộc giai đoạn backend tiếp theo.”
- Mốc hình ảnh duy nhất: `pixel-office-seated-alignment-v11-delivery.html` và các asset trong `.superpowers/brainstorm/57389-1791431517/content/`. Không sửa artwork/thiết kế đã duyệt trong quá trình chuyển FE.

## Review Focus

1. Giảm số phòng demo khi còn phiên: giữ mọi phòng có phiên, không làm mất agent hoặc orphan session. Kiểm tra tại Task 2.
2. Event trùng hoặc đến muộn sau đóng phiên: không hồi sinh phiên, không cộng tiến độ lại. Kiểm tra tại Task 2.
3. Đổi vai trò/tài khoản khách/workspace khi panel đang mở: kiểm tra customerId và grant; bỏ lựa chọn không còn được phép, không lộ tên/hợp đồng/log khách khác; tài khoản không có grant thấy trạng thái chưa được cấp workspace. Kiểm tra tại Task 3.
4. Chuyển phòng/unmount giữa animation: hủy motion, không để callback/timer cũ kéo người dùng về phòng trước. Kiểm tra tại Task 5.
5. Model/reasoning thiếu hoặc unsupported, prompt chứa `$`, `/`, xuống dòng: giữ nội dung và metadata đúng ý nghĩa, không suy diễn từ logo. Kiểm tra tại Task 6.

---

## Cấu trúc file và các hợp đồng chung

Root hiện chỉ có tài liệu đã commit và mockup chưa track. Đây là ứng dụng mới; không có framework/service sẵn để tái sử dụng. Khi thực thi, đọc skill worktree trước khi quyết định isolation; nếu dùng worktree, copy những asset mockup chưa track từ workspace gốc vào worktree bằng đường dẫn tuyệt đối. Không commit toàn bộ `.superpowers/`.

| Nhóm file | Trách nhiệm |
| --- | --- |
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | Layout, điểm vào và token/reset |
| `features/studio/Studio.tsx`, `StudioProvider.tsx`, `AppShell.tsx`, `studio.css` | Store/context, điều hướng desktop/mobile, panel chung |
| `features/studio/model/{types,seed,reducer,allocation,selectors}.ts` | Dữ liệu, events, quy tắc phiên/phòng/quyền hiển thị |
| `features/office/{geometry,atlas}.ts`, `OfficeView.tsx`, `RoomView.tsx`, `AgentSprite.tsx`, `office.css` | Artwork, ghế, các chế độ nhìn và sprite |
| `features/office/{motion,useAgentMotion}.ts` | Đường đi, tư thế, cleanup |
| `features/demo/adapter.ts`, `DemoControls.tsx` | Sự kiện demo rõ ràng, không chạy CLI |
| `features/sessions/{metadata,skills}.ts`, `SessionPanel.tsx`, `SessionRoster.tsx`, `sessions.css` | Terminal, prompt, skill, metadata và lịch sử |
| `features/records/RecordsRoom.tsx`, `RecordPanel.tsx`, `records.css` | Hồ sơ, filter, chi tiết, notes/checklist |
| `public/art/*`, `public/cli/*`, `public/ASSET-SOURCES.md` | Asset chạy độc lập và nguồn gốc |
| `tests/{state,allocation,visibility,geometry,motion,sessions,records}.test.ts` | Hồi quy có ý nghĩa về hành vi |
| `docs/validation/orc-nextjs-ui.md`, `docs/validation/images/*` | Checklist nghiệm thu và ảnh so sánh |

`types.ts` định nghĩa các type dùng chung:

- `Role = 'ceo' | 'employee' | 'client'`; `Provider = 'codex' | 'claude' | 'gemini' | 'opencode'`; `Avatar = 'Nova' | 'Atlas' | 'Mika' | 'Sage' | 'Rune'` trong model/types.ts, atlas import lại type này.
- `Reasoning = { kind: 'effort' | 'thinking-level' | 'thinking-budget' | 'variant'; value: string | number } | { kind: 'unknown' | 'unsupported' }`.
- `Workspace`: `{ id: string; customerId: string; name: string; repoPath: string }`; `ClientViewer`: `{ id: string; customerId: string; allowedWorkspaceIds: string[] }` là ngữ cảnh tài khoản mô phỏng, không phải hệ thống login; `TerminalMessage`: `{ id: string; kind: 'input' | 'output' | 'status'; text: string; timestamp: number }`.
- `Session`: `id`, `workspaceId`, `roomId`, `seatSlot: 0 | 1 | 2`, `agentName`, `avatar`, `role: 'supervisor' | 'lead' | 'peer'`, `provider`, `model: string | null`, `reasoning`, `skills: string[]`, `lifecycle: 'starting' | 'active' | 'closing' | 'disconnected' | 'error'`, `processConfirmed: boolean`, `lastUpdate`, `messages: TerminalMessage[]`.
- `Room`: `id`, `workspaceId`, `departmentId: string | null`, `name`, `kind: 'work' | 'supervisor' | 'lobby' | 'meeting'`, `template: 'ui' | 'engineering' | 'supervisor' | 'lobby' | 'meeting'`. Session có roomId; occupancy được derive, không lưu thêm một bản sao danh sách phiên trong Room.
- `Department`: `id`, `workspaceId`, `name`, `leadSessionId: string | null`; một Lead có một session/room duy nhất.
- `Task`: `id`, `workspaceId`, `departmentId`, `requiredSkills`, `status: 'queued' | 'assigned' | 'working' | 'approval' | 'blocked' | 'reporting' | 'done'`, `sessionId: string | null`, `title`.
- `Report`: `id`, `workspaceId`, `taskId`, `sessionId`, `content`, `status: 'submitted' | 'reviewed' | 'accepted'`; report nội bộ không phải hồ sơ khách.
- `ProjectRecord`: `id`, `workspaceId`, `roomId`, `type`, `name`, `summary`, `content`, `audience: 'internal' | 'shared' | 'ceo'`, `updatedAt`; loại gồm `project`, `contract`, `minutes`, `progress`, `delivery`, `requirements`, `checklist`, `reference`, `commercial`.
- `AppState`: dictionary `workspaces`, `clientViewers`, `departments`, `rooms`, `sessions`, `tasks`, `reports`, `records`, `archives`; `acceptedReportIds: string[]`; `capacity: number`; `ui: { workspaceId: string | null; clientViewerId: string | null; role: Role; roomId: string | null; officeMode: 'merged' | 'cards'; selectedSessionId: string | null; selectedRecordId: string | null; panelOpen: boolean; search: string; recordFilter: string }`.
- `StudioEvent` dùng union có discriminant `type`, ID và payload cụ thể: `ui.navigate`, `ui.role`, `ui.client` (clientViewerId), `ui.workspace`, `ui.mode`, `ui.panel`, `ui.search`, `ui.record-filter`, `session.start-requested`, `session.started`, `session.config`, `session.message`, `session.disconnected`, `session.reconnected`, `session.close-requested`, `session.close-failed`, `session.closed`, `task.assigned`, `task.status`, `approval.responded`, `report.submitted`, `report.reviewed`, `report.accepted`, `record.updated`.

Payload khai báo trong cùng file; không dùng `any` hay payload dictionary tùy ý. UI chỉ nhận dữ liệu serializable. `session.started` xác nhận process; `session.closed` archive/gỡ khỏi phiên đang tồn tại. `starting` giữ slot nhưng chưa có nhân vật. Giai đoạn demo mô phỏng xác nhận này; không đo máy hoặc tạo process. `StudioProvider.tsx` export `StudioViewProps = { state: AppState; dispatch: Dispatch<StudioEvent> }`; các component view phía dưới dùng props này, thêm roomId/sessionId/recordId ở interface tương ứng.

### Task 1: Ứng dụng chạy độc lập và store ban đầu

**Files:** Create `package.json`, `package-lock.json`, `.gitignore`, `tsconfig.json`, `next-env.d.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `features/studio/Studio.tsx`, `features/studio/StudioProvider.tsx`, `features/studio/model/types.ts`, `features/studio/model/seed.ts`, `features/studio/model/reducer.ts`, `tests/state.test.ts`; copy approved assets to `public/art/office.png`, `public/art/agents.png`, `public/cli/{codex,claude,gemini,opencode}.svg`; create `public/ASSET-SOURCES.md`.

**Interfaces:** Produces `createDemoState(): AppState`, `studioReducer(state: AppState, event: StudioEvent): AppState`, `StudioProvider({ children }: { children: ReactNode })`, `useStudio(): { state: AppState; dispatch: Dispatch<StudioEvent> }`. Context nằm trong Client Component; page/layout không cần `'use client'`.

- [ ] **Step 1:** Tạo cấu hình package tối thiểu và unit test thất bại trước khi viết model bodies. Scripts: `dev: next dev`, `build: next build`, `start: next start`, `typecheck: tsc --noEmit`, `test: vitest run`. Vitest environment `node`; install package stable exact versions, `@types/react`, `@types/react-dom`, `@types/node` tương thích và khóa mọi kết quả trong lockfile.
- [ ] **Step 2:** Trong `state.test.ts`, kiểm tra seed có 5 phiên rõ ràng (Nova, Atlas, Mika, Sage, Rune), 2 phòng ban, 3 phòng mặc định và 2 work rooms ở workspace đầu; workspace thứ hai trống phiên nhưng có phòng dữ liệu. `ui.workspace` đổi context không tăng/giảm tổng session; `ui.navigate` không tạo session. Chạy `npm test -- tests/state.test.ts`, cần FAIL do model chưa có.

```ts
test('workspace switch preserves all five sessions', () => {
  const state = createDemoState();
  const next = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
  expect(Object.keys(next.sessions)).toHaveLength(5);
  expect(next.ui.workspaceId).toBe('demo-empty');
});
```
- [ ] **Step 3:** Implement types/seed/reducer UI events, provider và page tối thiểu hiển thị tên workspace + nhãn “UI demo · chưa kết nối CLI”. Copy asset, ghi attribution, ignore node_modules/.next/.superpowers. Seed workspace IDs `demo-website` của customer-a và `demo-empty` của customer-b; ClientViewer `client-a` có grant demo-website, `client-b` có grant demo-empty, `client-none` không có grant. Seed12 tasks,8 hoàn tất đã được xác nhận. Capacity=6 chỉ là ví dụ; các model/provider lấy từ mockup và đánh dấu minh họa.
- [ ] **Step 4:** `npm test -- tests/state.test.ts`, `npm run typecheck`, `npm run build` đều pass; `npm run dev -- --hostname 127.0.0.1` và browser mở được page, asset không 404. Không cần test riêng cho reset CSS/attribution.
- [ ] **Step 5:** Commit `feat: bootstrap ORC studio with typed demo state` (stage các file Task 1, không stage `.superpowers`).

### Task 2: Room capacity, phân công, vòng đời phiên và bàn giao

**Files:** Modify `features/studio/model/reducer.ts`, `features/studio/model/types.ts`; Create `features/studio/model/allocation.ts`, `features/studio/model/selectors.ts`, `tests/allocation.test.ts`; extend `tests/state.test.ts`.

**Interfaces:** Consumes Task 1. Produces `roomSessions(state: AppState, roomId: string): Session[]`, `runningSessions(state: AppState): Session[]`, `assignTask(state: AppState, taskId: string, provider: Provider): { state: AppState; outcome: 'reused' | 'starting' | 'queued'; sessionId: string | null }`, `resizeDemoDepartments(state: AppState, workspaceId: string, count: number): AppState`. Running count includes starting/closing/disconnected/error reservations until closed; visible actors additionally require processConfirmed.

- [ ] **Step 1:** Write failing tests: four sessions of one department occupy `[3,1]`, including Lead, with four unique IDs; assigning matching skills to an existing available session returns `reused` with unchanged count; capacity=6 with six reservations queues a new task and creates no seventh session; adding 64 departments changes no session count; resizing down preserves rooms/departments referenced by sessions or unfinished tasks; closing one session leaves other seatSlot values unchanged. Run `npm test -- tests/allocation.test.ts`, expect FAIL.

```ts
test('64 empty departments do not create CLI sessions', () => {
  const next = resizeDemoDepartments(createDemoState(), 'demo-website', 64);
  expect(runningSessions(next)).toHaveLength(5);
  expect(Object.values(next.departments).filter(d => d.workspaceId === 'demo-website')).toHaveLength(64);
});
```
- [ ] **Step 2:** Add reducer tests: close-request keeps slot/actor and shows closing; close-failed keeps slot with error; only session.closed archives/removes; late config/message/start for archived ID cannot revive it. Accept one reviewed report twice: exactly one task completes once; submitted/unreviewed reports cannot update progress; animation has no completion event. Run targeted tests and confirm FAIL.
- [ ] **Step 3:** Implement allocation and event transitions. Match same workspace/department, required skills, active session without another unfinished task; role/department lead references remain unique. New demo sessions begin starting with processConfirmed=false; use stable monotonic IDs, not time/random during render. Add an overflow room only when all existing rooms of that department are full. Missing/foreign task/report/session IDs return unchanged state and queue reason where needed.
- [ ] **Step 4:** `npm test -- tests/allocation.test.ts tests/state.test.ts` and `npm run typecheck` pass. Compare each room's derived occupancy to 3 and validate all active session→room/workspace links.
- [ ] **Step 5:** Commit `feat: enforce session capacity and accepted handoffs`.

### Task 3: Shell, quyền hiển thị và điều hướng desktop/mobile

**Files:** Create `features/studio/AppShell.tsx`, `features/studio/studio.css`, `tests/visibility.test.ts`; Modify `features/studio/Studio.tsx`, `features/studio/model/selectors.ts`, `features/studio/model/reducer.ts`.

**Interfaces:** Produces `visibleWorkspaces(state: AppState): Workspace[]`, `canAccessWorkspace(state: AppState, workspaceId: string): boolean`, `visibleRooms(state: AppState): Room[]`, `visibleRecords(state: AppState, roomId: string): ProjectRecord[]`, `canSelectSession(state: AppState, sessionId: string): boolean`, `AppShell({ children, panel }: { children: ReactNode; panel: ReactNode })`. Khách cần đồng thời đúng customerId và allowedWorkspaceIds; CEO/employee xem workspace nội bộ theo vai trò. UI events được kiểm tra qua cùng selectors; workspaceId null thì trả danh sách rỗng và view chưa được cấp quyền.

- [ ] **Step 1:** Write failing tests for CEO/employee/client matrix: employee lobby excluded, client only shared lobby records, CEO commercial data excluded for others. client-a sees only demo-website; direct ui.workspace/demo-empty or record ID from customer-b is rejected; even a mistaken foreign-customer grant does not pass customerId check. Changing CEO→client while internal panel selected clears it and focuses allowed lobby; changing client-a→client-b clears previous records; client-none has workspaceId=null and no rooms/records. Changing permitted workspace leaves sessions unchanged. Hidden room IDs cannot be navigated via reducer. Run `npm test -- tests/visibility.test.ts`, expect FAIL.

```ts
test('client sees only its lobby and no private records', () => {
  const state = studioReducer(createDemoState(), { type: 'ui.role', role: 'client' });
  expect(visibleRooms(state).map(r => r.kind)).toEqual(['lobby']);
  expect(visibleWorkspaces(state).map(w => w.id)).toEqual(['demo-website']);
  expect(canAccessWorkspace(state, 'demo-empty')).toBe(false);
  expect(visibleRecords(state, state.ui.roomId!).every(r => r.audience === 'shared')).toBe(true);
  expect(state.ui.selectedSessionId).toBeNull();
});
```
- [ ] **Step 2:** Implement selectors, navigation guards, desktop sidebar/header/panel and mobile bottom navigation/sheet using the approved CSS tokens. Workspace selection and role/account preview are explicitly demo; role client defaults to client-a fixture, demo account choice supports client-b/client-none. Header workspace options and search never expose unauthorized workspace names. Layout: internal merged office by default, client allowed lobby by default; no-grant view says “Chưa được cấp quyền truy cập workspace”. Close buttons, keyboard Escape, focus return to opener, and reduced motion for sheet transitions.
- [ ] **Step 3:** `npm test -- tests/visibility.test.ts`, `npm run typecheck` pass. Check shell at 1440×900 and 390×844 through CUA; `scrollWidth <= innerWidth`, sheet close usable, workspace switch retains total session count. Restore viewport after checks.
- [ ] **Step 4:** Commit `feat: add responsive studio navigation and role views`.

### Task 4: Artwork, ghế và các chế độ xem phòng

**Files:** Create `features/office/geometry.ts`, `features/office/atlas.ts`, `features/office/OfficeView.tsx`, `features/office/RoomView.tsx`, `features/office/AgentSprite.tsx`, `features/office/office.css`, `tests/geometry.test.ts`; Modify `features/studio/Studio.tsx`.

**Interfaces:** Produces `layoutOffice(rooms: Room[]): OfficeLayout`, `seatAnchor(room: LayoutRoom, slot: number): Point`, `spriteFrame(avatar: Avatar, pose: Pose, step?: 0 | 1): SpriteFrame`, `OfficeView({ state, dispatch })`, `RoomView({ roomId, state, dispatch })`, `AgentSprite({ session, pose, direction, animated }: { session: Session; pose: Pose; direction: 'left' | 'right'; animated: boolean })`. Define `Point = { x: number; y: number }`, `Box = [number, number, number, number]`, `OfficeSection = { kind: 'top' | 'work-row' | 'facade'; source: Box; destination: Box }`, `OfficeLayout = { width: number; height: number; rooms: LayoutRoom[]; sections: OfficeSection[] }`, `LayoutRoom = { room: Room; source: Box; destination: Box; mirrored: boolean }` in geometry.ts. Pose and `SpriteFrame = { source: Box; offsetX: number; offsetY: number; canvas: [number, number] }` nằm trong atlas.ts; Avatar import từ model/types.ts. seatAnchor trả tọa độ source sau mirror, renderer dùng crop/destination để đổi sang tọa độ hiển thị.

- [ ] **Step 1:** Write failing geometry tests with measured literals: canvas width1586, topHeight440, rowHeight398, facadeHeight154; 64 departments→32 work rows and total height13330; UI crop `[8,440,666,398]`, engineering `[912,440,666,398]`; third seats x522/x1393, seated y765, standing y785. Mirror x preserves seat/art alignment. Atlas seated-head offsets `[13,15,9,14,13]` for Nova/Atlas/Mika/Sage/Rune; sprite frame bounds copy exact values from approved mockup. Run `npm test -- tests/geometry.test.ts`, expect FAIL.

```ts
test('64 department layout keeps one facade and all 67 rooms', () => {
  const state = resizeDemoDepartments(createDemoState(), 'demo-website', 64);
  const layout = layoutOffice(visibleRooms(state));
  expect(layout.width).toBe(1586);
  expect(layout.height).toBe(13330);
  expect(layout.rooms).toHaveLength(67);
  expect(layout.sections.filter(s => s.kind === 'facade')).toHaveLength(1);
});
```
- [ ] **Step 2:** Implement geometry/atlas and SVG renderers with a single source coordinate system. Supervisor crop `[478,8,630,432]`, lobby `[8,8,490,432]`, meeting `[1088,8,490,432]`; Supervisor anchor792/240 retains front-pose desk occlusion. Work seat x lists UI195/355/522 and engineering1055/1225/1393. Keep arm-offset correction on seated poses only. Fixed slot assignment prevents agents shifting seats when another session closes; allocation chooses vacant slot0..2.
- [ ] **Step 3:** Render merged office/cards/single room; click room focuses exactly that view, back to overview. Add room search and create-room/department demo action; empty rooms have no sprite. Roster/labels preserve CLI, model/reasoning. Use IntersectionObserver to pause offscreen step animations, store updates continue; no polling interval per room.
- [ ] **Step 4:** Tests/typecheck pass. Use browser to compare single-room three agents, engineering, a mirrored overflow room, two overview modes and 64 departments with approved images. Mobile has no stretch/overflow. Verify each visible actor has a session and all seats line up. Archive screenshots for Task 8.
- [ ] **Step 5:** Commit `feat: render approved pixel office with aligned seats`.

### Task 5: Motion và demo events có cleanup

**Files:** Create `features/office/motion.ts`, `features/office/useAgentMotion.ts`, `features/demo/adapter.ts`, `features/demo/DemoControls.tsx`, `tests/motion.test.ts`; Modify `features/office/RoomView.tsx`, `features/office/AgentSprite.tsx`, `features/studio/Studio.tsx`.

**Interfaces:** Produces `routeFor(room: LayoutRoom, slot: number, phase: 'assign' | 'report' | 'exit', leadSlot: number | null): Point[]`, `startMotion(target: MotionTarget, points: Point[], options: MotionOptions): { cancel(): void }`, `useAgentMotion(target: RefObject<HTMLElement | null>, route: Point[] | null, phase: 'assign' | 'report' | 'exit' | null, reducedMotion: boolean, onFinish: () => void): void`, `createDemoAdapter(getState: () => AppState, dispatch: Dispatch<StudioEvent>): { receive(sessionId: string): void; submitReport(sessionId: string): void; respond(taskId: string, accepted: boolean): void; close(sessionId: string): void; dispose(): void }`. Define `MotionOptions = { duration: number; onFinish: () => void }` and MotionTarget minimal browser animation interface in motion.ts; durations assign/report3600ms, exit4200ms. Cancellation behavior tested on wrapper, frame visibility tested in browser.

- [ ] **Step 1:** Write failing route/cleanup tests: entry passes side door/aisle and ends at standing seat; report ends beside Lead, never at Lead's coordinate; exit ends outside door. If no Lead in this physical room, report heads to room exit for upstream handoff. Using fake timers, dispose cancels pending demo callbacks and leaves current room unchanged; cancel ends animation and never fires completion callback. Run `npm test -- tests/motion.test.ts`, expect FAIL.

```ts
test('disposed demo cannot switch back to an old room', () => {
  vi.useFakeTimers();
  let state = createDemoState();
  const adapter = createDemoAdapter(() => state, e => { state = studioReducer(state, e); });
  adapter.receive('preview-mika'); adapter.dispose();
  state = studioReducer(state, { type: 'ui.workspace', workspaceId: 'demo-empty' });
  vi.runAllTimers();
  expect(state.ui.workspaceId).toBe('demo-empty');
  vi.useRealTimers();
});
```
- [ ] **Step 2:** Implement movement via Web Animations API with direction on a parent and two complementary footstep frames. Explicitly block legacy transform/typing animation on walking sprite. Animation completion changes local pose only, never accepts reports or confirms process exit. Demo adapter has a single managed pending-timer collection and explicit events; cleanup on scenario reset/workspace change, motion cleanup on room switch/unmount. Avoid idle actors running timers.
- [ ] **Step 3:** Add demo controls for receive/work/report/approval/disconnect/reconnect and session close. Confirmed close emits session.closed separately; failed close/approval stop auto-closure. Reduced motion skips travel but retains readable lifecycle labels and explicit event outcomes. Demo accepted handoff is a deliberate control through report.reviewed then report.accepted.
- [ ] **Step 4:** Tests/typecheck pass. Browser sample at least70 frames for receive/report: horizontal scale magnitude1 and one walk frame always visible; check sit anchor after entry. Switch rooms mid-motion and verify no return jump or stale callback. Verify reported progress unchanged until explicit acceptance and closed session vanishes only on demo close confirmation.
- [ ] **Step 5:** Commit `feat: animate agent lifecycle without flicker or stale timers`.

### Task 6: Panel CLI, metadata, skill và lịch sử

**Files:** Create `features/sessions/metadata.ts`, `features/sessions/skills.ts`, `features/sessions/SessionPanel.tsx`, `features/sessions/SessionRoster.tsx`, `features/sessions/sessions.css`, `tests/sessions.test.ts`; Modify `features/studio/model/reducer.ts`, `features/studio/Studio.tsx`.

**Interfaces:** Produces `sessionMetadata(session: Session): { model: string; reasoningLabel: string; reasoningValue: string }`, `skillSuggestions(provider: Provider, query: string): SkillSuggestion[]`, `makePromptEvent(state: AppState, sessionId: string, text: string): StudioEvent | null`, `SessionPanel({ sessionId, state, dispatch })`, `SessionRoster({ roomId, state, dispatch })`; define SkillSuggestion `{ id; label; command; description }` in skills.ts. makePromptEvent returns a session.message for an allowed live session, no shell command execution.

- [ ] **Step 1:** Write failing tests: unknown→“Chưa đồng bộ”, unsupported→“Không hỗ trợ”, thinking-budget8192 keeps budget kind/value rather than High; session.config switches model everywhere through one source; prompt to selected session preserves exact `$skill`, `/skill`, newlines and does not write another terminal; closed/forbidden session yields null. Suggestions scoped to selected provider, demo source marked. Run `npm test -- tests/sessions.test.ts`, expect FAIL.

```ts
test('unknown metadata is not guessed from provider', () => {
  const session = { ...createDemoState().sessions['preview-nova'], model: null, reasoning: { kind: 'unknown' as const } };
  const result = sessionMetadata(session);
  expect(result.model).toBe('Chưa đồng bộ');
  expect(result.reasoningValue).toBe('Chưa đồng bộ');
});
```
- [ ] **Step 2:** Implement metadata helper, composer and suggestions. Copy native command examples from approved mockup/provider design notes, label uncertain capabilities unsupported instead of guessing; confirm provider-specific docs with Context7/official docs if syntax is expanded. Terminal renders messages as text, not HTML; bounded demo scrollback retains last500 messages per active session to prevent indefinite growth, full demo reports remain separately available. Buttons for approval, report review/acceptance, close/reconnect invoke state events/demo adapter.
- [ ] **Step 3:** Wire panel and desktop/mobile rosters to exact session ID, model, reasoning and lifecycle; badges/labels consume sessionMetadata too. Archive view reads archives/reports without creating a session or terminal process. Format/copy config independent of task status.
- [ ] **Step 4:** Tests/typecheck pass. Browser click each CLI/agent, send multiline/native-style prompt, change effective config through demo control and verify panel/roster labels agree. Check approval controls, archived report access and client-role lack of terminal entry. Keep visibly “Mô phỏng” until backend exists.
- [ ] **Step 5:** Commit `feat: add per-session terminal and provider metadata`.

### Task 7: Hồ sơ phòng khách/phòng họp và tiến độ

**Files:** Create `features/records/RecordsRoom.tsx`, `features/records/RecordPanel.tsx`, `features/records/records.css`, `tests/records.test.ts`; Modify `features/studio/model/selectors.ts`, `features/studio/model/reducer.ts`, `features/studio/Studio.tsx`.

**Interfaces:** Consumes visibleRecords/role selectors and accepted-report transitions. Produces `projectProgress(state: AppState, workspaceId: string): { done: number; total: number; percent: number }`, `RecordsRoom({ roomId, state, dispatch })`, `RecordPanel({ recordId, state, dispatch })`. Workroom session sidebar and record detail share one panel host and mutually exclusive selected IDs.

- [ ] **Step 1:** Write failing tests: only accepted tasks count; 8/12 gives67%, a new valid acceptance gives9/12=75%, repeat keeps75%; project with total0 shows0%; no progress from submitted/internal log. Record filters preserve allowed audience; CEO private notes absent from client/employee records and editable notes update only allowed current-project record. Client is read-only: record.updated bị bỏ qua; employee chỉ sửa hồ sơ nội bộ. Run `npm test -- tests/records.test.ts`, expect FAIL.

```ts
test('empty project progress never divides by zero', () => {
  expect(projectProgress(createDemoState(), 'demo-empty')).toEqual({ done: 0, total: 0, percent: 0 });
});
```
- [ ] **Step 2:** Implement lobby/meeting artwork, tabs, list, info/contract/minutes/progress/delivery detail, internal goals/requirements/checklist/reference detail, CEO commercial detail, note-save in store and labels “chưa lưu tệp thật”. Drive progress from tasks, no separate drifting percentage. Keep client minutes distinct from internal minutes; shared record content never copies terminal/log automatically.
- [ ] **Step 3:** Wire supervisor acceptance control to existing report review→accept events and show updated checklist/milestone summary. A missing or unauthorized selected record clears detail; no automatic raw report publication.
- [ ] **Step 4:** Tests/typecheck pass. Browser CEO/employee/client end-to-end: contracts/list/detail, internal notes edit/save, role/account change with commercial detail open, mobile bottom sheet. Acceptance twice changes67→75→75. client-a sees only its granted workspace/lobby; client-b sees only its separate workspace; client-none sees the no-grant view. Selecting or searching another customer's record ID/name yields no content.
- [ ] **Step 5:** Commit `feat: add project records and verified progress views`.

### Task 8: Nghiệm thu Next.js và bàn giao

**Files:** Modify only responsible files for defects found; Create `README.md`, `docs/validation/orc-nextjs-ui.md`, `docs/validation/images/{overview,room-three-agents,engineering,mirrored-room,mobile-room,client-records,mobile-contract}.png`.

**Interfaces:** Consumes Tasks 1–7; produces running independently built frontend and evidence for all12 spec acceptance criteria. No CLI runner/auth/database implementation in this task.

- [ ] **Step 1:** Run `npm test`, `npm run typecheck`, `npm run build`. Require zero failed tests, zero type errors and successful production build. If defect found, add failing regression at responsible unit before narrow fix; rerun affected suite then full gate once at end.
- [ ] **Step 2:** Run production `npm run start -- --hostname 127.0.0.1 --port 3000` (choose free port if3000 occupied; do not kill user processes), open using CUA, check console/asset loads, all12 acceptance conditions. Verify 1440×900, normal desktop viewport and390×844, five baseline sessions,64 departments/67 rooms, three-agent overflow, mirrored seats, all role views and report dedup. Pause background/offscreen animation; no interval-per-room. Restore viewport.
- [ ] **Step 3:** Capture fresh screenshots from Next.js and compare to approved images; run receive/report sampling, transitions to sitting/closing, switches mid-motion and reduced-motion behavior. Record exact commands/results and any remaining limitation; real CLI/auth/storage remain explicitly excluded. Only finish when UI defects blocking criteria are fixed.
- [ ] **Step 4:** Write README dev/build/start commands, Node requirement, demo workflow and backend boundary. Remove temporary diagnostic code, retain meaningful regression tests. Commit `test: verify ORC studio UI and document usage`; review full branch/diff according to the selected execution skill.
- [ ] **Step 5:** Leave Next.js preview open as deliverable; give user URL, screenshots and concise checks. Next milestone is review of the running Next.js workflow before a separate backend runner/protocol spec.

## Self-review và execution handoff

Spec coverage: nghiệm thu1→Tasks1/8;2/3/6→Task4;4/5/10→Task2;7/11→Task5;8→Task6;9→Tasks3/7;12→Tasks1/6/8. Cả5 Review Focus đều có test ở task sở hữu. Không có task/backend dependency chưa xác định; type/signature dùng chung được định nghĩa trước consumer.

Đề xuất **Native**: các task phụ thuộc cùng store, geometry và reducer; một người thực hiện xuyên suốt giúp giảm chi phí chuyển ngữ cảnh, rồi review toàn nhánh cuối. Nếu người dùng chọn **Subagent-driven**, từng task có implementer và reviewer riêng theo skill. Plan cần được người dùng duyệt và chọn phương thức trước khi cài dependency/viết product code.

Tài liệu đã tra cho kế hoạch: [Next.js Server/Client Components](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/05-server-and-client-components.mdx), [Vitest5 configuration](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/config/index.md), [Vitest fake timers](https://github.com/vitest-dev/vitest/blob/v5.0.3/docs/guide/migration/mocha.md). Đọc bằng Context7 khi bắt đầu dùng API cụ thể; package versions phía trên lấy từ npm registry, không suy ra từ nhánh tài liệu.
