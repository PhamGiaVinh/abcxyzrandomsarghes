import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { satellitePilotId } from "@/lib/onlineSatelliteRoute";

const registration = z.object({
  pilotId: z.string().uuid(),
  destinationName: z.string().min(1),
  registrationClosesAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  startingStack: z.number().int().positive(),
  seatLimit: z.number().int().min(2).max(9),
  entryId: z.string().uuid().nullable(),
  acceptingEntries: z.boolean(),
});
type Registration = z.infer<typeof registration>;
const receipt = z.object({ entryId: z.string().uuid(), idempotent: z.boolean() });

export default function OnlineSatelliteRegistration() {
  const { pilotId } = useParams();
  const { user, session, loading } = useAuth();
  const id = satellitePilotId.safeParse(pilotId);
  if (!id.success) return <p className="mx-auto max-w-lg p-4">Link đăng ký không hợp lệ.</p>;
  if (loading) return <p className="mx-auto max-w-lg p-4" role="status">Đang xác minh tài khoản…</p>;
  if (!user) return <main className="mx-auto max-w-lg space-y-4 p-4">
    <p>Đăng nhập bằng tài khoản thành viên đã liên kết tại CLB để tiếp tục đăng ký.</p>
    <Button asChild><Link to={{ pathname: "/auth", search: new URLSearchParams({ next: `/poker/satellite/${id.data}` }).toString() }}>Đăng nhập</Link></Button>
  </main>;
  return <ScopedRegistration key={JSON.stringify([id.data, user.id, sessionReadEpoch(session)])} pilotId={id.data} />;
}

function ScopedRegistration({ pilotId }: { pilotId: string }) {
  const client = useSupabaseClient();
  const [details, setDetails] = useState<Registration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const { data, error } = await observeTrackerContextRead(client.rpc("get_online_satellite_pilot_v1" as never,
          { p_pilot_id: pilotId } as never).abortSignal(abort.signal));
        if (error) throw error;
        const next = registration.parse(data);
        if (next.pilotId !== pilotId) throw new Error("SATELLITE_SCOPE_MISMATCH");
        if (!abort.signal.aborted) setDetails(next);
      } catch {
        if (!abort.signal.aborted) setError("Chưa xác minh được quyền đăng ký giải này.");
      }
    };
    void load();
    return () => abort.abort();
  }, [client, pilotId, revision]);

  const register = async () => {
    if (!details?.acceptingEntries || details.entryId || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const { data, error } = await client.rpc("register_online_satellite_pilot_v1" as never, { p_pilot_id: pilotId } as never);
      if (error) throw error;
      const verified = receipt.parse(data);
      setDetails({ ...details, entryId: verified.entryId });
    } catch {
      setError("Chưa xác nhận được đăng ký. Tải lại để kiểm tra biên nhận và số ghế.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return <main className="mx-auto max-w-lg p-4 sm:py-8">
    <Card>
      <CardHeader><h1 className="text-2xl font-semibold">Đăng ký satellite thử</h1></CardHeader>
      <CardContent className="space-y-4">
        {details && <>
          <p>Giải đích: <strong>{details.destinationName}</strong></p>
          <p className="text-sm text-muted-foreground">
            Tối đa {details.seatLimit} người đăng ký · {details.startingStack.toLocaleString("vi-VN")} chip thử
          </p>
          <p className="text-sm">Hạn đăng ký{" "}
            <time dateTime={details.registrationClosesAt}>
              {new Date(details.registrationClosesAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            </time>
          </p>
        </>}
        {error ? <>
          <p role="alert">{error}</p>
          <Button type="button" variant="outline" onClick={() => {
            setError(null); setDetails(null); setRevision(value => value + 1);
          }}>Tải lại</Button>
        </> : !details ? <p role="status">Đang xác minh đăng ký…</p>
          : details.entryId ? <>
            <p role="status">Máy chủ đã xác nhận đăng ký.</p>
            {import.meta.env.VITE_ONLINE_SATELLITE_RUNTIME === "true" && (
              <Button asChild><Link to={`/poker/satellite/${pilotId}/table`}>Mở bàn Satellite</Link></Button>
            )}
          </>
          : details.acceptingEntries ? <Button type="button" disabled={saving} onClick={() => void register()}>
            {saving ? "Đang đăng ký…" : "Đăng ký một ghế"}
          </Button> : <p role="status">Giải hiện chưa nhận thêm đăng ký.</p>}
      </CardContent>
    </Card>
  </main>;
}
