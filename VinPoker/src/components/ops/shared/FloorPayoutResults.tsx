import { usePublicSpectatorSnapshot } from "@/components/cashier/tournament-live/viewer-hub/usePublicSpectatorSnapshot";
import { RealtimePayoutPanel } from "@/components/cashier/tournament-live/viewer-hub/RealtimePayoutPanel";

export function FloorPayoutResults({ tournamentId }: { tournamentId: string }) {
  const { snapshot, loading, networkError } = usePublicSpectatorSnapshot(tournamentId, true);
  const payout = snapshot?.sections.payout;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Kết quả đã chốt từ hệ thống. Khi bust, kiểm tra hạng và thưởng trong hộp xác nhận. Cashier xác nhận riêng sau khi trao tiền thực tế.</p>
    {networkError && <p role="alert" className="text-sm text-amber-300">Chưa cập nhật được kết quả mới. Đang kết nối lại.</p>}
    {snapshot?.access === "revoked" ? <p role="alert">Giải chưa mở bảng kết quả công khai.</p>
      : <RealtimePayoutPanel rows={payout?.items ?? []} freshness={networkError ? undefined : payout?.freshness} loading={loading} published={payout?.published ?? false} />}
    <div className="flex flex-wrap gap-3">
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline" href={`/live/${tournamentId}?tab=prizes`} target="_blank" rel="noreferrer">Mở bảng kết quả online</a>
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline" href={`/cashier?tab=tournament_payouts&tournament=${tournamentId}`}>Cashier · Ghi nhận đã trả</a>
    </div>
  </div>;
}
