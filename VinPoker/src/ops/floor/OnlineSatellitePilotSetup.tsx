import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const verifiedReceipt = z.object({ pilotId: z.string().uuid() });
const integer = (value: FormDataEntryValue | null) =>
  typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;

export default function OnlineSatellitePilotSetup({ clubId, destinations }: {
  clubId: string;
  destinations: readonly { id: string; name: string }[];
}) {
  const client = useSupabaseClient();
  const [authorized, setAuthorized] = useState(false);
  const [pilotId, setPilotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void observeTrackerContextRead(client.rpc("can_create_online_satellite_pilot_v1" as never,
      { p_club_id: clubId } as never).abortSignal(abort.signal))
      .then(({ data, error }) => {
        if (!abort.signal.aborted) setAuthorized(!error && data === true);
      }).catch(() => {
        if (!abort.signal.aborted) setAuthorized(false);
      });
    return () => abort.abort();
  }, [client, clubId]);

  const createPilot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authorized || inFlight.current) return;
    const values = new FormData(event.currentTarget);
    const destination = values.get("destination");
    const cutoff = Date.parse(`${values.get("cutoff")}+07:00`);
    const stack = integer(values.get("stack"));
    const seats = integer(values.get("seats"));
    if (!destinations.some(tournament => tournament.id === destination)
      || !Number.isFinite(cutoff) || cutoff <= Date.now()
      || !Number.isSafeInteger(stack) || stack <= 0 || stack > 2_147_483_647
      || !Number.isSafeInteger(seats) || seats < 2 || seats > 9) {
      setMessage("Chọn giải đích, thời hạn tương lai, chip dương và từ 2 đến 9 ghế.");
      return;
    }
    const input = {
      p_club_id: clubId, p_destination_tournament_id: destination,
      p_registration_closes_at: new Date(cutoff).toISOString(), p_starting_stack: stack, p_seat_limit: seats,
    };
    const fingerprint = JSON.stringify(input);
    if (intent.current?.fingerprint !== fingerprint) {
      intent.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await client.rpc("create_online_satellite_pilot_v1" as never, {
        ...input, p_request_id: intent.current.requestId,
      } as never);
      if (error) throw error;
      setPilotId(verifiedReceipt.parse(data).pilotId);
    } catch {
      setMessage("Chưa xác nhận được việc tạo giải. Giữ nguyên thông tin và thử lại để kiểm tra biên nhận.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!authorized) return null;
  return <Card>
    <CardHeader><h2 className="font-semibold">Tạo satellite thử</h2></CardHeader>
    <CardContent className="space-y-3">
      {pilotId ? <div className="space-y-2">
        <p role="status">Máy chủ đã tạo đăng ký thử. Chia sẻ link với thành viên CLB.</p>
        <Link className="break-all underline" to={`/poker/satellite/${pilotId}`}>
          {new URL(`/poker/satellite/${pilotId}`, window.location.origin).href}
        </Link>
      </div> : <form className="grid gap-3 sm:grid-cols-2" onSubmit={createPilot}>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-target">Giải đích thử</Label>
          <select id="satellite-pilot-target" name="destination" defaultValue="" required disabled={busy}
            className="min-h-11 w-full rounded-md border bg-background px-2">
            <option value="">Chọn giải trong CLB</option>
            {destinations.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-cutoff">Hạn đăng ký (giờ Việt Nam)</Label>
          <Input id="satellite-pilot-cutoff" name="cutoff" type="datetime-local" required disabled={busy} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-stack">Chip thử mỗi người</Label>
          <Input id="satellite-pilot-stack" name="stack" type="number" min="1" step="1" required disabled={busy} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-seats">Số ghế trên một bàn</Label>
          <Input id="satellite-pilot-seats" name="seats" type="number" min="2" max="9" step="1" required disabled={busy} />
        </div>
        <Button type="submit" disabled={busy || !destinations.length}>{busy ? "Đang tạo…" : "Tạo link đăng ký thử"}</Button>
      </form>}
      {message && <p role="alert">{message}</p>}
    </CardContent>
  </Card>;
}
