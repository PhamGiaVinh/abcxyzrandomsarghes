import { describe, expect, it } from "vitest";
import { buildPayrollFinanceSummary } from "./payrollFinanceSummary";

describe("saved payroll status", () => {
  it.each([
    ["draft", "Bản nháp"],
    ["submitted", "Chờ duyệt"],
    ["approved", "Đã duyệt"],
    ["rejected", "Bị từ chối"],
    ["locked", "Đã khoá sổ"],
    ["payment_prepared", "Đã chuẩn bị chi"],
    ["paid", "CLB đã ghi chi"],
    ["reconciled", "Đã đối soát"],
    ["future_status", "Chưa xác định trạng thái"],
    ["constructor", "Chưa xác định trạng thái"],
    [null, "Chưa xác định trạng thái"],
  ])("displays %s using the saved status", (status, label) => {
    const summary = buildPayrollFinanceSummary([], {}, { periodId: "period", status });
    expect(summary.statusLabel).toBe(label);
  });

  it("labels an unsaved period and leaves workflow advice to the status controls", () => {
    const summary = buildPayrollFinanceSummary([], {}, { periodId: null, status: null });
    expect(summary.statusLabel).toBe("Chưa lưu");
    expect(summary.riskReasons).toEqual([]);
  });
});
