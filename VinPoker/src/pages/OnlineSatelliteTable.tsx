import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { onlinePokerClient } from "@/lib/onlinePoker/client";
import SatelliteBlindSchedule from "./SatelliteBlindSchedule";
import SatelliteBubbleEvidence from "./SatelliteBubbleEvidence";

const pilotIdentifier = z.string().uuid();
const tableSnapshot = z.object({
  tableId: z.string().uuid(),
  clockRevision: z.string().regex(/^[1-9]\d*$/),
  running: z.boolean(),
  status: z.enum(["open", "paused", "closed"]),
  canManage: z.boolean(),
  canPlay: z.boolean(),
  canProvision: z.literal(false),
  qualificationReached: z.boolean().optional(),
});
const unprovisioned = z.object({
  status: z.literal("unprovisioned"),
  tableId: z.null(),
  clockRevision: z.null(),
  canProvision: z.boolean(),
});
const clockReceipt = z.object({ outcome: z.enum(["ok", "stale"]) });

export default function OnlineSatelliteTable() {
  const { user, loading } = useAuth();
  const { pilotId } = useParams();
  return <OnlineSatelliteTableContent key={`${user?.id ?? ""}:${pilotId ?? ""}`}
    actorId={user?.id} pilotId={pilotId} loading={loading} />;
}

export function OnlineSatelliteTableContent({ actorId, pilotId, loading = false }: {
  actorId?: string;
  pilotId?: string;
  loading?: boolean;
}) {
  const pilot = pilotIdentifier.safeParse(pilotId);
  const client = useSupabaseClient();
  const snapshot = useQuery({
    queryKey: ["online-satellite-table", actorId, pilotId],
    enabled: !loading && Boolean(actorId) && pilot.success,
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_online_satellite_table_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return z.union([tableSnapshot, unprovisioned]).nullable().parse(data);
    },
    retry: false,
  });
  const clock = useMutation({
    mutationFn: async (table: z.infer<typeof tableSnapshot>) => {
      const { data, error } = await client.rpc("set_online_satellite_clock_v1" as never, {
        p_pilot_id: pilotId,
        p_expected_revision: table.clockRevision,
        p_running: !table.running,
      } as never);
      if (error) throw error;
      return clockReceipt.parse(data).outcome;
    },
    onSettled: () => snapshot.refetch(),
  });
  const deal = useMutation({
    mutationFn: (tableId: string) => onlinePokerClient.startHand(tableId),
    onSettled: () => snapshot.refetch(),
  });

  return (
    <section className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Bàn Satellite TEST</h1>
      {loading || snapshot.isFetching ? <p role="status">Đang kiểm tra trạng thái bàn…</p>
        : !actorId ? <p>Đăng nhập để mở bàn Satellite.</p>
        : snapshot.isError ? (
          <div className="space-y-2">
            <p role="alert">Chưa đọc được trạng thái bàn.</p>
            <Button variant="outline" onClick={() => void snapshot.refetch()}>Thử lại</Button>
          </div>
        ) : !snapshot.data ? <p>Bàn chưa sẵn sàng hoặc bạn chưa có quyền truy cập.</p>
        : snapshot.data.status === "unprovisioned" ? (
          snapshot.data.canProvision && pilot.success
            ? <SatelliteBlindSchedule pilotId={pilot.data} onCreated={() => void snapshot.refetch()} />
            : <p role="status">Bàn chưa được tạo.</p>
        )
        : (
          <div className="space-y-3">
            <p role="status">{snapshot.data.status === "closed" ? "Bàn đã đóng"
              : snapshot.data.qualificationReached ? "Đã chạm ngưỡng suất TEST"
              : snapshot.data.running ? "Đồng hồ đang chạy" : "Đồng hồ đang tạm dừng"}</p>
            <div className="flex flex-wrap gap-2">
              {snapshot.data.canPlay && (
                <Button asChild><Link to={`/poker/table/${snapshot.data.tableId}`}>Vào bàn</Link></Button>
              )}
              {snapshot.data.canManage && snapshot.data.status !== "closed"
                && (!snapshot.data.qualificationReached || snapshot.data.running) && (
                <Button variant="outline" disabled={clock.isPending || deal.isPending}
                  onClick={() => snapshot.data?.status !== "unprovisioned" && snapshot.data && clock.mutate(snapshot.data)}>
                  {clock.isPending ? "Đang gửi…" : snapshot.data.running ? "Tạm dừng đồng hồ" : "Chạy đồng hồ"}
                </Button>
              )}
              {snapshot.data.canManage && snapshot.data.running && snapshot.data.status === "open"
                && !snapshot.data.qualificationReached && (
                <Button variant="outline" disabled={clock.isPending || deal.isPending}
                  onClick={() => snapshot.data?.tableId && deal.mutate(snapshot.data.tableId)}>
                  {deal.isPending ? "Đang gửi lệnh…" : "Chia ván mới"}
                </Button>
              )}
            </div>
            {deal.data?.outcome === "ok" && <p role="status">Máy chủ đã chia ván mới.</p>}
            {deal.data?.outcome === "already_active" && <p role="status">Bàn đang chơi một ván.</p>}
            {(deal.isError || deal.data?.outcome === "disabled") && (
              <p role="alert">Chưa chia được ván. Kiểm tra đồng hồ và số người còn chip.</p>
            )}
            {clock.isError && <p role="alert">Chưa xác nhận được lệnh. Trạng thái bàn đã được tải lại.</p>}
            {clock.data === "stale" && <p role="status">Đồng hồ đã thay đổi. Hãy kiểm tra trạng thái mới.</p>}
            {snapshot.data.canManage && pilot.success && actorId && (
              <SatelliteBubbleEvidence pilotId={pilot.data} actorId={actorId}
                canLock={snapshot.data.qualificationReached === true && snapshot.data.status !== "closed"}
                onLocked={() => void snapshot.refetch()} />
            )}
          </div>
        )}
    </section>
  );
}
