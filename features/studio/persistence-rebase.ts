import { studioReducer } from './model/reducer';
import type { AppState, Role, StudioEvent } from './model/types';

export type PendingStudioEvent = { event: StudioEvent; context: { role: Role; workspaceId: string; clientViewerId: string | null } };

export function rebasePendingEvents(serverState: AppState, pending: PendingStudioEvent[], localUi: AppState['ui']): AppState {
  let rebased = serverState;
  for (const item of pending) {
    rebased = studioReducer({ ...rebased, ui: { ...rebased.ui, ...item.context, workspaceId: item.context.workspaceId } }, item.event);
  }
  return { ...rebased, ui: localUi };
}
