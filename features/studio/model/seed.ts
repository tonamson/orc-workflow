import type { AppState, Department, ProjectRecord, Room, Session, Task } from './types';

const message = (id: string, kind: 'input' | 'output' | 'status', text: string, timestamp: number) => ({ id, kind, text, timestamp });

export function createDemoState(): AppState {
  const workspaces = {
    'demo-website': { id: 'demo-website', customerId: 'customer-a', name: 'Website refresh', repoPath: '/srv/repos/website' },
    'demo-empty': { id: 'demo-empty', customerId: 'customer-b', name: 'Mobile onboarding', repoPath: '/srv/repos/mobile' },
  };
  const rooms: Record<string, Room> = {};
  const addWorkspaceRooms = (workspaceId: string) => {
    const entries: Room[] = [
      { id: `${workspaceId}-supervisor`, workspaceId, departmentId: null, name: 'Điều phối', kind: 'supervisor', template: 'supervisor' },
      { id: `${workspaceId}-lobby`, workspaceId, departmentId: null, name: 'Phòng khách', kind: 'lobby', template: 'lobby' },
      { id: `${workspaceId}-meeting`, workspaceId, departmentId: null, name: 'Phòng họp', kind: 'meeting', template: 'meeting' },
    ];
    entries.forEach(room => { rooms[room.id] = room; });
  };
  addWorkspaceRooms('demo-website'); addWorkspaceRooms('demo-empty');
  const departments: Record<string, Department> = {
    'dept-ui': { id: 'dept-ui', workspaceId: 'demo-website', name: 'UI & UX', leadSessionId: 'session-atlas' },
    'dept-engineering': { id: 'dept-engineering', workspaceId: 'demo-website', name: 'Engineering', leadSessionId: 'session-sage' },
  };
  const workRooms: Room[] = [
    { id: 'room-ui', workspaceId: 'demo-website', departmentId: 'dept-ui', name: 'UI & UX', kind: 'work', template: 'ui' },
    { id: 'room-engineering', workspaceId: 'demo-website', departmentId: 'dept-engineering', name: 'Engineering', kind: 'work', template: 'engineering' },
  ];
  workRooms.forEach(room => { rooms[room.id] = room; });
  const sessions: Record<string, Session> = {
    'session-nova': { id: 'session-nova', workspaceId: 'demo-website', roomId: 'demo-website-supervisor', seatSlot: 0, agentName: 'Nova', avatar: 'Nova', role: 'supervisor', provider: 'codex', model: 'gpt-5-codex', reasoning: { kind: 'effort', value: 'high' }, skills: ['planning'], lifecycle: 'active', processConfirmed: true, lastUpdate: 1_791_437_120_000, messages: [message('m-nova-1','status','Supervisor đang phân phối công việc mô phỏng.',1_791_437_120_000)] },
    'session-atlas': { id: 'session-atlas', workspaceId: 'demo-website', roomId: 'room-ui', seatSlot: 0, agentName: 'Atlas', avatar: 'Atlas', role: 'lead', provider: 'claude', model: 'claude-sonnet', reasoning: { kind: 'thinking-level', value: 'high' }, skills: ['design-review'], lifecycle: 'active', processConfirmed: true, lastUpdate: 1_791_437_120_000, messages: [message('m-atlas-1','status','Đang rà soát giao diện responsive.',1_791_437_120_000)] },
    'session-mika': { id: 'session-mika', workspaceId: 'demo-website', roomId: 'room-ui', seatSlot: 1, agentName: 'Mika', avatar: 'Mika', role: 'peer', provider: 'claude', model: 'claude-sonnet', reasoning: { kind: 'thinking-budget', value: 8192 }, skills: ['frontend'], lifecycle: 'active', processConfirmed: true, lastUpdate: 1_791_437_120_000, messages: [message('m-mika-1','status','Đang làm mới booking UI.',1_791_437_120_000)] },
    'session-sage': { id: 'session-sage', workspaceId: 'demo-website', roomId: 'room-engineering', seatSlot: 0, agentName: 'Sage', avatar: 'Sage', role: 'lead', provider: 'gemini', model: 'gemini-2.5-pro', reasoning: { kind: 'thinking-level', value: 'high' }, skills: ['engineering'], lifecycle: 'active', processConfirmed: true, lastUpdate: 1_791_437_120_000, messages: [message('m-sage-1','status','Đang triển khai API mô phỏng.',1_791_437_120_000)] },
    'session-rune': { id: 'session-rune', workspaceId: 'demo-website', roomId: 'room-engineering', seatSlot: 1, agentName: 'Rune', avatar: 'Rune', role: 'peer', provider: 'opencode', model: 'openai/gpt-5', reasoning: { kind: 'variant', value: 'balanced' }, skills: ['testing'], lifecycle: 'active', processConfirmed: true, lastUpdate: 1_791_437_120_000, messages: [message('m-rune-1','status','Đang kiểm tra luồng thanh toán mô phỏng.',1_791_437_120_000)] },
  };
  const tasks: Record<string, Task> = {};
  const titles = ['Khảo sát giao diện hiện tại','Thiết kế luồng booking','Làm mới trang chủ','Tối ưu trải nghiệm mobile','Rà soát accessibility','Tạo component lịch hẹn','Thiết kế trang dịch vụ','Cập nhật bảng màu','Tích hợp tìm kiếm','Kiểm tra luồng đặt lịch','Viết hướng dẫn bàn giao','Kiểm tra tổng thể'];
  titles.forEach((title, index) => {
    const id = `task-${String(index + 1).padStart(2, '0')}`;
    tasks[id] = { id, workspaceId: 'demo-website', departmentId: index % 2 ? 'dept-engineering' : 'dept-ui', requiredSkills: index % 2 ? ['engineering'] : ['frontend'], status: index < 8 ? 'done' : index === 8 ? 'working' : 'queued', sessionId: index < 8 ? (index % 2 ? 'session-sage' : 'session-atlas') : index === 8 ? 'session-mika' : null, title };
  });
  const records: Record<string, ProjectRecord> = {};
  const addRecord = (record: ProjectRecord) => { records[record.id] = record; };
  const add = (workspaceId: string, roomId: string, id: string, type: ProjectRecord['type'], name: string, audience: ProjectRecord['audience'], summary: string, content: string) => addRecord({ id, workspaceId, roomId, type, name, audience, summary, content, updatedAt: 1_791_437_120_000 });
  add('demo-website','demo-website-lobby','record-project','project','Website refresh','shared','Làm mới trải nghiệm đặt lịch.','Mục tiêu: tăng khả năng hoàn tất đặt lịch trên mobile.');
  add('demo-website','demo-website-lobby','record-contract','contract','Thỏa thuận dự án','shared','Phạm vi và mốc bàn giao.','Bản mô phỏng — chưa lưu tệp thật.');
  add('demo-website','demo-website-lobby','record-client-minutes','minutes','Biên bản họp khách hàng','shared','Các quyết định đã thống nhất.','Ưu tiên luồng đặt lịch và trang dịch vụ.');
  add('demo-website','demo-website-lobby','record-progress','progress','Tiến độ bàn giao','shared','8/12 phần việc được xác nhận.','Tiến độ được tính từ nhiệm vụ đã chấp thuận.');
  add('demo-website','demo-website-lobby','record-delivery','delivery','Mốc bàn giao','shared','Bản xem trước và bàn giao cuối.','Bản xem trước: 15/10 · Bàn giao: 28/10.');
  add('demo-website','demo-website-lobby','record-commercial','commercial','Ghi chú thương mại CEO','ceo','Thông tin riêng của CEO.','Ngân sách dự phòng cần được xác nhận.');
  add('demo-website','demo-website-meeting','record-internal-minutes','minutes','Biên bản nội bộ','internal','Ghi chú điều phối nội bộ.','Supervisor phân việc theo kỹ năng và phòng trống.');
  add('demo-website','demo-website-meeting','record-requirements','requirements','Yêu cầu tính năng','internal','Phạm vi phiên bản đầu.','Tìm kiếm dịch vụ, chọn lịch và xác nhận đặt chỗ.');
  add('demo-website','demo-website-meeting','record-checklist','checklist','Checklist bàn giao','internal','Các mục kiểm tra nội bộ.','- [ ] Kiểm tra mobile\n- [ ] Kiểm tra accessibility');
  add('demo-website','demo-website-meeting','record-reference','reference','Tài liệu tham khảo','internal','Link và ghi chú thiết kế.','Các tài liệu tham khảo chỉ dùng trong demo.');
  add('demo-empty','demo-empty-lobby','record-mobile-project','project','Mobile onboarding','shared','Workspace của customer-b.','Thông tin demo riêng của customer-b.');
  add('demo-empty','demo-empty-meeting','record-mobile-notes','minutes','Ghi chú nội bộ','internal','Nội dung riêng của workspace thứ hai.','Nội dung này không được chia sẻ giữa khách hàng.');
  return {
    workspaces, clientViewers: {
      'client-a': { id: 'client-a', customerId: 'customer-a', allowedWorkspaceIds: ['demo-website'] },
      'client-b': { id: 'client-b', customerId: 'customer-b', allowedWorkspaceIds: ['demo-empty'] },
      'client-none': { id: 'client-none', customerId: 'customer-c', allowedWorkspaceIds: [] },
    },
    departments, rooms, sessions, tasks, reports: {}, records, archives: {}, acceptedReportIds: [], capacity: 6,
    ui: { workspaceId: 'demo-website', clientViewerId: null, role: 'ceo', roomId: null, officeMode: 'merged', selectedSessionId: 'session-nova', selectedRecordId: null, panelOpen: true, search: '', recordFilter: 'all' },
  };
}
