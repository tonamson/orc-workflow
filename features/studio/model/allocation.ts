import type { AppState, Department, Provider, Room, Session, Task } from './types';
import { roomSessions, runningSessions } from './selectors';

const unfinished = new Set(['queued', 'assigned', 'working', 'approval', 'blocked', 'reporting']);

function hasSkills(session: Session, skills: string[]): boolean {
  return skills.every(skill => session.skills.includes(skill));
}

function hasOpenTask(state: AppState, sessionId: string): boolean {
  return Object.values(state.tasks).some(task => task.sessionId === sessionId && unfinished.has(task.status));
}

function cloneState(state: AppState): AppState {
  return { ...state, sessions: { ...state.sessions }, rooms: { ...state.rooms }, departments: { ...state.departments }, tasks: { ...state.tasks } };
}

function roomFor(state: AppState, department: Department): { room: Room; slot: 0 | 1 | 2 } | null {
  const rooms = Object.values(state.rooms).filter(room => room.departmentId === department.id);
  for (const room of rooms) {
    const occupied = new Set(roomSessions(state, room.id).map(session => session.seatSlot));
    const slot = ([0, 1, 2] as const).find(candidate => !occupied.has(candidate));
    if (slot !== undefined) return { room, slot };
  }
  const index = rooms.length + 1;
  const base = rooms[0];
  if (!base) return null;
  const room: Room = { ...base, id: `${department.id}-room-${String(index).padStart(2, '0')}`, name: `${department.name} · Phòng ${String(index).padStart(2, '0')}` };
  state.rooms[room.id] = room;
  return { room, slot: 0 };
}

function nextSessionId(state: AppState): string {
  let maximum = 0;
  [...Object.keys(state.sessions), ...Object.keys(state.archives)].forEach(id => {
    const match = /^session-demo-(\d+)$/.exec(id);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  });
  return `session-demo-${String(maximum + 1).padStart(3, '0')}`;
}

export function assignTask(state: AppState, taskId: string, provider: Provider): { state: AppState; outcome: 'reused' | 'starting' | 'queued'; sessionId: string | null } {
  const task = state.tasks[taskId];
  if (!task || task.status !== 'queued') return { state, outcome: 'queued', sessionId: null };
  const department = state.departments[task.departmentId];
  if (!department || department.workspaceId !== task.workspaceId) return { state, outcome: 'queued', sessionId: null };

  const reusable = runningSessions(state).find(session => canAssignToSession(state, task, session));
  if (reusable) {
    const next = cloneState(state);
    next.tasks[taskId] = { ...task, status: 'assigned', sessionId: reusable.id };
    return { state: next, outcome: 'reused', sessionId: reusable.id };
  }

  if (runningSessions(state).length >= state.capacity) return { state, outcome: 'queued', sessionId: null };
  const next = cloneState(state);
  const location = roomFor(next, department);
  if (!location) return { state, outcome: 'queued', sessionId: null };
  const id = nextSessionId(next);
  const avatar = (['Nova', 'Atlas', 'Mika', 'Sage', 'Rune'] as const)[(Object.keys(next.sessions).length + Object.keys(next.archives).length) % 5];
  const role = department.leadSessionId && (next.sessions[department.leadSessionId] || next.archives[department.leadSessionId]) ? 'peer' : 'lead';
  const session: Session = {
    id, workspaceId: task.workspaceId, roomId: location.room.id, seatSlot: location.slot,
    agentName: `Agent ${id.slice(-3)}`, avatar, role, provider, model: null, reasoning: { kind: 'unknown' },
    skills: [...task.requiredSkills], lifecycle: 'starting', processConfirmed: false, lastUpdate: 0, messages: [],
  };
  next.sessions[id] = session;
  if (role === 'lead') next.departments[department.id] = { ...department, leadSessionId: id };
  next.tasks[taskId] = { ...task, status: 'assigned', sessionId: id };
  return { state: next, outcome: 'starting', sessionId: id };
}

export function canAssignToSession(state: AppState, task: Task, session: Session): boolean {
  const room = state.rooms[session.roomId];
  return session.workspaceId === task.workspaceId && room?.workspaceId === task.workspaceId && room.departmentId === task.departmentId
    && session.lifecycle === 'active' && session.processConfirmed && hasSkills(session, task.requiredSkills) && !hasOpenTask(state, session.id);
}

export function assignmentQueueReason(state: AppState, taskId: string): string | null {
  const task = state.tasks[taskId];
  if (!task || task.status !== 'queued') return null;
  if (task.workspaceId !== state.ui.workspaceId) return 'Nhiệm vụ thuộc workspace khác.';
  const department = state.departments[task.departmentId];
  if (!department || department.workspaceId !== task.workspaceId) return 'Chưa có phòng ban phù hợp.';
  if (runningSessions(state).length >= state.capacity) return `Đang chờ: đã đạt giới hạn ${state.capacity} phiên trên máy.`;
  const rooms = Object.values(state.rooms).filter(room => room.departmentId === department.id);
  if (!rooms.length) return 'Phòng ban chưa có phòng làm việc.';
  const hasFreeSeat = rooms.some(room => roomSessions(state, room.id).length < 3);
  return hasFreeSeat ? 'Sẵn sàng: phòng còn chỗ hoặc có phiên đủ skill.' : 'Sẵn sàng: phòng đang đủ 3 chỗ, sẽ tạo phòng bổ sung.';
}

export function resizeDemoDepartments(state: AppState, workspaceId: string, count: number): AppState {
  const requested = Math.max(0, Math.floor(count));
  const next = cloneState(state);
  const current = Object.values(next.departments).filter(department => department.workspaceId === workspaceId);
  const generated = current.filter(department => department.id.startsWith(`${workspaceId}-department-`));
  const needed = Math.max(0, requested - current.length);
  for (let index = 0; index < needed; index += 1) {
    const ordinal = current.length + index + 1;
    const id = `${workspaceId}-department-${String(ordinal).padStart(2, '0')}`;
    const template = ordinal % 2 ? 'ui' : 'engineering';
    next.departments[id] = { id, workspaceId, name: `Phòng ban ${String(ordinal).padStart(2, '0')}`, leadSessionId: null };
    const roomId = `${id}-room-01`;
    next.rooms[roomId] = { id: roomId, workspaceId, departmentId: id, name: next.departments[id].name, kind: 'work', template };
    generated.push(next.departments[id]);
  }
  const targetGenerated = Math.max(0, requested - current.filter(department => !generated.includes(department)).length);
  const keepGenerated = generated.slice(0, targetGenerated);
  const keepIds = new Set(keepGenerated.map(department => department.id));
  const isReferenced = (departmentId: string) => {
    const department = next.departments[departmentId];
    return Object.values(next.sessions).some(session => session.workspaceId === workspaceId && next.rooms[session.roomId]?.departmentId === departmentId)
      || Object.values(next.tasks).some(task => task.workspaceId === workspaceId && task.departmentId === departmentId && unfinished.has(task.status))
      || Boolean(department?.leadSessionId && (next.sessions[department.leadSessionId] || next.archives[department.leadSessionId]));
  };
  Object.values(next.departments).filter(department => department.workspaceId === workspaceId && department.id.startsWith(`${workspaceId}-department-`) && !keepIds.has(department.id) && !isReferenced(department.id)).forEach(department => {
    delete next.departments[department.id];
    Object.values(next.rooms).filter(room => room.departmentId === department.id && !Object.values(next.sessions).some(session => session.roomId === room.id)).forEach(room => { delete next.rooms[room.id]; });
  });
  return next;
}
