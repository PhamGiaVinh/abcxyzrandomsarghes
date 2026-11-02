// ─────────────────────────────────────────────────────────────────────────────
// Owner-facing payroll finance summary — pure aggregation over already-fetched
// payroll rows. No queries, no writes, no formula changes. All "recomputed"
// figures are visibility/đối-chiếu estimates only and must never overwrite or
// be presented as the saved payroll numbers (B1/B5 unresolved backend risks).
// ─────────────────────────────────────────────────────────────────────────────

import type { DealerPayrollRow, PayrollAdjustmentRow } from "@/hooks/useDealerPayroll";
import {
  openShifts,
  cappedShifts,
  netAdjustmentMismatches,
  zeroHoursPaid,
  largeAdjustments,
  negativeAdjustments,
  highCostOutliers,
} from "@/lib/payrollAnomalies";

export interface SavedPayrollMeta {
  periodId: string | null;
  status: string | null;
}

export type ApprovalRiskLevel = "ready" | "review" | "blocked";

export interface TopCostDealer {
  dealerId: string;
  dealerName: string;
  netPayVnd: number;
  employmentType: string;
}

export interface PayrollFinanceSummary {
  totalGrossVnd: number;
  totalNetVnd: number;
  totalNetAfterTaxVnd: number;
  totalAdjustmentsVnd: number;
  /** Σ(net_after_tax + adjustments) — số đối chiếu hiển thị, KHÔNG phải số lương đã lưu. */
  visibilityRecomputedPayableVnd: number;
  /** Σ net_pay_vnd − số đối chiếu. ≠ 0 → cần đối chiếu trước khi chi. */
  adjustmentMismatchVnd: number;
  dealerCount: number;
  ftDealerCount: number;
  ptDealerCount: number;
  openShiftCount: number;
  cappedShiftCount: number;
  zeroHoursPaidCount: number;
  largeAdjustmentCount: number;
  negativeAdjustmentCount: number;
  highCostOutlierCount: number;
  topCostDealers: TopCostDealer[];
  costByEmploymentType: { ftNetVnd: number; ptNetVnd: number };
  statusLabel: string;
  approvalRiskLevel: ApprovalRiskLevel;
  riskReasons: string[];
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && !Number.isNaN(v) ? v : 0;

const STATUS_LABELS: Record<string, string> = {
  draft: "Bản nháp",
  submitted: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Bị từ chối",
  locked: "Đã khoá sổ",
};

export function buildPayrollFinanceSummary(
  rows: DealerPayrollRow[],
  adjustmentsMap: Record<string, PayrollAdjustmentRow[]>,
  savedMeta: SavedPayrollMeta
): PayrollFinanceSummary {
  const sum = (get: (r: DealerPayrollRow) => number | null | undefined) =>
    rows.reduce((s, r) => s + n(get(r)), 0);

  const totalGrossVnd = sum((r) => r.gross_pay_vnd);
  const totalNetVnd = sum((r) => r.net_pay_vnd);
  const totalNetAfterTaxVnd = sum((r) => r.net_pay_after_tax_vnd);
  const totalAdjustmentsVnd = sum((r) => r.total_adjustments_vnd);
  const visibilityRecomputedPayableVnd = totalNetAfterTaxVnd + totalAdjustmentsVnd;
  const adjustmentMismatchVnd = totalNetVnd - visibilityRecomputedPayableVnd;

  const ft = rows.filter((r) => r.employment_type === "full_time");
  const pt = rows.filter((r) => r.employment_type === "part_time");

  const open = openShifts(rows);
  const capped = cappedShifts(rows);
  const mismatches = netAdjustmentMismatches(rows);
  const zeroHours = zeroHoursPaid(rows);
  const largeAdj = largeAdjustments(rows, adjustmentsMap);
  const negativeAdj = negativeAdjustments(rows, adjustmentsMap);
  const outliers = highCostOutliers(rows);

  const topCostDealers: TopCostDealer[] = [...rows]
    .sort((a, b) => n(b.net_pay_vnd) - n(a.net_pay_vnd))
    .slice(0, 3)
    .map((r) => ({
      dealerId: r.dealer_id,
      dealerName: r.full_name,
      netPayVnd: n(r.net_pay_vnd),
      employmentType: r.employment_type,
    }));

  // Frontend-only readiness rule (visibility, not authority):
  //   mismatch        → blocked  "Không nên chi trước khi đối chiếu"
  //   open/capped ca  → review   "Cần kiểm tra trước khi duyệt"
  //   else            → ready    "Sẵn sàng duyệt"
  let approvalRiskLevel: ApprovalRiskLevel = "ready";
  const riskReasons: string[] = [];
  if (mismatches.length > 0) {
    approvalRiskLevel = "blocked";
    riskReasons.push(
      `${mismatches.length} dealer có chênh lệch giữa thực lãnh và (sau thuế + điều chỉnh) — số thực lãnh có thể không đáng tin`
    );
  }
  if (open.length > 0) {
    if (approvalRiskLevel === "ready") approvalRiskLevel = "review";
    riskReasons.push(`${open.length} ca chưa checkout — giờ tạm tính theo ca chuẩn, cần đối chiếu trước khi duyệt`);
  }
  if (capped.length > 0) {
    if (approvalRiskLevel === "ready") approvalRiskLevel = "review";
    riskReasons.push(`${capped.length} ca chạm trần 24h — có thể quên checkout`);
  }
  if (approvalRiskLevel === "ready") {
    riskReasons.push("Không phát hiện rủi ro chặn — có thể tiếp tục workflow duyệt");
  }

  return {
    totalGrossVnd,
    totalNetVnd,
    totalNetAfterTaxVnd,
    totalAdjustmentsVnd,
    visibilityRecomputedPayableVnd,
    adjustmentMismatchVnd,
    dealerCount: rows.length,
    ftDealerCount: ft.length,
    ptDealerCount: pt.length,
    openShiftCount: open.length,
    cappedShiftCount: capped.length,
    zeroHoursPaidCount: zeroHours.length,
    largeAdjustmentCount: largeAdj.length,
    negativeAdjustmentCount: negativeAdj.length,
    highCostOutlierCount: outliers.length,
    topCostDealers,
    costByEmploymentType: {
      ftNetVnd: ft.reduce((s, r) => s + n(r.net_pay_vnd), 0),
      ptNetVnd: pt.reduce((s, r) => s + n(r.net_pay_vnd), 0),
    },
    statusLabel: savedMeta.periodId
      ? STATUS_LABELS[savedMeta.status ?? ""] ?? "—"
      : "Chưa lưu",
    approvalRiskLevel,
    riskReasons,
  };
}
