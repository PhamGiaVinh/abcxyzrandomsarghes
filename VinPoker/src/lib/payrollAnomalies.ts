// ─────────────────────────────────────────────────────────────────────────────
// Pure, read-only anomaly detection over already-fetched payroll rows.
// Visibility only: these helpers never modify payroll data and their output
// must never be presented as authoritative payroll math — formula drift (B1)
// and saved-net/adjustment decoupling (B5) are known unresolved backend risks.
// UI wording: "Số liệu đối chiếu — không thay đổi số lương đã lưu."
// ─────────────────────────────────────────────────────────────────────────────

import type { DealerPayrollRow, PayrollAdjustmentRow } from "@/hooks/useDealerPayroll";

export interface AnomalyItem {
  dealerId: string;
  dealerName: string;
  detail: string;
  amountVnd?: number;
}

/** Saved-period rows from the RPC may carry null numerics — coerce defensively. */
const n = (v: number | null | undefined): number =>
  typeof v === "number" && !Number.isNaN(v) ? v : 0;

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtVnd(v: number): string {
  return `${Math.round(v).toLocaleString("vi-VN")}đ`;
}

/** Open shifts use the server's standard-shift estimate, not a running elapsed clock. */
export function openShifts(rows: DealerPayrollRow[]): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    for (const s of r.shifts ?? []) {
      if (s.check_out_time === null || s.check_out_time === undefined) {
        items.push({
          dealerId: r.dealer_id,
          dealerName: r.full_name,
          detail: `vào ca ${fmtTime(s.check_in_time)} — chưa checkout, giờ tạm tính theo ca chuẩn; chưa phải giờ thực tế`,
        });
      }
    }
  }
  return items;
}

/** Ca chạm trần 24h → khả năng quên checkout, cần kiểm tra trước khi chi. */
export function cappedShifts(rows: DealerPayrollRow[]): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    for (const s of r.shifts ?? []) {
      if (n(s.shift_hours) >= 24) {
        items.push({
          dealerId: r.dealer_id,
          dealerName: r.full_name,
          detail: `ca ${fmtTime(s.check_in_time)} bị giới hạn 24h — có thể quên checkout`,
        });
      }
    }
  }
  return items;
}

/**
 * Thực lãnh lệch với (sau thuế + điều chỉnh) → số thực lãnh có thể không đáng tin (B5).
 * Cả hai phiên bản công thức backend đã commit đều thoả net = net_after_tax + adjustments
 * trên đường tính trực tiếp; lệch xuất hiện khi kỳ đã lưu có điều chỉnh thêm sau khi lưu
 * mà net snapshot chưa được tính lại. Đây là check đối chiếu, không phải số lương đúng.
 */
export function netAdjustmentMismatches(rows: DealerPayrollRow[]): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    const diff = n(r.net_pay_vnd) - (n(r.net_pay_after_tax_vnd) + n(r.total_adjustments_vnd));
    if (Math.abs(diff) > 1) {
      items.push({
        dealerId: r.dealer_id,
        dealerName: r.full_name,
        detail: `thực lãnh lệch ${fmtVnd(diff)} so với (sau thuế + điều chỉnh) — cần đối chiếu trước khi chi`,
        amountVnd: diff,
      });
    }
  }
  return items;
}

/** FT 0 giờ nhưng vẫn có lương gộp → cần xác nhận chính sách lương tháng (B3). */
export function zeroHoursPaid(rows: DealerPayrollRow[]): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    if (r.employment_type === "full_time" && n(r.total_hours) <= 0 && n(r.gross_pay_vnd) > 0) {
      items.push({
        dealerId: r.dealer_id,
        dealerName: r.full_name,
        detail: `0 giờ làm nhưng lương gộp ${fmtVnd(n(r.gross_pay_vnd))} — xác nhận chính sách lương tháng`,
        amountVnd: n(r.gross_pay_vnd),
      });
    }
  }
  return items;
}

/** Điều chỉnh lớn (mặc định ≥ 500.000đ) → cần lý do phê duyệt rõ ràng. */
export function largeAdjustments(
  rows: DealerPayrollRow[],
  adjustmentsMap: Record<string, PayrollAdjustmentRow[]>,
  thresholdVnd: number = 500_000
): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    for (const a of adjustmentsMap[r.dealer_id] ?? []) {
      if (Math.abs(n(a.amount_vnd)) >= thresholdVnd) {
        items.push({
          dealerId: r.dealer_id,
          dealerName: r.full_name,
          detail: `${a.adjustment_type} ${fmtVnd(n(a.amount_vnd))} — "${a.reason || "không có lý do"}"`,
          amountVnd: n(a.amount_vnd),
        });
      }
    }
  }
  return items;
}

/** Điều chỉnh trừ lương (phạt/khấu trừ/tạm ứng) → dễ gây tranh chấp, cần audit reason. */
export function negativeAdjustments(
  rows: DealerPayrollRow[],
  adjustmentsMap: Record<string, PayrollAdjustmentRow[]>
): AnomalyItem[] {
  const NEGATIVE_TYPES = new Set(["PENALTY", "DEDUCTION", "ADVANCE"]);
  const items: AnomalyItem[] = [];
  for (const r of rows) {
    for (const a of adjustmentsMap[r.dealer_id] ?? []) {
      if (NEGATIVE_TYPES.has(a.adjustment_type)) {
        items.push({
          dealerId: r.dealer_id,
          dealerName: r.full_name,
          detail: `${a.adjustment_type} −${fmtVnd(Math.abs(n(a.amount_vnd)))} — "${a.reason || "không có lý do"}"`,
          amountVnd: -Math.abs(n(a.amount_vnd)),
        });
      }
    }
  }
  return items;
}

/** Dealer chi phí cao bất thường (net > trung bình + 2σ, tối thiểu 5 dealer) → cần review lịch làm / adjustment. */
export function highCostOutliers(rows: DealerPayrollRow[]): AnomalyItem[] {
  if (rows.length < 5) return [];
  const nets = rows.map((r) => n(r.net_pay_vnd));
  const mean = nets.reduce((s, v) => s + v, 0) / nets.length;
  const variance = nets.reduce((s, v) => s + (v - mean) ** 2, 0) / nets.length;
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return [];
  const cutoff = mean + 2 * sigma;
  return rows
    .filter((r) => n(r.net_pay_vnd) > cutoff && n(r.net_pay_vnd) > 0)
    .map((r) => ({
      dealerId: r.dealer_id,
      dealerName: r.full_name,
      detail: `thực lãnh ${fmtVnd(n(r.net_pay_vnd))} vượt trung bình + 2σ (${fmtVnd(cutoff)}) — review lịch làm / adjustment`,
      amountVnd: n(r.net_pay_vnd),
    }));
}
