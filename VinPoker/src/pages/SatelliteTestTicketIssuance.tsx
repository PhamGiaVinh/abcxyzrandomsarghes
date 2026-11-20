import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

const issuance = z.object({
  destinationName: z.string(),
  expectedCount: z.number().int().positive(),
  issuedCount: z.number().int().nonnegative().nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});
const intent = z.object({ requestId: z.string().uuid(), expiresAt: z.string().datetime() });
const receipt = z.object({ outcome: z.literal("ok"), ticketCount: z.number().int().positive() });
const timeInVietnam = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
});

export default function SatelliteTestTicketIssuance({ pilotId, actorId }: { pilotId: string; actorId: string }) {
  const client = useSupabaseClient();
  const key = `online-satellite:issue-test:${actorId}:${pilotId}`;
  const [saved, setSaved] = useState<z.infer<typeof intent> | null>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? intent.parse(JSON.parse(raw)) : null;
    } catch { return null; }
  });
  const [message, setMessage] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["online-satellite-test-issuance", actorId, pilotId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.rpc("get_online_satellite_test_issuance_v1" as never,
        { p_pilot_id: pilotId } as never).abortSignal(signal);
      if (error) throw error;
      return issuance.nullable().parse(data);
    },
    retry: false,
  });
  const write = useMutation({
    mutationFn: async ({ requestId, expiresAt }: z.infer<typeof intent>) => {
      const { data, error } = await client.rpc("issue_online_satellite_test_tickets_v1" as never, {
        p_pilot_id: pilotId, p_request_id: requestId, p_expires_at: expiresAt,
      } as never);
      if (error) throw error;
      return receipt.parse(data);
    },
    onSettled: () => status.refetch(),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!status.data || status.data.issuedCount !== null || write.isPending) return;
    if (saved) { write.mutate(saved); return; }
    const date = Date.parse(`${new FormData(event.currentTarget).get("expiry")}+07:00`);
    if (!Number.isFinite(date) || date <= Date.now()) {
      setMessage("Chọn hạn dùng trong tương lai.");
      return;
    }
    const prepared = { requestId: crypto.randomUUID(), expiresAt: new Date(date).toISOString() };
    try {
      sessionStorage.setItem(key, JSON.stringify(prepared));
    } catch {
      setMessage("Trình duyệt chưa lưu được mã yêu cầu phát vé.");
      return;
    }
    setMessage(null);
    setSaved(prepared);
    write.mutate(prepared);
  };

  return <section className="space-y-2 border-t pt-4">
    <h2 className="text-lg font-semibold">Phát vé TEST</h2>
    {status.isFetching ? <p role="status">Đang kiểm tra biên nhận…</p>
      : status.isError ? <Button variant="outline" onClick={() => void status.refetch()}>Tải lại biên nhận phát vé</Button>
      : !status.data ? <p>Giải đích chưa được cấp quyền phát vé TEST.</p>
      : status.data.issuedCount !== null ? <p role="status">
        Đã phát {status.data.issuedCount} vé TEST cho {status.data.destinationName}.
      </p>
      : <form onSubmit={submit} className="space-y-2">
        <p>{status.data.expectedCount} vé TEST · {status.data.destinationName}</p>
        {saved ? <p>Hạn dùng {timeInVietnam.format(new Date(saved.expiresAt))}</p>
          : <label className="block space-y-1 text-sm">
            <span>Hạn dùng (giờ Việt Nam)</span>
            <Input name="expiry" type="datetime-local" required disabled={write.isPending} />
          </label>}
        <Button type="submit" disabled={write.isPending}>{write.isPending ? "Đang phát…" : saved ? "Gửi lại yêu cầu" : "Phát vé TEST"}</Button>
        {(message || write.isError) && <p role="alert">{message ?? "Chưa xác nhận được việc phát vé."}</p>}
      </form>}
  </section>;
}
