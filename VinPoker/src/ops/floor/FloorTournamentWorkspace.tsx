import {
  ArrowLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import OpsTables from "@/pages/ops/OpsTables";
import OpsTournamentCockpit from "@/pages/ops/OpsTournamentCockpit";
import { TrackerFloorAlertLane } from "@/components/cashier/tournament-live/TrackerFloorAlertLane";
import { cn } from "@/lib/utils";
import { useTournamentOps } from "@/ops/workspace/TournamentOpsProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { OPS_CASHIER_MUTATIONS_ENABLED } from "@/ops/opsMutations";
import FloorRefundClearance from "./FloorRefundClearance";
import {
  FLOOR_TOURNAMENT_SECTIONS,
  type FloorTournamentSection,
  type FloorTournamentSectionDefinition,
} from "@/ops/floor/floorTournamentSections";

export default function FloorTournamentWorkspace({ section }: { section: FloorTournamentSection }) {
  const navigate = useNavigate();
  const tournament = useTournamentOps();
  const { user, session } = useOpsAuth();
  const { snapshot } = tournament;
  const clubQuery = `?club=${encodeURIComponent(snapshot.clubId)}`;
  const routeFor = (target: FloorTournamentSection) =>
    `/ops/floor/tournaments/${snapshot.tournamentId}/${target}${clubQuery}`;
  const exitWorkspace = () => navigate(`/ops/floor${clubQuery}`);

  return (
    <div className="grid min-w-0 gap-4 pb-24 md:grid-cols-[15rem_minmax(0,1fr)] md:pb-0">
      <aside className="hidden md:block">
        <div className="sticky top-20 rounded-3xl border border-white/10 bg-[#07100c] p-3">
          <button
            type="button"
            data-ops-action="floor.workspace.exit"
            onClick={exitWorkspace}
            className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 text-left text-sm font-semibold text-[#d7e3dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <ArrowLeft className="h-4 w-4" /> Thoát không gian giải
          </button>
          <div className="mx-2 my-3 border-t border-white/8" />
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
            Giải đang vận hành
          </p>
          <h1 className="mt-2 line-clamp-2 px-3 text-lg font-semibold text-white">
            {snapshot.tournamentName}
          </h1>
          <p className="mt-1 px-3 text-xs text-[#91a49b]">{snapshot.status}</p>
          <nav className="mt-4 space-y-1" aria-label="Công việc trong giải">
            {FLOOR_TOURNAMENT_SECTIONS.map((item) => (
              <SectionButton
                key={item.id}
                item={item}
                active={item.id === section}
                onSelect={() => navigate(routeFor(item.id))}
              />
            ))}
          </nav>
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-3 md:hidden">
          <button
            type="button"
            data-ops-action="floor.workspace.exit"
            onClick={exitWorkspace}
            className="flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-[#d8bc85] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <ArrowLeft className="h-4 w-4" /> Danh sách giải
          </button>
          <div className="rounded-2xl border border-white/8 bg-[#07100c] px-4 py-3">
            <p className="truncate text-base font-semibold text-white">{snapshot.tournamentName}</p>
            <p className="mt-0.5 text-xs text-[#91a49b]">{snapshot.status} · {activeLabel(section)}</p>
          </div>
        </div>

        {(tournament.stale || tournament.conflict) && (
          <div className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-100">
            Dữ liệu đã thay đổi trên máy khác. Hãy làm mới trước khi thao tác tiếp.
            <button
              type="button"
              data-ops-action="floor.workspace.refresh_conflict"
              onClick={tournament.refreshSnapshot}
              className="ml-2 min-h-11 font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Làm mới
            </button>
          </div>
        )}

        <TrackerFloorAlertLane key={JSON.stringify([user?.id, sessionReadEpoch(session), snapshot.tournamentId])} tournamentId={snapshot.tournamentId} actorId={user?.id} />

        <div key={`${section}:${tournament.revision}`} className="min-w-0">
          {section === "tables"
            ? <OpsTables tournamentId={snapshot.tournamentId} />
            : <OpsTournamentCockpit section={section} />}
          {section === "players" && OPS_CASHIER_MUTATIONS_ENABLED && <FloorRefundClearance />}
        </div>
      </section>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-[#030604]/96 px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        aria-label="Công việc trong giải"
      >
        {FLOOR_TOURNAMENT_SECTIONS.map((item) => (
          <SectionButton
            key={item.id}
            item={item}
            active={item.id === section}
            mobile
            onSelect={() => navigate(routeFor(item.id))}
          />
        ))}
      </nav>
    </div>
  );
}

function SectionButton({
  item,
  active,
  mobile = false,
  onSelect,
}: {
  item: FloorTournamentSectionDefinition;
  active: boolean;
  mobile?: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-ops-action="floor.workspace.navigate"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
        mobile
          ? "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold"
          : "flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium",
        active ? "bg-emerald-300/12 text-emerald-300" : "text-[#91a49b]",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className={mobile ? "max-w-full truncate" : "truncate"}>
        {mobile ? item.mobileLabel : item.label}
      </span>
    </button>
  );
}

function activeLabel(section: FloorTournamentSection): string {
  return FLOOR_TOURNAMENT_SECTIONS.find((item) => item.id === section)?.label ?? "Công việc";
}
