import { NextResponse } from 'next/server';
import { getNativeRuntimeService, isLocalRuntimeRequest } from '../../../server/runtime/service';

export function localOnly(request: Request): NextResponse | null {
  return isLocalRuntimeRequest(request) ? null : NextResponse.json({ error: 'local_runtime_only' }, { status: 403 });
}

export function runtimeError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'runtime_error';
  const status = code.endsWith('_not_found') ? 404
    : ['runtime_busy', 'session_bootstrapping', 'session_not_attached', 'session_not_resumable', 'session_already_attached', 'peer_not_reporting', 'run_not_delegatable', 'supervisor_report_not_ready', 'supervisor_turn_not_ready', 'native_turn_not_completed', 'native_report_unavailable', 'routing_settings_revision_conflict', 'routing_settings_not_configured', 'routing_provider_runner_unsupported', 'routing_session_configuration_mismatch', 'invalid_routing_decision'].includes(code) ? 409
      : code.startsWith('workspace_path_') ? 403
        : ['invalid_request', 'invalid_workspace', 'invalid_workspace_path', 'workspace_not_directory', 'invalid_run', 'invalid_report', 'invalid_terminal_input', 'invalid_terminal_size', 'invalid_sequence', 'native_conversation_unknown', 'native_conversation_id_required', 'report_content_must_come_from_native_peer', 'invalid_routing_settings'].includes(code) ? 400
          : 503;
  return NextResponse.json({ error: code }, { status });
}

export async function parseJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new Error('invalid_request'); }
}

export function runtimeService() { return getNativeRuntimeService(); }
