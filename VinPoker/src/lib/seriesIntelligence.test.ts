import { describe, it, expect } from 'vitest';
import { SERIES_INTEL } from './seriesIntelligence';

describe('Series Intelligence content', () => {
  it('has title, subtitle and the safety boundary', () => {
    expect(SERIES_INTEL.title).toBe('Series Intelligence');
    expect(SERIES_INTEL.subtitle.length).toBeGreaterThan(0);
    expect(SERIES_INTEL.safetyBoundary).toContain('không thay thế báo cáo kế toán');
  });

  it('has the 4 workflow steps', () => {
    expect(SERIES_INTEL.steps).toHaveLength(4);
    expect(SERIES_INTEL.steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });

  it('lists the 9 required CSV columns', () => {
    expect(SERIES_INTEL.requiredColumns).toEqual([
      'event_name',
      'event_date',
      'buy_in',
      'fee',
      'gtd',
      'prize_pool_actual',
      'total_entries',
      'unique_entries',
      'reentries',
    ]);
    // event_id is an internal reference, NOT a required calculation column
    expect(SERIES_INTEL.requiredColumns).not.toContain('event_id');
    expect(SERIES_INTEL.eventIdNote).toContain('chưa dùng để tính toán');
  });

  it('contains no forbidden wording', () => {
    const { transparencyBadge, ...claims } = SERIES_INTEL;
    expect(transparencyBadge).toBe('Dữ liệu: quy tắc + quan sát, không phải dự đoán');
    const blob = JSON.stringify(claims).toLowerCase();
    for (const term of [
      'profit',
      'lợi nhuận thật',
      'doanh thu thật',
      'rake thật',
      'dự đoán',
      'nguyên nhân',
      'kết luận',
      'khuyến nghị',
      'wallet',
      'staking',
    ]) {
      expect(blob).not.toContain(term.toLowerCase());
    }
  });
});
