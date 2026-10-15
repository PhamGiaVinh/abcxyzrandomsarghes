import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { classifyManualSwingOutcome } from "@/lib/dealerSwingOutcome";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { assertManualSwingIntent, clearManualSwingIntent, manualSwingReaderArgs, manualSwingReceipt,
  manualSwingWriterArgs, persistManualSwingIntent, readManualSwingIntent,
  type DealerManualSwingIntent } from "@/lib/dealerManualSwingIntent";

type Options = {
  actorId: string | null; clubId: string | null;
  assignments: readonly { id: string; table_id: string; table_session_id?: string | null; version: number }[];
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  onSettled: () => unknown;
};
const message = (e: unknown) => e instanceof Error ? e.message : "Không xác minh được kết quả Swing.";
/** One unresolved manual intent per actor/club; no automatic writer retries. */
export function useManualSwingRecovery(options: Options) {
  const {actorId, clubId, assignments, rpc, onSettled} = options;
  const scopeKey = JSON.stringify([actorId, clubId]);
  const lifetime = useRef({ key: scopeKey, generation: 0 });
  if (lifetime.current.key !== scopeKey) lifetime.current = { key: scopeKey, generation: lifetime.current.generation + 1 };
  const alive = useRef(true), flight = useRef(false);
  const [state, setState] = useState<{ scope: string; intent: DealerManualSwingIntent | null; error: string; ready: boolean; retryable: boolean }>({scope: scopeKey, intent: null, error: "", ready: false, retryable: false});
  const [swingingTableId, setSwingingTableId] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function reload() {
    if (!actorId || !clubId) return;
    try { setState({scope: scopeKey, intent: readManualSwingIntent(sessionStorage, {actor_user_id: actorId, club_id: clubId}), error: "", ready: true, retryable: false}); }
    catch (e) { setState({scope: scopeKey, intent: null, error: message(e), ready: false, retryable: false}); }
  }
  useEffect(() => {
    flight.current = false; setSwingingTableId(null);
    if (!actorId || !clubId) { setState({scope: scopeKey, intent: null, error: "", ready: false, retryable: false}); return; }
    try { setState({scope: scopeKey, intent: readManualSwingIntent(sessionStorage, {actor_user_id: actorId, club_id: clubId}), error: "", ready: true, retryable: false}); }
    catch (e) { setState({scope: scopeKey, intent: null, error: message(e), ready: false, retryable: false}); }
  }, [actorId, clubId, scopeKey]);

  async function run(assignmentId?: string, retry = false) {
    if (flight.current || !actorId || !clubId || state.scope !== scopeKey || (!state.ready && !state.intent)) return;
    const generation = lifetime.current.generation;
    const current = () => alive.current && lifetime.current.generation === generation;
    flight.current = true;
    let intent = state.intent;
    try {
      if (!intent) {
        if (!assignmentId) return;
        const assignment = assignments.find(row => row.id === assignmentId);
        if (!assignment?.table_session_id) throw new Error("Lượt chia hoặc phiên bàn không còn hợp lệ. Hãy tải lại.");
        intent = {actor_user_id: actorId, club_id: clubId, assignment_id: assignment.id,
          table_id: assignment.table_id, table_session_id: assignment.table_session_id,
          expected_version: assignment.version, request_id: crypto.randomUUID()};
        persistManualSwingIntent(sessionStorage, intent);
        setState({scope: scopeKey, intent, error: "Đang xác minh kết quả Swing.", ready: true, retryable: false});
        setSwingingTableId(intent.assignment_id);
        const write = await waitForManualPlayerResponse(Promise.resolve(rpc("operator_perform_swing", manualSwingWriterArgs(intent))));
        if (!current()) return;
        if (write.error) throw new Error(write.error.message);
      } else {
        setSwingingTableId(intent.assignment_id);
        assertManualSwingIntent(sessionStorage, intent);
      }
      const read = async () => {
        assertManualSwingIntent(sessionStorage, intent!);
        const result = await waitForManualPlayerResponse(Promise.resolve(rpc("get_dealer_manual_swing_receipt_v1", manualSwingReaderArgs(intent!))), 10000);
        if (!current()) return { status: "unknown" } as const;
        assertManualSwingIntent(sessionStorage, intent!);
        if (result.error) throw new Error(result.error.message);
        return manualSwingReceipt(result.data, intent!);
      };
      let receipt = await read();
      if (!current()) return;
      if (retry && receipt.status === "not_found") {
        assertManualSwingIntent(sessionStorage, intent);
        const write = await waitForManualPlayerResponse(Promise.resolve(rpc("operator_perform_swing", manualSwingWriterArgs(intent))));
        if (!current()) return;
        if (write.error) throw new Error(write.error.message);
        receipt = await read();
        if (!current()) return;
      }
      if (receipt.status !== "found") {
        setState({scope: scopeKey, intent, error: "Chưa có kết quả được xác nhận. Giữ nguyên yêu cầu; không tự đổi dealer lần nữa.", ready: true, retryable: receipt.status === "not_found"});
        return;
      }
      const outcome = classifyManualSwingOutcome(receipt.response);
      if (outcome.kind === "unknown" || outcome.kind === "error") throw new Error(outcome.message);
      clearManualSwingIntent(sessionStorage, intent);
      setState({scope: scopeKey, intent: null, error: "", ready: true, retryable: false});
      if (outcome.kind === "success") toast.success(outcome.message);
      else if (outcome.kind === "warning") toast.warning(outcome.message);
      else toast.info(outcome.message);
      try { await waitForManualPlayerResponse(Promise.resolve(onSettled()), 10000); }
      catch { if (current()) toast.warning("Đã đối chiếu kết quả; chưa tải lại được trạng thái bàn."); }
    } catch (e) {
      if (current()) setState({scope: scopeKey, intent, error: message(e), ready: false, retryable: false});
    } finally {
      if (current()) { flight.current = false; setSwingingTableId(null); }
    }
  }
  const visible = state.scope === scopeKey;
  return { swingingTableId: visible ? swingingTableId : null,
    pending: visible ? state.intent : null, error: visible ? state.error : "",
    retryable: visible && state.ready && state.retryable,
    performSwingForTable: (id: string) => run(id), reconcile: () => run(), retry: () => run(undefined, true), reload };
}
