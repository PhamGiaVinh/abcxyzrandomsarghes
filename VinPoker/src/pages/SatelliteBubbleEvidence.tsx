import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const evidence = z.object({
  handNo: z.string().regex(/^\d+$/),
  stateVersion: z.number().int().nonnegative(),
  status: z.string(),
  survivingCount: z.number().int().nonnegative().nullable(),
  eliminations: z.array(z.object({
    seat: z.number().int().positive(),
    startingStack: z.string().regex(/^\d+$/),
  })).nullable(),
});

export default function SatelliteBubbleEvidence({ pilotId, actorId }: { pilotId: string; actorId: string }) {
  const client = useSupabaseClient();
  const result = useQuery({
    queryKey: ["online-satellite-bubble", actorId, pilotId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_online_satellite_bubble_evidence_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return evidence.nullable().parse(data);
    },
    enabled: false,
    retry: false,
  });
  return <section className="space-y-2 border-t pt-4">
    <h2 className="text-lg font-semibold">Đối chiếu bubble</h2>
    <Button type="button" variant="outline" disabled={result.isFetching} onClick={() => void result.refetch()}>
      {result.isFetching ? "Đang kiểm tra…" : "Kiểm tra ván mới nhất"}
    </Button>
    {result.isError ? <p role="alert">Chưa đọc được dữ liệu bubble.</p>
      : result.data === null ? <p role="status">Chưa xác minh được ván để đối chiếu.</p>
      : result.data && !result.isFetching && (
        <div className="space-y-2" aria-live="polite">
          <p>Ván {result.data.handNo} · bản {result.data.stateVersion}</p>
          {result.data.status !== "complete" ? <p>Ván chưa chốt.</p> : <>
            <p>Còn {result.data.survivingCount} người có chip.</p>
            {result.data.eliminations?.length
              ? <ul className="list-disc space-y-1 pl-5">
                {result.data.eliminations.map(({ seat, startingStack }) => (
                  <li key={seat}>Ghế {seat} · {BigInt(startingStack).toLocaleString("vi-VN")} chip đầu ván</li>
                ))}
              </ul>
              : <p>Ván này không loại người chơi.</p>}
          </>}
        </div>
      )}
  </section>;
}
