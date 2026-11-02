import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {parsePayrollSaveReceipt,type PayrollSaveIntent,type PayrollSaveReceipt} from '@/lib/payrollSaveIntent';

// Read availability only. Never wrap payroll mutations or retry a write.
async function readPayrollResponse<T>(response: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(response),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Quá thời gian tải dữ liệu lương. Hãy tải lại.')),20_000);
    })]);
  } finally { clearTimeout(timer); }
}

// A write deadline is an UNKNOWN outcome, never permission to retry a mutation.
// Save uses its durable journal; payment callers re-read canonical period/payment state.
async function waitPayrollWriteOutcome<T>(response:PromiseLike<T>,unknownMessage='PAYROLL_SAVE_OUTCOME_UNKNOWN'):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve(response),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(unknownMessage)),20_000);
  })]);}finally{clearTimeout(timer);}
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DealerPayrollRow {
  dealer_id: string;
  full_name: string;
  employment_type: "full_time" | "part_time";
  monthly_salary_vnd: number;
  hourly_rate_vnd: number;
  standard_hours_per_shift: number;
  ot_multiplier: number;
  standard_shifts_per_month?: number;
  total_shifts: number;
  total_hours: number;
  regular_hours: number;
  ot_hours: number;
  base_salary_vnd: number;
  regular_pay_vnd: number;
  ot_pay_vnd: number;
  gross_pay_vnd: number;
  total_adjustments_vnd: number;
  tips_amount_vnd: number;
  bhxh_deduction_vnd: number;
  bhyt_deduction_vnd: number;
  bhtn_deduction_vnd: number;
  pit_deduction_vnd: number;
  net_pay_vnd: number;
  net_pay_after_tax_vnd: number;
  shifts: Array<{
    attendance_id: string;
    check_in_time: string;
    check_out_time: string | null;
    total_worked_minutes: number;
    overtime_minutes: number;
    regular_minutes: number;
    shift_hours: number;
    regular_hours: number;
    ot_hours: number;
    is_overnight: boolean;
  }>;
}

export interface ClubPayrollResult {
  club_id: string;
  period_start: string;
  period_end: string;
  standard_shifts_per_month: number;
  dealers: Record<string, DealerPayrollRow>;
}

