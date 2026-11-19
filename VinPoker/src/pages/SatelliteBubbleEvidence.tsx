import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const evidence = z.object({
  handId: z.string().uuid(),
  handNo: z.string().regex(/^\d+$/),
  stateVersion: z.number().int().nonnegative(),
  status: z.string(),
  survivingCount: z.number().int().nonnegative().nullable(),
  eliminations: z.array(z.object({
    seat: z.number().int().positive(),
    startingStack: z.string().regex(/^\d+$/),
  })).nullable(),
});
const lockReceipt = z.object({
  outcome: z.enum(["ok", "stale", "not_ready", "bubble_review_required", "roster_unverified"]),
});

export default function SatelliteBubbleEvidence({ pilotId, actorId, canLock, onLocked }: {
  pilotId: string; actorId: string; canLock: boolean; onLocked: () => void;
}) {
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
  const lock = useMutation({
    mutationFn: async (current: z.infer<typeof evidence> | null) => {
      const { data, error } = await client.rpc("lock_online_satellite_result_v1" as never, {
        p_pilot_id: pilotId,
        p_expected_hand_id: current?.handId ?? null,
        p_expected_hand_version: current?.stateVersion ?? null,
      } as never);
      if (error) throw error;
      return lockReceipt.parse(data).outcome;
    },
    onSuccess: (outcome) => {
      if (outcome === "ok") onLocked();
      if (outcome === "stale") void result.refetch();
    },
  });
  return <section className="space-y-2 border-t pt-4">
    <h2 className="text-lg font-semibold">Đối chiếu bubble</h2>
    <Button type="button" variant="outline" disabled={result.isFetching || lock.isPending} onClick={() => void result.refetch()}>
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
    {canLock && !result.isError && !result.isFetching && (result.data === null || result.data?.status === "complete") && (
      <Button type="button" disabled={lock.isPending} onClick={() => lock.mutate(result.data ?? null)}>
        {lock.isPending ? "Đang khóa…" : "Khóa kết quả TEST và đóng bàn"}
      </Button>
    )}
    {lock.error && <p role="alert">Chưa xác nhận được kết quả. Kiểm tra lại trước khi gửi tiếp.</p>}
    {lock.data === "stale" && <p role="status">Ván đã thay đổi. Hãy đối chiếu lại trước khi khóa.</p>}
    {lock.data === "bubble_review_required" && <p role="status">Cần TD phân xử suất còn thiếu.</p>}
    {(lock.data === "not_ready" || lock.data === "roster_unverified") && (
      <p role="status">Chưa đủ bằng chứng để khóa kết quả.</p>
    )}
  </section>;
}
