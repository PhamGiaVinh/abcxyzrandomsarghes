import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, RefreshCw, Dices, Ticket, XCircle, Copy, ArrowRightLeft, Undo2 } from "lucide-react";
import { formatVND, formatDateTime } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { SeatDrawDialog, type DrawRegistration } from "./SeatDrawDialog";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { CancelRegistrationDialog } from "@/components/cashier/registrations/CancelRegistrationDialog";
import { VoidRegistrationDialog } from "@/components/cashier/registrations/VoidRegistrationDialog";

const POLL_MS = 15_000; // tournament_registrations is NOT realtime-published — honest poll + seats-channel piggyback (refreshTrigger)

type QueueStatus = "waiting" | "seated" | "printed" | "needs_review" | "cancelled";

interface QueueRow {
  id: string;
  reference_code: string;
  status: string;
  total_pay: number;
  committed_at: string;
  confirmed_at: string | null;
  player_id: string;
  player_name: string;
  phone: string | null;
  cashier_name: string | null;
  queueStatus: QueueStatus;
  entry_id: string | null;
  receipt: {
    receipt_code: string;
    status: string;
    table_number: number | null;
    seat_number: number;
    display_name: string;
  } | null;
  starting_stack: number | null;
}

const maskPhone = (p?: string | null) => {
  if (!p) return null;
  const s = p.replace(/\D/g, "");
  if (s.length < 7) return p;
  return s.slice(0, 3) + "****" + s.slice(-3);
};

// Server-authoritative refund request failures; never imply money has been paid.
function mapVoidErr(res: any, raw?: string): string {
  switch (res?.error ?? raw) {
    case "invalid_request": return "Lý do hoàn tiền cần ít nhất 8 ký tự.";
    case "refund_window_closed": return "Đã hết thời điểm cho phép hoàn hoặc giải đã có kết quả/payout.";
    case "verified_payment_history_required": return "Chưa đối chiếu đủ lịch sử khoản thu. Không thể yêu cầu hoàn.";
    case "registration_club_mismatch": return "Đăng ký và giải không cùng CLB. Cần kiểm tra dữ liệu.";
    case "unauthorized": return "Phiên đăng nhập hết hạn — đăng nhập lại.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền huỷ cho CLB này.";
    case "registration_not_found": return "Không tìm thấy đăng ký.";
    case "already_cancelled": return "Đăng ký đã được huỷ trước đó.";
    case "invalid_status": return "Chỉ huỷ được đăng ký đã xác nhận.";
    case "entry_not_voidable": return "Người chơi đã bust/kết thúc — không thể huỷ (dùng re-entry nếu cần).";
    default: return res?.error ? `Huỷ thất bại (${res.error}).` : (raw || "Huỷ thất bại.");
  }
}

const QUEUE_BADGE: Record<QueueStatus, { label: string; cls: string }> = {
  waiting: { label: "⏳ Chờ xếp ghế", cls: "text-warning border-warning/40" },
  seated: { label: "🪑 Đã có ghế", cls: "text-success border-success/40" },
  printed: { label: "🖨 Đã in phiếu", cls: "text-sky-400 border-sky-500/40" },
  needs_review: { label: "⚠ Cần xử lý", cls: "text-destructive border-destructive/40" },
  cancelled: { label: "❌ Đã huỷ", cls: "text-muted-foreground" },
};

/**
 * Floor pending queue: paid/registered players for the selected tournament with
 * their seating state. Reads only (registrations + entries + receipts + profiles,
 * all SELECT-authenticated). Seating actions go through SeatDrawDialog →
 * confirm_registration_and_assign_seat; cancel reuses the cashier dialog.
 */
export function RegistrationQueuePanel(props: Parameters<typeof ScopedRegistrationQueuePanel>[0]) {
  const { user } = useAuth();
  // A different actor/tournament must not inherit rows or open mutation dialogs.
  if (!user) return <Card className="p-4" role="alert">Đăng nhập để tải hàng chờ.</Card>;
  return <ScopedRegistrationQueuePanel key={`${user.id}:${props.tournamentId}`} {...props} />;
}

