import type { ProjectRecord } from '../studio/model/types';

const typeLabels: Record<ProjectRecord['type'], string> = {
  project: 'Dự án', contract: 'Hợp đồng', minutes: 'Biên bản', progress: 'Tiến độ', delivery: 'Bàn giao',
  requirements: 'Yêu cầu', checklist: 'Danh sách kiểm tra', reference: 'Tài liệu tham khảo', commercial: 'Ghi chú thương mại',
};

export function recordTypeLabel(type: ProjectRecord['type']): string { return typeLabels[type]; }
export function recordAudienceLabel(audience: ProjectRecord['audience']): string {
  return audience === 'shared' ? 'Được chia sẻ' : audience === 'ceo' ? 'CEO' : 'Nội bộ';
}
