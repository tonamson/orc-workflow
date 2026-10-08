'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AgentSprite } from './AgentSprite';
import { ArtworkCrop } from './ArtworkCrop';
import { layoutOffice, pointPercent, seatAnchor, type Box, type LayoutRoom, type OfficeLayout, type Point } from './geometry';
import { routeFor } from './motion';
import { useAgentMotion } from './useAgentMotion';
import { visibleActors, visibleRecords, visibleRooms } from '../studio/model/selectors';
import type { AppState, Dispatch, Room as RoomModel, Session, StudioEvent } from '../studio/model/types';
import { SessionRoster, WorkspaceSessionRoster } from '../sessions/SessionRoster';
import { RecordsRoom } from '../records/RecordsRoom';
import { sessionMetadata } from '../sessions/metadata';
import { sessionDisplay } from '../sessions/display';

function actorStyle(room: LayoutRoom, session: Session): React.CSSProperties {
  const point = pointPercent(room, seatAnchor(room, session.seatSlot));
  const height = 52 * 300 / 180;
  return { left: `${point.x}%`, top: `${point.y}%`, '--actor-width': `${52 / room.source[2] * 100}cqw`, '--actor-height': `${height / room.source[2] * 100}cqw` } as React.CSSProperties;
}

function SourceSlice({ source, destination, mirrored = false }: { source: Box; destination: Box; mirrored?: boolean }) {
  const [sx, sy, sw, sh] = source; const [dx, dy, dw, dh] = destination;
  return <svg x={dx} y={dy} width={dw} height={dh} viewBox={`${sx} ${sy} ${sw} ${sh}`} preserveAspectRatio="none" overflow="hidden" aria-hidden="true">
    {mirrored ? <g transform={`translate(${2 * sx + sw} 0) scale(-1 1)`}><image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" /></g> : <image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" />}
  </svg>;
}

function destinationPercent(room: LayoutRoom, layout: { width: number; height: number }) {
  const [x, y, width, height] = room.destination;
  return { left: `${x / layout.width * 100}%`, top: `${y / layout.height * 100}%`, width: `${width / layout.width * 100}%`, height: `${height / layout.height * 100}%` };
}

function actorWorldStyle(room: LayoutRoom, session: Session, layout: { width: number; height: number }): React.CSSProperties {
  const [sx, sy, sw, sh] = room.source; const [dx, dy, dw, dh] = room.destination;
  const actor = seatAnchor(room, session.seatSlot);
  const x = dx + ((actor.x - sx) / sw) * dw; const y = dy + ((actor.y - sy) / sh) * dh;
  return { left: `${x / layout.width * 100}%`, top: `${y / layout.height * 100}%`, '--actor-width': `${52 / layout.width * 100}cqw`, '--actor-height': `${52 * 300 / 180 / layout.width * 100}cqw` } as React.CSSProperties;
}

