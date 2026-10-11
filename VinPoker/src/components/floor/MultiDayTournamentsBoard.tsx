import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Layers, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FEATURES } from "@/lib/featureFlags";
import { NewTournamentDialog, TournamentCard } from "./TournamentManagerShared";
import type { EventMeta, FloorBoardProps } from "./useFloorTournaments";
import { BoardEmpty, BoardError } from "./floorBoardStates";
import { MultiDayFloorEventPanel } from "./MultiDayFloorEventPanel";

type EventGroup = { eventId: string; name: string; itmPercent: number; flights: any[]; final: any | null };

// Last-resort name when the event row's name isn't loaded: strip the child suffix the
// create RPC adds ("<Event> · Flight A" / "<Event> · Final Day").
const stripSuffix = (name: string) => (name ?? "").replace(/ · (Flight [A-Z]+|Final Day)$/u, "");

/**
 * Group event-linked tours into one Main Event per event_id [P2-8].
 * - name prefers eventMeta (the events row) and only falls back to stripSuffix.
 * - missing eventMeta never crashes (key/name stay valid).
 * - flights are enumerated DYNAMICALLY from the rows (sorted by flight_label), so an event
 *   with more than 11 flights doesn't drop any after K.
 */
function groupEvents(tours: any[], eventMeta: Record<string, EventMeta>): EventGroup[] {
  const byEvent = new Map<string, EventGroup>();
  for (const tr of tours) {
    if (!tr.event_id) continue;
    let g = byEvent.get(tr.event_id);
    if (!g) {
      const meta = eventMeta[tr.event_id];
      g = { eventId: tr.event_id, name: meta?.name || stripSuffix(tr.name) || "Main Event", itmPercent: meta?.itm_percent ?? 0, flights: [], final: null };
      byEvent.set(tr.event_id, g);
    }
    if (tr.phase === "final") g.final = tr;
    else g.flights.push(tr);
  }
  for (const g of byEvent.values()) {
    g.flights.sort((a, b) => String(a.flight_label ?? "").localeCompare(String(b.flight_label ?? "")));
  }
  return [...byEvent.values()];
}

export function MultiDayTournamentsBoard(p: FloorBoardProps) {
  const groups = useMemo(() => groupEvents(p.tours.filter((tr) => tr.event_id != null), p.eventMeta), [p.tours, p.eventMeta]);
  // [P0-2] only the create affordance is flag-gated; existing event tours show regardless.
  const createBtn = p.clubIds.length > 0 && FEATURES.multiDayTournaments
    ? <NewTournamentDialog clubs={p.clubs} defaultClubId={p.clubIds[0]} multiClub={p.multiClub} onCreated={p.reload} lockMode="multi" />
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Multi-day <span className="text-muted-foreground">({groups.length})</span></span>
        {createBtn}
      </div>
      {p.loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : p.error ? (
        <BoardError onRetry={p.reload} />
      ) : groups.length === 0 ? (
        <BoardEmpty icon={<Layers className="w-8 h-8" />} title="Chưa có Multi-day Event nào" sub="Tạo Main Event với các flight A–K + Final Day." create={createBtn} />
      ) : (
        <div className="max-h-[58vh] overflow-y-auto space-y-3 pr-1">
          {groups.map((g) => <EventCard key={g.eventId} group={g} p={p} />)}
        </div>
      )}
    </div>
  );
}

function EventCard({ group, p }: { group: EventGroup; p: FloorBoardProps }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [verifiedRelease, setVerifiedRelease] = useState(false);
  const entrants = group.flights.every(fl => p.flightMeta[fl.id] !== undefined)
    ? group.flights.reduce((s, fl) => s + p.flightMeta[fl.id].entrants, 0) : null;
  const cardProps = (tr: any) => ({
    tour: tr,
    flightMeta: p.flightMeta[tr.id],
    finalMeta: p.finalMeta[tr.id],
    multiClub: p.multiClub,
    clubName: p.clubNameMap[tr.club_id],
    reload: p.reload,
    onDelete: p.deleteTour,
    onSetStatus: p.setTourStatus,
    onStart: p.startTournament,
    onSelect: p.onSelect,
    legacyMultiDayActions: !verifiedRelease,
  });

  return (
    <Card className="border-primary/30 p-3 space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-primary shrink-0" /> : <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
        <Layers className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold truncate">{group.name}</span>
        {group.itmPercent > 0 && <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">ITM {group.itmPercent}%</span>}
        <span className="ml-auto min-w-0 text-right text-[11px] text-muted-foreground">{group.flights.length} flight · {entrants === null ? t("floorReadiness.unavailable") : `${entrants} entrant`}</span>
      </button>
      {open && (
        <div className="space-y-2 border-l-2 border-primary/15 pl-2">
          <MultiDayFloorEventPanel eventId={group.eventId} onReleaseRead={setVerifiedRelease} />
          {group.flights.map((fl) => <TournamentCard key={fl.id} {...cardProps(fl)} />)}
          {group.final ? (
            <TournamentCard {...cardProps(group.final)} />
          ) : (
            <p className="pl-1 text-[11px] text-muted-foreground">Chưa có Final Day cho sự kiện này.</p>
          )}
        </div>
      )}
    </Card>
  );
}
