import type { Session } from '../studio/model/types';

export function sessionMetadata(session: Session): { model: string; reasoningLabel: string; reasoningValue: string } {
  const model = session.model ?? 'Chưa đồng bộ';
  const reasoning = session.reasoning;
  switch (reasoning.kind) {
    case 'unknown': return { model, reasoningLabel: 'Suy luận', reasoningValue: 'Chưa đồng bộ' };
    case 'unsupported': return { model, reasoningLabel: 'Suy luận', reasoningValue: 'Không hỗ trợ' };
    case 'effort': return { model, reasoningLabel: 'Mức suy luận', reasoningValue: String(reasoning.value) };
    case 'thinking-level': return { model, reasoningLabel: 'Mức suy nghĩ', reasoningValue: String(reasoning.value) };
    case 'thinking-budget': return { model, reasoningLabel: 'Ngân sách suy nghĩ', reasoningValue: String(reasoning.value) };
    case 'variant': return { model, reasoningLabel: 'Biến thể suy luận', reasoningValue: String(reasoning.value) };
  }
}
