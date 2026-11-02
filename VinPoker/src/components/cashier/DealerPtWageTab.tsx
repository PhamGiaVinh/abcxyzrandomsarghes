import { startLiveReportRefresh } from "@/lib/liveReportRefresh";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import {
  getPtWageAccrualPresentation,
  projectPtWageBalanceVnd,
} from "@/lib/dealerPtWagePresentation";
import {
  buildDealerPtWageGlobalPolicyRequest,
  buildDealerPtWagePolicyRequest,
  PT_WAGE_POLICY_REASON_LIMIT,
} from "@/lib/dealerPtWagePolicyControl";
import DealerPtWageGlobalPolicyControl from "@/components/cashier/DealerPtWageGlobalPolicyControl";
import { useAuth } from "@/hooks/useAuth";
import { PtStatementControl } from "./PtStatementControl";
import { RefreshCw, Loader2, Clock, Coins, Wallet, Info, ShieldCheck, ShieldOff } from "lucide-react";

/**
 * Salary-C — Operator "Theo giờ · Part-time" sub-tab. Live accruing balances per PT dealer
 * + full-payment-then-reset via the Salary-B1 RPCs (get_club_pt_wages / pay_part_time_balance).
 *
 * Generated client types can lag the controlled database contract, so the RPCs are called
 * through the untyped client (same pattern as useDealerLink / useDealerPayroll's
 * save_payroll_period). This tab is dark for routine operators until
 * FEATURES.salaryTabV2 is ON; owners/admins can access it first for controlled
 * UAT. The server recomputes + resets payments. Policy changes are an
 * owner/admin intent only; the RPC rechecks authorization and writes audit.
 */

type ClubRow = { id: string; name: string };

interface PtDealer {
  dealer_id: string;
  full_name: string;
  hourly_rate_vnd: number;
  accrued_minutes: number;
  balance_vnd: number;
  last_reset_at: string | null;
  current_shift_open: boolean;
  current_shift_start: string | null;
  accrual_mode?: string | null;
  standby_accrual_enabled?: boolean;
  current_shift_cap_reached?: boolean;
  live_accrual_active?: boolean;
  last_payment: { amount_vnd: number; paid_at: string } | null;
}

interface PtWageResponse {
  dealers?: PtDealer[];
  accrual_mode?: string | null;
  standby_accrual_enabled?: boolean;
  policy_effective_from?: string | null;
}

interface PtWageGlobalPolicyResponse {
  future_club_enabled?: boolean;
}

interface Props {
  clubIds: string[];
  clubs: ClubRow[];
  readOnly?: boolean;
  finalizeStatements?: boolean;
  ownerClubIds?: string[];
}

type RpcError = { message?: string } | null;
type RpcResponse = { data: unknown; error: RpcError };

const db = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResponse>;
};

function rpcErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function fmtHMS(ms: number): string {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DealerPtWageTab({ clubIds, clubs, readOnly = false, finalizeStatements = false, ownerClubIds }: Props) {
  const { isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [clubFilter, setClubFilter] = useState<string>(clubIds[0] ?? "");
  const activeClubId = clubFilter || clubIds[0] || "";

  const [dealers, setDealers] = useState<PtDealer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clubAccrualMode, setClubAccrualMode] = useState<string | null>(null);
  const [standbyAccrualEnabled, setStandbyAccrualEnabled] = useState(false);
  const [globalPolicyReady, setGlobalPolicyReady] = useState(false);
  const [globalFutureClubEnabled, setGlobalFutureClubEnabled] = useState(false);
  const [globalPolicyLoading, setGlobalPolicyLoading] = useState(false);
  const fetchedAtRef = useRef<number>(Date.now());
  const snapshotClubRef = useRef<string | null>(null);
  const fetchSequenceRef = useRef(0);
  const globalPolicySequenceRef = useRef(0);
  const activeClubIdRef = useRef(activeClubId);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [paidSession, setPaidSession] = useState(0);

  // pay dialog
  const [payOpen, setPayOpen] = useState(false);
  const [payDealer, setPayDealer] = useState<PtDealer | null>(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);

  // Policy changes are never bulk-applied from the client. Each selected club
  // gets a separately authorized RPC call and audit reason.
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyReason, setPolicyReason] = useState("");
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const policySubmitRef = useRef(false);
  const canFinalizeForClub = isAdmin || isClubAdmin || (ownerClubIds ? ownerClubIds.includes(activeClubId) : isClubOwner);
  const canManagePolicy = !readOnly && canFinalizeForClub;
  const activeClub = clubs.find((club) => club.id === activeClubId) ?? null;

  useEffect(() => { activeClubIdRef.current = activeClubId; }, [activeClubId]);

  const fetchData = useCallback(async () => {
    if (!activeClubId) return;
    const sequence = ++fetchSequenceRef.current;
    if (snapshotClubRef.current !== activeClubId) setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await observeTrackerContextRead(db.rpc("get_club_pt_wages", { p_club_id: activeClubId }));
      if (rpcError) throw rpcError;
      const response = data as PtWageResponse;
      if (!response || typeof response !== 'object' || Array.isArray(response) || !Array.isArray(response.dealers)
        || response.dealers.some(d => !d || typeof d !== 'object' || Array.isArray(d)
          || typeof d.dealer_id !== 'string' || !d.dealer_id || typeof d.full_name !== 'string'
          || [d.hourly_rate_vnd,d.accrued_minutes,d.balance_vnd].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)
          || typeof d.current_shift_open !== 'boolean')) {
        throw new Error('Không xác minh được dữ liệu lương part-time.');
      }
      if (sequence !== fetchSequenceRef.current) return;
      snapshotClubRef.current = activeClubId;
      setDealers(response.dealers);
      setClubAccrualMode(response.accrual_mode ?? null);
      setStandbyAccrualEnabled(response.standby_accrual_enabled === true);
      fetchedAtRef.current = Date.now();
    } catch (e: unknown) {
      if (sequence !== fetchSequenceRef.current) return;
      snapshotClubRef.current = null;
      setError(rpcErrorMessage(e, "Lỗi tải lương part-time"));
      setDealers([]);
      setClubAccrualMode(null);
      setStandbyAccrualEnabled(false);
    } finally {
      if (sequence === fetchSequenceRef.current) setLoading(false);
    }
  }, [activeClubId]);

  const fetchGlobalPolicy = useCallback(async () => {
    const sequence = ++globalPolicySequenceRef.current;
    if (!isAdmin) {
      setGlobalPolicyReady(false);
      setGlobalFutureClubEnabled(false);
      setGlobalPolicyLoading(false);
      return;
    }

    setGlobalPolicyLoading(true);
    try {
      const { data, error: rpcError } = await db.rpc("get_dealer_pt_wage_global_accrual_policy");
      if (rpcError) throw rpcError;
      const response = (data ?? {}) as PtWageGlobalPolicyResponse;
      if (sequence !== globalPolicySequenceRef.current) return;
      if (typeof response.future_club_enabled !== "boolean") throw new Error("Global policy response is incomplete");
      setGlobalFutureClubEnabled(response.future_club_enabled);
      setGlobalPolicyReady(true);
    } catch {
      if (sequence !== globalPolicySequenceRef.current) return;
      // Fail closed: a missing migration or privileged-read failure never
      // exposes a global money-policy action to the browser.
      setGlobalPolicyReady(false);
      setGlobalFutureClubEnabled(false);
    } finally {
      if (sequence === globalPolicySequenceRef.current) setGlobalPolicyLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    const stop = startLiveReportRefresh(fetchData);
    return () => { fetchSequenceRef.current += 1; stop(); };
  }, [fetchData]);
  useEffect(() => { fetchGlobalPolicy(); }, [fetchGlobalPolicy]);
  // Tick the bounded display estimate; server refresh has its own lifecycle.
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => { clearInterval(tick); };
  }, [fetchData]);

  // The server owns the balance. This only presents a bounded estimate until the next refresh.
  const liveBalance = (d: PtDealer): number => {
    const accrual = getPtWageAccrualPresentation(d);
    return projectPtWageBalanceVnd(
      d.balance_vnd,
      d.hourly_rate_vnd,
      nowMs - fetchedAtRef.current,
      accrual.isLiveAccruing,
    );
  };

  const totalUnpaid = dealers.reduce((s, d) => s + liveBalance(d), 0);
  const workingCount = dealers.filter((d) => d.current_shift_open).length;

  const openPay = (d: PtDealer) => {
    setPayDealer(d);
    setPayMethod("cash");
    setPayRef("");
    setPayOpen(true);
  };

  const handleClubChange = (clubId: string) => {
    fetchSequenceRef.current += 1;
    setClubFilter(clubId);
    setPolicyOpen(false);
    setPolicyReason("");
    setPolicyAcknowledged(false);
  };

  const openPolicyDialog = () => {
    setPolicyReason("");
    setPolicyAcknowledged(false);
    setPolicyOpen(true);
  };

  const handlePolicySave = useCallback(async () => {
    const targetClubId = activeClubId;
    const nextEnabled = !standbyAccrualEnabled;

    if (policySubmitRef.current) return;
    if (!policyAcknowledged) {
      toast.error("Cần xác nhận đã hiểu tác động trước khi đổi chính sách.");
      return;
    }

    policySubmitRef.current = true;
    setSavingPolicy(true);
    try {
      const request = buildDealerPtWagePolicyRequest(targetClubId, nextEnabled, policyReason);
      const { error: rpcError } = await db.rpc("set_dealer_pt_wage_accrual_policy", { ...request });
      if (rpcError) throw rpcError;

      setPolicyOpen(false);
      setPolicyReason("");
      setPolicyAcknowledged(false);
      toast.success(nextEnabled ? "Đã bật tích lũy liên tục cho CLB đã chọn." : "Đã trở về giới hạn 24 giờ cho CLB đã chọn.");
      if (targetClubId === activeClubIdRef.current) await fetchData();
    } catch (e: unknown) {
      toast.error(rpcErrorMessage(e, "Không thể cập nhật chính sách lương."));
    } finally {
      policySubmitRef.current = false;
      setSavingPolicy(false);
    }
  }, [activeClubId, fetchData, policyAcknowledged, policyReason, standbyAccrualEnabled]);

  const handleGlobalPolicySave = useCallback(async (nextEnabled: boolean, reason: string) => {
    try {
      const request = buildDealerPtWageGlobalPolicyRequest(nextEnabled, reason);
      const { error: rpcError } = await db.rpc("set_all_approved_dealer_pt_wage_accrual", { ...request });
      if (rpcError) throw rpcError;

      toast.success(nextEnabled
        ? "Đã gửi chính sách tích luỹ mới cho toàn bộ CLB đã duyệt."
        : "Đã dừng chính sách tích luỹ liên tục cho toàn bộ CLB đã duyệt.");
      await Promise.all([fetchData(), fetchGlobalPolicy()]);
    } catch (e: unknown) {
      toast.error(rpcErrorMessage(e, "Không thể cập nhật chính sách lương toàn hệ thống."));
      throw e;
    }
  }, [fetchData, fetchGlobalPolicy]);

  const handlePay = useCallback(async () => {
    if (!payDealer || readOnly || finalizeStatements) return;
    setPaying(true);
    try {
      const key =
        (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.floor((nowMs % 1) * 1e9)}-${payDealer.dealer_id}`;
      const { data, error: rpcError } = await db.rpc("pay_part_time_balance", {
        p_dealer_id: payDealer.dealer_id,
        p_payment_method: payMethod,
        p_payment_reference: payRef.trim() || null,
        p_idempotency_key: key,
        p_note: null,
      });
      if (rpcError) throw rpcError;
      const result = (data ?? {}) as { amount_vnd?: number; idempotent?: boolean };
      const amt = Number(result.amount_vnd ?? 0);
      if (!result.idempotent) setPaidSession((p) => p + amt);
      toast.success(`Đã thanh toán ${formatVND(amt)} cho ${payDealer.full_name}`);
      setPayOpen(false);
      await fetchData();
    } catch (e: unknown) {
      toast.error(rpcErrorMessage(e, "Lỗi thanh toán"));
    } finally {
      setPaying(false);
    }
  }, [payDealer, payMethod, payRef, nowMs, fetchData, readOnly, finalizeStatements]);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter} onValueChange={handleClubChange}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
            <SelectContent>
              {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
        <div className="flex-1" />
        {canManagePolicy && activeClubId && (
          <Button
            size="sm"
            variant={standbyAccrualEnabled ? "outline" : "default"}
            className="h-8 text-xs"
            onClick={openPolicyDialog}
            disabled={loading || savingPolicy}
          >
            {standbyAccrualEnabled
              ? <ShieldOff className="w-3.5 h-3.5 mr-1" />
              : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
            {standbyAccrualEnabled ? "Dừng tích lũy liên tục" : "Bật tích lũy liên tục"}
          </Button>
        )}
        {!readOnly && isAdmin && globalPolicyReady && (
          <DealerPtWageGlobalPolicyControl
            futureClubEnabled={globalFutureClubEnabled}
            loading={loading || globalPolicyLoading || savingPolicy}
            onApply={handleGlobalPolicySave}
          />
        )}
        <div className="text-[11px] text-zinc-500">
          {clubAccrualMode === "continuous_standby"
            ? "Tính cả thời gian chờ trong pool · phiếu đã chốt hiển thị riêng"
            : "Lương theo giờ · số dư chưa chốt và phiếu đã chốt"}
        </div>
      </div>

      {/* Summary */}
      {!loading && !error && snapshotClubRef.current === activeClubId && <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">PT đang làm</div>
          <div className="text-base font-semibold text-emerald-400">{workingCount}/{dealers.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Tổng tạm tính chưa chốt</div>
          <div className="text-base font-semibold text-amber-400 font-mono">{formatVND(totalUnpaid)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Đã trả (phiên này)</div>
          <div className="text-base font-semibold text-emerald-400 font-mono">{formatVND(paidSession)}</div>
        </div>
      </div>}

      {loading && <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center text-red-400 text-sm">{error}</div>
      )}

      {!loading && !error && snapshotClubRef.current === activeClubId && dealers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Coins className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Chưa có dealer part-time đang hoạt động</p>
        </div>
      )}

      {/* Cards */}
      {!loading && !error && snapshotClubRef.current === activeClubId && dealers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {dealers.map((d) => {
            const bal = liveBalance(d);
            const accrual = getPtWageAccrualPresentation(d);
            return (
              <div key={d.dealer_id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-white">{d.full_name}</div>
                  {d.current_shift_open ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 border border-emerald-500/40 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Đang làm
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">Nghỉ</span>
                  )}
                </div>

                <div className="flex items-end justify-between gap-3 mt-3">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tạm tính chưa chốt</div>
                    <div className={`text-2xl font-semibold font-mono ${d.current_shift_open ? "text-emerald-400" : "text-white"}`}>
                      {formatVND(bal)}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-zinc-400">
                    {d.current_shift_open && d.current_shift_start && (
                      <div><Clock className="w-3 h-3 inline -mt-0.5 mr-1" /><span className="font-mono">{fmtHMS(nowMs - new Date(d.current_shift_start).getTime())}</span></div>
                    )}
                    <div className="font-mono">{Math.round(d.hourly_rate_vnd / 1000)}K/h</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mt-3">
                  <div className="text-[11px] text-zinc-500 min-w-0">
                    <div className="flex items-center gap-1">
                      <Info className="w-3 h-3 shrink-0" />
                      <span>{accrual.label}</span>
                    </div>
                    <div className="mt-1">
                      {d.last_payment
                        ? <>Lần trả gần nhất: {new Date(d.last_payment.paid_at).toLocaleDateString("vi-VN")} · <span className="font-mono">{formatVND(d.last_payment.amount_vnd)}</span></>
                        : "Chưa có lịch sử thanh toán"}
                    </div>
                  </div>
                  {!readOnly && !finalizeStatements && (
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                      onClick={() => openPay(d)}
                      disabled={bal < 1}
                    >
                      <Wallet className="w-3.5 h-3.5 mr-1" /> Thanh toán
                    </Button>
                  )}
                </div>
                {finalizeStatements && !readOnly && <PtStatementControl
                  clubId={activeClubId} dealerId={d.dealer_id} dealerName={d.full_name} onFinalized={() => { void fetchData(); }}
                  canFinalize={canFinalizeForClub}
                />}
              </div>
            );
          })}
        </div>
      )}

      {/* Pay confirm */}
      <Dialog open={!readOnly && !finalizeStatements && payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thanh toán lương part-time</DialogTitle>
            <DialogDescription>
              Trả toàn bộ số dư đang tích luỹ cho {payDealer?.full_name ?? "dealer"}. Hệ thống tính lại số tiền ở thời điểm xác nhận, ghi nhận và reset số dư về 0.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Số dư hiện tại (≈)</div>
              <div className="text-2xl font-semibold font-mono text-emerald-400 mt-1">
                {payDealer ? formatVND(liveBalance(payDealer)) : "—"}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Số tiền cuối cùng do máy chủ tính tại thời điểm xác nhận</div>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Hình thức</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Tiền mặt</SelectItem>
                  <SelectItem value="bank_transfer">Chuyển khoản</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Mã tham chiếu (tuỳ chọn)</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="VD: phiếu chi #123" className="bg-zinc-900 border-zinc-700 text-white" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>Huỷ</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handlePay} disabled={paying}>
              {paying ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wallet className="w-4 h-4 mr-1" />}
              Xác nhận &amp; reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{standbyAccrualEnabled ? "Dừng tích lũy lương liên tục" : "Bật tích lũy lương liên tục"}</DialogTitle>
            <DialogDescription>
              {standbyAccrualEnabled
                ? `CLB ${activeClub?.name ?? "đã chọn"} sẽ quay về giới hạn 24 giờ cho các lần đọc lương sau này. Phiếu lương đã trả không thay đổi.`
                : `CLB ${activeClub?.name ?? "đã chọn"} sẽ tính thời gian từ mốc máy chủ xác nhận trở đi, gồm thời gian chờ pool. Phiếu lương đã trả và thời gian chưa trả trước mốc đó không bị viết lại.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pt-wage-policy-reason" className="text-xs text-zinc-400">Lý do thay đổi</Label>
              <Textarea
                id="pt-wage-policy-reason"
                value={policyReason}
                onChange={(event) => setPolicyReason(event.target.value)}
                maxLength={PT_WAGE_POLICY_REASON_LIMIT}
                placeholder="Ghi lý do để lưu audit"
                className="mt-1 bg-zinc-900 border-zinc-700 text-white"
              />
              <div className="mt-1 text-right text-[11px] text-zinc-500">{policyReason.length}/{PT_WAGE_POLICY_REASON_LIMIT}</div>
            </div>
            <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
              <Checkbox
                checked={policyAcknowledged}
                onCheckedChange={(checked) => setPolicyAcknowledged(checked === true)}
                className="mt-0.5"
              />
              <span>
                {standbyAccrualEnabled
                  ? "Tôi hiểu thay đổi này không sửa phiếu lương đã trả."
                  : "Tôi hiểu máy chủ chỉ tính giờ từ mốc kích hoạt mới, không tính ngược giờ cũ."}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyOpen(false)} disabled={savingPolicy}>Huỷ</Button>
            <Button
              className={standbyAccrualEnabled ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"}
              onClick={handlePolicySave}
              disabled={savingPolicy || !policyAcknowledged || !policyReason.trim()}
            >
              {savingPolicy && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {standbyAccrualEnabled ? "Xác nhận dừng" : "Xác nhận bật"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
