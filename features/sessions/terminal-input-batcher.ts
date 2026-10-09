export const MAX_TERMINAL_INPUT_BATCH_BYTES = 16 * 1024;
export const MAX_PENDING_TERMINAL_INPUT_BYTES = 64 * 1024;
const TERMINAL_INPUT_BATCH_DELAY_MS = 12;

type InputState = {
  pending: string;
  pendingBytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  failed: boolean;
};

type InputBatcherOptions = {
  onFailure?: (sessionId: string) => void;
  onOverflow?: (sessionId: string) => void;
  delayMs?: number;
};

export type TerminalInputBatcher = {
  enqueue: (sessionId: string, data: string) => boolean;
  clear: (sessionId: string) => void;
  reset: (sessionId: string) => void;
  dispose: () => void;
};

function utf8CharacterBytes(character: string): number {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) bytes += utf8CharacterBytes(character);
  return bytes;
}

function utf8Prefix(value: string, maxBytes: number): { length: number; bytes: number } {
  let bytes = 0;
  let length = 0;
  for (const character of value) {
    const characterBytes = utf8CharacterBytes(character);
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    length += character.length;
  }
  return { length, bytes };
}

function hasControlInput(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function createTerminalInputBatcher(
  send: (sessionId: string, data: string) => Promise<void>,
  options: InputBatcherOptions = {},
): TerminalInputBatcher {
  const sessions = new Map<string, InputState>();
  const delayMs = options.delayMs ?? TERMINAL_INPUT_BATCH_DELAY_MS;
  let disposed = false;

  const getState = (sessionId: string) => {
    let state = sessions.get(sessionId);
    if (!state) {
      state = { pending: '', pendingBytes: 0, timer: null, inFlight: false, failed: false };
      sessions.set(sessionId, state);
    }
    return state;
  };

  const clearPending = (state: InputState) => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    state.pending = '';
    state.pendingBytes = 0;
  };

  const drain = (sessionId: string, state: InputState) => {
    if (disposed || state.inFlight || state.failed || !state.pending) return;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;

    const prefix = utf8Prefix(state.pending, MAX_TERMINAL_INPUT_BATCH_BYTES);
    const batch = state.pending.slice(0, prefix.length);
    state.pending = state.pending.slice(prefix.length);
    state.pendingBytes -= prefix.bytes;
    state.inFlight = true;

    let acknowledgement: Promise<void>;
    try {
      acknowledgement = send(sessionId, batch);
    } catch {
      acknowledgement = Promise.reject(new Error('terminal_input_failed'));
    }
    void acknowledgement.then(() => {
      state.inFlight = false;
      if (disposed || sessions.get(sessionId) !== state || state.failed) return;
      if (state.pending) drain(sessionId, state);
      else sessions.delete(sessionId);
    }, () => {
      state.inFlight = false;
      if (disposed || sessions.get(sessionId) !== state) return;
      clearPending(state);
      state.failed = true;
      options.onFailure?.(sessionId);
    });
  };

  return {
    enqueue(sessionId, data) {
      if (disposed || !sessionId || typeof data !== 'string') return false;
      if (!data) return true;
      const state = getState(sessionId);
      if (state.failed) return false;
      const addedBytes = utf8ByteLength(data);
      if (state.pendingBytes + addedBytes > MAX_PENDING_TERMINAL_INPUT_BYTES) {
        clearPending(state);
        state.failed = true;
        options.onOverflow?.(sessionId);
        return false;
      }

      state.pending += data;
      state.pendingBytes += addedBytes;
      if (hasControlInput(data)) {
        drain(sessionId, state);
      } else if (!state.inFlight && state.timer === null) {
        state.timer = setTimeout(() => drain(sessionId, state), delayMs);
      }
      return true;
    },

    clear(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return;
      clearPending(state);
      if (!state.inFlight && !state.failed) sessions.delete(sessionId);
    },

    reset(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return;
      clearPending(state);
      state.failed = false;
      if (!state.inFlight) sessions.delete(sessionId);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const state of sessions.values()) clearPending(state);
      sessions.clear();
    },
  };
}
