import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChipDisc } from "./ChipDisc";
import { AlertTriangle, Crown, Users, Gauge, CheckCircle2 } from "lucide-react";
import { deriveTournamentChipMetrics } from "@/lib/chipOpsMetrics";
import { parseParticipationSummary } from "@/lib/tournamentParticipation";

// Reads are open-SELECT tournament tables + the server-authoritative inventory (passed in).
const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");

interface InvDenom { denomination_id: string; value: number; color: string | null; issued_count_total: number; current_count?: number }
interface Inventory { denominations: InvDenom[]; total_value: number; reconciled: boolean }
interface Denom { id: string; value: number; color: string | null }
interface Metrics {
  status: string | null; players_remaining: number | null; average_stack: number | null;
  current_level: number | null; current_blinds: string | null;
  small_blind: number | null; big_blind: number | null; ante: number | null; is_break: boolean | null;
  leader_name: string | null; leader_chips: number | null;
  active_seat_count: number; table_chip_total: number; roster_quality: "exact" | "partial";
  participation_stack: number;
}

/** Live "Tổng quan" dashboard — synced to the tournament. Read-only. */
export function DashboardTab({ tournamentId, inv, denoms }: { tournamentId: string; inv: Inventory | null; denoms: Denom[] }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setM(null);
    setLoadError(false);
    if (!tournamentId) { setM(null); return; }
    let active = true;
    let requestInFlight = false;
    const load = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      setLoading(true);
      try {
      const { data: t, error: tournamentError } = await sb.from("tournaments")
        .select("status,players_remaining,average_stack,current_level,current_blinds,starting_stack")
        .eq("id", tournamentId).maybeSingle();
      if (tournamentError) throw tournamentError;
      const { data: participationData, error: participationError } = await sb.rpc("get_tournament_participation_counts_v1", { p_tournament_id: tournamentId });
      if (participationError) throw participationError;
      const participation = parseParticipationSummary(participationData, tournamentId);
      let lvl: any = null;
      if (t?.current_level != null) {
        const { data: l, error: levelError } = await sb.from("tournament_levels")
          .select("small_blind,big_blind,ante,is_break")
          .eq("tournament_id", tournamentId).eq("level_number", t.current_level).maybeSingle();
        if (levelError) throw levelError;
        lvl = l;
      }
      const { data: activeSeats, error: seatsError } = await sb.from("tournament_seats")
        .select("player_name,chip_count")
        .eq("tournament_id", tournamentId)
        .eq("is_active", true)
        .order("chip_count", { ascending: false });
      if (seatsError) throw seatsError;
      const normalizedSeats = (activeSeats ?? []) as Array<{ player_name?: string | null; chip_count?: number | null }>;
      const seatStacks = normalizedSeats.map((seat) => (
        seat.chip_count == null ? Number.NaN : Number(seat.chip_count)
      ));
      const chipMetrics = deriveTournamentChipMetrics(
        seatStacks,
        participation.counts.remaining,
      );
      const leader = normalizedSeats.reduce<null | { player_name?: string | null; chip_count?: number | null }>((best, seat) => {
        const chipCount = seat.chip_count == null ? Number.NaN : Number(seat.chip_count);
        if (!Number.isSafeInteger(chipCount) || chipCount < 0) return best;
        const bestCount = best?.chip_count == null ? Number.NEGATIVE_INFINITY : Number(best.chip_count);
        return chipCount > bestCount ? seat : best;
      }, null);
      const leaderName = leader?.player_name ?? null;
      const leaderChips = leader?.chip_count != null ? Number(leader.chip_count) : null;
      if (!active) return;
      setLoadError(false);
      setM({
        status: t?.status ?? null, players_remaining: participation.counts.remaining, average_stack: participation.averageStack,
        participation_stack: participation.counts.live_entry_stack,
        current_level: t?.current_level ?? null, current_blinds: t?.current_blinds ?? null,
        small_blind: lvl?.small_blind ?? null, big_blind: lvl?.big_blind ?? null, ante: lvl?.ante ?? null, is_break: lvl?.is_break ?? null,
        leader_name: leaderName, leader_chips: leaderChips,
        active_seat_count: chipMetrics.activeSeatCount,
        table_chip_total: chipMetrics.tableChipTotal,
        roster_quality: chipMetrics.rosterQuality,
      });
      setLoading(false);
      } catch {
        if (active) { setLoading(false); setLoadError(true); }
      } finally {
        requestInFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 4_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tournamentId]);

  if (!inv) {
    return (
      <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">
        Chưa có dữ liệu chip cho giải này. Vào tab <b className="text-foreground">Setup stack</b> để cài đặt bộ chip + mẫu stack.
      </CardContent></Card>
    );
  }

  const issuedInventoryValue = inv.total_value ?? 0;
  const playersLeft = m?.players_remaining ?? null;
  const tableChipTotal = m?.table_chip_total ?? 0;
  const computedAvg = m?.average_stack ?? null;
  const bb = m?.big_blind ?? null;
  const countOf = (d: InvDenom) => d.current_count ?? d.issued_count_total;
  const currentByValue = new Map(inv.denominations.map((d) => [d.value, countOf(d)]));
  const dueDenoms = bb ? denoms.filter((d) => d.value < bb && (currentByValue.get(d.value) ?? 0) > 0) : [];

  return (
    <div className="operations-typography min-w-0 space-y-4">
      {loadError && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        Không tải được dữ liệu chip trên ghế. {m ? "Đang hiển thị lần tải thành công trước; chưa xác nhận số liệu hiện tại." : "Chưa có số liệu để hiển thị."}
      </p>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] items-start gap-3">
        <StatCard label="Kho chip đã phát" value={fmt(issuedInventoryValue)} accent
          sub={inv.reconciled ? "Kho đã đối soát nội bộ" : "Kho chưa đối soát"} />
        <StatCard label="Chip trên ghế" value={m ? fmt(tableChipTotal) : "—"}
          sub={m ? `${m.active_seat_count} ghế đang active` : "Đang tải roster"} />
        <StatCard label="Average stack" icon={<Gauge className="h-3.5 w-3.5" />}
          value={computedAvg != null ? fmt(computedAvg) : "—"}
          sub={m?.roster_quality === "partial" ? "Ghế đang active và entry hợp lệ chưa khớp; AVG dùng entry hợp lệ" : playersLeft != null ? `${fmt(m?.participation_stack ?? 0)} ÷ ${playersLeft}` : ""} />
        <StatCard label="Người còn lại" icon={<Users className="h-3.5 w-3.5" />}
          value={playersLeft != null ? fmt(playersLeft) : "—"} />
        <StatCard label="Chip leader" icon={<Crown className="h-3.5 w-3.5" />}
          value={m?.leader_chips != null ? fmt(m.leader_chips) : "—"} sub={m?.leader_name ?? ""} />
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-foreground">Cấu trúc hiện tại</CardTitle>
          {loading
            ? <Skeleton className="h-5 w-16" />
            : m?.status && <Badge variant="outline" className="uppercase">{m.is_break ? "break" : m.status}</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <Field k="Level" v={m?.current_level != null ? String(m.current_level) : "—"} />
            <Field k="Blinds" v={m?.small_blind != null ? `${fmt(m.small_blind)} / ${fmt(m.big_blind ?? 0)}` : (m?.current_blinds ?? "—")} />
            <Field k="Ante" v={m?.ante != null ? fmt(m.ante) : "—"} />
          </div>
          {dueDenoms.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Đến hạn color-up: <b>{dueDenoms.map((d) => `T${fmt(d.value)}`).join(", ")}</b> (nhỏ hơn big blind {fmt(bb ?? 0)}).{" "}
                <span className="text-muted-foreground">Color-up sẽ làm ở bước sau.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Chip đang lưu hành</CardTitle></CardHeader>
        <CardContent>
          {inv.denominations.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Chưa có mẫu stack hoặc chưa phát bộ nào.</p>
          ) : (
            <div className="flex flex-wrap gap-5">
              {inv.denominations.map((d) => (
                <div key={d.denomination_id} className="flex w-20 flex-col items-center gap-2">
                  <ChipDisc value={d.value} color={d.color} size={52} />
                  <div className="font-display text-sm font-bold tabular-nums text-foreground">{fmt(d.current_count ?? d.issued_count_total)}</div>
                  <div className="text-center text-[11px] leading-tight text-muted-foreground">
                    T{fmt(d.value)}{bb && d.value < bb ? <><br /><span className="text-warning">color-up</span></> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {inv.reconciled && <CheckCircle2 className="h-4 w-4 text-primary" />} Tổng giá trị chip đã phát từ kho
            </span>
            <span className="font-display font-semibold tabular-nums text-foreground">{fmt(issuedInventoryValue)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent?: boolean; icon?: ReactNode }) {
  return (
    <Card className={`min-w-0 border-border ${accent ? "ring-1 ring-primary/20" : ""}`}>
      <CardContent className="min-w-0 px-4 py-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 break-words font-display text-xl font-bold tabular-nums [overflow-wrap:anywhere] ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
        {sub ? <div className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="break-words font-display text-lg font-semibold tabular-nums text-foreground [overflow-wrap:anywhere]">{v}</div>
    </div>
  );
}
