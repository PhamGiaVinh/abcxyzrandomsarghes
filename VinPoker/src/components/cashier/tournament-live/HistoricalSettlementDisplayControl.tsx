import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  parseHistoricalSettlementDisplayPreview,
  type HistoricalSettlementDisplayPreview,
} from "@/lib/tracker-poker/historicalSettlementDisplay";
import { diagnoseHistoricalSettlementInvocation } from "@/lib/tracker-poker/historicalSettlementDiagnostics";
import { useAuth } from "@/hooks/useAuth";
import { createSingleFlightGuard } from "@/lib/singleFlight";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { createHistoricalCommitIntent, readHistoricalCommitJournal, persistHistoricalCommitJournal,
  settleHistoricalCommitJournal, historicalCommitReceiptState, type HistoricalCommitIntent } from "@/lib/tracker-poker/historicalCommitIntent";

type HistoricalSettlementDisplayControlProps = {
  tournamentId: string;
  handId: string;
  handNumber: number;
  onVerified: () => void;
};

function formatStack(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function failureMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Không thể xác minh hand cũ trên máy chủ.";
  const code = "code" in data && typeof data.code === "string" ? data.code : "";
  if (code === "stored_ending_stack_mismatch") {
    return "Stack đã lưu không khớp kết quả tính lại. Không tạo glow hoặc payout cho hand này.";
  }
  if (code === "incomplete_showdown_cards") {
    return "Hand không đủ bài showdown đã lưu để xác minh kết quả.";
  }
  if (code === "historical_settlement_already_exists") {
    return "Hand này đã có outcome đã xác minh. Hãy mở Replay để xem.";
  }
  return "Không thể xác minh hand cũ trên máy chủ.";
}

function diagnosticFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    historical_preview_transport_failed: "Lỗi kết nối khi gọi máy chủ xác minh.",
    historical_preview_unauthorized: "Phiên đăng nhập không hợp lệ.",
    historical_preview_forbidden: "Không có quyền xác minh hand này.",
    historical_preview_not_found: "Không tìm thấy hand trên máy chủ.",
    historical_preview_verification_blocked: "Máy chủ chặn xác minh vì dữ liệu hand không hợp lệ.",
    historical_preview_server_failed: "Máy chủ xác minh tạm thời lỗi. Chưa ghi dữ liệu nào.",
    historical_commit_transport_failed: "Lỗi kết nối khi lưu outcome.",
    historical_commit_unauthorized: "Phiên đăng nhập không hợp lệ.",
    historical_commit_forbidden: "Không có quyền lưu outcome.",
    historical_commit_not_found: "Không tìm thấy hand trên máy chủ.",
    historical_commit_verification_blocked: "Máy chủ chặn lưu outcome.",
    historical_commit_server_failed: "Máy chủ lưu outcome tạm thời lỗi. Chưa ghi dữ liệu nào.",
  };
  const message = messages[code] ?? failureMessage({ code });
  return messages[code] ? message : `${message} (Mã: ${code})`;
}

/**
 * Owner-only by the server boundary. This control only asks the Edge function
 * to verify stored history; it never submits cards, winners, stack values, or
 * a settlement chosen in the browser.
 */
