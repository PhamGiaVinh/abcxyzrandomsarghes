import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { startLiveReportRefresh } from '@/lib/liveReportRefresh';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useFtPayrollStatements } from "@/hooks/useFtPayrollStatements";
import { usePayrollStatementTelegramDelivery } from "@/hooks/usePayrollStatementTelegramDelivery";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { exportToExcel, type ExcelColumn } from "@/lib/exportExcel";
import {
  useDealerPayroll, type DealerPayrollRow,
  savePayrollWithIntent, getPayrollSaveReceipt, cancelUnresolvedPayrollSave,
  addPayrollAdjustment, loadPayrollAdjustments, getSavedPayroll, deletePayrollAdjustment,
  submitPayroll, approvePayroll, lockPayroll, rejectPayroll, resubmitPayroll,
  preparePayment, markPaid, reconcilePayment, getPaymentRecord,
  getPayrollAuditLog, SAVED_PAYROLL_FIELDS,
  type PayrollAdjustmentRow, type SavedPayrollRecord, type PaymentRecord,
} from "@/hooks/useDealerPayroll";
import {readPayrollSaveIntent,persistPayrollSaveIntent,clearPayrollSaveIntent,type PayrollSaveIntent} from '@/lib/payrollSaveIntent';
import {
  Users, RefreshCw, Download, Calculator, Save, Plus, Trash2, Loader2, Moon, Eye,
  AlertTriangle, CheckCircle2, TrendingUp, ChevronDown, ChevronUp, ShieldAlert,
} from "lucide-react";
import {
  openShifts, cappedShifts, netAdjustmentMismatches, zeroHoursPaid,
  largeAdjustments, negativeAdjustments, highCostOutliers, type AnomalyItem,
} from "@/lib/payrollAnomalies";
import { buildPayrollFinanceSummary } from "@/lib/payrollFinanceSummary";
import {
  FtPayrollStatementActions,
  FtPayrollStatementBadge,
  FtPayrollStatementSummary,
} from "@/components/cashier/FtPayrollStatementControls";
import { PayrollStatementTelegramDeliveryControls } from "@/components/cashier/PayrollStatementTelegramDeliveryControls";
import { LegacyPayrollPreviewDialog } from "@/components/cashier/LegacyPayrollPreviewDialog";

type ClubRow = { id: string; name: string };
type AdjType = "BONUS" | "PENALTY" | "DEDUCTION" | "ADVANCE" | "OTHER" | "TIPS";

const ADJ_TYPE_LABELS: Record<AdjType, string> = {
  BONUS: "Thưởng",
  PENALTY: "Phạt",
  DEDUCTION: "Khấu trừ",
  ADVANCE: "Tạm ứng",
  OTHER: "Khác",
  TIPS: "Tips",
};

const ADJ_TYPE_COLORS: Record<AdjType, string> = {
  BONUS: "border-success text-success",
  PENALTY: "border-destructive text-destructive",
  DEDUCTION: "border-warning text-warning",
  ADVANCE: "border-[hsl(var(--ds-active))] text-[hsl(var(--ds-active))]",
  OTHER: "border-border text-muted-foreground",
  TIPS: "border-warning text-warning",
};

function mergeSavedPayrollRows(
  liveRows: DealerPayrollRow[],
  savedRecords: Record<string, SavedPayrollRecord>,
): DealerPayrollRow[] {
  const liveByDealer = new Map(liveRows.map((row) => [row.dealer_id, row]));
  return Object.values(savedRecords)
    .filter((saved) => saved.status !== "excluded")
    .map((saved) => {
      const live = liveByDealer.get(saved.dealer_id);
      const row: DealerPayrollRow = live ? { ...live } : {
        dealer_id: saved.dealer_id,
        full_name: `Dealer ${saved.dealer_id.slice(0, 8)}`,
        employment_type: saved.employment_type === "full_time" ? "full_time" : "part_time",
        monthly_salary_vnd: 0,
        hourly_rate_vnd: 0,
        standard_hours_per_shift: 0,
        ot_multiplier: 0,
        standard_shifts_per_month: 0,
        total_shifts: 0,
        total_hours: 0,
        regular_hours: 0,
        ot_hours: 0,
        base_salary_vnd: 0,
        regular_pay_vnd: 0,
        ot_pay_vnd: 0,
        gross_pay_vnd: 0,
        total_adjustments_vnd: 0,
        tips_amount_vnd: 0,
        bhxh_deduction_vnd: 0,
        bhyt_deduction_vnd: 0,
        bhtn_deduction_vnd: 0,
        pit_deduction_vnd: 0,
        net_pay_vnd: 0,
        net_pay_after_tax_vnd: 0,
        shifts: [],
      };

      row.employment_type = saved.employment_type === "full_time" ? "full_time" : "part_time";
      for (const field of SAVED_PAYROLL_FIELDS) {
        row[field] = saved[field] as number;
      }
      return row;
    })
    .sort((a, b) => {
      if (a.employment_type !== b.employment_type) return a.employment_type === "full_time" ? -1 : 1;
      return a.full_name.localeCompare(b.full_name);
    });
}

// ── Column config (single source of truth for table + export + PDF) ──────────

type HideBelow = "md" | "lg" | "xl";

type ColumnKey =
  | "full_name"
  | "employment_type"
  | "total_shifts"
  | "total_hours"
  | "regular_hours"
  | "ot_hours"
  | "base_pay"
  | "regular_pay"
  | "ot_pay"
  | "gross_pay"
  | "tips"
  | "bhxh"
  | "bhyt"
  | "bhtn"
  | "pit"
  | "net_after_tax"
  | "adjustments"
  | "net_pay"
  | "actions";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  hideBelow?: HideBelow;
  export: boolean;
}

const COLUMNS: readonly ColumnDef[] = [
  { key: "full_name",       label: "Tên",        export: true },
  { key: "employment_type", label: "Loại",       export: true },
  { key: "total_shifts",    label: "Ca",         export: true },
  { key: "total_hours",     label: "Tổng giờ",   export: true },
  { key: "regular_hours",   label: "Giờ chuẩn",  export: true },
  { key: "ot_hours",        label: "OT",         export: true },
  { key: "base_pay",        label: "Lương CB",   export: true },
  { key: "regular_pay",     label: "Thường",     hideBelow: "md", export: true },
  { key: "ot_pay",          label: "OT pay",     export: true },
  { key: "gross_pay",       label: "Gộp",        export: true },
  { key: "tips",            label: "Tips",       hideBelow: "lg", export: true },
  { key: "bhxh",            label: "BHXH",       hideBelow: "lg", export: true },
  { key: "bhyt",            label: "BHYT",       hideBelow: "lg", export: true },
  { key: "bhtn",            label: "BHTN",       hideBelow: "lg", export: true },
  { key: "pit",             label: "PIT",        hideBelow: "xl", export: true },
  { key: "net_after_tax",   label: "Sau thuế",   hideBelow: "lg", export: true },
  { key: "adjustments",     label: "Điều chỉnh", export: true },
  { key: "net_pay",         label: "Thực lãnh",  export: true },
  { key: "actions",         label: "",           export: false },
] as const;

// ── Filter types & pure helpers (file level) ─────────────────────────────────

type FilterKey = "all" | "full_time" | "part_time" | "has_adjustments" | "high_ot";

const FILTERS: readonly { key: FilterKey; label: string; danger?: boolean }[] = [
  { key: "all",             label: "Tất cả" },
  { key: "full_time",       label: "FT" },
  { key: "part_time",       label: "PT" },
  { key: "has_adjustments", label: "Có điều chỉnh" },
  { key: "high_ot",         label: "OT nhiều", danger: true },
] as const;

function passesFilter(
  row: DealerPayrollRow,
  filter: FilterKey,
  adjustmentsMap: Record<string, PayrollAdjustmentRow[]>
): boolean {
  if (filter === "has_adjustments") return (adjustmentsMap[row.dealer_id]?.length ?? 0) > 0;
  if (filter === "high_ot") return row.ot_hours >= 20;
  // 'all', 'full_time', 'part_time' handled by section split
  return true;
}

function matchesSearch(row: DealerPayrollRow, query: string): boolean {
  if (!query) return true;
  return row.full_name.toLowerCase().includes(query.toLowerCase());
}

// ── Excel export value accessor ──────────────────────────────────────────────

