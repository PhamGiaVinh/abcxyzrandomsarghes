/**
 * ChangePredictedDealerModal — "Đổi dự kiến" (Dealer Swing, Phase 4).
 * Opened from the per-table "Đổi dự kiến" action-row button on each table card.
 * NOT the wrong-table correction flow ("Sửa nhầm bàn" — future, via
 * reconcile_dealer_room_state): this modal never hands off the current dealer;
 * server intent may update the assignment's next-dealer reservation.
 *
 * Planning-only action: changes WHICH dealer is planned/locked as the next
 * replacement for one table. It never executes the handoff, never releases
 * the current table dealer, and never moves the planned swing time.
 *
 * Honest semantics: confirming LOCKS the choice (predicted → announced/CHỐT)
 * so the rotation planner cannot supersede the floor's decision on the next
 * tick — hence "Đổi & CHỐT", not just "đổi dự kiến".
 *
 * Server authority: candidate grouping below is advisory display only
 * (src/lib/rotationEligibility.ts). The operator_plan_next_dealer_v1 RPC
 * re-validates everything; its outcome is final.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, RefreshCw, Clock } from "lucide-react";
import type { DealerAttendance } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";
import { classifyCandidate, type CandidateGroup } from "@/lib/rotationEligibility";
import { clearDealerNextIntent, dealerNextIntentArgs, dealerNextIntentKey, persistDealerNextIntent,
  readDealerNextIntent, type DealerNextIntent, type DealerNextScope } from "@/lib/dealerNextIntent";

function hhmm(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface CandidateRow {
  attendance: DealerAttendance;
  group: CandidateGroup;
  eligibleAtMs: number | null;
  selectable: boolean;
  reason: string;
}

export interface ChangePredictedDealerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  context: DealerNextScope & { version: number; swingDueAt: string | null };
  /** Live slot-0 schedule row (predicted or announced). */
  slot0: RotationScheduleRow | null | undefined;
  /** Attendance id of the dealer currently dealing this table (excluded from candidates). */
  currentTableAttendanceId: string | null;
  dealers: DealerAttendance[];
  /** attendance_id → table name, for "đang assigned Bàn N" reasons. */
  assignedTableNameByAttendanceId: Record<string, string>;
  restMinutes: number;
  onChanged: () => void;
}