export function HistoricalSettlementDisplayControl({
  tournamentId,
  handId,
  handNumber,
  onVerified,
}: HistoricalSettlementDisplayControlProps) {
  const supabase = useSupabaseClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [storedPreview, setPreview] = useState<HistoricalSettlementDisplayPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [storedPending, setPending] = useState<HistoricalCommitIntent | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const commitFlightRef = useRef(createSingleFlightGuard());
  const pending = storedPending?.expected_actor_id === user?.id && storedPending?.tournament_id === tournamentId
    && storedPending?.hand_id === handId ? storedPending : null;
  const scope = JSON.stringify([user?.id, tournamentId, handId]);
  const scopeRef = useRef({ key: scope, generation: 0 });
  if (scopeRef.current.key !== scope) scopeRef.current = { key: scope, generation: scopeRef.current.generation + 1 };
  const previewGenerationRef = useRef(-1);
  const preview = previewGenerationRef.current === scopeRef.current.generation ? storedPreview : null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; scopeRef.current.generation += 1; };
  }, []);

  useEffect(() => {
    setPreview(null);
    setConfirmOpen(false);
    setBusy(false);
    setPending(null);
    setJournalError(null);
    if (user?.id) {
      try { setPending(readHistoricalCommitJournal(sessionStorage, { expected_actor_id: user.id, tournament_id: tournamentId, hand_id: handId })); }
      catch { setJournalError("Không đọc được mã phục hồi History; giữ dữ liệu trình duyệt và chưa gửi yêu cầu mới."); }
    }
  }, [scope, handId, tournamentId, user?.id]);

  const verify = async () => {
    try {
      if (journalError || (user?.id && readHistoricalCommitJournal(sessionStorage, { expected_actor_id: user.id, tournament_id: tournamentId, hand_id: handId }))) {
        toast.error("Còn yêu cầu History chưa rõ kết quả. Kiểm tra receipt trước khi tạo preview mới."); return;
      }
    } catch { toast.error("Không đọc được mã phục hồi History; chưa gửi yêu cầu mới."); return; }
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation;
    setBusy(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-historical-settlement", {
        body: { mode: "preview", tournament_id: tournamentId, hand_id: handId },
      });
      if (!current()) return;
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        const diagnostic = await diagnoseHistoricalSettlementInvocation({ data, error, mode: "preview", handId });
        if (!current()) return;
        toast.error(diagnosticFailureMessage(diagnostic.code));
        return;
      }
      const parsed = parseHistoricalSettlementDisplayPreview(data, crypto.randomUUID());
      if (!parsed || parsed.handId !== handId) {
        toast.error("Máy chủ trả outcome không hợp lệ. Chưa lưu dữ liệu nào.");
        return;
      }
      previewGenerationRef.current = generation;
      setPreview(parsed);
    } catch (error) {
      const diagnostic = await diagnoseHistoricalSettlementInvocation({ data: null, error, mode: "preview", handId });
      if (!current()) return;
      toast.error(diagnosticFailureMessage(diagnostic.code));
    } finally {
      if (current()) setBusy(false);
    }
  };

  const readIntentReceipt = async (intent: HistoricalCommitIntent, current: () => boolean) => {
    const { data, error } = await observeTrackerContextRead(supabase.functions.invoke("tournament-historical-settlement", {
      body: { mode: "receipt", ...intent },
    }));
    if (!current()) return null;
    const state = historicalCommitReceiptState(data, intent);
    if (error || state === null) {
      throw new Error("Chưa xác minh được receipt History. Giữ nguyên mã yêu cầu; không tạo key mới.");
    }
    return state;
  };
  const acknowledgeIntent = (intent: HistoricalCommitIntent) => {
    try { settleHistoricalCommitJournal(sessionStorage, intent); setPending(null); }
    catch { toast.error("Máy chủ đã xác nhận commit nhưng chưa dọn được mã phục hồi. Không tạo yêu cầu mới."); }
    setConfirmOpen(false);
    setPreview(null);
    toast.success("Máy chủ đã xác nhận request History đã commit. Đang tải lại kết quả hiện hành.");
    onVerified();
  };
  const recoverIntent = async (intent: HistoricalCommitIntent, current: () => boolean) => {
    const state = await readIntentReceipt(intent, current);
    if (!current()) return;
    if (state !== "found") throw new Error("Chưa tìm thấy receipt History; chưa thể kết luận request đã thất bại.");
    acknowledgeIntent(intent);
  };

  const recoverPending = async () => {
    if (!pending || busy || !commitFlightRef.current.begin()) return;
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation;
    setBusy(true);
    try { await recoverIntent(pending, current); }
    catch { if (current()) toast.error("Chưa xác minh được receipt History. Giữ nguyên mã yêu cầu để kiểm tra lại."); }
    finally { commitFlightRef.current.finish(); if (current()) setBusy(false); }
  };

  const retryPending = async () => {
    if (!pending || busy || !confirm("Tra receipt trước; chỉ khi chưa tìm thấy mới gửi lại đúng request ID và revision/hash cũ. Không tạo preview mới. Tiếp tục?")) return;
    if (!commitFlightRef.current.begin()) return;
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation;
    setBusy(true);
    try {
      const prior = readHistoricalCommitJournal(sessionStorage, pending);
      if (!prior || prior.idempotency_key !== pending.idempotency_key) throw new Error("journal_changed");
      persistHistoricalCommitJournal(sessionStorage, pending);
      const state = await readIntentReceipt(pending, current);
      if (!current()) return;
      if (state === "found") { acknowledgeIntent(pending); return; }
      // The same immutable journal must still exist after the receipt await.
      if (!readHistoricalCommitJournal(sessionStorage, pending)) throw new Error("journal_changed");
      persistHistoricalCommitJournal(sessionStorage, pending);
      try { await waitForManualPlayerResponse(supabase.functions.invoke("tournament-historical-settlement", {
        body: { mode: "commit", ...pending },
      })); } catch { /* Explicit same-key retry still needs exact receipt proof. */ }
      if (current()) await recoverIntent(pending, current);
    } catch {
      if (current()) toast.error("Chưa xác minh được request History cũ; giữ nguyên mã và revision/hash, không tạo yêu cầu mới.");
    } finally { commitFlightRef.current.finish(); if (current()) setBusy(false); }
  };

  const commit = async () => {
    if (!preview || busy || !user?.id || !commitFlightRef.current.begin()) return;
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation;
    setBusy(true);
    setConfirmOpen(false);
    let intent: HistoricalCommitIntent | null = null;
    let journalReady = false;
    try {
      intent = readHistoricalCommitJournal(sessionStorage, { expected_actor_id: user.id, tournament_id: tournamentId, hand_id: handId });
      if (intent) { journalReady = true; setPending(intent); await recoverIntent(intent, current); return; }
      intent = createHistoricalCommitIntent(user.id, tournamentId, preview);
      persistHistoricalCommitJournal(sessionStorage, intent);
      journalReady = true;
      setPending(intent);
      // The durable intent exists before dispatch. Even a transport timeout is
      // not permission to mint another key or overwrite this preview fingerprint.
      try { await waitForManualPlayerResponse(supabase.functions.invoke("tournament-historical-settlement", {
        body: { mode: "commit", ...intent },
      })); } catch { /* Read the unchanged receipt once; never retry the writer. */ }
      if (!current()) return;
      await recoverIntent(intent, current);
    } catch {
      if (current()) {
        if (!journalReady) setJournalError("Không lưu được mã yêu cầu an toàn; chưa gửi commit History.");
        toast.error(journalReady
        ? "Chưa rõ kết quả History; giữ nguyên mã yêu cầu và kiểm tra receipt, không tạo key mới."
        : "Không lưu được mã yêu cầu an toàn; chưa gửi commit History.");
      }
    } finally {
      commitFlightRef.current.finish();
      if (current()) setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <ShieldCheck className="h-4 w-4" /> Xác minh hiển thị Hand cũ
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Chỉ tạo ranking, glow và payout hiển thị khi server chứng minh kết quả khớp đúng stack đã lưu. Không sửa hand, chip hoặc kết quả giải.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="min-h-11 border-amber-500/50 text-amber-200" onClick={() => void verify()} disabled={busy || !!pending || !!journalError}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Xem trước xác minh
        </Button>
      </div>

      {journalError && <p role="alert" className="mt-2 text-xs text-destructive">{journalError}</p>}
      {pending && <div role="status" className="mt-3 space-y-2 text-xs">
        <p>History đang chờ đối chiếu receipt. Chưa thể kết luận request đã ghi hay chưa.</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void recoverPending()}>Kiểm tra receipt yêu cầu cũ</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void retryPending()}>Kiểm tra rồi gửi lại cùng mã</Button>
      </div>}

      {preview && (
        <div className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
          <p className="text-xs font-medium text-emerald-300">Server đã xác minh outcome, chưa ghi gì vào dữ liệu hand.</p>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {preview.settlement.players.filter((player) => player.potAward > 0 || player.refund > 0).map((player) => (
              <div key={player.playerId} className="rounded border border-emerald-500/20 bg-emerald-950/20 px-2 py-1.5 font-mono text-emerald-200">
                {player.potAward > 0 && <span>Pot +{formatStack(player.potAward)}</span>}
                {player.potAward > 0 && player.refund > 0 && <span> · </span>}
                {player.refund > 0 && <span>Hoàn +{formatStack(player.refund)}</span>}
              </div>
            ))}
          </div>
          {preview.settlement.handRanks.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Ranking: {preview.settlement.handRanks.map((rank) => `${rank.category} (${rank.kickers.join("-") || "best five"})`).join(" · ")}
            </p>
          )}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Button type="button" size="sm" className="min-h-11 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => setConfirmOpen(true)} disabled={busy || !!pending}>
              Lưu outcome hiển thị đã xác minh
            </Button>
            <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Lưu kết quả hiển thị cho Hand #{handNumber}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Chỉ lưu outcome server đã xác minh để Replay hiển thị ranking, winner glow và payout. Hand, chip, entry, seat và các hand sau không bị thay đổi.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Huỷ</AlertDialogCancel>
                <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void commit(); }}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Xác nhận lưu hiển thị
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