export interface PayrollAdjustmentRow {
  id: string;
  payroll_id: string;
  adjustment_type: string;
  amount_vnd: number;
  reason: string;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface SavedPayrollRecord {
  id: string;
  dealer_id: string;
  club_id: string;
  period_id: string;
  employment_type: string;
  monthly_salary_vnd: number | null;
  hourly_rate_vnd: number | null;
  ot_multiplier: number | null;
  total_shifts: number | null;
  total_hours: number | null;
  regular_hours: number | null;
  ot_hours: number | null;
  base_salary_vnd: number | null;
  regular_pay_vnd: number | null;
  ot_pay_vnd: number | null;
  gross_pay_vnd: number | null;
  total_adjustments_vnd: number | null;
  tips_amount_vnd: number | null;
  bhxh_deduction_vnd: number | null;
  bhyt_deduction_vnd: number | null;
  bhtn_deduction_vnd: number | null;
  pit_deduction_vnd: number | null;
  net_pay_vnd: number | null;
  net_pay_after_tax_vnd: number | null;
  status: string | null;
  calculated_at: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDealerPayroll(clubIds: string[]): {
  data: DealerPayrollRow[];
  period: { start: string; end: string };
  loading: boolean;
  error: string | null;
  fetchPayroll: (clubId: string, start: string, end: string) => Promise<void>;
} {
  const [rows, setRows] = useState<DealerPayrollRow[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const clubScope = [...clubIds].sort().join(':');
  useEffect(() => () => { generationRef.current += 1; }, [clubScope]);

  const fetchPayroll = useCallback(async (clubId: string, start: string, end: string) => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await readPayrollResponse(supabase.rpc("calculate_club_payroll", {
        p_club_id: clubId,
        p_start_date: start,
        p_end_date: end,
      }));
      if (generation !== generationRef.current) return;
      if (rpcError) throw rpcError;
      const result = data as unknown as ClubPayrollResult;
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || result.club_id !== clubId || result.period_start !== start || result.period_end !== end
        || !result.dealers || typeof result.dealers !== 'object' || Array.isArray(result.dealers)) {
        throw new Error('Không xác minh được dữ liệu tính lương cho đúng CLB và kỳ đã chọn.');
      }
      const dealerRows:DealerPayrollRow[]=[];
      for(const [dealerId,value] of Object.entries(result.dealers as Record<string,unknown>)) {
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Không xác minh được số liệu lương từng dealer.');
        const row=value as DealerPayrollRow&{error?:unknown};
        // Preserve the canonical inactive-dealer result, not arbitrary failures.
        if(row.error==='dealer not found or inactive'&&Object.keys(row).length===1)continue;
        if(row.dealer_id!==dealerId||typeof row.full_name!=='string'||!row.full_name.trim()
          || !['full_time','part_time'].includes(row.employment_type)
          || !Array.isArray(row.shifts)
          || [...SAVED_PAYROLL_FIELDS,'standard_hours_per_shift'].some(field=>
            typeof (value as Record<string,unknown>)[field]!=='number'||!Number.isFinite((value as Record<string,unknown>)[field]))) {
          throw new Error('Không xác minh được số liệu lương từng dealer.');
        }
        // Saved-period RPC rows omit this display-only denominator. Never
        // invent it or reject otherwise verified frozen money for its absence.
        if ('standard_shifts_per_month' in value && (typeof row.standard_shifts_per_month !== 'number'
          || !Number.isFinite(row.standard_shifts_per_month) || row.standard_shifts_per_month <= 0)) {
          throw new Error('Không xác minh được số liệu lương từng dealer.');
        }
        dealerRows.push(row);
      }
      // Sort: FT first, then PT; within each group by name
      dealerRows.sort((a, b) => {
        if (a.employment_type !== b.employment_type) {
          return a.employment_type === "full_time" ? -1 : 1;
        }
        return (a.full_name || "").localeCompare(b.full_name || "");
      });
      setPeriod({ start: result.period_start, end: result.period_end });
      setRows(dealerRows);
    } catch (e: any) {
      if (generation !== generationRef.current) return;
      setError(e?.message ?? "Lỗi tính lương");
      setRows([]);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);

  return { data: rows, period, loading, error, fetchPayroll };
}

// ── Save / Approve helpers ────────────────────────────────────────────────────

function confirmedPayrollTransition(value:unknown):true {
  if(value!==true)throw new Error('Trạng thái kỳ lương chưa được server xác nhận. Hãy tải lại trước khi tiếp tục.');
  return true;
}

/** Caller must persist intent before invoking. No automatic v1 fallback/retry. */
export async function savePayrollWithIntent(intent:PayrollSaveIntent,rows:DealerPayrollRow[]):Promise<PayrollSaveReceipt> {
  const start=`${intent.year}-${String(intent.month).padStart(2,'0')}-01`;
  const end=`${intent.year}-${String(intent.month).padStart(2,'0')}-${new Date(intent.year,intent.month,0).getDate()}`;
  const {data,error}=await waitPayrollWriteOutcome(supabase.rpc('save_payroll_period_v2' as never,{
    p_club_id:intent.clubId,p_year:intent.year,p_month:intent.month,p_start_date:start,p_end_date:end,
    p_payroll_rows:rows,p_request_id:intent.requestId,
  } as never));
  if(error)throw error;
  const receipt=parsePayrollSaveReceipt(data,intent);
  if(receipt.outcome!=='saved'||receipt.savedCount!==rows.length)throw new Error('PAYROLL_SAVE_RECEIPT_INVALID');
  return receipt;
}
export async function getPayrollSaveReceipt(intent:PayrollSaveIntent):Promise<PayrollSaveReceipt|null> {
  const {data,error}=await readPayrollResponse(supabase.rpc('get_payroll_save_receipt_v2' as never,{
    p_request_id:intent.requestId,p_club_id:intent.clubId,
  } as never));
  if(error)throw error;
  return data===null?null:parsePayrollSaveReceipt(data,intent);
}
export async function cancelUnresolvedPayrollSave(intent:PayrollSaveIntent):Promise<PayrollSaveReceipt> {
  const {data,error}=await waitPayrollWriteOutcome(supabase.rpc('cancel_unresolved_payroll_save_v2' as never,{
    p_request_id:intent.requestId,p_club_id:intent.clubId,p_year:intent.year,p_month:intent.month,
  } as never));
  if(error)throw error;
  return parsePayrollSaveReceipt(data,intent);
}

/**
 * Save payroll to DB via transaction-safe RPC.
 * Replaces old 3-call sequence (upsert + delete + insert).
 * Uses ON CONFLICT (period_id, dealer_id) DO UPDATE so adjustments are preserved.
 */
export async function savePayroll(
  clubId: string,
  year: number,
  month: number,
  payrollRows: DealerPayrollRow[]
): Promise<{ periodId: string; savedCount: number }> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const { data: periodId, error } = await (supabase as any).rpc("save_payroll_period_secure", {
    p_club_id: clubId,
    p_year: year,
    p_month: month,
    p_start_date: startDate,
    p_end_date: endDate,
    p_payroll_rows: payrollRows,
  });

  if (error) throw error;
  if (typeof periodId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(periodId)) {
    throw new Error('Chưa xác minh được kết quả lưu bảng lương. Hãy đọc lại kỳ lương trước khi tiếp tục.');
  }
  return { periodId, savedCount: payrollRows.length };
}

/**
 * Submit payroll period for approval (draft → submitted).
 */
export async function submitPayroll(
  periodId: string
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("transition_payroll_status_secure", {
    p_period_id: periodId,
    p_expected_status: "draft",
    p_new_status: "submitted",
  });
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/**
 * Approve payroll period (submitted → approved).
 */
export async function approvePayroll(
  periodId: string
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("transition_payroll_status_secure", {
    p_period_id: periodId,
    p_expected_status: "submitted",
    p_new_status: "approved",
  });
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/**
 * Lock payroll period (approved → locked). No more edits allowed.
 */
export async function lockPayroll(
  periodId: string
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("transition_payroll_status_secure", {
    p_period_id: periodId,
    p_expected_status: "approved",
    p_new_status: "locked",
  });
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/**
 * Reject payroll period (submitted → rejected). Records rejecter + reason.
 */
export async function rejectPayroll(
  periodId: string,
  reason: string
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("transition_payroll_status_secure", {
    p_period_id: periodId,
    p_expected_status: "submitted",
    p_new_status: "rejected",
    p_rejection_reason: reason,
  });
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/**
 * Resubmit rejected payroll (rejected → draft). Clears reject metadata.
 */
export async function resubmitPayroll(
  periodId: string
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("transition_payroll_status_secure", {
    p_period_id: periodId,
    p_expected_status: "rejected",
    p_new_status: "draft",
  });
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

// ── Payment lifecycle (PL1) ────────────────────────────────────────────────────

export interface PaymentRecord {
  id: string;
  period_id: string;
  club_id: string;
  status: string;
  total_net_vnd: number;
  dealer_count: number;
  payment_method: string | null;
  payment_ref: string | null;
  note: string | null;
  prepared_by: string | null;
  prepared_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
  reconciliation_ref: string | null;
  reconciliation_note: string | null;
}

/** Prepare payment (locked → payment_prepared). Returns new payment_records id. */
export async function preparePayment(
  periodId: string,
  paymentMethod: string,
  note?: string
): Promise<string> {
  const { data, error } = await waitPayrollWriteOutcome<{data:unknown;error:unknown}>((supabase as any).rpc("prepare_payroll_payment_secure", {
    p_period_id: periodId,
    p_payment_method: paymentMethod,
    p_note: note ?? null,
  }), 'Chưa xác minh được kết quả thanh toán lương. Hãy đọc lại kỳ lương trước khi tiếp tục.');
  if (error) throw error;
  if (typeof data !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(data)) {
    throw new Error('Chưa xác minh được kết quả chuẩn bị thanh toán. Hãy đọc lại kỳ lương trước khi tiếp tục.');
  }
  return data;
}

/** Mark payroll paid (payment_prepared → paid). payment_ref required. */
export async function markPaid(
  periodId: string,
  paymentRef: string,
  note?: string
): Promise<boolean> {
  const { data, error } = await waitPayrollWriteOutcome<{data:unknown;error:unknown}>((supabase as any).rpc("mark_payroll_paid_secure", {
    p_period_id: periodId,
    p_payment_ref: paymentRef,
    p_note: note ?? null,
  }), 'Chưa xác minh được kết quả thanh toán lương. Hãy đọc lại kỳ lương trước khi tiếp tục.');
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/** Reconcile payment (paid → reconciled). Reconciler must differ from payer. */
export async function reconcilePayment(
  periodId: string,
  reconciliationRef?: string,
  note?: string
): Promise<boolean> {
  const { data, error } = await waitPayrollWriteOutcome<{data:unknown;error:unknown}>((supabase as any).rpc("reconcile_payroll_payment_secure", {
    p_period_id: periodId,
    p_reconciliation_ref: reconciliationRef ?? null,
    p_note: note ?? null,
  }), 'Chưa xác minh được kết quả thanh toán lương. Hãy đọc lại kỳ lương trước khi tiếp tục.');
  if (error) throw error;
  return confirmedPayrollTransition(data);
}

/** Load the payment record for a period (or null). Read-only. */
export async function getPaymentRecord(periodId: string): Promise<PaymentRecord | null> {
  const { data, error } = await readPayrollResponse((supabase as any)
    .from("payment_records")
    .select("*")
    .eq("period_id", periodId)
    .maybeSingle()) as {data:PaymentRecord|null;error:unknown};
  if (error) throw error;
  return (data as PaymentRecord) ?? null;
}

/**
 * Add a payroll adjustment to a saved dealer_payroll record.
 */
export async function addPayrollAdjustment(
  payrollId: string,
  adjustmentType: string,
  amountVnd: number,
  reason: string,
  createdBy: string
): Promise<PayrollAdjustmentRow> {
  const { data, error } = await supabase
    .from("payroll_adjustments")
    .insert({
      payroll_id: payrollId,
      adjustment_type: adjustmentType,
      amount_vnd: amountVnd,
      reason,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PayrollAdjustmentRow;
}

/**
 * Load saved payroll adjustments for a given period.
 * Returns map of dealer_id → PayrollAdjustmentRow[]
 */
export async function loadPayrollAdjustments(
  periodId: string
): Promise<Record<string, PayrollAdjustmentRow[]>> {
  const { data, error } = await readPayrollResponse(supabase
    .from("dealer_payroll")
    .select("id, dealer_id, payroll_adjustments!payroll_adjustments_payroll_id_fkey(*)")
    .eq("period_id", periodId));
  if (error) throw error;

  const map: Record<string, PayrollAdjustmentRow[]> = {};
  for (const row of (data ?? []) as unknown as Array<{dealer_id: string; payroll_adjustments: PayrollAdjustmentRow[] | null}>) {
    map[row.dealer_id] = row.payroll_adjustments ?? [];
  }
  return map;
}

/**
 * Get saved payroll records for a period, including status.
 */
export const SAVED_PAYROLL_FIELDS = [
  "monthly_salary_vnd", "hourly_rate_vnd", "ot_multiplier", "total_shifts",
  "total_hours", "regular_hours", "ot_hours", "base_salary_vnd",
  "regular_pay_vnd", "ot_pay_vnd", "gross_pay_vnd", "total_adjustments_vnd",
  "tips_amount_vnd", "bhxh_deduction_vnd", "bhyt_deduction_vnd",
  "bhtn_deduction_vnd", "pit_deduction_vnd", "net_pay_vnd",
  "net_pay_after_tax_vnd",
] as const;

export async function getSavedPayroll(
  clubId: string,
  year: number,
  month: number
): Promise<{
  periodId: string | null;
  status: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  paymentPreparedBy: string | null;
  paymentPreparedAt: string | null;
  paidBy: string | null;
  paidAt: string | null;
  reconciledBy: string | null;
  reconciledAt: string | null;
  records: SavedPayrollRecord[];
}> {
  const { data: period, error: periodError } = await readPayrollResponse((supabase as any)
    .from("payroll_periods")
    .select("id, status, submitted_by, submitted_at, approved_by, approved_at, locked_by, locked_at, rejected_by, rejected_at, rejection_reason, payment_prepared_by, payment_prepared_at, paid_by, paid_at, reconciled_by, reconciled_at")
    .eq("club_id", clubId)
    .eq("period_year", year)
    .eq("period_month", month)
    .maybeSingle()) as {data:({id:string}&Record<string,string|null>)|null;error:unknown};

  if (periodError) throw periodError;

  if (!period) {
    return {
      periodId: null,
      status: null,
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      lockedBy: null,
      lockedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      paymentPreparedBy: null,
      paymentPreparedAt: null,
      paidBy: null,
      paidAt: null,
      reconciledBy: null,
      reconciledAt: null,
      records: [],
    };
  }

  const { data: records, error } = await readPayrollResponse(supabase
    .from("dealer_payroll")
    .select("*")
    .eq("period_id", period.id));
  if (error) throw error;

  if (!Array.isArray(records)) throw new Error("Không xác minh được dữ liệu kỳ lương đã lưu");
  const seenDealers = new Set<string>();
  const seenRows = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" ||
        typeof record.id !== "string" || !record.id ||
        typeof record.dealer_id !== "string" || !record.dealer_id ||
        record.club_id !== clubId || record.period_id !== period.id ||
        seenRows.has(record.id) || seenDealers.has(record.dealer_id) ||
        SAVED_PAYROLL_FIELDS.some((field) => typeof record[field] !== "number" || !Number.isFinite(record[field]))) {
      throw new Error("Không xác minh được dữ liệu kỳ lương đã lưu");
    }
    seenRows.add(record.id);
    seenDealers.add(record.dealer_id);
  }

  return {
    periodId: period.id,
    status: period.status,
    submittedBy: period.submitted_by,
    submittedAt: period.submitted_at,
    approvedBy: period.approved_by,
    approvedAt: period.approved_at,
    lockedBy: period.locked_by,
    lockedAt: period.locked_at,
    rejectedBy: period.rejected_by,
    rejectedAt: period.rejected_at,
    rejectionReason: period.rejection_reason,
    paymentPreparedBy: period.payment_prepared_by,
    paymentPreparedAt: period.payment_prepared_at,
    paidBy: period.paid_by,
    paidAt: period.paid_at,
    reconciledBy: period.reconciled_by,
    reconciledAt: period.reconciled_at,
    records: records as SavedPayrollRecord[],
  };
}

/**
 * Get audit log for a period.
 */
export async function getPayrollAuditLog(
  periodId: string,
  limit: number = 100
): Promise<any[]> {
  const { data, error } = await (supabase as any).rpc("get_payroll_audit_log", {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Get audit log for a payroll period.
 */
async function getAuditLog(
  periodId: string,
  limit = 100
): Promise<Array<{
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_values: any;
  new_values: any;
  changed_by: string | null;
  changed_at: string;
}>> {
  const { data, error } = await (supabase as any).rpc("get_payroll_audit_log", {
    p_period_id: periodId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as any[];
}

/**
 * Delete a payroll adjustment.
 */
export async function deletePayrollAdjustment(
  adjustmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("payroll_adjustments")
    .delete()
    .eq("id", adjustmentId);
  if (error) throw error;
}
