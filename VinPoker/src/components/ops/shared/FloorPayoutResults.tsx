import { useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { RealtimePayoutPanel } from "@/components/cashier/tournament-live/viewer-hub/RealtimePayoutPanel";
import type { PublicFreshness, PublicPayoutRow } from "@/components/cashier/tournament-live/viewer-hub/publicSnapshotTypes";

type FloorResults = { tournamentId: string; published: boolean; items: PublicPayoutRow[]; checkedAt: string };
export function parseFloorPayoutResults(value: unknown, tournamentId: string): FloorResults {
  const row = value as FloorResults & { ok?: boolean };
  if (!row || row.ok !== true || row.tournamentId !== tournamentId || typeof row.published !== "boolean"
    || !Number.isFinite(Date.parse(row.checkedAt)) || !Array.isArray(row.items)
    || row.items.some((item) => !item || !Number.isSafeInteger(item.fromPlace) || item.fromPlace < 1
      || item.fromPlace !== item.toPlace || !Number.isSafeInteger(item.amountPerPlayer) || item.amountPerPlayer < 0
      || !["open", "official"].includes(item.resultStatus)
      || (item.playerName !== null && typeof item.playerName !== "string"))) throw Error("floor_payout_result_invalid");
  return row;
}

export function FloorPayoutResults({ tournamentId }: { tournamentId: string }) {
  const { user, session, loading } = useOpsAuth();
  const client = useSupabaseClient();
  const lifetime = useMemo(() => crypto.randomUUID(), [client]);
  return <ScopedFloorPayoutResults key={JSON.stringify([lifetime, tournamentId, user?.id, sessionReadEpoch(session), loading])}
    tournamentId={tournamentId} ready={!loading && !!user?.id} />;
}

function ScopedFloorPayoutResults({ tournamentId, ready }: { tournamentId: string; ready: boolean }) {
  const client = useSupabaseClient();
  const [data, setData] = useState<FloorResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let active = true, reading = false;
    const controller = new AbortController();
    const load = async () => {
      if (reading) return; reading = true;
      try {
        const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
          PromiseLike<{ data: unknown; error: unknown }> & { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
        const response = await waitForManualPlayerResponse(Promise.resolve(rpc("get_floor_tournament_prize_results_v1", { p_tournament_id: tournamentId }).abortSignal(controller.signal)));
        if (!active) return;
        if (response.error) throw Error("floor_payout_unavailable");
        setData(parseFloorPayoutResults(response.data, tournamentId)); setError(false);
      } catch { if (active) { setError(true); setData(null); } }
      finally { reading = false; if (active) setLoading(false); }
    };
    void load(); const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [client, ready, tournamentId]);
  const freshness: PublicFreshness | undefined = data ? { state: "current", sourceRevision: data.checkedAt,
    projectedSourceRevision: data.checkedAt, serverCheckedAt: data.checkedAt, sourceChangedAt: null, publishedAt: null, oldestPendingAt: null } : undefined;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Kết quả nội bộ sau khi Floor chốt hạng. Cashier trao tiền rồi ghi nhận đã trả; khi đó tên người nhận mới được công bố online.</p>
    {error ? <p role="alert" className="text-sm text-amber-300">Chưa tải được kết quả nội bộ. Hệ thống sẽ thử lại.</p>
      : <RealtimePayoutPanel rows={data?.items ?? []} freshness={freshness} loading={loading} published={data?.published ?? false} requirePaymentConfirmation={false} />}
    <div className="flex flex-wrap gap-3">
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline" href={`/live/${tournamentId}?tab=prizes`} target="_blank" rel="noreferrer">Mở bảng kết quả online</a>
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline" href={`/cashier?tab=tournament_payouts&tournament=${tournamentId}`}>Cashier · Ghi nhận đã trả</a>
    </div>
  </div>;
}