export default function ChangePredictedDealerModal({
  open, onOpenChange, tableName, context, slot0, currentTableAttendanceId,
  dealers, assignedTableNameByAttendanceId, restMinutes, onChanged,
}: ChangePredictedDealerModalProps) {
  const [pendingId, setPendingId] = useState<string | null>(null); // selected, awaiting confirm
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<DealerNextIntent | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [notRecorded, setNotRecorded] = useState(false);
  const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const scopeKey = dealerNextIntentKey(context);
  const activeScope = useRef(scopeKey); activeScope.current = scopeKey;
  useEffect(() => {
    try { setUnresolved(readDealerNextIntent(sessionStorage, context)); setIntentError(null); }
    catch { setIntentError("Không đọc được yêu cầu trước. Chưa thể tạo yêu cầu mới."); }
    setNotRecorded(false); setPendingId(null);
  }, [scopeKey]);

  const plannedReliefAt = slot0?.planned_relief_at ?? context.swingDueAt;
  const plannedReliefMs = plannedReliefAt ? new Date(plannedReliefAt).getTime() : null;
  const oldName = slot0?.in_dealer_name ?? "dealer hiện dự kiến";
  const currentDealerName =
    dealers.find((d) => d.id === currentTableAttendanceId)?.dealers?.full_name ?? "—";
  const predictedName = slot0?.in_dealer_name ?? (slot0?.is_shortage ? "Thiếu dealer" : "—");

  const candidates: CandidateRow[] = useMemo(() => {
    if (plannedReliefMs == null || !Number.isFinite(plannedReliefMs)) return [];
    const nowMs = Date.now();
    const rows: CandidateRow[] = [];
    for (const d of dealers) {
      if (d.id === currentTableAttendanceId) continue; // dealer currently ON this table
      if (slot0?.status === "announced" && d.id === slot0.in_attendance_id) continue;
      const c = classifyCandidate({
        lastReleasedAt: d.last_released_at,
        currentState: d.current_state,
        attendanceStatus: d.status,
        plannedReliefAtMs: plannedReliefMs,
        restMinutes,
        nowMs,
      });
      let reason = "";
      switch (c.group) {
        case "ready_now":
          reason = "Sẵn sàng ngay";
          break;
        case "eligible_before_swing":
          reason = `Đang nghỉ — đủ điều kiện lúc ${hhmm(c.eligibleAtMs)}, swing lúc ${hhmm(plannedReliefMs)}`;
          break;
        case "resting_not_eligible":
          reason = `Chưa đủ nghỉ: cần tới ${hhmm(c.earliestEntryMs)} (swing lúc ${hhmm(plannedReliefMs)})`;
          break;
        case "busy_assigned":
          reason = assignedTableNameByAttendanceId[d.id]
            ? `Đang assigned ${assignedTableNameByAttendanceId[d.id]}`
            : "Đang assigned bàn khác";
          break;
        case "busy_pre_assigned":
          reason = "Đã CHỐT cho bàn khác";
          break;
        case "on_break":
          reason = "Đang nghỉ giải lao — kết thúc break trước";
          break;
        default:
          reason = "Không khả dụng";
      }
      rows.push({
        attendance: d,
        group: c.group,
        eligibleAtMs: c.eligibleAtMs,
        selectable: c.group === "ready_now" || c.group === "eligible_before_swing",
        reason,
      });
    }
    // Sort: ready now (longest-rested first) → future-eligible (soonest first) → disabled.
    const groupRank: Record<CandidateGroup, number> = {
      ready_now: 0, eligible_before_swing: 1, resting_not_eligible: 2,
      busy_assigned: 3, busy_pre_assigned: 4, on_break: 5, unavailable: 6,
    };
    rows.sort((a, b) => {
      const g = groupRank[a.group] - groupRank[b.group];
      if (g !== 0) return g;
      if (a.group === "ready_now") {
        return (a.eligibleAtMs ?? 0) - (b.eligibleAtMs ?? 0); // older release = longer rested first
      }
      return (a.eligibleAtMs ?? Infinity) - (b.eligibleAtMs ?? Infinity);
    });
    return rows;
  }, [slot0, plannedReliefMs, dealers, currentTableAttendanceId, restMinutes, assignedTableNameByAttendanceId]);

  const pending = candidates.find((c) => c.attendance.id === pendingId) ?? null;

  const close = (o: boolean) => {
    if (!o) setPendingId(null);
    onOpenChange(o);
  };

  const confirm = async (recovery: boolean = false, retry: boolean = false) => {
    if (inFlight.current || intentError || (!unresolved && !pending)) return;
    const intent = unresolved ?? { ...context, attendanceId: pending!.attendance.id, requestId: crypto.randomUUID() };
    const requestedScope = scopeKey;
    inFlight.current = true;
    setBusy(true);
    try {
      persistDealerNextIntent(sessionStorage, intent);
      setUnresolved(intent);
      const readingReceipt = recovery || (!!unresolved && !retry);
      // Untyped RPC: not in generated types yet (same pattern as useRotationSchedule).
      const { data, error } = await (supabase as any).rpc(
        readingReceipt ? "get_dealer_next_intent_receipt_v1" : "operator_plan_next_dealer_v1",
        dealerNextIntentArgs(intent));
      if (!live.current || activeScope.current !== requestedScope) return;
      if (error) {
        toast.error("Chưa xác minh được kết quả. Giữ yêu cầu để kiểm tra biên nhận.");
        return;
      }
      const r = data as any;
      if (["changed", "noop_same_dealer"].includes(r?.outcome)
        && (r.table_session_id !== intent.sessionId || r.assignment_id !== intent.assignmentId
          || r.request_id !== intent.requestId)) {
        toast.error("Biên nhận không khớp yêu cầu. Chưa xác nhận thành công.");
        return;
      }
      if (r?.outcome === "not_recorded") { setNotRecorded(true); return; }
      if (readingReceipt && !["changed", "noop_same_dealer"].includes(r?.outcome)) {
        toast.error("Không xác minh được biên nhận. Giữ nguyên yêu cầu trước.");
        return;
      }
      const known = ["changed", "noop_same_dealer", "race_lost", "not_eligible", "dealer_already_locked",
        "dealer_already_reserved", "dealer_unavailable", "forbidden", "plan_requires_repair", "backend_not_ready",
        "session_not_active", "assignment_not_active", "current_dealer", "invalid_request", "scope_mismatch"];
      if (known.includes(r?.outcome)) { clearDealerNextIntent(sessionStorage, intent); setUnresolved(null); setNotRecorded(false); }
      const newName = dealers.find(d => d.id === intent.attendanceId)?.dealers?.full_name ?? "dealer mới";
      switch (r?.outcome) {
        case "changed":
          toast.success(`Đã CHỐT dealer kế tiếp: ${newName}`);
          onChanged();
          close(false);
          break;
        case "noop_same_dealer":
          toast.info("Dealer này đã là người thay dự kiến.");
          break;
        case "race_lost":
          toast.warning("Kế hoạch vừa được cập nhật — thử lại.");
          setPendingId(null);
          onChanged();
          break;
        case "not_eligible":
          // Server is authoritative: show ITS eligible_at, not the client estimate.
          toast.warning(
            `Chưa thể chọn: dealer chưa đủ thời gian nghỉ — đủ điều kiện lúc ${
              r?.eligible_at ? hhmm(new Date(r.eligible_at).getTime()) : "--:--"
            }.`
          );
          break;
        case "dealer_already_locked":
          toast.warning("Dealer này vừa được CHỐT cho bàn khác.");
          break;
        case "dealer_unavailable":
          toast.warning("Dealer không còn khả dụng (đã đổi trạng thái).");
          break;
        case "forbidden":
          toast.error("Bạn không có quyền đổi dealer thay thế cho club này.");
          break;
        default:
          toast.error(`Không đổi được: ${r?.detail ?? r?.outcome ?? "lỗi không xác định"}`);
      }
    } catch {
      if (live.current && activeScope.current === requestedScope) toast.error("Chưa xác minh được yêu cầu; không tạo yêu cầu khác.");
    } finally {
      inFlight.current = false;
      if (live.current && activeScope.current === requestedScope) setBusy(false);
    }
  };

  const groupHeaders: Array<{ key: CandidateGroup[]; label: string }> = [
    { key: ["ready_now"], label: "Sẵn sàng ngay" },
    { key: ["eligible_before_swing"], label: "Đang nghỉ — kịp giờ swing" },
    { key: ["resting_not_eligible", "busy_assigned", "busy_pre_assigned", "on_break", "unavailable"], label: "Không chọn được" },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Đổi dự kiến — {tableName}</DialogTitle>
          <DialogDescription>
            Chỉ thay đổi kế hoạch: dealer đang chia vẫn giữ bàn, giờ swing giữ nguyên
            {plannedReliefMs ? ` (${hhmm(plannedReliefMs)})` : ""}. Handoff thật vẫn chờ "Chốt đổi dealer".
          </DialogDescription>
        </DialogHeader>

        {/* Exact-table context summary — hidden during the confirm step, where the
            from→to sentence already names old/new and predictedName would be stale. */}
        {!pending && (
          <div className="text-xs border border-border bg-muted/20 p-2 space-y-0.5">
            <div>
              <span className="text-muted-foreground">Bàn:</span>{" "}
              <span className="font-semibold">{tableName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Dealer hiện tại:</span>{" "}
              <span className="font-medium">{currentDealerName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Thay thế dự kiến:</span>{" "}
              <span className="font-medium">{predictedName}</span>
              {slot0?.status === "announced" ? (
                <span className="text-success"> · đã CHỐT</span>
              ) : slot0?.status === "predicted" ? (
                <span className="text-warning"> · dự kiến</span>
              ) : null}
            </div>
          </div>
        )}

        {intentError ? <div role="alert">{intentError}</div> : unresolved ? (
          <div role="status" className="space-y-3 text-sm">
            <p>Yêu cầu trước chưa rõ kết quả. Kiểm tra biên nhận trước khi chọn dealer khác.</p>
            <Button disabled={busy} onClick={() => confirm(true)}>Kiểm tra biên nhận</Button>
            {notRecorded && <Button disabled={busy} onClick={() => confirm(false, true)}>Gửi lại đúng yêu cầu</Button>}
          </div>
        ) : plannedReliefMs == null ? (
          <div className="text-sm text-muted-foreground">Bàn này chưa có kế hoạch thay dealer.</div>
        ) : pending ? (
          /* ── Confirm step ─────────────────────────────────────────── */
          <div className="space-y-3">
            <div className="text-sm">
              Đổi và CHỐT dealer thay thế từ <span className="font-semibold">{oldName}</span> sang{" "}
              <span className="font-semibold">{pending.attendance.dealers?.full_name}</span> cho{" "}
              <span className="font-semibold">{tableName}</span>?
            </div>
            <div className="text-sm font-medium text-success">Chỉ áp dụng cho {tableName}.</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Chỉ đổi người thay thế DỰ KIẾN — dealer đang chia vẫn giữ bàn.</div>
              <div>Giờ swing giữ nguyên: {hhmm(plannedReliefMs)}.</div>
              <div>Dealer mới sẽ được giữ slot này và không bị planner thay lại.</div>
              {pending.group === "eligible_before_swing" && (
                <div className="text-warning">
                  Dealer đang nghỉ — đủ điều kiện lúc {hhmm(pending.eligibleAtMs)}.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setPendingId(null)} disabled={busy}>
                Quay lại
              </Button>
              <Button size="sm" onClick={() => confirm()} disabled={busy}>
                {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Đổi &amp; CHỐT
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Candidate list ───────────────────────────────────────── */
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {candidates.length === 0 && (
              <div className="text-sm text-warning">Không có dealer nào trong ca.</div>
            )}
            {groupHeaders.map(({ key, label }) => {
              const rows = candidates.filter((c) => key.includes(c.group));
              if (rows.length === 0) return null;
              return (
                <div key={label}>
                  <div className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</div>
                  <div className="space-y-1.5">
                    {rows.map((c) => (
                      <button
                        key={c.attendance.id}
                        type="button"
                        disabled={!c.selectable}
                        onClick={() => c.selectable && setPendingId(c.attendance.id)}
                        className={[
                          "w-full flex items-center justify-between gap-2 p-2 border rounded-none text-left",
                          c.selectable
                            ? "border-border bg-muted/20 hover:border-primary/50 cursor-pointer"
                            : "border-border/50 bg-muted/10 opacity-60 cursor-not-allowed",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {c.attendance.dealers?.full_name ?? "?"}
                          </div>
                          <div className={[
                            "text-[11px] truncate",
                            c.group === "eligible_before_swing" ? "text-warning" : "text-muted-foreground",
                          ].join(" ")}>
                            {c.group === "eligible_before_swing" && <Clock className="inline w-3 h-3 mr-0.5 -mt-0.5" />}
                            {c.reason}
                          </div>
                        </div>
                        {c.attendance.dealers?.tier ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">{c.attendance.dealers.tier}</Badge>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
