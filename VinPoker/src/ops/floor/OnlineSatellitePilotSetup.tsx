import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const verifiedReceipt = z.object({ pilotId: z.string().uuid() });
const savedIntent = z.object({
  requestId: z.string().uuid(), destination: z.string().uuid(), cutoff: z.string(),
  stack: z.number().int().positive(), seats: z.number().int().min(2).max(9),
});
const integer = (value: FormDataEntryValue | null) =>
  typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;

function readIntent(key: string) {
  const raw = sessionStorage.getItem(key);
  return raw ? savedIntent.parse(JSON.parse(raw)) : null;
}

export default function OnlineSatellitePilotSetup({ actorId, clubId, destinations }: {
  actorId: string;
  clubId: string;
  destinations: readonly { id: string; name: string }[];
}) {
  const client = useSupabaseClient();
  const [authorized, setAuthorized] = useState(false);
  const [pilotId, setPilotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const storageKey = `online-satellite:pilot-create:${actorId}:${clubId}`;
  const [draft] = useState(() => {
    try { return readIntent(storageKey); } catch { return null; }
  });

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
    const destination = String(values.get("destination") ?? "");
    const localCutoff = String(values.get("cutoff") ?? "");
    const cutoff = Date.parse(`${localCutoff}+07:00`);
    const stack = integer(values.get("stack"));
    const seats = integer(values.get("seats"));
    if (!destinations.some(tournament => tournament.id === destination)
      || !Number.isFinite(cutoff)
      || !Number.isSafeInteger(stack) || stack <= 0 || stack > 2_147_483_647
      || !Number.isSafeInteger(seats) || seats < 2 || seats > 9) {
      setMessage("Chọn giải đích, thời hạn tương lai, chip dương và từ 2 đến 9 ghế.");
      return;
    }
    const input = {
      p_club_id: clubId, p_destination_tournament_id: destination,
      p_registration_closes_at: new Date(cutoff).toISOString(), p_starting_stack: stack, p_seat_limit: seats,
    };
    let requestId: string;
    try {
      const prior = readIntent(storageKey);
      if (prior?.destination === destination && prior.cutoff === localCutoff
        && prior.stack === stack && prior.seats === seats) {
        requestId = prior.requestId;
      } else {
        if (cutoff <= Date.now()) {
          setMessage("Hạn đăng ký của giải mới phải ở tương lai.");
          return;
        }
        requestId = crypto.randomUUID();
        sessionStorage.setItem(storageKey, JSON.stringify({ requestId, destination, cutoff: localCutoff, stack, seats }));
      }
    } catch {
      setMessage("Không lưu được mã yêu cầu an toàn trong tab này.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await client.rpc("create_online_satellite_pilot_v1" as never, {
        ...input, p_request_id: requestId,
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
        <a className="break-all underline" href={`/poker/satellite/${pilotId}`}>
          {new URL(`/poker/satellite/${pilotId}`, window.location.origin).href}
        </a>
      </div> : <form className="grid gap-3 sm:grid-cols-2" onSubmit={createPilot}>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-target">Giải đích thử</Label>
          <select id="satellite-pilot-target" name="destination" defaultValue={draft?.destination ?? ""} required disabled={busy}
            className="min-h-11 w-full rounded-md border bg-background px-2">
            <option value="">Chọn giải trong CLB</option>
            {destinations.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-cutoff">Hạn đăng ký (giờ Việt Nam)</Label>
          <Input id="satellite-pilot-cutoff" name="cutoff" type="datetime-local" defaultValue={draft?.cutoff} required disabled={busy} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-stack">Chip thử mỗi người</Label>
          <Input id="satellite-pilot-stack" name="stack" type="number" min="1" step="1" defaultValue={draft?.stack} required disabled={busy} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="satellite-pilot-seats">Số ghế trên một bàn</Label>
          <Input id="satellite-pilot-seats" name="seats" type="number" min="2" max="9" step="1" defaultValue={draft?.seats} required disabled={busy} />
        </div>
        <Button type="submit" disabled={busy || !destinations.length}>{busy ? "Đang tạo…" : "Tạo link đăng ký thử"}</Button>
      </form>}
      {message && <p role="alert">{message}</p>}
    </CardContent>
  </Card>;
}
