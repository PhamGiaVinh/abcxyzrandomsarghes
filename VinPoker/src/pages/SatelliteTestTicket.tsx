import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const ticketShape = z.object({
  ticketId: z.string().uuid(),
  destinationId: z.string().uuid(),
  destinationName: z.string(),
  expiresAt: z.string().datetime({ offset: true }),
  testEntryId: z.string().uuid().nullable(),
});
const redeemReceipt = z.object({ outcome: z.enum(["ok", "expired", "already_registered"]) });
const expiryLabel = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
});

export default function SatelliteTestTicket({ pilotId, actorId }: { pilotId: string; actorId: string }) {
  const client = useSupabaseClient();
  const ticket = useQuery({
    queryKey: ["online-satellite-test-ticket", actorId, pilotId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_my_online_satellite_test_ticket_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return ticketShape.nullable().parse(data);
    },
    retry: false,
  });
  const redemption = useMutation({
    mutationFn: async ({ ticketId, destinationId }: z.infer<typeof ticketShape>) => {
      const { data, error } = await client.rpc("redeem_online_satellite_test_ticket_v1" as never, {
        p_ticket_id: ticketId, p_destination_id: destinationId,
      } as never);
      if (error) throw error;
      return redeemReceipt.parse(data).outcome;
    },
    onSettled: () => ticket.refetch(),
  });
  if (ticket.isError) {
    return <div className="space-y-1">
      <p role="alert">Chưa tải được vé TEST.</p>
      <Button variant="outline" onClick={() => void ticket.refetch()}>Tải lại vé TEST</Button>
    </div>;
  }
  if (!ticket.data) return <p role="status">{ticket.isFetching ? "Đang kiểm tra vé TEST…" : "Vé TEST chưa được phát."}</p>;
  return <div className="space-y-2 border-t pt-3">
    <p>Vé TEST · {ticket.data.destinationName}</p>
    <p className="text-sm text-muted-foreground">
      Hạn dùng <time dateTime={ticket.data.expiresAt}>{expiryLabel.format(new Date(ticket.data.expiresAt))}</time>
    </p>
    {ticket.data.testEntryId ? <p role="status">Đã tạo entry TEST tại giải đích.</p>
      : redemption.data === "expired" ? <p role="status">Vé TEST đã hết hạn.</p>
      : redemption.data === "already_registered" ? <p role="status">Bạn đã có entry TEST tại giải đích.</p>
      : <Button disabled={redemption.isPending || ticket.isFetching}
        onClick={() => ticket.data && redemption.mutate(ticket.data)}>
        {redemption.isPending ? "Đang đổi…" : "Đổi vé TEST"}
      </Button>}
    {redemption.isError && !ticket.data.testEntryId && <p role="alert">Chưa xác nhận được việc đổi vé.</p>}
  </div>;
}
