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
  }, [scope]);

  const verify = async () => {
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

  const commit = async () => {
    if (!preview || busy) return;
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-historical-settlement", {
        body: {
          mode: "commit",
          tournament_id: tournamentId,
          hand_id: handId,
          idempotency_key: preview.idempotencyKey,
          expected_source_revision: preview.sourceRevision,
          expected_source_chain_hash: preview.sourceChainHash,
          expected_outcome_hash: preview.outcomeHash,
        },
      });
      if (!current()) return;
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        const diagnostic = await diagnoseHistoricalSettlementInvocation({ data, error, mode: "commit", handId });
        if (!current()) return;
        toast.error(diagnosticFailureMessage(diagnostic.code));
        return;
      }
      setConfirmOpen(false);
      toast.success(`Đã lưu outcome hiển thị đã xác minh cho Hand #${handNumber}.`);
      onVerified();
    } finally {
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
        <Button type="button" size="sm" variant="outline" className="min-h-11 border-amber-500/50 text-amber-200" onClick={() => void verify()} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Xem trước xác minh
        </Button>
      </div>

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
            <Button type="button" size="sm" className="min-h-11 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => setConfirmOpen(true)} disabled={busy}>
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
