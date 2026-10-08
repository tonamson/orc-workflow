import type { LayoutRoom } from './geometry';

function mirroredArt(room: LayoutRoom) {
  const [sx, , sw] = room.source;
  return room.mirrored ? <g transform={`translate(${2 * sx + sw} 0) scale(-1 1)`}><image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" /></g> : <image href="/art/office.png" x="0" y="0" width="1586" height="992" imageRendering="pixelated" />;
}

export function ArtworkCrop({ room, label }: { room: LayoutRoom; label: string }) {
  const [x, y, width, height] = room.source;
  return <svg className="room-artwork" viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Nội thất pixel của ${label}`}>
    {mirroredArt(room)}
  </svg>;
}
