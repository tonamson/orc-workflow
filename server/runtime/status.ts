const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
}

function fieldValue(text: string, label: string, nextLabel: string): string {
  const start = text.lastIndexOf(`${label}:`);
  if (start < 0) return '';
  const value = text.slice(start + label.length + 1);
  const next = value.search(new RegExp(`\\n\\s*${nextLabel}:`, 'i'));
  return next < 0 ? value.slice(0, 256) : value.slice(0, next);
}

export function parseCodexStatus(raw: string): { nativeConversationId: string; model: string | null; reasoningEffort: string | null } | null {
  const text = stripAnsi(raw);
  const session = fieldValue(text, 'Session', 'Weekly limit').replace(/\s/g, '');
  const nativeConversationId = session.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
  if (!nativeConversationId || !UUID_RE.test(nativeConversationId)) return null;

  const modelField = fieldValue(text, 'Model', 'Model provider').replace(/\s/g, '');
  const modelParts = modelField.match(/^([A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159})\(reasoning([A-Za-z-]+)/i);
  const model = modelParts?.[1] && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/.test(modelParts[1]) ? modelParts[1].toLowerCase() : null;
  const reasoning = modelParts?.[2]?.toLowerCase();
  const reasoningEffort = reasoning && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(reasoning) ? reasoning : null;
  return { nativeConversationId, model, reasoningEffort };
}