function MotionMarker({ room, session, state, mapLayout, compactLabel = false, onClick }: { room: LayoutRoom; session: Session; state: AppState; mapLayout?: OfficeLayout; compactLabel?: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [finishedTag, setFinishedTag] = useState('');
  const task = Object.values(state.tasks).find(item => item.sessionId === session.id && item.status !== 'done');
  const phase = session.lifecycle === 'closing' ? 'exit' : task?.status === 'reporting' ? 'report' : task?.status === 'assigned' ? 'assign' : null;
  const lead = Object.values(state.sessions).find(item => item.roomId === session.roomId && item.role === 'lead');
  const tag = `${phase ?? 'idle'}:${task?.id ?? ''}:${task?.status ?? ''}`;
  const raw = useMemo(() => phase ? routeFor(room, session.seatSlot, phase, lead?.seatSlot ?? null) : null, [phase, room.source[0], room.source[1], room.source[2], room.source[3], room.mirrored, room.room.template, session.seatSlot, lead?.seatSlot]);
  const route = useMemo<Point[] | null>(() => raw?.map(point => {
    if (!mapLayout) return pointPercent(room, point);
    const [sx, sy, sw, sh] = room.source; const [dx, dy, dw, dh] = room.destination;
    const x = dx + ((point.x - sx) / sw) * dw; const y = dy + ((point.y - sy) / sh) * dh;
    return { x: x / mapLayout.width * 100, y: y / mapLayout.height * 100 };
  }) ?? null, [raw, mapLayout?.width, mapLayout?.height, room.source[0], room.source[1], room.source[2], room.source[3], room.destination[0], room.destination[1], room.destination[2], room.destination[3]]);
  const finished = finishedTag === tag;
  const onMotionFinish = useCallback(() => setFinishedTag(tag), [tag]);
  useAgentMotion(ref, finished ? null : route, finished ? null : phase, false, onMotionFinish);
  const baseStyle = mapLayout ? actorWorldStyle(room, session, mapLayout) : actorStyle(room, session);
  const restingPoint = finished && (phase === 'exit' || phase === 'report') ? route?.at(-1) : null;
  const style = restingPoint ? { ...baseStyle, left: `${restingPoint.x}%`, top: `${restingPoint.y}%` } : baseStyle;
  const metadata = sessionMetadata(session);
  const display = sessionDisplay(state, session);
  return <button ref={ref} className={`agent-marker ${session.lifecycle} ${session.role === 'supervisor' ? 'supervisor' : ''}`} style={style} onClick={onClick} aria-label={`Mở phiên ${session.agentName}`}>
    <AgentSprite session={session} pose={phase && !finished ? 'walking' : phase === 'exit' || phase === 'report' ? 'standing' : session.role === 'supervisor' ? 'standing' : 'seated'} direction="right" animated={Boolean(phase && !finished)}/>
    <span className={`agent-marker-label ${compactLabel ? 'compact' : ''}`}><span className="agent-identity"><img src={`/cli/${session.provider}.svg`} alt=""/>{session.agentName}</span>{!compactLabel && <small className="agent-meta">{metadata.model} · {metadata.reasoningLabel}: {metadata.reasoningValue}</small>}<span className={`agent-activity ${display.tone}`}>{display.state}</span></span>
  </button>;
}

function SingleRoom({ room, layoutRoom, state, dispatch }: { room: RoomModel; layoutRoom: LayoutRoom; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const actors = visibleActors(state, room.id);
  return <div className="single-room-wrap">
    <div className="single-room-top"><button className="back-button" onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>← Toàn cảnh</button><div><h2>{room.name}</h2><p>{room.kind === 'work' ? `${actors.length}/3 phiên · tính cả Lead` : room.kind === 'supervisor' ? 'Phiên Supervisor đang tồn tại' : 'Phòng dữ liệu · không tự mở CLI'}</p></div></div>
    <div className="room-crop" style={{ aspectRatio: `${layoutRoom.source[2]}/${layoutRoom.source[3]}` }}>
      <ArtworkCrop room={layoutRoom} label={room.name}/>
      {actors.map(session => <MotionMarker key={session.id} room={layoutRoom} session={session} state={state} onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}/>)}
      {room.kind === 'work' && actors.length === 0 && <span className="room-empty-label">0 phiên đang chạy · không có agent</span>}
    </div>
    {room.kind === 'work' && <SessionRoster roomId={room.id} state={state} dispatch={dispatch}/>}
  </div>;
}

export function RoomView({ roomId, state, dispatch }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const room = visibleRooms(state).find(candidate => candidate.id === roomId);
  if (!room) return null;
  if (room.kind === 'lobby' || room.kind === 'meeting') return <RecordsRoom roomId={room.id} state={state} dispatch={dispatch}/>;
  const layoutRoom = layoutOffice(visibleRooms(state)).rooms.find(candidate => candidate.room.id === roomId);
  return layoutRoom ? <SingleRoom room={room} layoutRoom={layoutRoom} state={state} dispatch={dispatch}/> : null;
}

export function RoomPreview({ room, state, dispatch }: { room: RoomModel; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const layoutRoom = layoutOffice(visibleRooms(state)).rooms.find(candidate => candidate.room.id === room.id);
  if (!layoutRoom) return null;
  return <article className="room-preview-card">
    <span className="room-preview-crop" style={{ aspectRatio: `${layoutRoom.source[2]}/${layoutRoom.source[3]}` }}><ArtworkCrop room={layoutRoom} label={room.name}/>
      {visibleActors(state, room.id).map(session => <MotionMarker key={session.id} room={layoutRoom} session={session} state={state} compactLabel onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}/>)}
    </span><button className="room-preview-open" onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>{room.name}</button><small>{room.kind === 'work' ? `${visibleActors(state, room.id).length}/3 phiên` : room.kind === 'supervisor' ? 'Điều phối' : 'Phòng dữ liệu'}</small>
    {(room.kind === 'work' || room.kind === 'supervisor') && <SessionRoster roomId={room.id} state={state} dispatch={dispatch}/>}
  </article>;
}

export function OfficeView({ state, dispatch }: { state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const rooms = visibleRooms(state);
  const layout = layoutOffice(rooms);
  const query = state.ui.search.trim().toLocaleLowerCase();
  const matchesRoom = (room: RoomModel) => !query || room.name.toLocaleLowerCase().includes(query) || visibleRecords(state, room.id).some(record => `${record.name} ${record.summary}`.toLocaleLowerCase().includes(query));
  if (state.ui.roomId) return <RoomView roomId={state.ui.roomId} state={state} dispatch={dispatch}/>;
  if (state.ui.officeMode === 'cards') {
    const matches = rooms.filter(matchesRoom);
    return matches.length ? <div className="room-preview-grid">{matches.map(room => <RoomPreview key={room.id} room={room} state={state} dispatch={dispatch}/>)}</div> : <div className="empty-state">Không tìm thấy phòng phù hợp.</div>;
  }

  const roomLookup = new Map(layout.rooms.map(room => [room.room.id, room]));
  const matchingRooms = rooms.filter(matchesRoom);
  if (query && !matchingRooms.length) return <div className="empty-state">Không tìm thấy phòng phù hợp.</div>;
  return <div className="office-merged-view"><div className="office-building-scroll"><div className="office-building" style={{ aspectRatio: `${layout.width}/${layout.height}` }}>
    <svg className="office-world-art" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" role="img" aria-label="Văn phòng pixel với các phòng thẳng và hành lang liên tục">
      {layout.sections.map((item, index) => <SourceSlice key={`section-${index}`} source={item.source} destination={item.destination}/>)}
      {layout.rooms.filter(room => room.room.kind === 'work').map(room => <SourceSlice key={room.room.id} source={room.source} destination={room.destination} mirrored={room.mirrored}/>)}
    </svg>
    {state.ui.role === 'employee' && <div className="office-restricted" style={{ left: `${8 / layout.width * 100}%`, top: `${8 / layout.height * 100}%`, width: `${490 / layout.width * 100}%`, height: `${432 / layout.height * 100}%` }}>KHU VỰC RIÊNG</div>}
    {matchingRooms.map(room => {
      const layoutRoom = roomLookup.get(room.id)!;
      const style = destinationPercent(layoutRoom, layout);
      const actors = visibleActors(state, room.id);
      return <span key={room.id} className="room-layer">
        <button className={`office-room-hit ${room.kind} ${query ? 'search-match' : ''}`} style={style} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })} aria-label={`Vào ${room.name}`}><span className="office-room-label">{room.name}<small>{room.kind === 'work' ? `${actors.length}/3 · PHÒNG BAN` : room.kind === 'supervisor' ? 'SUPERVISOR' : room.kind === 'lobby' ? 'PHÒNG KHÁCH' : 'PHÒNG HỌP'}</small></span></button>
        {actors.map(session => <MotionMarker key={session.id} room={layoutRoom} session={session} state={state} mapLayout={layout} compactLabel onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}/>)}
      </span>;
    })}
  </div></div>{state.ui.role !== 'client' && <WorkspaceSessionRoster roomIds={matchingRooms.filter(room => room.kind === 'work' || room.kind === 'supervisor').map(room => room.id)} state={state} dispatch={dispatch}/>}</div>;
}
