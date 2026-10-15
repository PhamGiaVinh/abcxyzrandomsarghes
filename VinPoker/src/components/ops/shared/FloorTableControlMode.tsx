import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { floorOpsErrorMessage } from "@/lib/floorOpsErrors";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";
import { FloorTableModePicker } from "@/components/ops/shared/FloorTableModePicker";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "@/lib/floorTableControlV3";
import { readPendingFloorModeIntent, savePendingFloorModeIntent, clearPendingFloorModeIntent,
  type PendingFloorModeIntent } from "@/lib/floorPendingModeIntent";

type ControlTable = {
  tt_id: string;
  table_name: string;
  floor_control_mode: FloorTableControlMode;
  floor_control_revision: number;
  table_session_id?: string;
  control_epoch?: number;
};

type ModeControlProps = {
  actorId: string | null;
  tournamentId: string;
  table: ControlTable;
  onChanged: () => void | boolean | Promise<void | boolean>;
  disabledReason?: string | null;
  expanded?: boolean;
};

export function FloorTableControlModeControl(props: ModeControlProps) {
  return <ScopedFloorTableControlMode key={JSON.stringify([props.actorId, props.tournamentId,
    props.table.tt_id, props.table.table_session_id])} {...props} />;
}

function ScopedFloorTableControlMode({ actorId, tournamentId, table, onChanged, disabledReason, expanded = true }: ModeControlProps) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const supabase = useSupabaseClient();
  const client = useMemo(() => createFloorTableControlV3Client(
    supabase.rpc.bind(supabase) as unknown as FloorTableControlV3Rpc,
  ), [supabase]);
  const scope = JSON.stringify([actorId, tournamentId, table.tt_id, table.table_session_id]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const validReadContext = Boolean(actorId && table.table_session_id
    && Number.isSafeInteger(table.control_epoch) && (table.control_epoch ?? -1) >= 0
    && Number.isSafeInteger(table.floor_control_revision) && table.floor_control_revision >= 0);
  const changedRef = useRef(onChanged);
  const validContext = validReadContext && !disabledReason;
  changedRef.current = onChanged;
  const [requestState, setRequestState] = useState<{ scope: string; loaded: boolean;
    error: string | null; pending: { id: string; mode: FloorTableControlMode; blockers: string[] } | null
  }>({ scope, loaded: false, error: null, pending: null });
  const currentRequest = requestState.scope === scope ? requestState : null;
  const pending = currentRequest?.pending ?? null;
  const attempt = useRef<PendingFloorModeIntent | null>(null);
  const [recovery, setRecovery] = useState<PendingFloorModeIntent | null>(null);
  const recovering = recovery?.scope === scope;
  const mutationGeneration = useRef(0);
  const pendingSeen = useRef(false);
  const refreshRequest = useRef<(() => Promise<void>) | null>(null);
  const [selected, setSelected] = useState<FloorTableControlMode>(table.floor_control_mode);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    setSelected(attempt.current?.scope === scope ? attempt.current.args.controlMode : table.floor_control_mode);
    setConfirmOpen(false);
  }, [scope, table.floor_control_mode, table.floor_control_revision]);

  useEffect(() => { if (!expanded) setConfirmOpen(false); }, [expanded]);

  useEffect(() => {
    let disposed = false;
    let running = false;
    pendingSeen.current = false;
    setRequestState({ scope, loaded: false, error: null, pending: null });
    if (!validReadContext || !table.table_session_id) return;
    const sessionId = table.table_session_id;
    try {
      const saved = readPendingFloorModeIntent(scope);
      if (saved && (saved.args.tableSessionId !== sessionId || saved.args.tournamentTableId !== table.tt_id)) {
        throw new Error("saved_mode_scope_mismatch");
      }
      attempt.current = saved;
      setRecovery(saved);
      if (saved) setSelected(saved.args.controlMode);
    } catch {
      setRequestState({ scope, loaded: false, pending: null,
        error: "Yêu cầu đã lưu không hợp lệ hoặc không đọc được. Chưa thể tạo thao tác mới." });
      return;
    }
    const refresh = async () => {
      if (running || busyRef.current || document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true;
      const generation = mutationGeneration.current;
      try {
        const result = await observeTrackerContextRead(client.getTableControlModeRequest({
          tournamentTableId: table.tt_id, tableSessionId: sessionId,
        }));
        if (disposed || scopeRef.current !== scope || generation !== mutationGeneration.current) return;
        if (result.ok === false) throw new Error(result.error);
        const request = result.data.request;
        if (request === null) {
          setRequestState({ scope, loaded: true, error: null, pending: null });
          if (pendingSeen.current) {
            const refreshed = await changedRef.current();
            if (!disposed && scopeRef.current === scope && refreshed !== false) pendingSeen.current = false;
          }
        } else {
          if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("invalid_mode_request");
          const row = request as Record<string, unknown>;
          if (typeof row.id !== "string" || !row.id
            || (row.target_mode !== "manual" && row.target_mode !== "tracker")
            || !Array.isArray(row.blockers) || !row.blockers.every((item) => typeof item === "string")) {
            throw new Error("invalid_mode_request");
          }
          const firstObservation = !pendingSeen.current;
          pendingSeen.current = true;
          setRequestState({ scope, loaded: true, error: null,
            pending: { id: row.id, mode: row.target_mode, blockers: row.blockers as string[] } });
          if (firstObservation) await changedRef.current();
        }
      } catch {
        if (!disposed && scopeRef.current === scope && generation === mutationGeneration.current) setRequestState((state) => ({
          scope, loaded: false, error: "Không xác minh được yêu cầu đổi chế độ. Hãy tải lại.",
          pending: state.scope === scope ? state.pending : null,
        }));
      } finally { running = false; }
    };
    refreshRequest.current = refresh;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 4000);
    const resume = () => { void refresh(); };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      if (refreshRequest.current === refresh) refreshRequest.current = null;
      clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [client, scope, validReadContext, table.tt_id, table.table_session_id]);

  const changed = selected !== table.floor_control_mode;
  const selectedSummary = selected === "tracker"
    ? "Live Tracker: Tracker quản lý chip; chỉ cho phép loại khi chip đã về 0."
    : "Manual Floor: cho phép loại dù còn chip; chip trước khi loại được ghi audit, không payout.";

  const save = async () => {
    if ((!changed && !recovering) || busyRef.current || !validContext || !currentRequest?.loaded
      || (pending && !recovering) || !table.table_session_id) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (attempt.current?.scope !== scope) attempt.current = { scope, args: {
        tournamentTableId: table.tt_id, tableSessionId: table.table_session_id,
        controlMode: selected, expectedRevision: table.floor_control_revision,
        expectedEpoch: table.control_epoch!, requestId: crypto.randomUUID(),
      } };
      setRecovery(attempt.current);
      savePendingFloorModeIntent(attempt.current);
      ++mutationGeneration.current;
      const submitted = attempt.current;
      const result = await waitForManualPlayerResponse(client.requestTableControlMode(submitted.args));
      if (!alive.current || scopeRef.current !== scope) return;
      if (result.ok === false) {
        // Existing receipt is checked before STALE_STATE by the reviewed RPC.
        // This definitive rejection permits a fresh intent only after refresh.
        if (result.error === "STALE_STATE") {
          clearPendingFloorModeIntent(attempt.current);
          attempt.current = null;
          setRecovery(null);
          setConfirmOpen(false);
          setRequestState({ scope, loaded: false, pending: null,
            error: "Phiên bàn đã thay đổi. Đang tải lại trước khi tạo yêu cầu mới." });
          if ((await onChanged()) === true && alive.current && scopeRef.current === scope) {
            // The caller confirmed a fresh canonical roster; verify pending
            // state again after releasing the write guard.
            busyRef.current = false;
            await refreshRequest.current?.();
          }
        }
        toast.error(floorOpsErrorMessage(result.error, "Không đổi được chế độ bàn."));
        return;
      }
      const outcome = result.data.outcome;
      if (!["applied", "pending", "unchanged"].includes(String(outcome))) {
        toast.error("Chưa xác minh được kết quả. Tải lại trước khi thao tác tiếp.");
        return;
      }
      if (outcome === "pending") {
        const id = result.data.request_id;
        const blockers = result.data.blockers;
        if (typeof id !== "string" || !id || !Array.isArray(blockers)
          || !blockers.every((item) => typeof item === "string")) {
          toast.error("Chưa xác minh được yêu cầu chờ. Hãy tải lại.");
          return;
        }
        setRequestState({ scope, loaded: true, error: null,
          pending: { id, mode: attempt.current.args.controlMode, blockers: blockers as string[] } });
        pendingSeen.current = true;
        toast.success("Đã lưu yêu cầu; chế độ hiện tại chưa thay đổi.");
      } else toast.success(outcome === "unchanged" ? "Bàn đã ở chế độ này." : "Đã đổi chế độ bàn.");
      clearPendingFloorModeIntent(attempt.current);
      attempt.current = null;
      setRecovery(null);
      setConfirmOpen(false);
      onChanged();
    } catch {
      if (alive.current && scopeRef.current === scope) toast.error("Chưa xác minh được kết quả. Giữ yêu cầu để thử lại, không tạo thao tác mới.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const cancelPending = async () => {
    if (!pending || !validContext || !table.table_session_id || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      ++mutationGeneration.current;
      const result = await waitForManualPlayerResponse(client.cancelTableControlModeRequest({ tournamentTableId: table.tt_id,
        tableSessionId: table.table_session_id, modeRequestId: pending.id }));
      if (!alive.current || scopeRef.current !== scope) return;
      if (result.ok === false || result.data.outcome !== "cancelled") {
        toast.error("Chưa xác minh được việc hủy yêu cầu. Hãy tải lại."); return;
      }
      setRequestState({ scope, loaded: true, error: null, pending: null });
      onChanged();
    } catch { if (alive.current && scopeRef.current === scope) toast.error("Không xác minh được việc hủy yêu cầu."); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };

  return (
    <section hidden={!expanded} data-testid="floor-table-control-mode" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Kiểm soát chip khi loại</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Bàn có người vẫn được đổi chế độ. Nếu có ván hoặc thao tác chưa giải quyết, server lưu yêu cầu và chờ ranh giới an toàn; giữ nguyên người và chip.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <FloorTableModePicker
          value={selected}
          onChange={setSelected}
          disabled={busy || !validContext || !currentRequest?.loaded || Boolean(pending) || recovering}
          testIdPrefix="floor-table-control-mode"
        />
      </div>
      {!validContext && <p role="alert" className="mt-2 text-sm text-muted-foreground">{disabledReason ?? "Không xác minh được phiên bàn. Hãy tải lại trước khi đổi chế độ."}</p>}
      {currentRequest?.error && <p role="alert" className="mt-2 text-sm text-muted-foreground">{currentRequest.error}</p>}
      {recovering && <p role="status" className="mt-2 text-sm">Có yêu cầu chưa xác minh. Đối chiếu cùng mã đã lưu trước khi tạo thao tác khác.</p>}
      {pending && <div role="status" className="mt-2 text-sm">
        <p>Đang chờ chuyển sang {pending.mode === "tracker" ? "Live Tracker" : "Manual Floor"}.</p>
        <ul>{pending.blockers.map((reason) => <li key={reason}>{({ active_hand: "Ván đang chạy", pending_move: "Chuyển ghế chưa hoàn tất", correction_pending: "Đang chờ sửa hand", correction_session_unknown: "Chưa xác minh phiên sửa hand" } as Record<string, string>)[reason] ?? reason}</li>)}</ul>
        <Button data-ops-action="floor.tables.cancel_pending_control_mode" type="button" variant="outline" disabled={busy || !validContext || !currentRequest?.loaded} onClick={() => { void cancelPending(); }}>Hủy yêu cầu đổi chế độ</Button>
      </div>}

      <Button
        data-ops-action="floor.tables.open_control_mode_confirm"
        data-testid="floor-table-control-mode-save"
        type="button"
        className="mt-3 w-full"
        disabled={(!changed && !recovering) || busy || !validContext || !currentRequest?.loaded || (Boolean(pending) && !recovering)}
        onClick={() => setConfirmOpen(true)}
      >
        {recovering ? "Đối chiếu yêu cầu đã lưu" : "Lưu chế độ bàn"}
      </Button>

      <AlertDialog open={expanded && confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Đổi kiểm soát chip của {table.table_name}</AlertDialogTitle>
            <AlertDialogDescription>{selectedSummary} Nếu có blocker, yêu cầu sẽ chờ và không đổi chế độ ngay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel data-ops-action="floor.tables.cancel_control_mode" disabled={busy}>Huỷ</AlertDialogCancel>
            <AlertDialogAction data-ops-action="floor.tables.save_control_mode" data-testid="floor-table-control-mode-confirm" disabled={busy || !validContext || !currentRequest?.loaded} onClick={(event) => { event.preventDefault(); void save(); }}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Đang lưu</> : "Xác nhận đổi chế độ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
