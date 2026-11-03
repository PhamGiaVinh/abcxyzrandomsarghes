import { usePublicSpectatorSnapshot } from "./usePublicSpectatorSnapshot";
import { RealtimePayoutPanel } from "./RealtimePayoutPanel";

// Legacy and realtime viewers share the sanitized, payment-confirmed contract.
export function PrizesPanel({ tournamentId }: { tournamentId: string; rpt?: boolean }) {
  const { snapshot, loading, networkError } = usePublicSpectatorSnapshot(tournamentId, true);
  const payout = snapshot?.sections.payout;
  return <div className="space-y-3">
    {networkError && <p role="alert" className="text-sm text-muted-foreground">Chưa cập nhật được bảng giải thưởng. Đang kết nối lại.</p>}
    <RealtimePayoutPanel rows={payout?.items ?? []} freshness={networkError ? undefined : payout?.freshness}
      loading={loading} published={snapshot?.access === "public" && !!payout?.published} />
  </div>;
}
