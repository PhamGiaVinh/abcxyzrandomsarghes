import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BellRing, Check, Loader2, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { HandHistoryWorkspace } from "./HandHistoryWorkspace";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  listTrackerFloorAlerts,
  type TrackerFloorAlert,
  type TrackerFloorAlertStatus,
} from "@/lib/tracker-floor-alerts/trackerFloorAlertsRead";
import { useTrackerFloorAlertLocations } from "@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { useFloorAlertTransition } from "./useFloorAlertTransition";

type FloorAlertStatus = TrackerFloorAlertStatus;
interface TrackerFloorAlertLaneProps {
  tournamentId: string;
  actorId?: string;
}

function nextTransition(status: FloorAlertStatus): { action: string; label: string } | null {
  if (status === "open") return { action: "acknowledge", label: "Đã nhận" };
  if (status === "acknowledged") return { action: "start", label: "Bắt đầu xử lý" };
  if (status === "in_progress") return { action: "resolve", label: "Đã xử lý" };
  return null;
}

export function TrackerFloorAlertLane({ tournamentId, actorId }: TrackerFloorAlertLaneProps) {
  return <ScopedTrackerFloorAlertLane key={JSON.stringify([tournamentId, actorId])} tournamentId={tournamentId} actorId={actorId} />;
}

