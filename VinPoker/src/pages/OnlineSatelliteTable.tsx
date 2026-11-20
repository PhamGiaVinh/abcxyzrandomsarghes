import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { onlinePokerClient } from "@/lib/onlinePoker/client";
import SatelliteBlindSchedule from "./SatelliteBlindSchedule";
import SatelliteBubbleEvidence from "./SatelliteBubbleEvidence";
import SatelliteTestTicket from "./SatelliteTestTicket";
import SatelliteTestTicketIssuance from "./SatelliteTestTicketIssuance";
import SatelliteRoundOperations from "./SatelliteRoundOperations";
import SatelliteRoundBubbleEvidence from "./SatelliteRoundBubbleEvidence";

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
  roundNo: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
});
const unprovisioned = z.object({
  status: z.literal("unprovisioned"),
  tableId: z.null(),
  clockRevision: z.null(),
  canProvision: z.boolean(),
});
const unassigned = z.object({
  status: z.literal("unassigned"),
  tableId: z.null(),
});
const clockReceipt = z.object({ outcome: z.enum(["ok", "stale"]) });
const roundMessages = {
  ok: "Đã mở vòng chơi.",
  stale: "Số vòng đã thay đổi. Trạng thái đã được tải lại.",
  paused: "Chạy đồng hồ trước khi mở vòng.",
  round_still_playing: "Còn bàn chưa hoàn tất vòng hiện tại.",
  qualification_reached: "Giải đã chạm ngưỡng suất TEST.",
  rebalance_required: "Cần cân bàn trước khi mở vòng tiếp theo.",
};
const roundReceipt = z.object({ outcome: z.enum([
  "ok", "stale", "paused", "round_still_playing", "qualification_reached", "rebalance_required",
]) });
const roundResultMessages = {
  ok: "Đã khóa kết quả toàn vòng.",
  stale: "Số vòng đã thay đổi. Trạng thái đã được tải lại.",
  not_ready: "Chưa đủ điều kiện khóa kết quả toàn vòng.",
  bubble_review_required: "Còn thiếu người nhận suất. TD cần phân xử bubble.",
  roster_unverified: "Danh sách ghế chưa khớp với các hand đã hoàn tất.",
};
const roundResultReceipt = z.object({ outcome: z.enum([
  "ok", "stale", "not_ready", "bubble_review_required", "roster_unverified",
]) });
const ownResult = z.object({ qualified: z.boolean(), destinationName: z.string(), lockedAt: z.string() });

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
      return z.union([tableSnapshot, unprovisioned, unassigned]).nullable().parse(data);
    },
    retry: false,
  });
  const ownQualification = useQuery({
    queryKey: ["online-satellite-own-result", actorId, pilotId],
    enabled: Boolean(actorId) && !loading && pilot.success
      && snapshot.data?.status === "closed" && snapshot.data.canPlay,
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_my_online_satellite_result_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return ownResult.nullable().parse(data);
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
  const openRound = useMutation({
    mutationFn: async (roundNo: string) => {
      const { data, error } = await client.rpc("open_online_satellite_round_v1" as never,
        { p_pilot_id: pilotId, p_expected_round: roundNo } as never);
      if (error) throw error;
      return roundReceipt.parse(data).outcome;
    },
    onSettled: () => snapshot.refetch(),
  });
  const lockRoundResult = useMutation({
    mutationFn: async (roundNo: string) => {
      const { data, error } = await client.rpc("lock_online_satellite_round_result_v1" as never,
        { p_pilot_id: pilotId, p_expected_round: roundNo } as never);
      if (error) throw error;
      return roundResultReceipt.parse(data).outcome;
    },
    onSettled: () => snapshot.refetch(),
  });
  const commandPending = clock.isPending || deal.isPending || openRound.isPending || lockRoundResult.isPending;

  const table = snapshot.data;
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
        ) : !table ? <p>Bàn chưa sẵn sàng hoặc bạn chưa có quyền truy cập.</p>
        : table.status === "unassigned" ? <p role="status">Bạn chưa được xếp bàn.</p>
        : table.status === "unprovisioned" ? (
          table.canProvision && pilot.success
            ? <SatelliteBlindSchedule pilotId={pilot.data} onCreated={() => void snapshot.refetch()} />
            : <p role="status">Bàn chưa được tạo.</p>
        )
        : (
          <div className="space-y-3">
            <p role="status">{table.status === "closed" ? "Bàn đã đóng"
              : table.qualificationReached ? "Đã chạm ngưỡng suất TEST"
              : table.running ? "Đồng hồ đang chạy" : "Đồng hồ đang tạm dừng"}</p>
            {table.status === "closed" && table.canPlay && (
              <section className="space-y-1" aria-label="Kết quả của bạn">
                <h2 className="font-semibold">Kết quả của bạn</h2>
                {ownQualification.isFetching ? <p role="status">Đang kiểm tra kết quả…</p>
                  : ownQualification.isError ? <>
                    <p role="alert">Chưa tải được kết quả.</p>
                    <Button variant="outline" onClick={() => void ownQualification.refetch()}>Tải lại kết quả</Button>
                  </>
                  : ownQualification.data ? <>
                    <p role="status">{ownQualification.data.qualified ? "Bạn đạt suất TEST." : "Bạn chưa đạt suất TEST."}</p>
                    <p className="text-sm text-muted-foreground">{ownQualification.data.destinationName}</p>
                    {ownQualification.data.qualified && pilot.success && actorId && (
                      <SatelliteTestTicket pilotId={pilot.data} actorId={actorId} />
                    )}
                  </>
                  : <p role="status">Chưa có kết quả đã khóa cho tài khoản này.</p>}
              </section>
            )}
            <div className="flex flex-wrap gap-2">
              {table.canPlay && (
                <Button asChild><Link to={`/poker/table/${table.tableId}`}>Vào bàn</Link></Button>
              )}
              {table.canManage && table.status !== "closed"
                && (!table.qualificationReached || table.running) && (
                <Button variant="outline" disabled={commandPending}
                  onClick={() => table?.tableId && clock.mutate(table)}>
                  {clock.isPending ? "Đang gửi…" : table.running ? "Tạm dừng đồng hồ" : "Chạy đồng hồ"}
                </Button>
              )}
              {table.canManage && table.status !== "closed" && table.roundNo !== undefined && (
                <Button variant="outline" disabled={!table.running || commandPending}
                  onClick={() => {
                    if (table.tableId && table.roundNo !== undefined) openRound.mutate(table.roundNo);
                  }}>
                  {openRound.isPending ? "Đang mở vòng…" : "Mở vòng tiếp theo"}
                </Button>
              )}
              {table.canManage && table.status !== "closed" && table.roundNo
                && table.roundNo !== "0" && (
                <Button variant="outline" disabled={commandPending} onClick={() => {
                  if (table.tableId && table.roundNo && table.roundNo !== "0") lockRoundResult.mutate(table.roundNo);
                }}>
                  {lockRoundResult.isPending ? "Đang khóa kết quả…" : "Khóa kết quả toàn vòng"}
                </Button>
              )}
              {table.canManage && table.running && table.status === "open"
                && !table.qualificationReached && (
                <Button variant="outline" disabled={commandPending}
                  onClick={() => table?.tableId && deal.mutate(table.tableId)}>
                  {deal.isPending ? "Đang gửi lệnh…" : "Chia ván mới"}
                </Button>
              )}
            </div>
            {openRound.data && <p role="status">{roundMessages[openRound.data]}</p>}
            {openRound.isError && <p role="alert">Chưa xác nhận được lệnh mở vòng.</p>}
            {lockRoundResult.data && <p role="status">{roundResultMessages[lockRoundResult.data]}</p>}
            {lockRoundResult.data === "bubble_review_required" && table.canManage
              && table.roundNo && pilot.success && actorId && (
              <SatelliteRoundBubbleEvidence pilotId={pilot.data} actorId={actorId} roundNo={table.roundNo} />
            )}
            {lockRoundResult.isError && <p role="alert">Chưa xác nhận được lệnh khóa kết quả toàn vòng.</p>}
            {deal.data?.outcome === "ok" && <p role="status">Máy chủ đã chia ván mới.</p>}
            {deal.data?.outcome === "already_active" && <p role="status">Bàn đang chơi một ván.</p>}
            {(deal.isError || deal.data?.outcome === "disabled") && (
              <p role="alert">Chưa chia được ván. Kiểm tra đồng hồ và số người còn chip.</p>
            )}
            {clock.isError && <p role="alert">Chưa xác nhận được lệnh. Trạng thái bàn đã được tải lại.</p>}
            {clock.data === "stale" && <p role="status">Đồng hồ đã thay đổi. Hãy kiểm tra trạng thái mới.</p>}
            {table.canManage && table.roundNo !== undefined && pilot.success && actorId && (
              <SatelliteRoundOperations pilotId={pilot.data} actorId={actorId} roundNo={table.roundNo} />
            )}
            {table.canManage && table.roundNo === undefined && pilot.success && actorId && (
              <SatelliteBubbleEvidence pilotId={pilot.data} actorId={actorId}
                canLock={table.qualificationReached === true && table.status !== "closed"}
                onLocked={() => void snapshot.refetch()} />
            )}
            {table.canManage && table.status === "closed" && pilot.success && actorId && (
              <SatelliteTestTicketIssuance pilotId={pilot.data} actorId={actorId} />
            )}
          </div>
        )}
    </section>
  );
}
