'use client';

import { AgentSprite } from './AgentSprite';
import { layoutOffice, pointPercent, seatAnchor, type Box, type LayoutRoom } from './geometry';
import { visibleActors, visibleRooms } from '../studio/model/selectors';
import type { AppState, Dispatch, Room as RoomModel, Session, StudioEvent } from '../studio/model/types';

function mirroredArt(room: LayoutRoom) {
  const [sx, sy, sw, sh] = room.source;
  return room.mirrored ? <g transform={`translate(${2 * sx + sw} 0) scale(-1 1)`}><image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" /></g> : <image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" />;
}

export function ArtworkCrop({ room, label }: { room: LayoutRoom; label: string }) {
  const [x, y, width, height] = room.source;
  return <svg className="room-artwork" viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Nội thất pixel của ${label}`}>
    {mirroredArt(room)}
  </svg>;
}

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

function SingleRoom({ room, layoutRoom, state, dispatch }: { room: RoomModel; layoutRoom: LayoutRoom; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const actors = visibleActors(state, room.id);
  return <div className="single-room-wrap">
    <div className="single-room-top"><button className="back-button" onClick={() => dispatch({ type: 'ui.navigate', roomId: null })}>← Toàn cảnh</button><div><h2>{room.name}</h2><p>{room.kind === 'work' ? `${actors.length}/3 phiên · tính cả Lead` : room.kind === 'supervisor' ? 'Phiên Supervisor đang tồn tại' : 'Phòng dữ liệu · không tự mở CLI'}</p></div></div>
    <div className="room-crop" style={{ aspectRatio: `${layoutRoom.source[2]}/${layoutRoom.source[3]}` }}>
      <ArtworkCrop room={layoutRoom} label={room.name}/>
      {actors.map(session => <button key={session.id} className={`agent-marker ${session.lifecycle} ${session.role === 'supervisor' ? 'supervisor' : ''}`} style={actorStyle(layoutRoom, session)} onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })} aria-label={`Mở phiên ${session.agentName}`}>
        <AgentSprite session={session} pose={session.role === 'supervisor' ? 'standing' : 'seated'} direction="right" animated={false}/>
        <span className="agent-marker-label"><img src={`/cli/${session.provider}.svg`} alt=""/>{session.agentName}<small>{session.model ?? 'Chưa đồng bộ'}</small></span>
      </button>)}
      {room.kind === 'work' && actors.length === 0 && <span className="room-empty-label">0 phiên đang chạy · không có agent</span>}
    </div>
    {room.kind === 'work' && <div className="room-roster">{actors.map(session => <button key={session.id} className="room-session" onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })}><strong>{session.agentName}</strong><span>{session.role} · {session.lifecycle}</span><small>{session.provider} · {session.model ?? 'Chưa đồng bộ'}</small></button>)}</div>}
  </div>;
}

export function RoomView({ roomId, state, dispatch }: { roomId: string; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const room = visibleRooms(state).find(candidate => candidate.id === roomId);
  if (!room) return null;
  const layoutRoom = layoutOffice(visibleRooms(state)).rooms.find(candidate => candidate.room.id === roomId);
  return layoutRoom ? <SingleRoom room={room} layoutRoom={layoutRoom} state={state} dispatch={dispatch}/> : null;
}

export function RoomPreview({ room, state, dispatch }: { room: RoomModel; state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const layoutRoom = layoutOffice(visibleRooms(state)).rooms.find(candidate => candidate.room.id === room.id);
  if (!layoutRoom) return null;
  return <button className="room-preview-card" onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })}>
    <span className="room-preview-crop" style={{ aspectRatio: `${layoutRoom.source[2]}/${layoutRoom.source[3]}` }}><ArtworkCrop room={layoutRoom} label={room.name}/>
      {visibleActors(state, room.id).map(session => <span className="preview-actor" key={session.id} style={actorStyle(layoutRoom, session)}><AgentSprite session={session} pose={session.role === 'supervisor' ? 'standing' : 'seated'} direction="right" animated={false}/></span>)}
    </span><span className="room-preview-name">{room.name}</span><small>{room.kind === 'work' ? `${visibleActors(state, room.id).length}/3 phiên` : room.kind === 'supervisor' ? 'Điều phối' : 'Phòng dữ liệu'}</small>
  </button>;
}

export function OfficeView({ state, dispatch }: { state: AppState; dispatch: Dispatch<StudioEvent> }) {
  const rooms = visibleRooms(state);
  const layout = layoutOffice(rooms);
  const query = state.ui.search.trim().toLocaleLowerCase();
  if (state.ui.roomId) return <RoomView roomId={state.ui.roomId} state={state} dispatch={dispatch}/>;
  if (state.ui.officeMode === 'cards') return <div className="room-preview-grid">{rooms.filter(room => !query || room.name.toLocaleLowerCase().includes(query)).map(room => <RoomPreview key={room.id} room={room} state={state} dispatch={dispatch}/>)}</div>;

  const roomLookup = new Map(layout.rooms.map(room => [room.room.id, room]));
  return <div className="office-building-scroll"><div className="office-building" style={{ aspectRatio: `${layout.width}/${layout.height}` }}>
    <svg className="office-world-art" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" role="img" aria-label="Văn phòng pixel với các phòng thẳng và hành lang liên tục">
      {layout.sections.map((item, index) => <SourceSlice key={`section-${index}`} source={item.source} destination={item.destination}/>)}
      {layout.rooms.filter(room => room.room.kind === 'work').map(room => <SourceSlice key={room.room.id} source={room.source} destination={room.destination} mirrored={room.mirrored}/>)}
    </svg>
    {state.ui.role === 'employee' && <div className="office-restricted" style={{ left: `${8 / layout.width * 100}%`, top: `${8 / layout.height * 100}%`, width: `${490 / layout.width * 100}%`, height: `${432 / layout.height * 100}%` }}>KHU VỰC RIÊNG</div>}
    {rooms.map(room => {
      const layoutRoom = roomLookup.get(room.id)!;
      const style = destinationPercent(layoutRoom, layout);
      const actors = visibleActors(state, room.id);
      return <span key={room.id} className="room-layer">
        <button className={`office-room-hit ${room.kind}`} style={style} onClick={() => dispatch({ type: 'ui.navigate', roomId: room.id })} aria-label={`Vào ${room.name}`}><span className="office-room-label">{room.name}<small>{room.kind === 'work' ? `${actors.length}/3 · PHÒNG BAN` : room.kind === 'supervisor' ? 'SUPERVISOR' : room.kind === 'lobby' ? 'PHÒNG KHÁCH' : 'PHÒNG HỌP'}</small></span></button>
        {actors.map(session => <button key={session.id} className={`agent-marker map-agent ${session.role === 'supervisor' ? 'supervisor' : ''}`} style={actorWorldStyle(layoutRoom, session, layout)} onClick={() => dispatch({ type: 'ui.select-session', sessionId: session.id })} aria-label={`Mở phiên ${session.agentName}`}><AgentSprite session={session} pose={session.role === 'supervisor' ? 'standing' : 'seated'} direction="right" animated={false}/><span className="agent-marker-label"><img src={`/cli/${session.provider}.svg`} alt=""/>{session.agentName}<small>{session.model ?? 'Chưa đồng bộ'}</small></span></button>)}
      </span>;
    })}
  </div></div>;
}