function ScopedRegistrationQueuePanel({
  tournamentId, tournamentName, tournamentDate, refreshTrigger,
}: {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  refreshTrigger: number;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [drawRegs, setDrawRegs] = useState<DrawRegistration[] | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<QueueRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState<QueueRow | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [moveRow, setMoveRow] = useState<QueueRow | null>(null);
  const seqRef = useRef(0);
  useEffect(() => () => { ++seqRef.current; }, []);
  useEffect(() => {
    if (!readError) return;
    setDrawRegs(null);
    setCancelTarget(null);
    setVoidTarget(null);
    setMoveRow(null);
    setReceiptOpen(false);
  }, [readError]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
    const [{ data: regs, error: regErr }, { data: entries, error: entryErr }, { data: receipts, error: receiptErr }] = await Promise.all([
      supabase.from("tournament_registrations")
        .select("id, reference_code, status, total_pay, committed_at, confirmed_at, confirmed_by, player_id")
        .eq("tournament_id", tournamentId)
        .in("status", ["pending", "confirmed"])
        .order("committed_at", { ascending: true })
        .limit(300),
      supabase.from("tournament_entries")
        .select("id, registration_id, player_id, status, current_stack")
        .eq("tournament_id", tournamentId),
      supabase.from("seat_draw_receipts")
        .select("entry_id, registration_id, receipt_code, status, table_number, seat_number, display_name, issued_at")
        .eq("tournament_id", tournamentId)
        .in("status", ["issued", "printed"])
        .order("issued_at", { ascending: false }),
    ]);
    if (seq !== seqRef.current) return; // stale response
    const readFailure = regErr ?? entryErr ?? receiptErr;
    if (readFailure) {
      setLoading(false);
      setReadError("Không tải được đầy đủ đăng ký, entry hoặc phiếu ghế. Hãy thử lại trước khi thao tác.");
      toast.error(readFailure.message);
      return;
    }

    const base = (regs ?? []) as any[];
    const userIds = [...new Set(base.flatMap((r) => [r.player_id, r.confirmed_by]).filter(Boolean))];
    const { data: profs, error: profileErr } = userIds.length
      ? await supabase.from("profiles").select("user_id, display_name, phone").in("user_id", userIds)
      : { data: [] as any[], error: null };
    if (seq !== seqRef.current) return;
    if (profileErr) {
      setLoading(false);
      setReadError("Không tải được hồ sơ người chơi. Hãy thử lại trước khi thao tác.");
      toast.error(profileErr.message);
      return;
    }
    const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
    const entryByReg = new Map((entries ?? []).map((e: any) => [e.registration_id, e]));
    // receipts are issued_at DESC — first hit per registration is the latest non-superseded
    const receiptByReg = new Map<string, any>();
    for (const rc of (receipts ?? []) as any[]) {
      if (rc.registration_id && !receiptByReg.has(rc.registration_id)) receiptByReg.set(rc.registration_id, rc);
    }

    setRows(base.map((r): QueueRow => {
      const entry = entryByReg.get(r.id);
      const rc = receiptByReg.get(r.id);
      let queueStatus: QueueStatus;
      if (r.status === "pending") queueStatus = "waiting";
      else if (entry && rc) queueStatus = rc.status === "printed" ? "printed" : "seated";
      else if (entry) queueStatus = "seated";
      else queueStatus = "needs_review"; // confirmed but no entry (already_confirmed_no_entry class)
      return {
        id: r.id,
        reference_code: r.reference_code,
        status: r.status,
        total_pay: r.total_pay,
        committed_at: r.committed_at,
        confirmed_at: r.confirmed_at,
        player_id: r.player_id,
        player_name: pMap.get(r.player_id)?.display_name ?? rc?.display_name ?? "Player",
        phone: pMap.get(r.player_id)?.phone ?? null,
        cashier_name: r.confirmed_by ? (pMap.get(r.confirmed_by)?.display_name ?? r.confirmed_by.slice(0, 8)) : null,
        queueStatus,
        receipt: rc ? {
          receipt_code: rc.receipt_code, status: rc.status,
          table_number: rc.table_number, seat_number: rc.seat_number, display_name: rc.display_name,
        } : null,
        entry_id: entry?.id ?? null,
        starting_stack: entry?.current_stack ?? null,
      };
    }));
    setLastRefreshed(new Date());
    setReadError(null);
    setLoading(false);
    } catch (error) {
      if (seq !== seqRef.current) return;
      setLoading(false);
      setReadError("Không tải được hàng chờ. Hãy thử lại trước khi thao tác.");
      toast.error(error instanceof Error ? error.message : "Lỗi kết nối khi tải hàng chờ.");
    }
  }, [tournamentId]);

  // initial + realtime piggyback (tournament_seats channel bumps refreshTrigger)
  useEffect(() => { load(); }, [load, refreshTrigger]);

  // honest poll for NEW registrations (table not realtime-published)
  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const waiting = (rows ?? []).filter((r) => r.queueStatus === "waiting");

  const showReceipt = (r: QueueRow) => {
    if (!r.receipt) return;
    setReceipt({
      tournamentName,
      tournamentDate,
      playerName: r.receipt.display_name || r.player_name,
      tableNumber: r.receipt.table_number,
      seatNumber: r.receipt.seat_number,
      receiptCode: r.receipt.receipt_code,
      startingStack: r.starting_stack,
      qrValue: r.receipt.receipt_code,
    });
    setReceiptOpen(true);
  };

  const cancel = async (reason: string) => {
    if (!cancelTarget || !user || loading || readError) return;
    setCancelBusy(true);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancellation_reason: reason,
      })
      .eq("id", cancelTarget.id)
      .eq("status", "pending"); // never cancel an already-confirmed row from the queue
    setCancelBusy(false);
    if (error) { toast.error(error.message); return; }
    setCancelTarget(null);
    toast.success("Đã huỷ đăng ký");
    load();
  };

  // Request only: Floor clearance and actual Cashier payment remain separate server steps.
  const voidReg = async (reason: string) => {
    if (!voidTarget || !user || loading || readError) return;
    setVoidBusy(true);
    const { data, error } = await supabase.rpc("cashier_request_refund_v1", {
      p_registration_id: voidTarget.id,
      p_reason: reason,
    });
    setVoidBusy(false);
    const res = data as any;
    if (error || !res?.ok) { toast.error(mapVoidErr(res, error?.message)); return; }
    setVoidTarget(null);
    toast.success("Đã ghi nhận yêu cầu hoàn. Floor xác minh ghế; Cashier ghi chi thực tế trước khi hoàn tất.");
    load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Hàng chờ xếp ghế
            {waiting.length > 0 && (
              <Badge variant="outline" className="text-warning border-warning/40">{waiting.length} chờ</Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            Player đã đăng ký của giải này. Bốc thăm = xác nhận đã nhận tiền + xếp ghế + in phiếu (một giao dịch).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-9" disabled={loading || !!readError || waiting.length === 0}
            onClick={() => setDrawRegs(waiting.map((w) => ({ id: w.id, reference_code: w.reference_code, player_name: w.player_name })))}>
            <Dices className="w-3.5 h-3.5 mr-1" /> Bốc thăm tất cả ({waiting.length})
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Tự làm mới mỗi 15s{lastRefreshed ? ` · Cập nhật ${lastRefreshed.toLocaleTimeString("vi-VN")}` : ""} — đăng ký mới có thể trễ tối đa 15s.
      </div>

      {readError && (
        <div role="alert" className="text-sm text-destructive border border-destructive/40 rounded-md p-3">
          {readError}{rows !== null ? " Dữ liệu bên dưới là lần tải thành công trước, chưa được xác minh lại." : ""}
        </div>
      )}
      {rows === null && readError ? null : rows === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Chưa có đăng ký nào cho giải này.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const badge = QUEUE_BADGE[r.queueStatus];
            return (
              <div key={r.id} className="rounded-lg border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1 text-sm min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{r.player_name}</span>
                    {maskPhone(r.phone) && <span className="text-xs text-muted-foreground">{maskPhone(r.phone)}</span>}
                    <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <button onClick={() => { navigator.clipboard.writeText(r.reference_code); toast.success("Đã copy mã"); }}
                      className="font-mono text-primary inline-flex items-center gap-1 hover:underline">
                      {r.reference_code} <Copy className="w-3 h-3" />
                    </button>
                    <span>· {formatVND(r.total_pay)}</span>
                    <span>· Đăng ký {formatDateTime(r.committed_at)}</span>
                  </div>
                  {r.queueStatus !== "waiting" && (
                    <div className="text-xs text-muted-foreground">
                      {r.receipt ? <>Bàn {r.receipt.table_number ?? "?"} · Ghế {r.receipt.seat_number} · Phiếu <span className="font-mono">{r.receipt.receipt_code}</span></> : "Chưa có phiếu"}
                      {r.cashier_name ? <> · Xác nhận bởi <span className="text-foreground">{r.cashier_name}</span></> : null}
                      {r.confirmed_at ? <> · {formatDateTime(r.confirmed_at)}</> : null}
                    </div>
                  )}
                  {r.queueStatus === "needs_review" && (
                    <div className="text-xs text-destructive">Đã xác nhận nhưng chưa có ghế — xếp thủ công trong Table Draw rồi đối chiếu.</div>
                  )}
                </div>

                <fieldset disabled={loading || !!readError} className="flex md:flex-col gap-2 md:w-44">
                  {r.queueStatus === "waiting" && (
                    <>
                      <Button size="sm" className="flex-1 h-9"
                        onClick={() => setDrawRegs([{ id: r.id, reference_code: r.reference_code, player_name: r.player_name }])}>
                        <Dices className="w-3.5 h-3.5 mr-1" /> Bốc thăm chỗ
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40"
                        onClick={() => setCancelTarget(r)}>
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Huỷ
                      </Button>
                    </>
                  )}
                  {r.receipt && (
                    <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => showReceipt(r)}>
                      <Ticket className="w-3.5 h-3.5 mr-1" /> Xem phiếu
                    </Button>
                  )}
                  {FEATURES.movePlayer && r.entry_id && (r.queueStatus === "seated" || r.queueStatus === "printed") && (
                    <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => setMoveRow(r)}>
                      <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Chuyển ghế
                    </Button>
                  )}
                  {FEATURES.registrationExtensions && r.queueStatus !== "waiting" && (
                    <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40"
                      onClick={() => setVoidTarget(r)}>
                      <Undo2 className="w-3.5 h-3.5 mr-1" /> Yêu cầu hoàn tiền
                    </Button>
                  )}
                </fieldset>
              </div>
            );
          })}
        </div>
      )}

      <SeatDrawDialog
        open={drawRegs !== null && !readError}
        onOpenChange={(v) => { if (!v) setDrawRegs(null); }}
        tournamentId={tournamentId}
        tournamentName={tournamentName}
        tournamentDate={tournamentDate}
        registrations={drawRegs ?? []}
        onDone={load}
      />

      <CancelRegistrationDialog
        open={cancelTarget !== null && !readError}
        onOpenChange={(v) => { if (!v) setCancelTarget(null); }}
        playerName={cancelTarget?.player_name ?? "Player"}
        referenceCode={cancelTarget?.reference_code ?? ""}
        busy={cancelBusy}
        onCancel={cancel}
      />

      <VoidRegistrationDialog
        open={voidTarget !== null && !readError}
        onOpenChange={(v) => { if (!v) setVoidTarget(null); }}
        playerName={voidTarget?.player_name ?? "Player"}
        referenceCode={voidTarget?.reference_code ?? ""}
        refundAmount={voidTarget?.total_pay ?? 0}
        seatLabel={voidTarget?.receipt ? `Bàn ${voidTarget.receipt.table_number ?? "?"} · Ghế ${voidTarget.receipt.seat_number}` : null}
        busy={voidBusy}
        onConfirm={voidReg}
      />

      {moveRow?.entry_id && !readError && (
        <MovePlayerDialog
          actorId={user?.id ?? null}
          open={moveRow !== null}
          onOpenChange={(v) => { if (!v) setMoveRow(null); }}
          tournamentId={tournamentId}
          entryId={moveRow.entry_id}
          playerName={moveRow.player_name}
          currentTournamentTableId={null}
          currentSeatNumber={moveRow.receipt?.seat_number ?? null}
          onMoved={load}
        />
      )}

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receipt} />
    </Card>
  );
}
