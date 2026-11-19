import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const roundDetails = z.object({
  roundNo: z.string(),
  tables: z.array(z.object({
    tableId: z.string().uuid(),
    maxSeats: z.number().int().positive(),
    status: z.enum(["open", "paused", "closed"]),
    roundStatus: z.enum(["not_opened", "awaiting_deal", "playing", "complete", "voided"]),
    seats: z.array(z.object({
      id: z.string().uuid(), seatNo: z.number().int(), stack: z.string(),
      canMove: z.boolean(), placementRevision: z.string(),
    })),
  })),
});
const states = {
  not_opened: "Chưa mở vòng",
  awaiting_deal: "Chờ chia ván",
  playing: "Đang chơi",
  complete: "Đã hoàn tất",
  voided: "Ván đã hủy",
};

export default function SatelliteRoundOperations({ pilotId, actorId, roundNo }: {
  pilotId: string;
  actorId: string;
  roundNo: string;
}) {
  const client = useSupabaseClient();
  const details = useQuery({
    queryKey: ["satellite-round-operations", actorId, pilotId, roundNo],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_online_satellite_round_operations_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return roundDetails.nullable().parse(data);
    },
    retry: false,
  });
  return <section className="space-y-2" aria-label="Tiến độ các bàn">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Tiến độ các bàn</h2>
      <Button variant="outline" size="sm" disabled={details.isFetching} onClick={() => void details.refetch()}>
        Tải tiến độ
      </Button>
    </div>
    {details.isPending ? <p role="status">Đang tải tiến độ…</p>
      : details.isError || !details.data ? <p role="status">Chưa đọc được tiến độ các bàn.</p>
      : <ul className="grid gap-2 sm:grid-cols-2">
        {details.data.tables.map((table, index) => <li key={table.tableId} className="rounded-md border p-3">
          <h3 className="text-sm font-medium">Bàn {index + 1}</h3>
          <p className="text-sm text-muted-foreground">{states[table.roundStatus]}</p>
          <ul className="mt-2 space-y-1">
            {table.seats.map(seat => <li key={seat.id} className="flex justify-between gap-2 text-sm">
              <span>Ghế {seat.seatNo}</span><span>{seat.stack} chip</span>
            </li>)}
          </ul>
        </li>)}
      </ul>}
  </section>;
}
