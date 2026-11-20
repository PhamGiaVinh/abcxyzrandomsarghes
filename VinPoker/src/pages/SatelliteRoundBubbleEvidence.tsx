import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const evidence = z.object({
  roundNo: z.string(),
  qualificationSlots: z.number().int(),
  survivors: z.number().int(),
  unfilledSlots: z.number().int(),
  hands: z.array(z.object({
    tableId: z.string().uuid(),
    handId: z.string().uuid(),
    handVersion: z.number().int(),
    eliminations: z.array(z.object({ seatNo: z.number().int(), startingStack: z.string() })),
  })),
});

export default function SatelliteRoundBubbleEvidence({ pilotId, actorId, roundNo }: {
  pilotId: string;
  actorId: string;
  roundNo: string;
}) {
  const client = useSupabaseClient();
  const review = useQuery({
    queryKey: ["satellite-round-bubble", actorId, pilotId, roundNo],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_online_satellite_round_bubble_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return evidence.nullable().parse(data);
    },
    retry: false,
  });

  return <section className="space-y-2 rounded-md border p-3" aria-label="Bằng chứng bubble">
    <h2 className="font-semibold">Bằng chứng bubble</h2>
    {review.isPending ? <p role="status">Đang tải bằng chứng…</p>
      : review.isError ? <Button size="sm" variant="outline" onClick={() => void review.refetch()}>Tải lại bằng chứng</Button>
      : review.data?.roundNo !== roundNo ? <p role="status">Chưa có bằng chứng cho vòng này.</p>
      : <>
        <p className="text-sm">Vòng {review.data.roundNo} · {review.data.survivors}/{review.data.qualificationSlots} suất có người nhận · Còn {review.data.unfilledSlots} suất</p>
        <ul className="space-y-2">
          {review.data.hands.map(hand => <li key={hand.handId} className="text-sm">
            <div className="break-all">Hand {hand.handId} · Bản {hand.handVersion}</div>
            {hand.eliminations.length > 0
              ? <ul className="list-disc pl-5">{hand.eliminations.map(seat => <li key={seat.seatNo}>
                Ghế {seat.seatNo} bị loại · stack đầu hand {seat.startingStack} chip
              </li>)}</ul>
              : <p>Không có ghế bị loại.</p>}
          </li>)}
        </ul>
      </>}
  </section>;
}
