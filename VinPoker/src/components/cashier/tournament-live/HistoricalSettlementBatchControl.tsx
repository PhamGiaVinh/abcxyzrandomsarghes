import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ScanSearch, ShieldCheck } from "lucide-react";
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
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { parseHistoricalSettlementDisplayPreview } from "@/lib/tracker-poker/historicalSettlementDisplay";
import { diagnoseHistoricalSettlementInvocation } from "@/lib/tracker-poker/historicalSettlementDiagnostics";
import { parseReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";
import {
  commitHistoricalSettlementBatch,
  previewHistoricalSettlementBatch,
  type HistoricalSettlementBatchCandidate,
  type HistoricalSettlementBatchGateway,
  type HistoricalSettlementCommitResult,
  type HistoricalSettlementPreviewResult,
} from "@/lib/tracker-poker/historicalSettlementBatch";

type Props = {
  tournamentId: string;
  candidates: HistoricalSettlementBatchCandidate[];
  onSelectHand: (handId: string) => void;
  onCommitted: () => void;
};

function resultLabel(result: HistoricalSettlementPreviewResult | HistoricalSettlementCommitResult): string {
  if (result.kind === "ready") return "Đủ dữ liệu";
  if (result.kind === "verified") return "Đã xác minh";
  const labels: Record<string, string> = {
    historical_preview_transport_failed: "Lỗi kết nối khi gọi máy chủ",
    historical_preview_unauthorized: "Phiên đăng nhập không hợp lệ",
    historical_preview_forbidden: "Không có quyền xác minh hand này",
    historical_preview_not_found: "Không tìm thấy hand trên máy chủ",
    historical_preview_verification_blocked: "Máy chủ chặn xác minh dữ liệu hand",
    historical_preview_server_failed: "Máy chủ xác minh tạm thời lỗi",
    historical_commit_transport_failed: "Lỗi kết nối khi lưu outcome",
    historical_commit_unauthorized: "Phiên đăng nhập không hợp lệ",
    historical_commit_forbidden: "Không có quyền lưu outcome",
    historical_commit_not_found: "Không tìm thấy hand trên máy chủ",
    historical_commit_verification_blocked: "Máy chủ chặn lưu outcome",
    historical_commit_server_failed: "Máy chủ lưu outcome tạm thời lỗi",
    stored_ending_stack_mismatch: "Stack đã lưu không khớp",
    incomplete_showdown_cards: "Thiếu bài showdown",
    invalid_historical_hand: "Dữ liệu hand không hợp lệ",
    stale_historical_preview: "Dữ liệu vừa thay đổi",
    invalid_existing_settlement: "Outcome cũ không hợp lệ",
    invalid_preview_payload: "Máy chủ trả preview lỗi",
    preview_request_failed: "Không gọi được máy chủ",
    commit_request_failed: "Không lưu được outcome",
  };
  return labels[result.code] ?? `Cần sửa hand (${result.code})`;
}

export function HistoricalSettlementBatchControl({ tournamentId, candidates, onSelectHand, onCommitted }: Props) {
  const supabase = useSupabaseClient();
  const { user } = useAuth();
  const [storedPreviews, setPreviews] = useState<HistoricalSettlementPreviewResult[]>([]);
  const [storedCommits, setCommits] = useState<HistoricalSettlementCommitResult[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [mode, setMode] = useState<"idle" | "preview" | "commit">("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const runRef = useRef<{mode: "preview" | "commit"; generation: number} | null>(null);
  const scope = JSON.stringify([user?.id, tournamentId]);
  const scopeRef = useRef({ key: scope, generation: 0 });
  if (scopeRef.current.key !== scope) scopeRef.current = { key: scope, generation: scopeRef.current.generation + 1 };
  const dataGenerationRef = useRef(0);
  const previews = dataGenerationRef.current === scopeRef.current.generation ? storedPreviews : [];
  const commits = dataGenerationRef.current === scopeRef.current.generation ? storedCommits : [];
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; scopeRef.current.generation += 1; };
  }, []);

  useEffect(() => {
    setPreviews([]);
    setCommits([]);
    setProgress({ completed: 0, total: 0 });
    setMode("idle");
    setConfirmOpen(false);
    runRef.current = null;
  }, [scope]);

  const gatewayFor = (isCurrent: () => boolean): HistoricalSettlementBatchGateway => ({
    async preview(candidate) {
      if (!isCurrent()) throw new Error("historical_scope_changed");
      const { data: existing, error: existingError } = await supabase.rpc(
        "get_public_tournament_settlement" as never,
        { p_hand_id: candidate.handId } as never,
      );
      if (!isCurrent()) throw new Error("historical_scope_changed");
      if (!existingError && existing && typeof existing === "object" && Object.keys(existing).length > 0) {
        return parseReplayPublicSettlement(existing)
          ? { kind: "verified", candidate }
          : { kind: "blocked", candidate, code: "invalid_existing_settlement" };
      }
      const { data, error } = await supabase.functions.invoke("tournament-historical-settlement", {
        body: { mode: "preview", tournament_id: tournamentId, hand_id: candidate.handId },
      });
      if (!isCurrent()) throw new Error("historical_scope_changed");
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        const diagnostic = await diagnoseHistoricalSettlementInvocation({
          data,
          error,
          mode: "preview",
          handId: candidate.handId,
        });
        const code = diagnostic.code;
        if (code === "historical_settlement_already_exists") return { kind: "verified", candidate };
        return { kind: "blocked", candidate, code, diagnostic };
      }
      const parsed = parseHistoricalSettlementDisplayPreview(data, crypto.randomUUID());
      if (!parsed || parsed.handId !== candidate.handId) {
        return { kind: "blocked", candidate, code: "invalid_preview_payload" };
      }
      return { kind: "ready", candidate, preview: parsed };
    },
    async commit(result) {
      if (!isCurrent()) throw new Error("historical_scope_changed");
      const { candidate, preview } = result;
      const { data, error } = await supabase.functions.invoke("tournament-historical-settlement", {
        body: {
          mode: "commit",
          tournament_id: tournamentId,
          hand_id: candidate.handId,
          idempotency_key: preview.idempotencyKey,
          expected_source_revision: preview.sourceRevision,
          expected_source_chain_hash: preview.sourceChainHash,
          expected_outcome_hash: preview.outcomeHash,
        },
      });
      if (!isCurrent()) throw new Error("historical_scope_changed");
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        const diagnostic = await diagnoseHistoricalSettlementInvocation({
          data,
          error,
          mode: "commit",
          handId: candidate.handId,
        });
        return { kind: "blocked", candidate, code: diagnostic.code, diagnostic };
      }
      return { kind: "verified", candidate };
    },
  });

  const runPreview = async () => {
    if (runRef.current || candidates.length === 0) return;
    const run = { mode: "preview" as const, generation: scopeRef.current.generation };
    const isCurrent = () => mountedRef.current && run.generation === scopeRef.current.generation && runRef.current === run;
    runRef.current = run;
    dataGenerationRef.current = run.generation;
    setMode("preview");
    setPreviews([]);
    setCommits([]);
    setProgress({ completed: 0, total: candidates.length });
    try {
      const next = await previewHistoricalSettlementBatch(candidates, gatewayFor(isCurrent), (completed, total) => {
        if (isCurrent()) setProgress({ completed, total });
      }, isCurrent);
      if (!isCurrent()) return;
      setPreviews(next);
      const ready = next.filter((result) => result.kind === "ready").length;
      const blocked = next.filter((result) => result.kind === "blocked").length;
      toast.success(`Đã kiểm tra ${next.length} hand: ${ready} đủ dữ liệu, ${blocked} cần sửa.`);
    } finally {
      if (runRef.current === run) { runRef.current = null; if (mountedRef.current) setMode("idle"); }
    }
  };

  const runCommit = async () => {
    if (runRef.current || previews.every((result) => result.kind !== "ready")) return;
    const run = { mode: "commit" as const, generation: scopeRef.current.generation };
    const isCurrent = () => mountedRef.current && run.generation === scopeRef.current.generation && runRef.current === run;
    runRef.current = run;
    setMode("commit");
    setConfirmOpen(false);
    const readyCount = previews.filter((result) => result.kind === "ready").length;
    setProgress({ completed: 0, total: readyCount });
    try {
      const next = await commitHistoricalSettlementBatch(previews, gatewayFor(isCurrent), (completed, total) => {
        if (isCurrent()) setProgress({ completed, total });
      }, isCurrent);
      if (!isCurrent()) return;
      setCommits(next);
      const verified = next.filter((result) => result.kind === "verified").length;
      const blocked = next.length - verified;
      const commitByHandId = new Map(next.map((result) => [result.candidate.handId, result]));
      setPreviews(previews.map((result) => {
        const commit = commitByHandId.get(result.candidate.handId);
        if (!commit) return result;
        if (commit.kind === "verified") return { kind: "verified", candidate: result.candidate };
        return { kind: "blocked", candidate: result.candidate, code: commit.code, diagnostic: commit.diagnostic };
      }));
      if (blocked > 0) toast.warning(`Đã xác minh ${verified} hand; ${blocked} hand bị chặn an toàn.`);
      else toast.success(`Đã xác minh ${verified} hand. Replay sẽ hiện ranking và winner glow.`);
      onCommitted();
    } finally {
      if (runRef.current === run) { runRef.current = null; if (mountedRef.current) setMode("idle"); }
    }
  };

  const readyCount = previews.filter((result) => result.kind === "ready").length;
  const verifiedCount = previews.filter((result) => result.kind === "verified").length;
  const blockedCount = previews.filter((result) => result.kind === "blocked").length;
  const busy = mode !== "idle";

  return (
    <section className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/25 via-card to-amber-950/10 p-3 md:p-4" aria-labelledby="historical-batch-title">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p id="historical-batch-title" className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
            <ScanSearch className="h-4 w-4" aria-hidden="true" /> Kiểm tra ranking toàn bộ danh sách
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Máy chủ đọc lại board, hole cards, action và stack đã lưu. Hand sai hoặc thiếu dữ liệu bị chặn; không có winner nào được đoán ở trình duyệt.
          </p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 border-emerald-500/40 text-emerald-200" onClick={() => void runPreview()} disabled={busy || candidates.length === 0}>
          {mode === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          {mode === "preview" ? `Đang kiểm tra ${progress.completed}/${progress.total}` : `Kiểm tra ${candidates.length} hand`}
        </Button>
      </div>

      {previews.length > 0 && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-2"><strong className="block text-lg text-emerald-300">{readyCount}</strong>Đủ dữ liệu</div>
            <div className="rounded-lg border border-sky-500/25 bg-sky-950/20 p-2"><strong className="block text-lg text-sky-300">{verifiedCount}</strong>Đã xác minh</div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-2"><strong className="block text-lg text-amber-300">{blockedCount}</strong>Cần sửa</div>
          </div>

          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {previews.map((result) => (
              <button
                key={result.candidate.handId}
                type="button"
                onClick={() => onSelectHand(result.candidate.handId)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/35 px-3 py-2 text-left text-xs hover:border-emerald-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <span className="min-w-0 truncate font-medium">
                  {result.candidate.tableName ? `${result.candidate.tableName} · ` : ""}Hand #{result.candidate.handNumber}
                </span>
                <span
                  className={result.kind === "blocked" ? "text-right text-amber-300" : result.kind === "ready" ? "text-emerald-300" : "text-sky-300"}
                  data-historical-diagnostic={result.kind === "blocked" && result.diagnostic
                    ? `${result.diagnostic.httpStatus ?? "no-http"}:${result.diagnostic.code}`
                    : undefined}
                >
                  {result.kind === "blocked" ? <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />}
                  {resultLabel(result)}
                </span>
              </button>
            ))}
          </div>

          {FEATURES.trackerHistoricalSettlementBulk ? (
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Button type="button" className="min-h-11 w-full bg-emerald-400 text-emerald-950 hover:bg-emerald-300" disabled={busy || readyCount === 0} onClick={() => setConfirmOpen(true)}>
                {mode === "commit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "commit" ? `Đang lưu ${progress.completed}/${progress.total}` : `Lưu ${readyCount} hand đủ dữ liệu`}
              </Button>
              <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg">
                <AlertDialogHeader>
                  <AlertDialogTitle>Xác minh hiển thị {readyCount} hand?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Mỗi hand sẽ được server tính lại và kiểm tra CAS lần nữa. Chỉ outcome hiển thị được tạo; hand, chip, seat, entry và các hand sau không thay đổi. Hand bị lỗi vẫn bị chặn riêng.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Huỷ</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void runCommit(); }}>
                    Xác nhận lưu outcome hiển thị
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-xs leading-relaxed text-amber-100">
              Lưu hàng loạt đang khoá an toàn. Chọn từng hand “Đủ dữ liệu” để xem preview và lưu riêng; hand lỗi sẽ dẫn thẳng tới nút “Sửa dữ liệu hand”.
            </p>
          )}

          {commits.some((result) => result.kind === "blocked") && (
            <p className="text-xs text-amber-300">Một số hand đổi dữ liệu trong lúc lưu hoặc không còn hợp lệ. Hãy chạy kiểm tra lại; không có ghi dở bên trong từng hand.</p>
          )}
        </div>
      )}
    </section>
  );
}
