import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

export function TournamentBuyCloseControl({ tournamentId }: { tournamentId: string }) {
  const { user } = useAuth();
  return user?.id ? <BuyCloseControl key={`${user.id}:${tournamentId}`} tournamentId={tournamentId} /> : null;
}

function BuyCloseControl({ tournamentId }: { tournamentId: string }) {
  const [state, setState] = useState<{ phase: "loading" | "open" | "closed" | "terminal" | "unknown" | "unavailable"; name: string; closedAt: string | null }>({ phase: "loading", name: "", closedAt: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const unresolved = useRef(false);

  const load = useCallback(async () => {
    const read = ++sequence.current;
    const current = () => mounted.current && read === sequence.current;
    setState(s => ({ ...s, phase: "loading" })); setError(null);
    try {
      const { data, error: readError } = await observeTrackerContextRead(supabase.from("tournaments")
        .select("id,name,status,live_status,registration_closed_at").eq("id", tournamentId).maybeSingle());
      if (!current()) return;
      if (readError || !data || data.id !== tournamentId || typeof data.name !== "string" || typeof data.status !== "string"
        || !(data.registration_closed_at === null || typeof data.registration_closed_at === "string" && Number.isFinite(Date.parse(data.registration_closed_at)))) throw new Error("unavailable");
      if (data.registration_closed_at) unresolved.current = false;
      setState({ name: data.name, closedAt: data.registration_closed_at, phase: data.registration_closed_at ? "closed"
        : unresolved.current ? "unknown" : data.status === "completed" || data.status === "cancelled" || data.live_status === "finished" ? "terminal" : "open" });
    } catch { if (current()) { setState(s => ({ ...s, phase: unresolved.current ? "unknown" : "unavailable" })); setError("Chưa tải được trạng thái buy. Hãy kiểm tra lại trước khi thao tác."); } }
  }, [tournamentId]);

  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; sequence.current += 1; };
  }, [load]);

  const closeBuy = async () => {
    if (inFlight.current || state.phase !== "open") return;
    inFlight.current = true; setBusy(true); setDialog(false); setError(null);
    sequence.current += 1;
    try {
      const { data, error: rpcError } = await waitForManualPlayerResponse(supabase.rpc("close_tournament_buy_v1" as never, { p_tournament_id: tournamentId } as never));
      if (!mounted.current) return;
      if (rpcError?.code === "55000" || rpcError?.code === "42501") {
        const waiting = rpcError.message.includes("buy_close_paid_registration_waiting_seat");
        setError(waiting ? "Còn buy đã thu đang chờ xếp chỗ. Xử lý xong các lượt này trước khi đóng buy."
          : rpcError.code === "42501" ? "Bạn không có quyền đóng buy của giải này." : "Trạng thái giải chưa cho phép đóng buy. Hãy kiểm tra lại.");
        if (!waiting) setState(s => ({ ...s, phase: "unavailable" }));
        return;
      }
      const result = data as unknown as { status?: unknown; registrationClosedAt?: unknown } | null;
      if (rpcError || !result || !["closed", "already_closed"].includes(String(result.status))
        || typeof result.registrationClosedAt !== "string" || !Number.isFinite(Date.parse(result.registrationClosedAt))) throw new Error("unknown");
      unresolved.current = false;
      setState(s => ({ ...s, phase: "closed", closedAt: result.registrationClosedAt as string }));
    } catch {
      if (mounted.current) { unresolved.current = true; setState(s => ({ ...s, phase: "unknown" })); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  return <section aria-label="Đóng buy giải" className="min-w-0 border-t border-border pt-4">
    <h3 className="text-balance font-semibold">Đăng ký &amp; buy</h3>
    <p className="mt-1 break-words text-pretty text-sm text-muted-foreground">{state.phase === "closed" ? `Đã đóng buy lúc ${new Date(state.closedAt!).toLocaleString("vi-VN")}. Báo cáo rake đã chốt được kiểm tra tại Tài chính & Đối soát.`
      : state.phase === "loading" ? "Đang kiểm tra trạng thái buy…"
        : state.phase === "unknown" ? "Chưa xác minh được kết quả đóng buy. Kiểm tra lại trạng thái; không gửi thêm lệnh."
          : state.phase === "terminal" ? "Giải đã kết thúc hoặc bị hủy. Không thay đổi lịch sử đóng buy."
            : state.phase === "open" ? "Đang mở buy. Đóng buy sẽ dừng nhận lượt mới và lưu snapshot rake; kết quả và payout vẫn xử lý riêng."
              : "Chưa xác minh được trạng thái buy."}</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || state.phase === "loading"} onClick={() => { void load(); }}>Kiểm tra trạng thái buy</Button>
      <AlertDialog open={dialog} onOpenChange={setDialog}>
        <AlertDialogTrigger asChild><Button variant="outline" disabled={busy || state.phase !== "open"}>{busy ? "Đang đóng buy…" : "Đóng buy"}</Button></AlertDialogTrigger>
        <AlertDialogContent className="w-11/12 sm:max-w-lg">
          <AlertDialogHeader><AlertDialogTitle>Đóng buy của giải này?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">{state.name} · Thao tác một chiều, không mở lại buy. Hệ thống sẽ lưu số rake tại thời điểm đóng buy. Các lượt đã thu đang chờ xếp chỗ cần được xử lý xong trước.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction onClick={e => { e.preventDefault(); void closeBuy(); }}>Xác nhận đóng buy</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </section>;
}
