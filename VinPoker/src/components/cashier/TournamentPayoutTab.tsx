import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PrizePayoutTrackingSection } from "./tournament-live/PrizePayoutTrackingSection";

type Tour = { id: string; name: string; start_time: string };

export function TournamentPayoutTab({ clubIds }: { clubIds: string[] }) {
  const { user, session } = useAuth();
  const scope = JSON.stringify([user?.id, sessionReadEpoch(session), [...clubIds].sort()]);
  return <ScopedTournamentPayoutTab key={scope} clubIds={clubIds} />;
}

function ScopedTournamentPayoutTab({ clubIds }: { clubIds: string[] }) {
  const [params, setParams] = useSearchParams();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const clubKey = [...clubIds].sort().join(":");
  const requested = params.get("tournament");
  const selected = tours.find((tour) => tour.id === requested) ?? (!requested ? tours[0] : undefined);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(false); setTours([]);
    void (async () => {
      try {
        if (!clubKey) return;
        const { data, error: readError } = await supabase.from("tournaments")
          .select("id, name, start_time").in("club_id", clubKey.split(":"))
          .not("registration_closed_at", "is", null)
          .order("start_time", { ascending: false }).limit(100).abortSignal(controller.signal);
        if (readError || !Array.isArray(data)) throw new Error("payout_tournaments_unavailable");
        if (active) setTours(data);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [clubKey, revision]);

  return <Card className="space-y-4 p-4">
    <div>
      <h2 className="text-lg font-semibold">Trả thưởng giải</h2>
      <p className="mt-1 text-sm text-muted-foreground">Hạng và tiền thưởng lấy từ kết quả đã chốt. Chỉ ghi nhận đã trả sau khi thực tế trao tiền cho người nhận.</p>
    </div>
    <Button variant="outline" disabled={loading} onClick={() => setRevision((n) => n + 1)}>Làm mới danh sách giải</Button>
    {loading ? <p role="status">Đang tải giải đã đóng đăng ký…</p>
      : error ? <p role="alert" className="text-sm text-destructive">Không tải được danh sách giải. Hãy làm mới để thử lại.</p>
      : tours.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có giải đã đóng đăng ký trong CLB bạn phụ trách.</p>
      : <>
        <div className="space-y-2">
          <Label htmlFor="payout-tournament">Giải đấu</Label>
          <select id="payout-tournament" value={selected?.id ?? ""} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => { const next = new URLSearchParams(params); next.set("tournament", event.target.value); setParams(next, { replace: true }); }}>
            {!selected && <option value="">Chọn giải trong CLB bạn phụ trách</option>}
            {tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name} · {new Date(tour.start_time).toLocaleDateString("vi-VN")}</option>)}
          </select>
        </div>
        {selected ? <>
          <a className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline" href={`/live/${selected.id}?tab=prizes`} target="_blank" rel="noreferrer">Mở bảng kết quả online</a>
          <PrizePayoutTrackingSection key={selected.id} tournamentId={selected.id} />
        </> : <p role="alert" className="text-sm text-muted-foreground">Giải trong liên kết không có trong danh sách hiện tại. Chọn lại giải để tiếp tục.</p>}
      </>}
  </Card>;
}