function ScopedTrackerFloorAlertLane({ tournamentId, actorId }: TrackerFloorAlertLaneProps) {
  const supabase = useSupabaseClient();
  const alive = useRef(true);
  const readEpoch = useRef(0);
  const readFlight = useRef<{ promise: Promise<void>; queued: boolean } | null>(null);
  useEffect(() => {
    const epoch = readEpoch.current;
    alive.current = true;
    return () => { alive.current = false; readEpoch.current = epoch + 1; readFlight.current = null; };
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const targetAlertId = searchParams.get("alert");
  const [alerts, setAlerts] = useState<TrackerFloorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [reviewAlert, setReviewAlert] = useState<TrackerFloorAlert | null>(null);
  const [confirmation,setConfirmation]=useState<{alert:TrackerFloorAlert;action:'resolve'|'dismiss';note:string|null}|null>(null);
  const locationFor = useTrackerFloorAlertLocations(supabase, alerts);
  const transitionRecovery = useFloorAlertTransition(actorId, tournamentId);

  const reload = useCallback(async () => {
    if (!alive.current) return;
    if (readFlight.current) {
      readFlight.current.queued = true;
      return readFlight.current.promise;
    }
    const epoch = readEpoch.current;
    const current = () => alive.current && readEpoch.current === epoch;
    const flight = { promise: Promise.resolve(), queued: false };
    readFlight.current = flight;
    flight.promise = (async () => {
      try {
        do {
          flight.queued = false;
          const result = await observeTrackerContextRead(listTrackerFloorAlerts(supabase, tournamentId));
          if (!current()) return;
          // Notifications invalidate successful snapshots, not evidence that
          // verification failed. Keep stale rows read-only during the follow-up.
          if ("error" in result) setError(result.error);
          else {
            if (flight.queued) continue;
            setAlerts([...result.alerts]); setError(null);
          }
          setLoading(false);
        } while (flight.queued && current());
      } catch {
        if (current()) {
          setError("Không tải được cảnh báo hiện tại. Dữ liệu cũ chưa được xác minh; hãy làm mới.");
          setLoading(false);
        }
      } finally {
        if (readFlight.current === flight) readFlight.current = null;
      }
    })();
    return flight.promise;
  }, [supabase, tournamentId]);

  useEffect(() => {
    void reload();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`tracker-floor-alerts:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracker_floor_alerts", filter: `tournament_id=eq.${tournamentId}` },
        () => void reload(),
      )
      .subscribe();
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [reload, supabase, tournamentId]);

  useEffect(() => {
    if (!targetAlertId || loading) return;
    const target = alerts.find((alert) => alert.id === targetAlertId);
    if (target?.hand_id) setReviewAlert(target);
  }, [alerts, loading, targetAlertId]);

  const transition = async (alert: TrackerFloorAlert, action: string, note: string | null = null, confirmed=false) => {
    if (!alive.current || transitioningId || error || transitionRecovery.blocked) return;
    if (action==='resolve' && (!locationFor(alert) || locationFor(alert)?.unavailable)) {
      toast.error('Chưa xác minh được bàn/hand. Hãy làm mới trước khi đánh dấu đã xử lý.');return;
    }
    if (!confirmed && (action==='dismiss' || action==='resolve'&&alert.correction_required)) {
      setConfirmation({alert,action,note});return;
    }
    if (action === "dismiss") {
      if (!alert.hand_id || !locationFor(alert)?.handVoided) return;
      const { data: hand, error: handError } = await supabase.from("tournament_hands")
        .select("id,is_voided")
        .eq("id", alert.hand_id)
        .eq("tournament_id", alert.tournament_id)
        .maybeSingle();
      if (!alive.current) return;
      if (handError || hand?.is_voided !== true) {
        toast.error("Không xác minh được hand đã void trên máy chủ. Cảnh báo vẫn giữ nguyên.");
        return;
      }
    }
    setTransitioningId(alert.id);
    try {
      const confirmed = await transitionRecovery.run(alert.id, alert.version, action as "acknowledge" | "start" | "resolve" | "dismiss", note);
      if (!alive.current) return;
      if (confirmed) {
        if (action === "dismiss") toast.success("Đã đóng cảnh báo hand void. Dealer hãy tải lại trạng thái Voice; không phát lại transcript cũ.");
        await reload();
      }
    } finally { if (alive.current) setTransitioningId(null); }
  };

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-amber-400/25 bg-[linear-gradient(135deg,rgba(32,20,4,.92),rgba(15,15,18,.96))]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-300">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Cảnh báo bàn Tracker</h3>
            <p className="text-[11px] text-zinc-500">Dealer gửi trực tiếp hoặc qua Voice; không thay đổi Dealer Swing.</p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      <div className="space-y-3 p-4" aria-live="polite">
        {transitionRecovery.message && <p role="alert" className="text-xs text-amber-100">{transitionRecovery.message}</p>}
        {transitionRecovery.pending && <Button type="button" variant="outline" className="min-h-11"
          disabled={transitionRecovery.busy} onClick={() => void transitionRecovery.recover().then(confirmed => {
            if (confirmed && alive.current) void reload();
          })}>Kiểm tra lại yêu cầu cũ</Button>}
        {loading && (
          <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải cảnh báo
          </div>
        )}
        {!loading && error && (
          <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-xs text-rose-100">
            {error}
          </div>
        )}
        {!loading && !error && alerts.length === 0 && (
          <div className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
            <Check className="h-4 w-4 text-emerald-400" /> Không có cảnh báo bàn đang mở
          </div>
        )}
        {alerts.map((alert) => {
          const primary = nextTransition(alert.status);
          const location = locationFor(alert);
          return (
            <article
              key={alert.id}
              className={`rounded-xl border p-3 ${alert.priority === "urgent" ? "border-rose-400/35 bg-rose-400/10" : "border-amber-300/25 bg-black/20"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <AlertTriangle className={`h-4 w-4 ${alert.priority === "urgent" ? "text-rose-300" : "text-amber-300"}`} />
                    <span className="text-sm font-semibold text-zinc-100">{alert.title}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      {alert.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {alert.dealer_name || (alert.dealer_id ? "Dealer" : "Floor / Owner")} · {new Date(alert.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-amber-100">
                    {location?.unavailable ? 'Không xác minh được bàn/hand — hãy làm mới' : location?.tableNumber != null ? `Bàn ${location.tableNumber}` : "Đang tải bàn"}
                    {!location?.unavailable && location?.handNumber != null ? ` · Hand #${location.handNumber}` : ""}
                    {!location?.unavailable && location?.handVoided ? " · ĐÃ VOID" : ""}
                  </p>
                  {alert.alert_kind === "wrong_action" && !alert.source_action_id && (
                    <p className="mt-1 text-xs text-zinc-300">Action sai chưa được chỉ rõ; xem toàn bộ nhật ký ván trước khi sửa.</p>
                  )}
                  {alert.alert_kind === "call_floor" && !alert.source_action_id && (
                    <p className="mt-1 text-xs text-zinc-300">Chưa chỉ định action · Floor kiểm tra theo bàn{alert.hand_id ? " và hand này" : " (chưa có hand)"}.</p>
                  )}
                  {alert.alert_kind === "display_issue" && <p className="mt-1 text-xs text-zinc-300">Vấn đề hiển thị; không khóa hand hoặc thay đổi poker state.</p>}
                  {alert.source_action_id && <p className="mt-1 text-xs text-amber-100">
                    Action gốc {alert.source_action_snapshot?.action_order != null ? `#${alert.source_action_snapshot.action_order}` : "đã chọn"}
                    {alert.source_action_snapshot?.action_type ? ` · ${alert.source_action_snapshot.action_type}` : ""}
                    {alert.source_action_snapshot?.action_amount != null ? ` · ${alert.source_action_snapshot.action_amount.toLocaleString("vi-VN")}` : ""}
                    <span className="block break-all text-[10px] text-zinc-500">ID {alert.source_action_id}</span>
                  </p>}
                  {alert.message && <p className="mt-2 line-clamp-2 text-xs text-zinc-300">{alert.message}</p>}
                  {alert.correction_required && (
                    <p className="mt-2 text-xs text-amber-200">{location?.handVoided ? "Hand đã void. Floor kiểm tra nhật ký rồi đóng cảnh báo để mở lại Voice." : "Voice tạm dừng. Kiểm tra và sửa hand trước khi đánh dấu đã xử lý."}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {alert.hand_id && (
                    <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setReviewAlert(alert)}>
                      {location?.handStatus === "completed" && !location?.handVoided ? "Xem action / Sửa hand" : "Xem toàn bộ action"}
                    </Button>
                  )}
                  {alert.correction_required && location?.handVoided && alert.hand_id && (
                    <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!!error || transitionRecovery.blocked || transitioningId === alert.id} onClick={() => void transition(alert, "dismiss", `Hand ${alert.hand_id} đã void; Floor kiểm tra và đóng cảnh báo.`)}>
                      Hand đã void: đóng cảnh báo
                    </Button>
                  )}
                  {primary && !location?.handVoided && (
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11"
                      disabled={!!error || transitionRecovery.blocked || transitioningId === alert.id
                        || primary.action==='resolve'&&(!location || location.unavailable)}
                      onClick={() => void transition(alert, primary.action)}
                    >
                      {transitioningId === alert.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      {primary.label}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <AlertDialog open={!!confirmation} onOpenChange={(open)=>{if(!open)setConfirmation(null);}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.action==='dismiss'?'Đóng cảnh báo hand đã void?':'Xác nhận đã xử lý hand?'}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.action==='dismiss'
              ?'Hand này đã VOID trên máy chủ. Đóng cảnh báo sẽ mở lại Voice cho bàn; transcript cũ không được tự phát lại. Bạn đã kiểm tra toàn bộ ván và muốn tiếp tục?'
              :'Chỉ đánh dấu đã xử lý sau khi action/hand canonical đã được sửa và kiểm tra. Thao tác này mở lại Voice cho bàn. Tiếp tục?'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Giữ cảnh báo</AlertDialogCancel>
            <AlertDialogAction disabled={!!error||transitionRecovery.blocked||!!transitioningId} onClick={()=>{
              const target=confirmation;setConfirmation(null);if(!target)return;
              const current=alerts.find(item=>item.id===target.alert.id);
              if(!current||current.version!==target.alert.version||current.status!==target.alert.status){
                toast.error('Cảnh báo đã thay đổi. Hãy làm mới và kiểm tra lại trước khi xác nhận.');return;
              }
              void transition(current,target.action,target.note,true);
            }}>Xác nhận đã kiểm tra</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!reviewAlert} onOpenChange={(open) => { if (!open) {
        setReviewAlert(null);
        if (targetAlertId) setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete("alert");
          return next;
        }, { replace: true });
      } }}>
        <DialogContent className="left-0 top-0 h-[100dvh] max-h-none max-w-none translate-x-0 translate-y-0 overflow-x-hidden overflow-y-auto rounded-none border-0 px-3 pb-8 pt-12 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92dvh] sm:max-w-6xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle>{reviewAlert && locationFor(reviewAlert)?.handVoided ? "Xem ván đã void" : "Kiểm tra & sửa hand"}</DialogTitle>
            <DialogDescription>
              {reviewAlert && locationFor(reviewAlert)?.handVoided
                ? "Hand đã void: chỉ xem nhật ký để đối chiếu. Không sửa hoặc phát lại action của hand này."
                : reviewAlert && locationFor(reviewAlert)?.handStatus === "in_progress"
                  ? "Hand còn mở: xem action để xác định chỗ sai, sau đó Dealer sửa bằng thao tác thủ công trên bàn. Không ghi đè lịch sử từ Floor."
                  : "Chọn action cần sửa, kiểm tra số theo/raise và xem trước stack cuối hand. Máy chủ vẫn là nơi duy nhất xác minh và ghi kết quả."}
            </DialogDescription>
          </DialogHeader>
          {reviewAlert?.hand_id && (
            <HandHistoryWorkspace
              actorId={actorId}
              key={reviewAlert.hand_id}
              tournamentId={reviewAlert.tournament_id}
              initialTableId={reviewAlert.tournament_table_id ?? reviewAlert.physical_table_id}
              initialHandId={reviewAlert.hand_id}
              initialActionId={reviewAlert.source_action_id ?? null}
              workspaceMode
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
