import type { StudioEvent } from './model/types';

const localOnlyEvents = new Set<StudioEvent['type']>([
  'ui.navigate', 'ui.role', 'ui.client', 'ui.workspace', 'ui.mode', 'ui.panel',
  'ui.select-session', 'ui.select-record', 'ui.search', 'ui.record-filter',
  'runtime.workspaces', 'runtime.run', 'runtime.runs', 'runtime.motion-finished',
]);

export function isLocalOnlyEvent(event: StudioEvent): boolean {
  return localOnlyEvents.has(event.type);
}
