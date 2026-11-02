import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { clearPayoutEditIntent, parsePayoutEditIntent, payoutEditArguments, payoutEditBackend,
  payoutEditJournalKey, persistPayoutEditIntent, resolvePayoutEditReceipt, resolvePayoutEditResult,
  type PayoutEditIntent, type PayoutEditResolution } from "@/lib/payoutEditIntent";

export interface PayoutEditReadback {
  appliedRun: Record<string, unknown> | null;
  rows: {position: number; amount: number}[];
}
const unknown = "Chưa xác minh được chỉnh tay payout. Giữ yêu cầu cũ để đối chiếu hoặc hủy an toàn.";
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) =>
  PromiseLike<{data: unknown; error: {message?: string; code?: string} | null}>;

// Parent is keyed by backend/actor/session/tournament. No bearer token is journaled.
export function usePayoutEditIntent(actorId: string | undefined, tournamentId: string,
  refresh: () => Promise<PayoutEditReadback | undefined>, onSettled: () => void) {
  const [pending, setPending] = useState<PayoutEditIntent | null>(null);
  const [blocked, setBlocked] = useState(true), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(false), writing = useRef(false);
  let backend = "";
  try { backend = payoutEditBackend(import.meta.env.VITE_SUPABASE_URL); } catch { /* Block, never invent a backend. */ }
  useEffect(() => {
    alive.current = true;
    const read = () => {
      try {
        if (!actorId || !backend) { setBlocked(true); return; }
        const raw = localStorage.getItem(payoutEditJournalKey(actorId, tournamentId, backend));
        setPending(raw === null ? null : parsePayoutEditIntent(raw, actorId, tournamentId, backend));
        setBlocked(false);
      } catch { setBlocked(true); setMessage("Không đọc được yêu cầu chỉnh tay đã lưu. Tạm khóa chỉnh tay mới."); }
    };
    const changed = (event: StorageEvent) => {
      if (!actorId || !backend) return;
      if (event.key === null || event.key === payoutEditJournalKey(actorId, tournamentId, backend)) read();
    };
    read(); window.addEventListener("storage", changed);
    return () => { alive.current = false; window.removeEventListener("storage", changed); };
  }, [actorId, tournamentId, backend]);

  const execute = async (intent: PayoutEditIntent, mode: "submit" | "recover" | "retry" | "cancel") => {
    if (!alive.current || writing.current) return;
    writing.current = true; setBusy(true); setMessage(null);
    const receipt = async () => {
      const response = await waitForManualPlayerResponse(Promise.resolve(rpc("get_tournament_payout_edit_receipt_v1", {
        p_tournament_id: intent.tournamentId, p_request_id: intent.requestId, p_expected_actor: intent.actorId,
      })));
      if (response.error) throw new Error(response.error.message || unknown);
      return resolvePayoutEditReceipt(intent, response.data);
    };
    try {
      persistPayoutEditIntent(localStorage, intent);
      let resolution: PayoutEditResolution = {status: "unknown"};
      let fromReceipt = false, failure = "";
      if (mode === "recover" || mode === "retry") {
        resolution = await receipt(); fromReceipt = true;
        if (!alive.current) return;
        if (resolution.status === "not_found" && mode === "recover") throw new Error("Chưa tìm thấy receipt. Chưa thể kết luận yêu cầu không được ghi; chỉ gửi lại cùng mã hoặc hủy an toàn.");
        if (resolution.status === "unknown") throw new Error(unknown);
      }
      if (mode === "submit" || mode === "cancel" || (mode === "retry" && resolution.status === "not_found")) {
        try {
          const response = await waitForManualPlayerResponse(Promise.resolve(rpc(mode === "cancel" ? "cancel_tournament_payout_edit_v1" : "save_tournament_prizes_v3", payoutEditArguments(intent))));
          if (!alive.current) return;
          failure = response.error?.message || "";
          resolution = response.error ? {status: "unknown"} : resolvePayoutEditResult(intent, response.data);
          fromReceipt = false;
        } catch (error) { resolution = {status: "unknown"}; failure = error instanceof Error ? error.message : unknown; }
        if (!alive.current) return;
        if (resolution.status === "unknown") {
          resolution = await receipt(); fromReceipt = true;
          if (!alive.current) return;
        }
      }
      if (resolution.status !== "saved" && resolution.status !== "cancelled") throw new Error(failure || unknown);
      const fresh = await refresh();
      if (!alive.current) return;
      if (resolution.status === "saved") {
        const run = fresh?.appliedRun;
        const matches = run?.id === resolution.runId && run.tournament_id === intent.tournamentId && run.status === "applied" && run.source === "manual_edit"
          && Number(run.prize_pool_snapshot) === intent.pool
          && run.supersedes_run_id === intent.expectedRunId && fresh?.rows.length === intent.rows.length
          && fresh.rows.every((row, index) => row.position === intent.rows[index].position && row.amount === intent.rows[index].amount);
        const superseded = fromReceipt && run && run.tournament_id === intent.tournamentId && run.status === "applied"
          && typeof run.id === "string" && !!run.id.trim() && run.id !== resolution.runId && run.id !== intent.expectedRunId;
        if (!matches && !superseded) throw new Error(unknown);
        clearPayoutEditIntent(localStorage, intent); setPending(null); onSettled();
        if (superseded) toast.error("Receipt xác nhận đã lưu, nhưng bảng payout hiện có phiên bản mới hơn. Đã tải lại; hãy xem lại trước khi sửa tiếp.");
        else toast.success("Đã đối chiếu chỉnh tay payout đã lưu.");
      } else {
        clearPayoutEditIntent(localStorage, intent); setPending(null); onSettled();
        toast.success("Đã hủy yêu cầu chỉnh tay; thao tác đến muộn không thể ghi.");
      }
    } catch (error) {
      if (alive.current) {
        const text = error instanceof Error ? error.message : unknown;
        setMessage(text); toast.error(text);
        // Storage drift must not allow a fresh key to replace another tab's intent.
        if (text.startsWith("PAYOUT_EDIT_JOURNAL")) setBlocked(true);
      }
    } finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  const submit = async (expectedRunId: string, pool: number, rows: PayoutEditIntent["rows"], reason: string) => {
    if (!actorId || !backend || blocked || pending || writing.current || !alive.current) return;
    try {
      const intent = parsePayoutEditIntent(JSON.stringify({actorId, tournamentId, backend, requestId: crypto.randomUUID(),
        expectedRunId, pool, rows, reason: reason.trim()}), actorId, tournamentId, backend);
      persistPayoutEditIntent(localStorage, intent); setPending(intent);
      await execute(intent, "submit");
    } catch (error) {
      if (alive.current) { setBlocked(true); setMessage(error instanceof Error ? error.message : unknown); toast.error("Không lưu được intent chỉnh tay an toàn. Chưa gửi yêu cầu mới."); }
    }
  };
  return {pending, blocked, busy, message, submit,
    recover: () => pending ? execute(pending, "recover") : Promise.resolve(),
    retry: () => pending ? execute(pending, "retry") : Promise.resolve(),
    cancel: () => pending ? execute(pending, "cancel") : Promise.resolve()};
}
