import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
const moveMessages = {
  ok: "Đã chuyển ghế.",
  stale: "Số vòng đã đổi. Hãy chọn lại ghế.",
  stale_placement: "Ghế đã đổi vị trí. Hãy chọn lại ghế.",
  round_still_playing: "Chờ các bàn hoàn tất vòng trước khi chuyển ghế.",
  invalid_destination: "Ghế đích không còn trống hoặc không hợp lệ.",
};
const moveReceipt = z.object({ outcome: z.enum([
  "ok", "stale", "stale_placement", "round_still_playing", "invalid_destination",
]) });

export default function SatelliteRoundOperations({ pilotId, actorId, roundNo }: {
  pilotId: string;
  actorId: string;
  roundNo: string;
}) {
  const client = useSupabaseClient();
  const [selection, setSelection] = useState<{ seatId: string; placement: string; round: string } | null>(null);
  const [destination, setDestination] = useState("");
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
  const tables = details.data?.tables ?? [];
  const observed = selection?.round === details.data?.roundNo ? selection : null;
  const source = tables.find(table => table.status !== "closed" && table.seats.some(seat =>
    seat.id === observed?.seatId && seat.canMove && seat.placementRevision === observed?.placement));
  const selectedSeat = source?.seats.find(seat => seat.id === observed?.seatId);
  const availableSeats = tables.flatMap((table, index) => {
    if (!source || table.status === "closed" || table.tableId === source.tableId) return [];
    return Array.from({ length: table.maxSeats }, (_, i) => i + 1)
      .filter(seatNo => !table.seats.some(seat => seat.seatNo === seatNo))
      .map(seatNo => ({ value: `${table.tableId}:${seatNo}`, tableId: table.tableId, label: `Bàn ${index + 1} · Ghế ${seatNo}`, seatNo }));
  });
  const target = availableSeats.find(seat => seat.value === destination);
  const checkpoint = tables.length > 1 && tables.every(table =>
    table.roundStatus === "complete" || table.roundStatus === "not_opened");
  const move = useMutation({
    mutationFn: async () => {
      if (!checkpoint || !selectedSeat || !target || !details.data) throw new Error("Missing current seat");
      const { data, error } = await client.rpc("move_online_satellite_round_seat_v2" as never, {
        p_pilot_id: pilotId, p_seat_id: selectedSeat.id,
        p_destination: target.tableId, p_destination_seat: target.seatNo,
        p_expected_round: details.data.roundNo, p_expected_placement: selectedSeat.placementRevision,
      } as never);
      if (error) throw error;
      return moveReceipt.parse(data).outcome;
    },
    onSettled: async () => {
      setSelection(null);
      setDestination("");
      await details.refetch();
    },
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
    {checkpoint && tables.filter(table => table.status !== "closed").length > 1 && (
      <form className="grid gap-2" onSubmit={event => { event.preventDefault(); move.mutate(); }}>
        <label className="grid gap-1 text-sm">
          Người cần chuyển
          <select className="rounded-md border bg-background p-2" value={selectedSeat?.id ?? ""}
            onChange={event => {
              const seat = tables.flatMap(table => table.seats).find(item => item.id === event.target.value);
              setSelection(seat && details.data ? { seatId: seat.id, placement: seat.placementRevision, round: details.data.roundNo } : null);
              setDestination("");
            }}>
            <option value="">Chọn ghế hiện tại</option>
            {tables.flatMap((table, index) => table.status === "closed" ? [] : table.seats
              .filter(seat => seat.canMove).map(seat => <option key={seat.id} value={seat.id}>
                Bàn {index + 1} · Ghế {seat.seatNo} · {seat.stack} chip
              </option>))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Ghế đích
          <select className="rounded-md border bg-background p-2" value={destination}
            onChange={event => setDestination(event.target.value)} disabled={!source}>
            <option value="">Chọn ghế trống</option>
            {availableSeats.map(seat => <option key={seat.value} value={seat.value}>{seat.label}</option>)}
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={!selectedSeat || !target || move.isPending || details.isFetching}>
          Chuyển ghế
        </Button>
      </form>
    )}
    {move.data && <p role="status">{moveMessages[move.data]}</p>}
    {move.isError && <p role="alert">Chưa xác nhận được việc chuyển ghế.</p>}
  </section>;
}
