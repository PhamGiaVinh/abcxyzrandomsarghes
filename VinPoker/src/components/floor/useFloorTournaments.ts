import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { flightEntrants, qualifierTarget, type ClubRow, type FlightMeta, type FinalMeta } from "./TournamentManagerShared";

export type EventMeta = { name: string; itm_percent: number };
type TourStatus = "scheduled" | "live" | "finished" | "cancelled";
const EMPTY_TOURS: never[] = [];

/**
 * Single data owner for the Floor tournament boards (Daily + Multi-day). Extracted from
 * TournamentManagerPanel so one hook owns the tours list + realtime + the multi-day
 * readiness meta + the CRUD actions — both boards consume it via props (they never call
 * this hook themselves), so exactly one realtime channel + one readiness effect run.
 */
export function useFloorTournaments(clubIds: string[]) {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const clubKey = JSON.stringify([...new Set(clubIds)].sort());
  const identity = JSON.stringify([user?.id, authLoading, clubKey]);
  const identityRef = useRef({ identity, generation: 0 });
  if (identityRef.current.identity !== identity) {
    identityRef.current = { identity, generation: identityRef.current.generation + 1 };
  }
  const scope = `${identity}:${identityRef.current.generation}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const readFlight = useRef<{ scope: string; trailing: boolean } | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [stateScope, setStateScope] = useState("");
  const [storedTours, setTours] = useState<any[]>([]);
  const tours = loadedScope === scope ? storedTours : EMPTY_TOURS;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flightMeta, setFlightMeta] = useState<Record<string, FlightMeta>>({});
  const [finalMeta, setFinalMeta] = useState<Record<string, FinalMeta>>({});
  const [eventMeta, setEventMeta] = useState<Record<string, EventMeta>>({});
  const [metadataOwner, setMetadataOwner] = useState<{ scope: string; tours: typeof storedTours } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!mounted.current || scopeRef.current !== scope) return;
    if (readFlight.current?.scope === scope) {
      readFlight.current.trailing = true;
      return;
    }
    const sequence = ++requestSequence.current;
    const current = () => mounted.current && scopeRef.current === scope && requestSequence.current === sequence;
    const scopedClubs = JSON.parse(clubKey) as string[];
    setStateScope(scope);
    setLoadedScope(null);
    setMetadataOwner(null);
    setTours([]);
    setError(null);
    if (!user?.id || authLoading || !scopedClubs.length) { setLoading(false); return; }
    const flight = { scope, trailing: false };
    readFlight.current = flight;
    setLoading(true);
    try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .is("deleted_at", null)
      .in("club_id", scopedClubs)
      .order("start_time");
    if (!current()) return;
    if (error) throw error;
    if (!Array.isArray(data) || data.some(row => !scopedClubs.includes(row.club_id))) {
      throw new Error("invalid_floor_tournament_scope");
    }
    setTours(data ?? []);
    setLoadedScope(scope);
    } catch (failure) {
      if (!current()) return;
      const message = failure instanceof Error ? failure.message
        : (failure as { message?: string })?.message ?? "Không tải được danh sách giải";
      setError(message);
      toast.error(message);
    } finally {
      if (current()) setLoading(false);
      if (readFlight.current === flight) {
        readFlight.current = null;
        if (flight.trailing && mounted.current && scopeRef.current === scope) void loadRef.current();
      }
    }
  }, [clubKey, scope, user?.id, authLoading]);

  useEffect(() => { load(); }, [load]);

  // Realtime: re-load on any tournaments change for this floor's clubs. Channel name is
  // unique per hook instance so a fast landing→tournament→back remount can't collide with
  // a not-yet-cleaned-up channel; cleanup removes it on unmount. [P1-6]
  const loadRef = useRef(load);
  loadRef.current = load;
  const instanceId = useId();
  useEffect(() => {
    if (!user?.id || authLoading || clubKey === "[]") return;
    const channel = supabase
      .channel(`floor-tour-mgr:${clubKey}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => {
        loadRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clubKey, instanceId, user?.id, authLoading]);

  // MD-2/3 — per-flight ITM readiness + per-final qualifier pool + per-event meta (name +
  // itm_percent for the Main Event card header). Gated; only queries the new objects when on.
  useEffect(() => {
    setMetadataOwner(null);
    if (!FEATURES.multiDayTournaments) { setFlightMeta({}); setFinalMeta({}); setEventMeta({}); return; }
    const flights = tours.filter((x) => x.phase === "flight" && x.event_id);
    const finals = tours.filter((x) => x.phase === "final");
    const eventIds = [...new Set(tours.filter((x) => x.event_id).map((x) => x.event_id))];
    if (!flights.length && !finals.length && !eventIds.length) { setFlightMeta({}); setFinalMeta({}); setEventMeta({}); return; }
    let cancelled = false;
    (async () => {
      const flightIds = flights.map((x) => x.id);
      const finalIds = finals.map((x) => x.id);
      const [regsRes, seatsRes, evsRes, qualRes, entRes] = await Promise.all([
        flightIds.length ? (supabase as any).from("tournament_registrations").select("tournament_id").in("tournament_id", flightIds).eq("status", "confirmed") : Promise.resolve({ data: [] }),
        flightIds.length ? (supabase as any).from("tournament_seats").select("tournament_id, player_id").in("tournament_id", flightIds).eq("is_active", true) : Promise.resolve({ data: [] }),
        eventIds.length ? (supabase as any).from("tournament_events").select("id, itm_percent, name").in("id", eventIds) : Promise.resolve({ data: [] }),
        finalIds.length ? (supabase as any).from("tournament_event_qualifiers").select("final_tournament_id").in("final_tournament_id", finalIds) : Promise.resolve({ data: [] }),
        finalIds.length ? (supabase as any).from("tournament_entries").select("tournament_id, player_id").in("tournament_id", finalIds) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled || scopeRef.current !== scope) return;
      // Failed readiness reads must not become verified empty counts.
      if ([regsRes, seatsRes, evsRes, qualRes, entRes].some(result => "error" in result && result.error)) return;
      const regCount: Record<string, number> = {};
      for (const r of ((regsRes.data ?? []) as any[])) regCount[r.tournament_id] = (regCount[r.tournament_id] || 0) + 1;
      const survivors: Record<string, Set<string>> = {};
      for (const s of ((seatsRes.data ?? []) as any[])) (survivors[s.tournament_id] ??= new Set()).add(s.player_id);
      const itmMap: Record<string, number> = {};
      const evMeta: Record<string, EventMeta> = {};
      for (const e of ((evsRes.data ?? []) as any[])) { itmMap[e.id] = Number(e.itm_percent) || 0; evMeta[e.id] = { name: e.name ?? "", itm_percent: Number(e.itm_percent) || 0 }; }
      const fMeta: Record<string, FlightMeta> = {};
      for (const fl of flights) {
        const surv = survivors[fl.id]?.size ?? 0;
        const ent = flightEntrants(regCount[fl.id] ?? 0, surv, fl.players_remaining);
        const itm = itmMap[fl.event_id] ?? 0;
        const target = qualifierTarget(ent, itm);
        fMeta[fl.id] = { entrants: ent, survivors: surv, itm, target, ready: surv > 0 && surv <= target };
      }
      const qCount: Record<string, number> = {};
      for (const q of ((qualRes.data ?? []) as any[])) qCount[q.final_tournament_id] = (qCount[q.final_tournament_id] || 0) + 1;
      const seatedByFinal: Record<string, Set<string>> = {};
      for (const e of ((entRes.data ?? []) as any[])) (seatedByFinal[e.tournament_id] ??= new Set()).add(e.player_id);
      const fnMeta: Record<string, FinalMeta> = {};
      for (const fn of finals) {
        const qualifiers = qCount[fn.id] ?? 0;
        const seated = seatedByFinal[fn.id]?.size ?? 0;
        fnMeta[fn.id] = { qualifiers, seated, pending: Math.max(0, qualifiers - seated) };
      }
      setFlightMeta(fMeta);
      setFinalMeta(fnMeta);
      setEventMeta(evMeta);
      setMetadataOwner({ scope, tours });
    })().catch(() => {
      // Leave readiness unavailable; never publish a partial or guessed result.
    });
    return () => { cancelled = true; };
  }, [tours, scope]);

  const deleteTour = useCallback(async (id: string) => {
    if (!mounted.current || scopeRef.current !== scope || loadedScope !== scope || !tours.some(tour => tour.id === id)) return;
    if (!confirm(t("clubAdmin.deleteConfirm"))) return;
    if (!mounted.current || scopeRef.current !== scope) return;
    const { data, error } = await supabase.rpc("ops_delete_tournament_safe", {
      p_tournament_id: id,
      p_reason: "floor_tournament_delete",
    });
    const result = data as { ok?: boolean; error?: string } | null;
    if (!mounted.current || scopeRef.current !== scope) return;
    if (error || result?.ok === false) toast.error(error?.message ?? result?.error ?? "Không thể xoá giải");
    else { toast.success(t("clubAdmin.tournamentDeleted")); load(); }
  }, [t, load, scope, loadedScope, tours]);

  const setTourStatus = useCallback(async (id: string, status: TourStatus) => {
    if (!mounted.current || scopeRef.current !== scope || loadedScope !== scope || !tours.some(tour => tour.id === id)) return;
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (!mounted.current || scopeRef.current !== scope) return;
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.statusUpdated")); load(); }
  }, [t, load, scope, loadedScope, tours]);

  // "Bắt đầu giải" — same canonical clock-start as the operator Clock tab.
  const startTournament = useCallback(async (id: string) => {
    if (!mounted.current || scopeRef.current !== scope || loadedScope !== scope || !tours.some(tour => tour.id === id)) return;
    const { data, error } = await supabase.functions.invoke("tournament-live-clock", {
      body: { tournament_id: id, action: "start", current_level: 1 },
    });
    if (!mounted.current || scopeRef.current !== scope) return;
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || "Không bắt đầu được giải");
    else { toast.success("Đã bắt đầu giải — đồng hồ chạy, giải lên Live Tracker + hiện blinds"); load(); }
  }, [load, scope, loadedScope, tours]);

  const visibleError = stateScope === scope ? error : null;
  const metadataCurrent = loadedScope === scope && metadataOwner?.scope === scope && metadataOwner.tours === tours;
  return { tours, loading: stateScope !== scope ? !!user?.id && !authLoading && clubKey !== "[]" : loading,
    error: visibleError, flightMeta: metadataCurrent ? flightMeta : {}, finalMeta: metadataCurrent ? finalMeta : {},
    eventMeta: metadataCurrent ? eventMeta : {}, reload: load, deleteTour, setTourStatus, startTournament };
}

/** Props every Floor board receives — the hook's return plus the view-level extras the
 *  landing computes (club lookups + the select callback into operational tabs). */
export type FloorBoardProps = ReturnType<typeof useFloorTournaments> & {
  multiClub: boolean;
  clubNameMap: Record<string, string>;
  clubs: ClubRow[];
  clubIds: string[];
  onSelect: (id: string) => void;
};