function getExportValue(key: ColumnKey): (r: DealerPayrollRow) => string | number | null {
  switch (key) {
    case "full_name":       return (r) => r.full_name;
    case "employment_type": return (r) => r.employment_type === "full_time" ? "FT" : "PT";
    case "total_shifts":    return (r) => r.total_shifts;
    case "total_hours":     return (r) => r.total_hours ? Number(r.total_hours.toFixed(1)) : 0;
    case "regular_hours":   return (r) => r.regular_hours ? Number(r.regular_hours.toFixed(1)) : 0;
    case "ot_hours":        return (r) => r.ot_hours ? Number(r.ot_hours.toFixed(1)) : 0;
    case "base_pay":        return (r) => r.base_salary_vnd;
    case "regular_pay":     return (r) => r.regular_pay_vnd;
    case "ot_pay":          return (r) => r.ot_pay_vnd;
    case "gross_pay":       return (r) => r.gross_pay_vnd;
    case "tips":            return (r) => r.tips_amount_vnd;
    case "bhxh":            return (r) => r.bhxh_deduction_vnd;
    case "bhyt":            return (r) => r.bhyt_deduction_vnd;
    case "bhtn":            return (r) => r.bhtn_deduction_vnd;
    case "pit":             return (r) => r.pit_deduction_vnd;
    case "net_after_tax":   return (r) => r.net_pay_after_tax_vnd;
    case "adjustments":     return (r) => r.total_adjustments_vnd;
    case "net_pay":         return (r) => r.net_pay_vnd;
    case "actions":         return () => null;
    default: { const _: never = key; return () => null; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVNDShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}tr`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("vi-VN");
}

function formatHours(h: number): string {
  if (h === 0) return "—";
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins < 10 ? "0" : ""}${mins}ph`;
}

// ── Audit log diff (money/status fields only — data already returned by RPC) ──

const AUDIT_DIFF_FIELDS = [
  "gross_pay_vnd", "net_pay_vnd", "net_pay_after_tax_vnd", "ot_pay_vnd",
  "base_salary_vnd", "total_adjustments_vnd", "amount_vnd",
  "status", "adjustment_type", "reason",
] as const;

function auditFieldDiffs(oldValues: any, newValues: any): { field: string; from: string; to: string }[] {
  const o = oldValues ?? {};
  const nv = newValues ?? {};
  const fmt = (v: unknown) =>
    v === null || v === undefined ? "—" : typeof v === "number" ? v.toLocaleString("vi-VN") : String(v);
  const diffs: { field: string; from: string; to: string }[] = [];
  for (const k of AUDIT_DIFF_FIELDS) {
    if (!(k in o) && !(k in nv)) continue;
    if (JSON.stringify(o[k]) === JSON.stringify(nv[k])) continue;
    diffs.push({ field: k, from: fmt(o[k]), to: fmt(nv[k]) });
  }
  return diffs;
}

// ── MetricCard (used in summary strip) ───────────────────────────────────────

type MetricVariant = "default" | "success" | "danger" | "warning";

function MetricCard({ label, value, sub, variant = "default" }: {
  label: string;
  value: ReactNode;
  sub?: string;
  variant?: MetricVariant;
}) {
  const variantStyles: Record<MetricVariant, string> = {
    default: "text-foreground",
    success: "text-success",
    danger: "text-destructive",
    warning: "text-warning",
  };
  return (
    <div className="bg-card border border-border rounded-lg p-2.5 flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider break-words">{label}</span>
      <span className={`text-base font-semibold ${variantStyles[variant]} break-words`}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground break-words">{sub}</span>}
    </div>
  );
}

function getMonthYearOptions(): { value: string; label: string; start: string; end: string; year: number; month: number }[] {
  const options: { value: string; label: string; start: string; end: string; year: number; month: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad(month)}-${lastDay}`;
    const label = `Tháng ${month}/${year}`;
    const value = `${year}-${pad(month)}`;
    options.push({ value, label, start, end, year, month });
  }
  return options;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface DealerPayrollTabProps {
  clubIds: string[];
  clubs: ClubRow[];
  /**
   * Accountant workspace: hide the approve/reject/lock controls so the UI matches the
   * permission matrix (accountant submits; only owner/admin approves & locks). The
   * server-side transition gate (transition_payroll_status_secure) remains the real
   * boundary — this is presentation only.
   */
  hideApprovalActions?: boolean;
}

export default function DealerPayrollTab(props: DealerPayrollTabProps) {
  const { user, loading, session } = useAuth();
  if (loading) return <p role="status">Đang xác minh phiên đăng nhập…</p>;
  if (!user) return <p role="alert">Đăng nhập để xem bảng lương.</p>;
  if (props.clubIds.length === 0) return <p role="status">Chưa có phạm vi CLB để tải bảng lương.</p>;
  return <DealerPayrollScope key={`${user.id}:${sessionReadEpoch(session)}:${[...props.clubIds].sort().join(':')}`} {...props}/>;
}

function DealerPayrollScope({ clubIds, clubs, hideApprovalActions }: DealerPayrollTabProps) {
  const { user, isAdmin } = useAuth();
  const { scope: operatorScope } = useOperatorClubs();
  const monthOptions = useMemo(() => getMonthYearOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? "");
  const currentRange = useMemo(() => monthOptions.find((o) => o.value === selectedMonth), [monthOptions, selectedMonth]);
  const [clubFilter, setClubFilter] = useState<string>(clubIds.length === 1 ? clubIds[0] : "");

  const { data: payrollRows, period, loading, error, fetchPayroll } = useDealerPayroll(clubIds);
  const activeClubId = clubFilter || clubIds[0] || "";
  const savedReadScope = `${user?.id ?? ''}:${activeClubId}:${currentRange?.start ?? ''}:${currentRange?.end ?? ''}`;
  const savedReadScopeRef = useRef(savedReadScope);
  savedReadScopeRef.current = savedReadScope;
  const savedReadGeneration = useRef(0);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current=true;return () => { activeRef.current=false; }; },[]);
  const [verifiedSavedScope, setVerifiedSavedScope] = useState<string | null>(null);
  const [savedReadError, setSavedReadError] = useState<string | null>(null);
  const [pendingSaveIntent,setPendingSaveIntent]=useState<PayrollSaveIntent|null>(null);
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const recoveryLockRef=useRef(false);
  const backgroundReadPaused = useRef(false);
  const actorId=user?.id;

  // ── Saved payroll state ──────────────────────────────────────────────────
  const [savedPeriodId, setSavedPeriodId] = useState<string | null>(null);
  const [payrollStatus, setPayrollStatus] = useState<string | null>(null);
  const [savedRecords, setSavedRecords] = useState<Record<string, SavedPayrollRecord>>({});
  const [adjustments, setAdjustments] = useState<Record<string, PayrollAdjustmentRow[]>>({});
  const [saving, setSaving] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectedBy, setRejectedBy] = useState<string | null>(null);
  const [rejectedAt, setRejectedAt] = useState<string | null>(null);
  const [storedRejectionReason, setStoredRejectionReason] = useState<string | null>(null);

  // Approval-flow metadata (real actors from DB, not the current viewer)
  const [submittedByMeta, setSubmittedByMeta] = useState<string | null>(null);
  const [submittedAtMeta, setSubmittedAtMeta] = useState<string | null>(null);
  const [approvedByMeta, setApprovedByMeta] = useState<string | null>(null);
  const [approvedAtMeta, setApprovedAtMeta] = useState<string | null>(null);
  const [lockedByMeta, setLockedByMeta] = useState<string | null>(null);
  const [lockedAtMeta, setLockedAtMeta] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  // Payment lifecycle (PL1): metadata + payment record + action inputs
  const [paymentPreparedByMeta, setPaymentPreparedByMeta] = useState<string | null>(null);
  const [paymentPreparedAtMeta, setPaymentPreparedAtMeta] = useState<string | null>(null);
  const [paidByMeta, setPaidByMeta] = useState<string | null>(null);
  const [paidAtMeta, setPaidAtMeta] = useState<string | null>(null);
  const [reconciledByMeta, setReconciledByMeta] = useState<string | null>(null);
  const [reconciledAtMeta, setReconciledAtMeta] = useState<string | null>(null);
  const [paymentRecord, setPaymentRecord] = useState<PaymentRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [reconRef, setReconRef] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);

  // Owner-finance UI state
  const [costRankingOn, setCostRankingOn] = useState(false);
  const [anomaliesExpanded, setAnomaliesExpanded] = useState(false);

  // Audit log state
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [auditLog, setAuditLog] = useState<Array<{
    id: string;
    table_name: string;
    record_id: string;
    action: string;
    old_values: any;
    new_values: any;
    changed_by: string | null;
    changed_at: string;
  }>>([]);

  // PDF export loading state
  const [exporting, setExporting] = useState<string | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<{ row: DealerPayrollRow; title: string; html: string } | null>(null);

  // Adjustment dialog state
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [adjustingDealerId, setAdjustingDealerId] = useState<string | null>(null);
  const [adjType, setAdjType] = useState<AdjType>("BONUS");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjSaving, setAdjSaving] = useState(false);
  const adjustmentScopeGeneration = useRef(0);
  useEffect(() => {
    adjustmentScopeGeneration.current += 1;
    setPaymentBusy(false);
    setPaymentRef("");
    setReconRef("");
    setAdjDialogOpen(false);
    setAdjustingDealerId(null);
    setAdjAmount("");
    setAdjReason("");
    setAdjSaving(false);
  }, [savedReadScope]);

  // Filter + search state
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Fetch payroll & check saved ──────────────────────────────────────────

  const refreshAll = useCallback(async () => {
    if (!actorId || !activeClubId || !currentRange) return;
    const generation = ++savedReadGeneration.current;
    const scope = savedReadScope;
    const current = () => generation === savedReadGeneration.current && scope === savedReadScopeRef.current;
    setVerifiedSavedScope(null);
    setSavedReadError(null);
    setRecoveryBusy(true);
    try {
    const pending=readPayrollSaveIntent(sessionStorage,{actorId,clubId:activeClubId,year:currentRange.year,month:currentRange.month});
    setPendingSaveIntent(pending);
    if(pending){
      const receipt=await getPayrollSaveReceipt(pending);
      if(!current())return;
      if(!receipt)return; // Absence is unresolved, never permission to resubmit.
      clearPayrollSaveIntent(sessionStorage,pending,receipt);
      setPendingSaveIntent(null);
    }
    await fetchPayroll(activeClubId, currentRange.start, currentRange.end);
    if (!current()) return;
    const {
      periodId, status, records,
      submittedBy: sBy, submittedAt: sAt,
      approvedBy: aBy, approvedAt: aAt,
      lockedBy: lBy, lockedAt: lAt,
      rejectedBy: rBy, rejectedAt: rAt, rejectionReason: rReason,
      paymentPreparedBy: ppBy, paymentPreparedAt: ppAt,
      paidBy: pdBy, paidAt: pdAt,
      reconciledBy: rcBy, reconciledAt: rcAt,
    } = await getSavedPayroll(activeClubId, currentRange.year, currentRange.month);
    if (!current()) return;
    setSavedPeriodId(periodId);
    setPayrollStatus(status);
    setSubmittedByMeta(sBy);
    setSubmittedAtMeta(sAt);
    setApprovedByMeta(aBy);
    setApprovedAtMeta(aAt);
    setLockedByMeta(lBy);
    setLockedAtMeta(lAt);
    setRejectedBy(rBy);
    setRejectedAt(rAt);
    setStoredRejectionReason(rReason);
    setPaymentPreparedByMeta(ppBy);
    setPaymentPreparedAtMeta(ppAt);
    setPaidByMeta(pdBy);
    setPaidAtMeta(pdAt);
    setReconciledByMeta(rcBy);
    setReconciledAtMeta(rcAt);
    setLastRefreshedAt(new Date());
    const recordMap: Record<string, SavedPayrollRecord> = {};
    for (const r of records) { recordMap[r.dealer_id] = r; }
    setSavedRecords(recordMap);
    if (periodId) {
      // Unknown adjustments/payment state is not an empty ledger. Keep the
      // operational screen blocked until all financial reads are verified.
      const nextAdjustments = await loadPayrollAdjustments(periodId);
      if (!current()) return;
      const nextPayment = await getPaymentRecord(periodId);
      if (!current()) return;
      setAdjustments(nextAdjustments);
      setPaymentRecord(nextPayment);
    } else {
      setAdjustments({});
      setPaymentRecord(null);
    }
    if (current()) setVerifiedSavedScope(scope);
    } catch {
      if (current()) setSavedReadError('Không xác minh được trạng thái kỳ lương. Chưa thể chỉnh sửa hoặc chốt lương; hãy tải lại.');
    } finally {if(current())setRecoveryBusy(false);}
  }, [actorId,activeClubId, currentRange, fetchPayroll, savedReadScope]);

  useEffect(() => {
    if (!activeClubId || !currentRange) return;
    let initial = true;
    const stop = startLiveReportRefresh(async () => {
      if (initial || (!backgroundReadPaused.current && !transitionLockRef.current && !recoveryLockRef.current)) {
        initial = false;
        await refreshAll();
      }
    });
    return () => { savedReadGeneration.current += 1; stop(); };
  }, [activeClubId, currentRange, refreshAll]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const displayRows = useMemo(
    () => savedPeriodId
      ? mergeSavedPayrollRows(payrollRows, savedRecords)
      : payrollRows,
    [payrollRows, savedPeriodId, savedRecords],
  );

  const ftDealers = useMemo(() => displayRows.filter((d) => d.employment_type === "full_time"), [displayRows]);
  const ptDealers = useMemo(() => displayRows.filter((d) => d.employment_type === "part_time"), [displayRows]);

  const filteredFt = useMemo(() => {
    const list = ftDealers
      .filter((r) => passesFilter(r, activeFilter, adjustments))
      .filter((r) => matchesSearch(r, searchQuery));
    return costRankingOn ? [...list].sort((a, b) => (b.net_pay_vnd ?? 0) - (a.net_pay_vnd ?? 0)) : list;
  }, [ftDealers, activeFilter, adjustments, searchQuery, costRankingOn]);

  const filteredPt = useMemo(() => {
    const list = ptDealers
      .filter((r) => passesFilter(r, activeFilter, adjustments))
      .filter((r) => matchesSearch(r, searchQuery));
    return costRankingOn ? [...list].sort((a, b) => (b.net_pay_vnd ?? 0) - (a.net_pay_vnd ?? 0)) : list;
  }, [ptDealers, activeFilter, adjustments, searchQuery, costRankingOn]);

  const highOtCount = useMemo(
    () => displayRows.filter((r) => r.ot_hours >= 20).length,
    [displayRows]
  );

  const totals = useMemo(() => {
    const sum = (key: keyof DealerPayrollRow) => displayRows.reduce((s, d) => s + (d[key] as number), 0);
    return {
      totalGross: sum("gross_pay_vnd"),
      totalBase: sum("base_salary_vnd"),
      totalOt: sum("ot_pay_vnd"),
      totalNet: sum("net_pay_vnd"),
      totalAdjust: sum("total_adjustments_vnd"),
      totalHours: sum("total_hours"),
      totalShifts: sum("total_shifts"),
      totalTips: sum("tips_amount_vnd"),
      totalBhxh: sum("bhxh_deduction_vnd"),
      totalBhyt: sum("bhyt_deduction_vnd"),
      totalBhtn: sum("bhtn_deduction_vnd"),
      totalPit: sum("pit_deduction_vnd"),
      totalNetAfterTax: sum("net_pay_after_tax_vnd"),
    };
  }, [displayRows]);

  // ── Owner finance summary + anomalies (visibility only — no payroll number is changed) ──

  const anomalies = useMemo(() => ({
    open: openShifts(displayRows),
    capped: cappedShifts(displayRows),
    mismatches: netAdjustmentMismatches(displayRows),
    zeroHours: zeroHoursPaid(displayRows),
    largeAdj: largeAdjustments(displayRows, adjustments),
    negativeAdj: negativeAdjustments(displayRows, adjustments),
    outliers: highCostOutliers(displayRows),
  }), [displayRows, adjustments]);

  const anomalyGroups = useMemo(() => ([
    { label: "Ca chưa checkout — giờ tạm tính theo ca chuẩn", items: anomalies.open, level: "danger" as const },
    { label: "Ca chạm trần 24h — có thể quên checkout", items: anomalies.capped, level: "danger" as const },
    { label: "Chênh lệch điều chỉnh — thực lãnh có thể không đáng tin", items: anomalies.mismatches, level: "danger" as const },
    { label: "FT 0 giờ vẫn có lương — xác nhận chính sách lương tháng", items: anomalies.zeroHours, level: "warning" as const },
    { label: "Điều chỉnh lớn (≥500K) — cần lý do phê duyệt", items: anomalies.largeAdj, level: "warning" as const },
    { label: "Điều chỉnh trừ lương — dễ gây tranh chấp", items: anomalies.negativeAdj, level: "warning" as const },
    { label: "Dealer chi phí cao bất thường — cần review lịch làm", items: anomalies.outliers, level: "warning" as const },
  ] as { label: string; items: AnomalyItem[]; level: "danger" | "warning" }[]).filter((g) => g.items.length > 0),
  [anomalies]);

  const finance = useMemo(
    () => buildPayrollFinanceSummary(displayRows, adjustments, { periodId: savedPeriodId, status: payrollStatus }),
    [displayRows, adjustments, savedPeriodId, payrollStatus]
  );

  // ── Save payroll ──────────────────────────────────────────────────────────

  const saveLockRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (!user || !activeClubId || !currentRange || !payrollRows.length || saveLockRef.current
      || verifiedSavedScope !== savedReadScope || error || savedReadError) return;
    const scope = savedReadScope;
    saveLockRef.current = true;
    setSaving(true);
    try {
      const intentScope={actorId:user.id,clubId:activeClubId,year:currentRange.year,month:currentRange.month};
      const existing=readPayrollSaveIntent(sessionStorage,intentScope);
      if(existing){setPendingSaveIntent(existing);setVerifiedSavedScope(null);return;}
      const intent=persistPayrollSaveIntent(sessionStorage,intentScope);
      setPendingSaveIntent(intent);
      const result = await savePayrollWithIntent(intent,payrollRows);
      if (!activeRef.current || scope !== savedReadScopeRef.current) return;
      clearPayrollSaveIntent(sessionStorage,intent,result);
      setPendingSaveIntent(null);
      setSavedPeriodId(result.periodId);
      setPayrollStatus("draft");
      toast.success(`Đã lưu bảng lương — ${result.savedCount} dealer`);
      await refreshAll();
    } catch (e: any) {
      if (!activeRef.current || scope !== savedReadScopeRef.current) return;
      setVerifiedSavedScope(null);
      setSavedReadError('Chưa xác minh được kết quả lưu bảng lương. Hãy tải lại kỳ lương để đọc trạng thái từ server; không gửi lại thao tác khi chưa kiểm tra.');
      toast.error(e?.message ?? "Lỗi lưu bảng lương");
    } finally {
      saveLockRef.current = false;
      if (activeRef.current && scope === savedReadScopeRef.current) setSaving(false);
    }
  }, [user, activeClubId, currentRange, payrollRows, refreshAll,verifiedSavedScope,savedReadScope,error,savedReadError]);

  const cancelPendingSave=useCallback(async()=>{
    if(!pendingSaveIntent||recoveryLockRef.current||saving)return;
    const scope=savedReadScope;recoveryLockRef.current=true;setRecoveryBusy(true);
    try {
      const receipt=await cancelUnresolvedPayrollSave(pendingSaveIntent);
      if(!activeRef.current||scope!==savedReadScopeRef.current)return;
      clearPayrollSaveIntent(sessionStorage,pendingSaveIntent,receipt);setPendingSaveIntent(null);
      toast.success(receipt.outcome==='saved'?'Đã xác minh bảng lương đã lưu; không hoàn tác.':'Đã hủy request chưa commit. Không hoàn tác bảng lương.');
      await refreshAll();
    } catch {
      if(activeRef.current&&scope===savedReadScopeRef.current)setSavedReadError('Chưa xác minh được kết quả yêu cầu. Giữ nguyên request và kiểm tra lại.');
    } finally {recoveryLockRef.current=false;if(activeRef.current&&scope===savedReadScopeRef.current)setRecoveryBusy(false);}
  },[pendingSaveIntent,saving,savedReadScope,refreshAll]);

  // ── Status helpers ──────────────────────────────────────────────────────────

  const isLocked = ["locked", "payment_prepared", "paid", "reconciled"].includes(payrollStatus ?? "");
  const canEditAdjustments = payrollStatus === null || payrollStatus === "draft" || payrollStatus === "rejected";
  const isDraft = payrollStatus === "draft" || payrollStatus === null;
  const isSubmitted = payrollStatus === "submitted";
  const isApproved = payrollStatus === "approved";
  const ftStatementController = useFtPayrollStatements({
    clubId: activeClubId,
    periodId: savedPeriodId,
    periodStatus: payrollStatus,
    canFinalize: isAdmin || operatorScope.some((row) => row.club_id === activeClubId && row.can_owner),
    dealerIds: ftDealers.map((dealer) => dealer.dealer_id),
  });
  const payrollDeliveryController = usePayrollStatementTelegramDelivery({
    clubId: activeClubId,
    periodId: savedPeriodId,
    canSend: isAdmin || operatorScope.some((row) => row.club_id === activeClubId && row.can_owner),
  });

  // ── Submit / Approve / Lock ─────────────────────────────────────────────

  const transitionLockRef = useRef(false);
  backgroundReadPaused.current = saving || recoveryBusy || paymentBusy || adjSaving
    || adjDialogOpen || auditLogOpen || !!legacyPreview || !!exporting || !!pendingSaveIntent;
  const runStatusTransition = useCallback(async (
    mutate: () => Promise<unknown>,
    confirmed: () => void,
    failureMessage: string,
  ) => {
    if (transitionLockRef.current || verifiedSavedScope !== savedReadScope || error || savedReadError) return;
    const scope = savedReadScope;
    transitionLockRef.current = true;
    try {
      await mutate();
      if (!activeRef.current || scope !== savedReadScopeRef.current) return;
      confirmed();
    } catch (failure: unknown) {
      if (!activeRef.current || scope !== savedReadScopeRef.current) return;
      toast.error(failure instanceof Error ? failure.message : failureMessage);
    } finally {
      transitionLockRef.current = false;
    }
  }, [verifiedSavedScope, savedReadScope, error, savedReadError]);

  const handleSubmit = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    await runStatusTransition(() => submitPayroll(savedPeriodId), () => {
      setPayrollStatus("submitted");
      setSubmittedByMeta(user.id);
      setSubmittedAtMeta(new Date().toISOString());
      toast.success("Đã gửi duyệt");
    }, "Lỗi gửi duyệt");
  }, [user, savedPeriodId, runStatusTransition]);

  const handleApprove = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    await runStatusTransition(() => approvePayroll(savedPeriodId), () => {
      setPayrollStatus("approved");
      setApprovedByMeta(user.id);
      setApprovedAtMeta(new Date().toISOString());
      toast.success("Đã phê duyệt");
    }, "Lỗi phê duyệt");
  }, [user, savedPeriodId, runStatusTransition]);

  const handleLock = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    await runStatusTransition(() => lockPayroll(savedPeriodId), () => {
      setPayrollStatus("locked");
      setLockedByMeta(user.id);
      setLockedAtMeta(new Date().toISOString());
      toast.success("Đã khoá sổ");
    }, "Lỗi khoá sổ");
  }, [user, savedPeriodId, runStatusTransition]);

  const handleReject = useCallback(async (reason: string) => {
    if (!user || !savedPeriodId) return;
    if (!reason.trim()) {
      toast.error("Vui lòng nhập lý do từ chối");
      return;
    }
    await runStatusTransition(() => rejectPayroll(savedPeriodId, reason), () => {
      setPayrollStatus("rejected");
      setRejectedBy(user.id);
      setRejectedAt(new Date().toISOString());
      setStoredRejectionReason(reason);
      setRejectionReason("");
      toast.success("Đã từ chối bảng lương");
    }, "Lỗi từ chối");
  }, [user, savedPeriodId, runStatusTransition]);

  const handleResubmit = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    await runStatusTransition(() => resubmitPayroll(savedPeriodId), () => {
      setPayrollStatus("draft");
      setRejectedBy(null);
      setRejectedAt(null);
      setStoredRejectionReason(null);
      toast.success("Đã chuyển về nháp");
    }, "Lỗi chuyển về nháp");
  }, [user, savedPeriodId, runStatusTransition]);

  const handlePreparePayment = useCallback(async () => {
    if (!user || !savedPeriodId || paymentBusy) return;
    const scope = savedReadScope;
    const current = () => activeRef.current && scope === savedReadScopeRef.current;
    setPaymentBusy(true);
    try {
      await preparePayment(savedPeriodId, paymentMethod);
      if (!current()) return;
      toast.success("Đã chuẩn bị chi trả");
      await refreshAll();
    } catch (e: any) {
      if (current()) toast.error(e?.message ?? "Lỗi chuẩn bị chi trả");
    } finally {
      if (current()) setPaymentBusy(false);
    }
  }, [user, savedPeriodId, paymentMethod, paymentBusy, refreshAll, savedReadScope]);

  const handleMarkPaid = useCallback(async () => {
    if (!user || !savedPeriodId || paymentBusy) return;
    if (!paymentRef.trim()) {
      toast.error("Vui lòng nhập mã/tham chiếu thanh toán");
      return;
    }
    const scope = savedReadScope;
    const current = () => activeRef.current && scope === savedReadScopeRef.current;
    setPaymentBusy(true);
    try {
      await markPaid(savedPeriodId, paymentRef.trim());
      if (!current()) return;
      toast.success("Đã ghi nhận chi trả");
      setPaymentRef("");
      await refreshAll();
    } catch (e: any) {
      if (current()) toast.error(e?.message ?? "Lỗi ghi nhận chi trả");
    } finally {
      if (current()) setPaymentBusy(false);
    }
  }, [user, savedPeriodId, paymentRef, paymentBusy, refreshAll, savedReadScope]);

  const handleReconcile = useCallback(async () => {
    if (!user || !savedPeriodId || paymentBusy) return;
    const scope = savedReadScope;
    const current = () => activeRef.current && scope === savedReadScopeRef.current;
    setPaymentBusy(true);
    try {
      await reconcilePayment(savedPeriodId, reconRef.trim() || undefined);
      if (!current()) return;
      toast.success("Đã đối soát");
      setReconRef("");
      await refreshAll();
    } catch (e: any) {
      if (current()) toast.error(e?.message ?? "Lỗi đối soát");
    } finally {
      if (current()) setPaymentBusy(false);
    }
  }, [user, savedPeriodId, reconRef, paymentBusy, refreshAll, savedReadScope]);

  const openAuditLog = useCallback(async () => {
    if (!savedPeriodId) return;
    try {
      const data = await getPayrollAuditLog(savedPeriodId);
      setAuditLog(data);
      setAuditLogOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tải audit log");
    }
  }, [savedPeriodId]);

  const exportSinglePdf = useCallback(async (row: DealerPayrollRow) => {
    setExporting(row.dealer_id);
    try {
      const { exportPayrollPdf } = await import("@/lib/exportPayrollPdf");
      const clubName = clubs.find((c) => c.id === activeClubId)?.name ?? "club";
      const monthLabel = currentRange?.label ?? selectedMonth;
      await exportPayrollPdf([row], clubName, monthLabel, row.dealer_id);
      toast.success(`Đã xuất PDF phiếu lương ${row.full_name}`);
    } catch (e: any) {
      // Fallback to print
      try {
        window.print();
        toast.info("Đã mở print dialog (fallback)");
      } catch {
        toast.error(e?.message ?? "Lỗi xuất PDF");
      }
    } finally {
      setExporting(null);
    }
  }, [clubs, activeClubId, currentRange, selectedMonth]);

  const openLegacyPreview = useCallback(async (row: DealerPayrollRow) => {
    const clubName = clubs.find((club) => club.id === activeClubId)?.name ?? "CLB";
    const monthLabel = currentRange?.label ?? selectedMonth;
    const { buildPayrollPreviewHtml } = await import("@/lib/exportPayrollPdf");
    setLegacyPreview({
      row,
      title: `Bản xem tạm tính · ${row.full_name}`,
      html: buildPayrollPreviewHtml([row], clubName, monthLabel, row.dealer_id),
    });
  }, [activeClubId, clubs, currentRange, selectedMonth]);

  // ── Add adjustment ────────────────────────────────────────────────────────

  const openAdjustDialog = useCallback((dealerId: string) => {
    setAdjustingDealerId(dealerId);
    setAdjType("BONUS");
    setAdjAmount("");
    setAdjReason("");
    setAdjDialogOpen(true);
  }, []);

  const handleAddAdjustment = useCallback(async () => {
    if (!adjustingDealerId || !user || !savedPeriodId) return;
    const scope = savedReadScope;
    const generation = adjustmentScopeGeneration.current;
    const current = () => activeRef.current && scope === savedReadScopeRef.current
      && generation === adjustmentScopeGeneration.current;
    const record = savedRecords[adjustingDealerId];
    if (!record) {
      toast.error("Vui lòng lưu bảng lương trước khi thêm điều chỉnh");
      return;
    }
    const amount = parseInt(adjAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    setAdjSaving(true);
    try {
      await addPayrollAdjustment(record.id, adjType, amount, adjReason || adjType, user.id);
      if (!current()) return;
      toast.success("Đã thêm điều chỉnh");
      setAdjDialogOpen(false);
      await refreshAll();
    } catch (e: any) {
      if (!current()) return;
      toast.error(e?.message ?? "Lỗi thêm điều chỉnh");
    } finally {
      if (current()) setAdjSaving(false);
    }
  }, [adjustingDealerId, user, savedPeriodId, savedRecords, adjType, adjAmount, adjReason, refreshAll, savedReadScope]);

  // ── Delete adjustment ─────────────────────────────────────────────────────

  const handleDeleteAdjustment = useCallback(async (adjId: string) => {
    const scope = savedReadScope;
    const generation = adjustmentScopeGeneration.current;
    const current = () => activeRef.current && scope === savedReadScopeRef.current
      && generation === adjustmentScopeGeneration.current;
    try {
      await deletePayrollAdjustment(adjId);
      if (!current()) return;
      toast.success("Đã xóa điều chỉnh");
      await refreshAll();
    } catch (e: any) {
      if (!current()) return;
      toast.error(e?.message ?? "Lỗi xóa điều chỉnh");
    }
  }, [refreshAll, savedReadScope]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const doExport = useCallback(() => {
    if (!displayRows.length) return;
    const clubName = clubs.find((c) => c.id === activeClubId)?.name ?? "club";
    const monthLabel = currentRange?.label ?? selectedMonth;
    const allRows = [...ftDealers, ...ptDealers];
    const exportColumns: ExcelColumn<DealerPayrollRow>[] = COLUMNS
      .filter((c) => c.export)
      .map((c) => {
        const headerSuffix = c.key === "base_pay" || c.key === "regular_pay" ||
                             c.key === "ot_pay" || c.key === "gross_pay" ||
                             c.key === "tips" || c.key === "bhxh" ||
                             c.key === "bhyt" || c.key === "bhtn" ||
                             c.key === "pit" || c.key === "net_after_tax" ||
                             c.key === "adjustments" || c.key === "net_pay"
                             ? " (VND)" : "";
        return { header: c.label + headerSuffix, get: getExportValue(c.key) };
      });
    exportToExcel(allRows, exportColumns, `luong-${clubName}-${monthLabel}`, "Bảng lương");
    toast.success(`Đã tải bảng lương ${monthLabel}`);
  }, [displayRows, ftDealers, ptDealers, clubs, activeClubId, currentRange, selectedMonth]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderCell = (col: typeof COLUMNS[number], r: DealerPayrollRow): ReactNode => {
    const isFullTime = r.employment_type === "full_time";
    const baseRight = "text-right font-mono text-xs";

    switch (col.key) {
      case "full_name":
        return (
          <div className="font-medium text-white text-sm">
            <div className="flex items-center gap-1">
              {r.full_name}
              {isFullTime && (
                <FtPayrollStatementBadge controller={ftStatementController} dealerId={r.dealer_id} />
              )}
              {canEditAdjustments && savedRecords[r.dealer_id] && (
                <button
                  className="text-[10px] text-muted-foreground hover:text-success ml-1"
                  onClick={() => openAdjustDialog(r.dealer_id)}
                  title="Thêm điều chỉnh"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
            {(adjustments[r.dealer_id]?.length ?? 0) > 0 && (
              <div className="mt-1 space-y-0.5">
                {(adjustments[r.dealer_id] ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-1 text-[10px]">
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${ADJ_TYPE_COLORS[a.adjustment_type as AdjType] ?? ""}`}>
                      {ADJ_TYPE_LABELS[a.adjustment_type as AdjType] ?? a.adjustment_type}
                    </Badge>
                    <span className={(a.adjustment_type === "BONUS" || a.adjustment_type === "OTHER") ? "text-success" : "text-destructive"}>
                      {(a.adjustment_type === "BONUS" || a.adjustment_type === "OTHER" ? "+" : "-")}{Number(a.amount_vnd).toLocaleString("vi-VN")}
                    </span>
                    <span className="text-muted-foreground">{a.reason}</span>
                    {canEditAdjustments && (
                      <button
                        className="text-muted-foreground hover:text-destructive ml-0.5"
                        onClick={() => handleDeleteAdjustment(a.id)}
                        title="Xóa"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case "employment_type":
        return (
          <Badge
            variant="outline"
            className={`text-[10px] ${isFullTime ? "border-success text-success" : "border-warning text-warning"}`}
          >
            {isFullTime ? "FT" : "PT"}
          </Badge>
        );
      case "total_shifts": {
        const hasOvernight = r.shifts.some((s) => s.is_overnight);
        return (
          <div className={`${baseRight.replace("text-right", "text-center")} text-foreground`}>
            <div className="flex items-center justify-center gap-1">
              {r.total_shifts || "—"}
              {hasOvernight && <Moon className="w-3 h-3 text-[hsl(var(--ds-active))]" />}
            </div>
          </div>
        );
      }
      case "total_hours":     return <span className={`${baseRight} text-foreground`}>{formatHours(r.total_hours)}</span>;
      case "regular_hours":   return <span className={`${baseRight} text-foreground`}>{formatHours(r.regular_hours)}</span>;
      case "ot_hours":        return <span className={`${baseRight} ${r.ot_hours > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{r.ot_hours > 0 ? formatHours(r.ot_hours) : "—"}</span>;
      case "base_pay": {
        const isProrated = isFullTime && r.monthly_salary_vnd > 0 && r.standard_shifts_per_month > 0
          && r.total_shifts < r.standard_shifts_per_month;
        return (
          <div className={`${baseRight} text-foreground`}>
            <div>
              {isFullTime
                ? r.base_salary_vnd > 0 ? formatVNDShort(r.base_salary_vnd) : "—"
                : r.hourly_rate_vnd ? `${(r.hourly_rate_vnd / 1000).toFixed(0)}K/h` : "—"}
            </div>
            {isProrated && (
              <div className="text-[10px] text-warning leading-tight">
                {formatVNDShort(r.monthly_salary_vnd)}×{r.total_shifts}/{r.standard_shifts_per_month}
              </div>
            )}
          </div>
        );
      }
      case "regular_pay":     return <span className={`${baseRight} text-foreground`}>{formatVND(r.regular_pay_vnd)}</span>;
      case "ot_pay":          return <span className={`${baseRight} ${r.ot_pay_vnd > 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.ot_pay_vnd > 0 ? formatVND(r.ot_pay_vnd) : "—"}</span>;
      case "gross_pay":       return <span className={`${baseRight} font-semibold text-success`}>{formatVND(r.gross_pay_vnd)}</span>;
      case "tips":            return <span className={`${baseRight} text-muted-foreground`}>{r.tips_amount_vnd > 0 ? formatVND(r.tips_amount_vnd) : "—"}</span>;
      case "bhxh":            return <span className={`${baseRight} ${isFullTime ? "text-foreground" : "text-muted-foreground"}`}>{isFullTime && r.bhxh_deduction_vnd > 0 ? formatVND(r.bhxh_deduction_vnd) : "—"}</span>;
      case "bhyt":            return <span className={`${baseRight} ${isFullTime ? "text-foreground" : "text-muted-foreground"}`}>{isFullTime && r.bhyt_deduction_vnd > 0 ? formatVND(r.bhyt_deduction_vnd) : "—"}</span>;
      case "bhtn":            return <span className={`${baseRight} ${isFullTime ? "text-foreground" : "text-muted-foreground"}`}>{isFullTime && r.bhtn_deduction_vnd > 0 ? formatVND(r.bhtn_deduction_vnd) : "—"}</span>;
      case "pit":             return <span className={`${baseRight} text-muted-foreground`}>{r.pit_deduction_vnd > 0 ? formatVND(r.pit_deduction_vnd) : "—"}</span>;
      case "net_after_tax":   return <span className={`${baseRight} font-semibold text-success`}>{formatVND(r.net_pay_after_tax_vnd)}</span>;
      case "adjustments":
        return (
          <span className={`${baseRight} ${r.total_adjustments_vnd > 0 ? "text-success" : r.total_adjustments_vnd < 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {r.total_adjustments_vnd !== 0 ? formatVND(r.total_adjustments_vnd) : "—"}
          </span>
        );
      case "net_pay":         return <span className={`${baseRight} font-semibold`}>{formatVND(r.net_pay_vnd)}</span>;
      case "actions":
        if (isFullTime && ftStatementController.availability !== "legacy") {
          return (
            <FtPayrollStatementActions
              key={`${activeClubId}:${selectedMonth}:${r.dealer_id}`}
              controller={ftStatementController}
              dealerId={r.dealer_id}
              dealerName={r.full_name}
              clubName={clubs.find((club) => club.id === activeClubId)?.name ?? "CLB"}
              periodLabel={currentRange?.label ?? selectedMonth}
            />
          );
        }
        return (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => openLegacyPreview(r)}
              disabled={exporting === r.dealer_id}
              className="p-1 rounded text-muted-foreground hover:text-success disabled:opacity-50"
              title="Xem tạm tính"
            >
              {exporting === r.dealer_id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
            {canEditAdjustments && savedRecords[r.dealer_id] && (
              <button
                onClick={() => openAdjustDialog(r.dealer_id)}
                className="p-1 rounded text-muted-foreground hover:text-success"
                title="Điều chỉnh"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      default: { const _: never = col.key; return null; }
    }
  };

  const renderRow = (r: DealerPayrollRow) => (
    <TableRow key={r.dealer_id} className="hover:bg-muted/50">
      {COLUMNS.map((col) => {
        const cellClass = col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : "";
        return (
          <TableCell key={col.key} className={cellClass}>
            {renderCell(col, r)}
          </TableCell>
        );
      })}
    </TableRow>
  );

  // ── Main render ────────────────────────────────────────────────────────────

  if(pendingSaveIntent)return <div className="space-y-3 p-4">
    <p role="alert">{saving?'Đang lưu bảng lương…':'Chưa xác minh được kết quả lưu bảng lương. Không gửi thêm thao tác lưu.'}</p>
    <p className="break-all text-xs text-muted-foreground">Request: {pendingSaveIntent.requestId}</p>
    {savedReadError&&<p className="text-sm">{savedReadError}</p>}
    <Button variant="outline" disabled={saving||recoveryBusy} onClick={()=>void refreshAll()}>Kiểm tra kết quả lưu</Button>
    <Button variant="outline" disabled={saving||recoveryBusy} onClick={()=>void cancelPendingSave()}>Hủy request chưa xác minh</Button>
    <p className="text-xs text-muted-foreground">Nếu server đã lưu, hủy request chỉ trả kết quả đã lưu; không hoàn tác kỳ lương.</p>
  </div>;
  if (activeClubId && currentRange && (verifiedSavedScope !== savedReadScope || error)) {
    return <div className="space-y-3 p-4">
      <p role={savedReadError || error ? 'alert' : 'status'}>{savedReadError ?? error ?? 'Đang xác minh trạng thái kỳ lương…'}</p>
      {(savedReadError || error) && <Button variant="outline" onClick={() => void refreshAll()}>Tải lại kỳ lương</Button>}
    </div>;
  }
  return (
    <div className="min-h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter} onValueChange={(v) => setClubFilter(v)}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Chọn CLB" />
            </SelectTrigger>
            <SelectContent>
              {clubs.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => void Promise.all([refreshAll(), ftStatementController.refresh()])}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>

        {displayRows.length > 0 && (
          <Button size="sm" className="h-8 text-xs bg-success hover:bg-success text-white" onClick={doExport}>
            <Download className="w-3.5 h-3.5 mr-1" />
            Xuất Excel
          </Button>
        )}

        {savedPeriodId ? (
          <PayrollStatementTelegramDeliveryControls
            controller={payrollDeliveryController}
            clubName={clubs.find((club) => club.id === activeClubId)?.name ?? "CLB"}
            periodLabel={currentRange?.label ?? selectedMonth}
          />
        ) : null}

        {/* Save button (always in toolbar) */}
        {displayRows.length > 0 && !savedPeriodId && (
          <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Lưu bảng lương
          </Button>
        )}

        {payrollStatus === "draft" && savedPeriodId && (
          <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Lưu lại
          </Button>
        )}

        <div className="flex-1" />

        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {displayRows.length > 0 && (
            <span>{displayRows.length} dealer · {period.start} → {period.end}</span>
          )}
          {lastRefreshedAt && (
            <span className="text-muted-foreground" title="Thời điểm dữ liệu được tải lần cuối">
              · Cập nhật {lastRefreshedAt.toLocaleTimeString("vi-VN")}
            </span>
          )}
        </div>
      </div>

      {ftDealers.length > 0 && (
        <FtPayrollStatementSummary controller={ftStatementController} totalDealers={ftDealers.length} />
      )}

      <LegacyPayrollPreviewDialog
        preview={legacyPreview ? { title: legacyPreview.title, html: legacyPreview.html } : null}
        onOpenChange={(open) => { if (!open) setLegacyPreview(null); }}
        onDownload={() => { if (legacyPreview) void exportSinglePdf(legacyPreview.row); }}
      />

      {displayRows.length > 0 && (
        <>
          {/* ── Owner Finance Summary — số liệu đối chiếu, không thay đổi số lương đã lưu ── */}
          <div className="border border-border rounded-lg p-3 bg-card/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Tổng quan tài chính chủ doanh nghiệp
              </span>
              <span className="text-[10px] text-muted-foreground">
                Số liệu đối chiếu — không thay đổi số lương đã lưu
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <MetricCard
                label="Cần chuẩn bị chi trả"
                value={formatVND(finance.totalNetVnd)}
                sub={`${finance.dealerCount} dealer · ${currentRange?.label ?? ""}`}
                variant="success"
              />
              <MetricCard
                label="Trạng thái bảng lương"
                value={finance.statusLabel}
                sub={savedPeriodId ? "Đã lưu vào hệ thống" : "Chưa lưu — tạm tính, chưa chốt giờ công"}
                variant={payrollStatus === "locked" ? "default" : payrollStatus === "approved" ? "success" : "warning"}
              />
              <MetricCard
                label="FT / PT"
                value={`${formatVNDShort(finance.costByEmploymentType.ftNetVnd)} / ${formatVNDShort(finance.costByEmploymentType.ptNetVnd)}`}
                sub={`FT: ${finance.ftDealerCount} · PT: ${finance.ptDealerCount}`}
              />
              <MetricCard
                label="Tổng điều chỉnh"
                value={formatVND(finance.totalAdjustmentsVnd)}
                sub={`${finance.largeAdjustmentCount} lớn · ${finance.negativeAdjustmentCount} trừ lương`}
                variant={finance.negativeAdjustmentCount > 0 ? "warning" : "default"}
              />
              {finance.adjustmentMismatchVnd !== 0 ? (
                <MetricCard
                  label="Chênh lệch điều chỉnh"
                  value={formatVND(finance.adjustmentMismatchVnd)}
                  sub="Cần đối chiếu trước khi chi"
                  variant="danger"
                />
              ) : (
                <MetricCard
                  label="Chi phí cao nhất"
                  value={finance.topCostDealers[0]?.dealerName ?? "—"}
                  sub={finance.topCostDealers[0] ? formatVNDShort(finance.topCostDealers[0].netPayVnd) : ""}
                />
              )}
            </div>
            {finance.topCostDealers.length > 0 && (
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
                <span className="uppercase tracking-wider text-[10px]">Chi phí cao nhất:</span>
                {finance.topCostDealers.map((d, i) => (
                  <span key={d.dealerId} className="text-foreground">
                    {i + 1}. {d.dealerName} <span className="text-muted-foreground">({formatVNDShort(d.netPayVnd)})</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Owner Decision Strip — Trạng thái sẵn sàng chi trả ── */}
          <div className={`rounded-lg border px-3 py-2 flex items-start gap-2 ${
            finance.approvalRiskLevel === "blocked"
              ? "border-destructive/50 bg-destructive/40"
              : finance.approvalRiskLevel === "review"
                ? "border-warning/50 bg-warning/30"
                : "border-success/40 bg-success/20"
          }`}>
            {finance.approvalRiskLevel === "blocked" ? (
              <ShieldAlert className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            ) : finance.approvalRiskLevel === "review" ? (
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${
                finance.approvalRiskLevel === "blocked" ? "text-destructive" :
                finance.approvalRiskLevel === "review" ? "text-warning" : "text-success"
              }`}>
                Trạng thái sẵn sàng chi trả: {
                  finance.approvalRiskLevel === "blocked" ? "Không nên chi trước khi đối chiếu" :
                  finance.approvalRiskLevel === "review" ? "Cần kiểm tra trước khi duyệt" : "Sẵn sàng duyệt"
                }
              </div>
              <ul className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                {finance.riskReasons.map((reason, i) => (
                  <li key={i}>• {reason}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── Anomaly warning strip — rủi ro vận hành ── */}
          {anomalyGroups.length > 0 && (
            <div className="rounded-lg border border-border bg-card/50">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left"
                onClick={() => setAnomaliesExpanded((v) => !v)}
              >
                <span className="text-xs font-medium text-warning flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Rủi ro vận hành: {anomalyGroups.reduce((s, g) => s + g.items.length, 0)} cảnh báo
                  ({anomalyGroups.length} nhóm)
                </span>
                {anomaliesExpanded
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
              {anomaliesExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {anomalyGroups.map((group) => (
                    <div key={group.label}>
                      <div className={`text-[11px] font-medium ${group.level === "danger" ? "text-destructive" : "text-warning"}`}>
                        {group.label} ({group.items.length})
                      </div>
                      <ul className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5 ml-3">
                        {group.items.slice(0, 10).map((item, i) => (
                          <li key={`${item.dealerId}-${i}`}>
                            <span className="text-foreground">{item.dealerName}</span> — {item.detail}
                          </li>
                        ))}
                        {group.items.length > 10 && (
                          <li className="text-muted-foreground">… và {group.items.length - 10} mục khác</li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            <MetricCard label="Tổng dealer" value={displayRows.length} sub={`FT: ${ftDealers.length} · PT: ${ptDealers.length}`} />
            <MetricCard label="Tổng gross" value={formatVNDShort(totals.totalGross)} sub="Lương cơ bản" />
            <MetricCard label="Tổng OT" value={formatHours(totals.totalOt)} sub={`${highOtCount} người > 20h`} variant={totals.totalOt > 0 ? "danger" : "default"} />
            <MetricCard label="Điều chỉnh" value={formatVND(totals.totalAdjust)} sub="Tips · phạt" />
            <MetricCard label="Thực lãnh" value={formatVNDShort(totals.totalNet)} sub="Sau khấu trừ" variant="success" />
          </div>

          {/* Filter pills + search */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map((f) => {
                const count = f.key === "all"
                  ? displayRows.length
                  : f.key === "full_time"
                    ? ftDealers.length
                    : f.key === "part_time"
                      ? ptDealers.length
                      : displayRows.filter((r) => passesFilter(r, f.key, adjustments)).length;
                const isActive = activeFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${
                      isActive
                        ? f.danger
                          ? "bg-destructive border-destructive text-destructive"
                          : "bg-foreground border-foreground text-background font-medium"
                        : f.danger
                          ? "border-destructive text-destructive hover:bg-destructive"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {f.label}
                    <span className={`text-[10px] rounded-full px-1.5 ${isActive ? "bg-secondary/30" : "bg-muted"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCostRankingOn((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${
                costRankingOn
                  ? "bg-success border-success text-success"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Sắp xếp theo thực lãnh cao nhất"
            >
              <TrendingUp className="w-3 h-3" />
              Chi phí cao nhất
            </button>
            <div className="flex-1" />
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">⌕</span>
              <input
                type="text"
                placeholder="Tìm tên dealer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-48 bg-card border border-border rounded-md pl-7 pr-2 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-success"
              />
            </div>
          </div>

          {/* Empty state when both sections filtered out */}
          {filteredFt.length === 0 && filteredPt.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              Không tìm thấy dealer phù hợp
              {searchQuery && <span className="block text-xs mt-1">Từ khoá: "{searchQuery}"</span>}
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-center text-destructive text-sm">
          {error}
        </div>
      )}

      {/* No data */}
      {!loading && !error && displayRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Calculator className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Chưa có dữ liệu lương cho tháng này</p>
          <p className="text-xs mt-1">Chọn tháng và CLB, rồi nhấn "Làm mới"</p>
        </div>
      )}

      {/* Payroll tables */}
      {!loading && !error && displayRows.length > 0 && (
        <ScrollArea className="flex-1">
          {/* FT Section */}
          {filteredFt.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-success text-white text-[10px]">Full-time</Badge>
                <span className="text-xs text-muted-foreground">{filteredFt.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    {COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-muted-foreground text-xs ${col.key === "full_name" ? "" : "text-right"} ${col.key === "employment_type" ? "w-12 text-center" : ""} ${col.key === "total_shifts" ? "w-10 text-center" : ""} ${col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ""}`}
                      >
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFt.map(renderRow)}
                  <TableRow className="border-t-2 border-success/30 bg-success/5">
                    <TableCell className="font-bold text-success text-xs" colSpan={3}>FT subtotal</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(filteredFt.reduce((s, d) => s + d.total_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(filteredFt.reduce((s, d) => s + d.regular_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-destructive">
                      {(() => { const total = filteredFt.reduce((s, d) => s + d.ot_hours, 0); return total > 0 ? formatHours(total) : "—"; })()}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatVND(filteredFt.reduce((s, d) => s + d.regular_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-destructive">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.ot_pay_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-success">{formatVND(filteredFt.reduce((s, d) => s + d.gross_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.tips_amount_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.bhxh_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.bhyt_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.bhtn_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.pit_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-success">{formatVND(filteredFt.reduce((s, d) => s + d.net_pay_after_tax_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = filteredFt.reduce((s, d) => s + d.total_adjustments_vnd, 0); return t !== 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* PT Section */}
          {filteredPt.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-warning text-white text-[10px]">Part-time</Badge>
                <span className="text-xs text-muted-foreground">{filteredPt.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    {COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-muted-foreground text-xs ${col.key === "full_name" ? "" : "text-right"} ${col.key === "employment_type" ? "w-12 text-center" : ""} ${col.key === "total_shifts" ? "w-10 text-center" : ""} ${col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ""}`}
                      >
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPt.map(renderRow)}
                  <TableRow className="border-t-2 border-warning/30 bg-warning/5">
                    <TableCell className="font-bold text-warning text-xs" colSpan={3}>PT subtotal</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(filteredPt.reduce((s, d) => s + d.total_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(filteredPt.reduce((s, d) => s + d.regular_hours, 0))}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatVND(filteredPt.reduce((s, d) => s + d.regular_pay_vnd, 0))}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold text-success">{formatVND(filteredPt.reduce((s, d) => s + d.gross_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = filteredPt.reduce((s, d) => s + d.tips_amount_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-muted-foreground">
                      {(() => { const t = filteredPt.reduce((s, d) => s + d.pit_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-success">{formatVND(filteredPt.reduce((s, d) => s + d.net_pay_after_tax_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = filteredPt.reduce((s, d) => s + d.total_adjustments_vnd, 0); return t !== 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Grand Total */}
          <div className="mt-2 p-4 rounded-lg bg-card border border-success/30">
            <div className="grid grid-cols-4 md:grid-cols-10 gap-3 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Dealer</div>
                <div className="text-lg font-bold text-white">{displayRows.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Ca</div>
                <div className="text-lg font-bold text-white">{totals.totalShifts}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tổng giờ</div>
                <div className="text-lg font-bold text-white">{formatHours(totals.totalHours)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Lương cơ bản</div>
                <div className="text-base font-semibold text-foreground">{formatVND(totals.totalBase)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">OT</div>
                <div className="text-base font-semibold text-destructive">{totals.totalOt > 0 ? formatVND(totals.totalOt) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Gộp</div>
                <div className="text-base font-semibold text-success">{formatVND(totals.totalGross)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tips</div>
                <div className="text-base font-semibold text-foreground">{totals.totalTips > 0 ? formatVND(totals.totalTips) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">BHXH</div>
                <div className="text-base font-semibold text-foreground">{totals.totalBhxh > 0 ? formatVND(totals.totalBhxh) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Sau thuế</div>
                <div className="text-base font-semibold text-success">{formatVND(totals.totalNetAfterTax)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Thực lãnh</div>
                <div className="text-lg font-bold text-success">{formatVND(totals.totalNet)}</div>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}

      {/* Approval footer */}
      {!loading && !error && displayRows.length > 0 && savedPeriodId && (
        <div className="border border-border rounded-lg p-3 bg-card/50 mt-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            {/* Left: status + history */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  payrollStatus === "approved" ? "bg-success" :
                  payrollStatus === "locked" ? "bg-muted-foreground" :
                  payrollStatus === "rejected" ? "bg-destructive" :
                  payrollStatus === "submitted" ? "bg-warning" :
                  payrollStatus === "payment_prepared" ? "bg-warning" :
                  payrollStatus === "paid" ? "bg-success" :
                  payrollStatus === "reconciled" ? "bg-success" : "bg-muted-foreground"
                }`} />
                <span className="text-sm font-medium text-foreground">
                  {payrollStatus === "draft" ? "Bản nháp" :
                   payrollStatus === "submitted" ? "Chờ duyệt" :
                   payrollStatus === "approved" ? "Đã duyệt" :
                   payrollStatus === "rejected" ? "Bị từ chối" :
                   payrollStatus === "locked" ? "Đã khoá sổ" :
                   payrollStatus === "payment_prepared" ? "Chờ chi trả" :
                   payrollStatus === "paid" ? "Đã chi trả" :
                   payrollStatus === "reconciled" ? "Đã đối soát" : "—"}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {submittedAtMeta && (
                  <div>
                    Gửi duyệt bởi: <span className="text-muted-foreground">{submittedByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(submittedAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {approvedAtMeta && (
                  <div>
                    Phê duyệt bởi: <span className="text-muted-foreground">{approvedByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(approvedAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {lockedAtMeta && (
                  <div>
                    Khoá sổ bởi: <span className="text-muted-foreground">{lockedByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(lockedAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {paymentPreparedAtMeta && (
                  <div>
                    Chuẩn bị chi bởi: <span className="text-muted-foreground">{paymentPreparedByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(paymentPreparedAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {paidAtMeta && (
                  <div className="text-success/80">
                    Chi trả bởi: <span className="text-success">{paidByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(paidAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {reconciledAtMeta && (
                  <div className="text-success/80">
                    Đối soát bởi: <span className="text-success">{reconciledByMeta?.slice(0, 8) ?? "—"}</span>
                    {" · "}{new Date(reconciledAtMeta).toLocaleString("vi-VN")}
                  </div>
                )}
                {payrollStatus === "rejected" && (
                  <div className="text-destructive">
                    Từ chối bởi: {rejectedBy?.slice(0, 8) ?? "—"}
                    {rejectedAt ? ` · ${new Date(rejectedAt).toLocaleString("vi-VN")}` : ""}
                    {storedRejectionReason ? ` — Lý do: ${storedRejectionReason}` : ""}
                  </div>
                )}
                <div className="text-muted-foreground">
                  Người xem hiện tại: {user?.id?.slice(0, 8) ?? "—"}
                  {lastRefreshedAt ? ` · Dữ liệu cập nhật ${lastRefreshedAt.toLocaleTimeString("vi-VN")}` : ""}
                </div>
              </div>
              <button
                onClick={openAuditLog}
                className="text-[11px] text-success hover:text-success mt-1 w-fit"
              >
                Xem audit log →
              </button>

              {paymentRecord && (
                <div className="mt-2 rounded-md border border-border bg-card/60 px-3 py-2 text-[11px] space-y-0.5">
                  <div className="text-foreground font-medium">Hồ sơ chi trả</div>
                  <div className="text-muted-foreground">
                    Số tiền chi: <span className="text-success">{formatVND(paymentRecord.total_net_vnd)}</span>
                    {" · "}{paymentRecord.dealer_count} dealer
                  </div>
                  <div className="text-muted-foreground">
                    Hình thức: <span className="text-muted-foreground">{paymentRecord.payment_method ?? "—"}</span>
                    {paymentRecord.payment_ref ? <> · Mã GD: <span className="text-muted-foreground">{paymentRecord.payment_ref}</span></> : null}
                  </div>
                  {paymentRecord.reconciliation_ref && (
                    <div className="text-muted-foreground">Mã đối soát: <span className="text-muted-foreground">{paymentRecord.reconciliation_ref}</span></div>
                  )}
                </div>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex flex-col gap-2 min-w-[240px]">
              {payrollStatus === "draft" && (
                <button
                  onClick={handleSubmit}
                  className="h-8 px-3 rounded-md bg-warning hover:bg-warning text-white text-xs font-medium"
                >
                  Gửi duyệt
                </button>
              )}
              {payrollStatus === "submitted" && (
                hideApprovalActions ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                    Đã gửi — chờ chủ CLB duyệt bảng lương.
                  </div>
                ) : (
                <>
                  <textarea
                    placeholder="Nhập lý do từ chối..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="h-14 text-xs bg-card border border-border rounded-md p-2 text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:border-success"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(rejectionReason)}
                      className="flex-1 h-8 rounded-md border border-destructive text-destructive hover:bg-destructive text-xs font-medium"
                    >
                      Từ chối
                    </button>
                    <button
                      onClick={handleApprove}
                      className="flex-[2] h-8 rounded-md bg-success hover:bg-success text-white text-xs font-medium"
                    >
                      Duyệt bảng lương
                    </button>
                  </div>
                </>
                )
              )}
              {payrollStatus === "approved" && (
                hideApprovalActions ? (
                  <div className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                    Đã duyệt — chờ chủ CLB khoá sổ.
                  </div>
                ) : (
                <button
                  onClick={handleLock}
                  className="h-8 px-3 rounded-md bg-destructive hover:bg-destructive text-white text-xs font-medium"
                >
                  Khoá sổ
                </button>
                )
              )}
              {payrollStatus === "rejected" && (
                <button
                  onClick={handleResubmit}
                  className="h-8 px-3 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium"
                >
                  Sửa lại và gửi duyệt
                </button>
              )}
              {payrollStatus === "locked" && (
                <>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="h-8 text-xs bg-card border border-border rounded-md px-2 text-white focus:outline-none focus:border-warning"
                  >
                    <option value="bank_transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="e_wallet">Ví điện tử</option>
                    <option value="other">Khác</option>
                  </select>
                  <button
                    onClick={handlePreparePayment}
                    disabled={paymentBusy}
                    className="h-8 px-3 rounded-md bg-warning hover:bg-warning disabled:opacity-50 text-white text-xs font-medium"
                  >
                    Chuẩn bị chi trả
                  </button>
                </>
              )}
              {payrollStatus === "payment_prepared" && (
                <>
                  <input
                    type="text"
                    placeholder="Mã/tham chiếu thanh toán..."
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="h-8 text-xs bg-card border border-border rounded-md px-2 text-white placeholder:text-muted-foreground focus:outline-none focus:border-success"
                  />
                  <button
                    onClick={handleMarkPaid}
                    disabled={paymentBusy}
                    className="h-8 px-3 rounded-md bg-success hover:bg-success disabled:opacity-50 text-white text-xs font-medium"
                  >
                    Xác nhận đã chi trả
                  </button>
                </>
              )}
              {payrollStatus === "paid" && (
                <>
                  <input
                    type="text"
                    placeholder="Mã đối soát (tuỳ chọn)..."
                    value={reconRef}
                    onChange={(e) => setReconRef(e.target.value)}
                    className="h-8 text-xs bg-card border border-border rounded-md px-2 text-white placeholder:text-muted-foreground focus:outline-none focus:border-success"
                  />
                  <button
                    onClick={handleReconcile}
                    disabled={paymentBusy}
                    className="h-8 px-3 rounded-md border border-success text-success hover:bg-success disabled:opacity-50 text-xs font-medium"
                  >
                    Đối soát
                  </button>
                  <p className="text-[10px] text-muted-foreground">Người đối soát phải khác người chi trả.</p>
                </>
              )}
              {payrollStatus === "reconciled" && (
                <div className="text-[11px] text-success border border-success/40 rounded-md px-3 py-2 text-center">
                  ✓ Đã hoàn tất chi trả &amp; đối soát
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audit log dialog */}
      <Dialog open={auditLogOpen} onOpenChange={setAuditLogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Lịch sử thay đổi</DialogTitle>
            <DialogDescription>
              Các thay đổi trên bảng lương này
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto space-y-2">
            {auditLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Chưa có lịch sử</p>
            ) : (
              auditLog.map((entry) => {
                const diffs = auditFieldDiffs(entry.old_values, entry.new_values);
                return (
                  <div key={entry.id} className="text-xs border border-border rounded p-2 bg-card/50">
                    <div className="flex justify-between text-muted-foreground">
                      <span className="font-medium">{entry.action}</span>
                      <span>{new Date(entry.changed_at).toLocaleString("vi-VN")}</span>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {entry.table_name} · {entry.changed_by?.slice(0, 8) ?? "—"}
                    </div>
                    {diffs.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
                        {diffs.map((d) => (
                          <div key={d.field} className="flex items-center gap-1.5 font-mono text-[10px]">
                            <span className="text-muted-foreground">{d.field}:</span>
                            <span className="text-destructive/80 line-through">{d.from}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-success">{d.to}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditLogOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment Dialog */}
      <Dialog open={adjDialogOpen} onOpenChange={setAdjDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm điều chỉnh</DialogTitle>
            <DialogDescription>
              Thêm thưởng/phạt/khấu trừ cho{" "}
              {displayRows.find((r) => r.dealer_id === adjustingDealerId)?.full_name ?? "dealer"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Loại điều chỉnh</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {(Object.entries(ADJ_TYPE_LABELS) as [AdjType, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setAdjType(key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      adjType === key
                        ? "bg-success text-white border-success"
                        : `bg-card text-muted-foreground border-border hover:text-white hover:bg-secondary`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Số tiền (VND)</Label>
              <Input
                type="number"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="VD: 500000"
                className="bg-card border-border text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Lý do</Label>
              <Input
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder={ADJ_TYPE_LABELS[adjType]}
                className="bg-card border-border text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjDialogOpen(false)}>Huỷ</Button>
            <Button className="bg-success hover:bg-success text-white" onClick={handleAddAdjustment} disabled={adjSaving || !adjAmount}>
              {adjSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Thêm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
