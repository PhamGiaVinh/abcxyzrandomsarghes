import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatVND } from "@/lib/format";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { clearPrizePaymentIntent, parsePrizePaymentIntent, persistPrizePaymentIntent,
  prizePaymentJournalKey, resolvePrizePaymentReceipt, resolvePrizePaymentResult,
  type PrizePaymentIntent } from "@/lib/prizePaymentIntent";
import type { PayoutRecipientPlace } from "./useTournamentPayoutRecipients";

const errors: Record<string, string> = {
  payout_confirmation_stale: "Kết quả hoặc người nhận đã thay đổi. Hãy xác nhận lại danh sách mới.",
  request_payload_conflict: "Mã yêu cầu đã gắn với thao tác khác. Cần kiểm tra receipt.",
  place_ambiguous: "Hạng có nhiều người nhận. Cần sửa dữ liệu kết quả trước khi trả thưởng.",
  paid_result_conflict: "Khoản đã trả không khớp kết quả hiện tại. Cần kiểm tra lịch sử.",
  place_not_finalized: "Hạng này chưa chốt kết quả.",
  place_not_in_money: "Hạng này không có tiền thưởng.",
  actor_not_allowed: "Bạn không có quyền ghi nhận (cần Chủ CLB/Thu ngân).",
  unauthorized: "Bạn chưa đăng nhập.",
  multi_day_obligations_not_finalized:"Nghĩa vụ thưởng Main Event chưa được khóa.",
  multi_day_package_release_off:"Ghi nhận payout Main Event đang tắt cho CLB này.",
  no_unpaid_obligation:"Người này không còn khoản phải trả. Hãy tải lại danh sách.",
};
const unknown = "Chưa xác minh được kết quả trả thưởng. Hãy kiểm tra yêu cầu đang chờ.";

// Mounted inside the actor/session/tournament-keyed section; the journal remains
// actor/tournament scoped across reload and token refresh, without storing tokens.
export function usePrizePaymentIntent(actorId: string | undefined, tournamentId: string, reload: () => void) {
  const [pending, setPending] = useState<PrizePaymentIntent | null>(null);
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true), writing = useRef(false);
  useEffect(() => {
    alive.current = true;
    try {
      const raw = actorId ? sessionStorage.getItem(prizePaymentJournalKey(actorId, tournamentId)) : null;
      setPending(raw && actorId ? parsePrizePaymentIntent(raw, actorId, tournamentId) : null);
      setBlocked(!actorId);
    } catch {
      setBlocked(true);
      toast.error("Không đọc được yêu cầu payout đã lưu. Cần kiểm tra trước khi ghi nhận tiếp.");
    }
    return () => { alive.current = false; };
  }, [actorId, tournamentId]);

  const execute = async (intent: PrizePaymentIntent, recovery: boolean) => {
    if (writing.current || !alive.current) return;
    writing.current = true;
    setBusy(true);
    try {
      if (!recovery) persistPrizePaymentIntent(sessionStorage, intent);
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) =>
        PromiseLike<{ data: unknown; error: { message?: string } | null }>;
      const response = await waitForManualPlayerResponse(Promise.resolve(recovery
        ? rpc("get_tournament_prize_payment_receipt_v2", { p_request_id: intent.requestId })
        : intent.multiDayEventId?rpc("record_multi_day_prize_payment_v1",{
          p_event_id:intent.multiDayEventId,p_participation_id:intent.multiDayParticipationId,
          p_method:intent.method,p_expected_token:intent.confirmationToken,p_request_id:intent.requestId })
        : rpc("record_tournament_prize_payment_v2", { p_tournament_id: intent.tournamentId,
          p_finished_place: intent.finishedPlace, p_method: intent.method,
          p_expected_token: intent.confirmationToken, p_request_id: intent.requestId })));
      if (!alive.current) return;
      if (response.error) throw new Error(response.error.message || unknown);
      const resolution = recovery ? resolvePrizePaymentReceipt(intent, response.data) : resolvePrizePaymentResult(intent, response.data);
      if (resolution.status === "unknown") { toast.error(unknown); return; }
      clearPrizePaymentIntent(sessionStorage, intent);
      setPending(null);
      if (resolution.status === "rejected") toast.error(errors[resolution.error] || "Hệ thống từ chối yêu cầu trả thưởng. Hãy tải lại danh sách.");
      else toast.success(`${resolution.outcome === "already_paid" ? "Đã ghi nhận trả trước đó" : "Đã ghi nhận trả"} · Hạng ${intent.finishedPlace} · ${formatVND(resolution.amount)}`);
      reload();
    } catch {
      if (alive.current) toast.error(unknown);
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submit = async (place: PayoutRecipientPlace, method: string) => {
    if (!actorId || pending || blocked || writing.current) return;
    try {
      const intent = parsePrizePaymentIntent(JSON.stringify({ actorId, tournamentId, requestId: crypto.randomUUID(),
        entryId: place.entryId, recipientRef: place.recipientRef, recipientName: place.recipientName,
        finishedPlace: place.finishedPlace, prizeAmount: place.prizeAmount, confirmationToken: place.confirmationToken, method,
        multiDayEventId:place.multiDayEventId,multiDayParticipationId:place.multiDayParticipationId }), actorId, tournamentId);
      persistPrizePaymentIntent(sessionStorage, intent);
      setPending(intent);
      await execute(intent, false);
    } catch {
      if (alive.current) {
        setBlocked(true);
        toast.error("Không lưu được yêu cầu payout an toàn. Chưa gửi thao tác mới.");
      }
    }
  };
  return { pending, blocked, busy, submit,
    recover: () => pending ? execute(pending, true) : Promise.resolve(),
    retry: () => pending ? execute(pending, false) : Promise.resolve() };
}
