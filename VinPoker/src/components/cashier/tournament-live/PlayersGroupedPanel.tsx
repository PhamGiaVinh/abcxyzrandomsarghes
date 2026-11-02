import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, User, Search, Users } from "lucide-react";
import { formatStack } from "@/lib/format";
import type { Tournament } from "@/types/tournament";
import { PlayerActionSheet, type ActionSeat } from "./PlayerActionSheet";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { EditChipsDialog } from "./EditChipsDialog";
import { PlayerInfoSheet } from "./PlayerInfoSheet";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { ManualFloorBustConfirmDialog } from "./ManualFloorBustConfirmDialog";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc, type FloorTournamentInventoryItem } from "@/lib/floorTableControlV3";
import { floorOpsErrorMessage } from "@/lib/floorOpsErrors";
import { RestoreBustDialog } from "./RestoreBustDialog";
import { parseTournamentParticipation, type ParticipationSeat, type ParticipationEntry } from "@/lib/tournamentParticipation";

interface SeatRow {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  tournament_table_id: string | null;
  table_session_id: string | null;
  table_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
}

interface EntryRow {
  id: string;
  player_id: string;
  player_name: string;
  current_stack: number;
  seat_number: number | null;
  finished_place: number | null;
  status: string;
}

const floorClient = createFloorTableControlV3Client(async (name, args) =>
  await (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args));

function exactSessionMode(seat: SeatRow, inventory: FloorTournamentInventoryItem[]) {
  if (!seat.tournament_table_id || !seat.table_session_id) return null;
  const matches = inventory.filter((table) => table.tournamentTableId === seat.tournament_table_id
    && table.tableSessionId === seat.table_session_id && table.availabilityStatus === "current_tournament");
  return matches.length === 1 ? matches[0].controlMode : null;
}

function responseError(data: unknown): string | null {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : null;
}

type GroupKey = "playing" | "waiting" | "bagged" | "bust" | "anomaly";

/**
 * Grouped participants panel with a separate read-only bagged roster, each with a
 * count badge + search + sort-by-chips. All groups use the canonical server
 * participation projection; invalid occupancy stays visible without actions.
 * Tap a valid playing row → action sheet (Chuyển / Sửa chip /
 * Phiếu / Loại). All actions reuse existing backend.
 */
export function PlayersGroupedPanel({
  tournament,
  refreshTrigger,
  onTournamentChanged,
}: {
  tournament: Tournament;
  refreshTrigger: number;
  onTournamentChanged?: () => void;
}) {
  const tid = tournament.id;
  const { user } = useAuth();
  const { t } = useTranslation();
  const tournamentEnded = ["completed", "finished", "cancelled"].includes(tournament.status);
  const scope = `${user?.id ?? "anonymous"}:${tournament.club_id}:${tid}:${tournamentEnded}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestSeq = useRef(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const [anomalySeats, setAnomalySeats] = useState<ParticipationSeat[]>([]);
  const [anomalyEntries, setAnomalyEntries] = useState<ParticipationEntry[]>([]);
  const [seats, setSeats] = useState<SeatRow[] | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entryBySeat, setEntryBySeat] = useState<Record<string, string>>({});
  const [tableControls, setTableControls] = useState<FloorTournamentInventoryItem[] | null>(null);
  const [canMove, setCanMove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<GroupKey>("playing");
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<SeatRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<SeatRow | null>(null);
  const [editTarget, setEditTarget] = useState<SeatRow | null>(null);
  const [infoTarget, setInfoTarget] = useState<SeatRow | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [busting, setBusting] = useState(false);
  const [manualBustTarget, setManualBustTarget] = useState<SeatRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ entryId: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setCanMove(false);
    (async () => {
      const { data: scope, error } = await supabase.rpc("get_my_floor_operator_scope");
      if (!alive) return;
      if (error) { setCanMove(false); return; }
      setCanMove((scope ?? []).some((row) => (
        row.club_id === tournament.club_id
        && (row.can_owner || row.can_cashier || row.can_floor)
      )));
    })();
    return () => { alive = false; };
  }, [tournament.club_id, user?.id]);

  const load = useCallback(async () => {
    if (scopeRef.current !== scope || !user?.id) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const [participationRes, tablesRes] = await Promise.all([
        (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>)(
          "get_tournament_participation_v1", { p_tournament_id: tid }),
        tournamentEnded ? Promise.resolve({ ok: true as const, data: [] }) : floorClient.getTournamentTableInventory(tid),
      ]);
      if (seq !== requestSeq.current || scopeRef.current !== scope) return;
      if (participationRes.error) {
        // Keep last-good rows for transient failures, never for revoked access.
        if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(participationRes.error.code ?? "")) {
          setLoadedScope(null);
          setSeats(null);
          setEntries([]);
          setAnomalySeats([]);
          setAnomalyEntries([]);
          setEntryBySeat({});
        }
        throw new Error(participationRes.error.message);
      }
      const projection = parseTournamentParticipation(participationRes.data, tid);
      setSeats(projection.seats.filter((s) => s.participation_status === "seated").sort((a, b) => b.chip_count - a.chip_count));
      setAnomalySeats(projection.seats.filter((s) => s.participation_status === "anomaly"));
      setAnomalyEntries(projection.entries.filter((e) => e.participation_status === "anomaly"
        && !projection.seats.some((s) => s.entry_id === e.id)));
      const m: Record<string, string> = {};
      for (const r of projection.seats) if (r.entry_id) m[r.seat_id] = r.entry_id;
      setEntryBySeat(m);
      setEntries(projection.entries.filter((e) => e.participation_status === "busted" || e.participation_status === "waiting"
        || (e.status === "bagged" && e.participation_status === "bagged")).map((e) => ({
        id: e.id,
        player_id: e.player_id,
        player_name: e.player_name ?? "",
        current_stack: e.current_stack ?? 0,
        seat_number: e.seat_number ?? null,
        finished_place: e.finished_place ?? null,
        status: e.status === "bagged" ? "bagged" : e.participation_status === "waiting" ? "registered" : "busted",
      })));
      // Viewing participation does not require mutation authority. An unavailable
      // table context must disable actions, not discard an authorized read.
      if (tablesRes.ok === false) {
        setTableControls(null);
        setAuthorityError(tablesRes.error);
      } else {
        setTableControls(tablesRes.data);
        setAuthorityError(null);
      }
      setLoadedScope(scope);
      setLoadError(null);
    } catch (error) {
      if (seq !== requestSeq.current || scopeRef.current !== scope) return;
      // A player action must not infer Manual mode when the table policy is
      // unavailable or legacy identifiers map to multiple tables.
      setTableControls(null);
      setAuthorityError(null);
      setLoadError(error instanceof Error ? error.message : t("participation.loadError"));
    } finally {
      if (seq === requestSeq.current && scopeRef.current === scope) setLoading(false);
    }
  }, [tid, scope, user?.id, t, tournamentEnded]);

  useEffect(() => {
    setSelected(null); setMoveTarget(null); setEditTarget(null); setInfoTarget(null);
    setManualBustTarget(null); setRestoreTarget(null); setReceipt(null);
    setLoadError(null);
    setAuthorityError(null);
    void load();
    return () => { requestSeq.current += 1; };
  }, [load, refreshTrigger]);

  const waiting = useMemo(
    () => entries.filter((e) => e.status === "registered"),
    [entries],
  );
  const bagged = useMemo(() => entries.filter((e) => e.status === "bagged"), [entries]);
  const bust = useMemo(
    () => entries
      .filter((e) => e.status === "busted")
      .sort((a, b) => (a.finished_place ?? 1e9) - (b.finished_place ?? 1e9)),
    [entries],
  );

  const scopeReady = loadedScope === scope;
  const operationsReady = !tournamentEnded && scopeReady && !loading && !loadError && !authorityError;
  const counts = { playing: seats?.length ?? 0, waiting: waiting.length, bagged: bagged.length, bust: bust.length,
    anomaly: anomalySeats.length + anomalyEntries.length };

  const filterText = useCallback(
    (s: string) => !query || s.toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const visiblePlaying = useMemo(
    () => (seats ?? []).filter((s) => filterText(s.player_name || s.player_id) || filterText(s.table_name)),
    [seats, filterText],
  );

  const selectedControlMode = useMemo(() => {
    if (!selected || !tableControls) return null;
    return exactSessionMode(selected, tableControls);
  }, [selected, tableControls]);
  const selectedChipEditDisabledReason = selected
    ? !selectedControlMode
      ? "Không xác minh được chế độ bàn. Hãy tải lại trước khi sửa chip."
      : selectedControlMode === "tracker"
        ? "Bàn Live Tracker do Tracker quản lý chip."
        : undefined
    : undefined;

  const bustSeat = async (target: SeatRow | null) => {
    if (!target || scopeRef.current !== scope || !operationsReady) return;
    setBusting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tid,
          action: "update_seats",
          seats: [{
            seat_id: target.seat_id,
            player_id: target.player_id,
            entry_number: target.entry_number,
            table_id: target.table_id,
            seat_number: target.seat_number,
            expected_chip_count: target.chip_count,
            chip_count: target.chip_count,
            is_active: false,
            player_name: target.player_name,
          }],
        },
      });
      if (scopeRef.current !== scope) return;
      const edgeError = responseError(data);
      if (error || edgeError) { toast.error(floorOpsErrorMessage(edgeError || error?.message, "Loại thất bại")); return; }
      toast.success(`Đã loại ${target.player_name || "người chơi"}`);
      setSelected(null);
      setInfoTarget(null);
      load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Lỗi");
    } finally {
      setBusting(false);
    }
  };

  const requestBust = async (target: SeatRow | null, manualConfirmed = false) => {
    if (!target || scopeRef.current !== scope || !operationsReady) return;
    const inventory = await floorClient.getTournamentTableInventory(tid);
    if (scopeRef.current !== scope) return;
    if (inventory.ok === false) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại.");
      return;
    }
    const mode = exactSessionMode(target, inventory.data);
    if (!mode) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại.");
      return;
    }
    if (mode === "tracker" && target.chip_count > 0) {
      toast.error("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0.");
      return;
    }
    if (mode === "manual" && target.chip_count > 0 && !manualConfirmed) {
      setSelected(null);
      setInfoTarget(null);
      setManualBustTarget(target);
      return;
    }
    await bustSeat(target);
  };

  const openReceipt = (target: SeatRow | null) => {
    if (!target) return;
    setReceipt({
      tournamentName: tournament.name,
      tournamentDate: (tournament as Tournament & { start_time?: string | null }).start_time ?? null,
      playerName: target.player_name || target.player_id.slice(0, 8),
      tableNumber: null,
      seatNumber: target.seat_number,
      receiptCode: entryBySeat[target.seat_id] ?? target.seat_id,
      startingStack: target.chip_count,
      qrValue: entryBySeat[target.seat_id] ?? target.seat_id,
    });
  };

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" /> Người chơi
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      {loadError && <div role="alert" className="text-sm text-destructive">
        {t("participation.loadError")}{scopeReady && ` ${t("participation.stale")}`}
      </div>}
      {scopeReady && authorityError && <div role="alert" className="text-sm text-warning">
        Không xác minh được trạng thái bàn. Vẫn có thể xem danh sách; thao tác tạm khóa. Hãy tải lại.
      </div>}
      <div className={`grid grid-cols-2 ${bagged.length || group === "bagged" ? "sm:grid-cols-5" : "sm:grid-cols-4"} gap-2`}>
        {([
          ["playing", "Đang chơi", counts.playing, "text-primary border-primary/45 bg-primary/10"],
          ["waiting", "Chờ xếp", counts.waiting, "text-warning border-warning/45 bg-warning/10"],
          ["bagged", t("participation.bagged"), counts.bagged, "text-primary border-primary/45 bg-primary/10"],
          ["bust", "Bust", counts.bust, "text-destructive border-destructive/45 bg-destructive/10"],
          ["anomaly", t("participation.repairRequired"), counts.anomaly, "text-warning border-warning/45 bg-warning/10"],
        ] as [GroupKey, string, number, string][]).filter(([k, , n]) => k !== "bagged" || n > 0 || group === "bagged").map(([k, label, n, active]) => (
          <button
            key={k}
            onClick={() => setGroup(k)}
            className={`rounded-lg border px-2 py-2 text-sm ${group === k ? active : "border-border bg-card text-muted-foreground"}`}
          >
            {label} <span className="ml-1 rounded-full bg-background/40 px-1.5 text-xs">{scopeReady ? n : "…"}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Tìm tên / bàn…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!scopeReady && loadError ? <Empty text={t("participation.loadError")} /> : !scopeReady || seats === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : group === "playing" ? (
        visiblePlaying.length === 0 ? (
          <Empty text="Chưa có người chơi đang hoạt động." />
        ) : (
          <div className="space-y-1.5">
            {visiblePlaying.map((s, idx) => (
              <button
                key={s.seat_id}
                disabled={!operationsReady}
                onClick={() => setSelected(s)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary/50"
              >
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                <Avatar name={s.player_name || s.player_id} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.player_name || s.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{s.table_name} · Ghế {s.seat_number}{s.entry_number > 1 ? ` · R#${s.entry_number}` : ""}</div>
                </div>
                <div className="shrink-0 text-right font-mono text-sm text-primary">{formatStack(s.chip_count)}</div>
              </button>
            ))}
          </div>
        )
      ) : group === "waiting" ? (
        waiting.filter((e) => filterText(e.player_name || e.player_id)).length === 0 ? (
          <Empty text="Không có người chờ xếp bàn." />
        ) : (
          <div className="space-y-1.5">
            {waiting.filter((e) => filterText(e.player_name || e.player_id)).map((e, idx) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                <Avatar name={e.player_name || e.player_id} tone="warning" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.player_name || e.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-warning">Chờ xếp bàn</div>
                </div>
                <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">{formatStack(e.current_stack)}</div>
              </div>
            ))}
          </div>
        )
      ) : group === "bagged" ? (
        <section aria-label={t("participation.bagged")} className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("participation.baggedHint")}</p>
          {bagged.filter((e) => filterText(e.player_name || e.player_id)).length === 0
            ? <Empty text={t("participation.noBagged")} />
            : bagged.filter((e) => filterText(e.player_name || e.player_id)).map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                <Avatar name={e.player_name || e.player_id} tone="muted" />
                <div className="min-w-0 flex-1 break-words text-sm font-medium">{e.player_name || e.player_id.slice(0, 8)}</div>
                <div className="shrink-0 font-mono text-xs text-muted-foreground">{formatStack(e.current_stack)}</div>
              </div>
            ))}
        </section>
      ) : group === "anomaly" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("participation.repairHint")}</p>
          {anomalySeats.filter((s) => filterText(s.player_name || s.player_id)).map((s) => <div key={s.seat_id} className="rounded-lg border border-warning/45 p-3 text-sm">
            <div>{s.player_name || s.player_id} · {s.table_name || s.table_id} · {s.seat_number}</div>
            <div className="text-muted-foreground">{t(s.anomaly_reason === "stack_projection_mismatch" ? "stack_projection_mismatch" : `participation.reasons.${s.anomaly_reason}`, { defaultValue: s.anomaly_reason ?? "" })} · {formatStack(s.chip_count)}</div>
          </div>)}
          {anomalyEntries.filter((e) => filterText(e.player_name || e.player_id)).map((e) => <div key={e.id} className="rounded-lg border border-warning/45 p-3 text-sm">
            <div>{e.player_name || e.player_id} · R#{e.entry_no}</div>
            <div className="text-muted-foreground">{t(e.anomaly_reason === "stack_projection_mismatch" ? "stack_projection_mismatch" : `participation.reasons.${e.anomaly_reason}`, { defaultValue: e.anomaly_reason ?? "" })} · {formatStack(e.current_stack)}</div>
          </div>)}
        </div>
      ) : (
        bust.filter((e) => filterText(e.player_name || e.player_id)).length === 0 ? (
          <Empty text="Chưa có người bị loại." />
        ) : (
          <div className="space-y-1.5">
            {bust.filter((e) => filterText(e.player_name || e.player_id)).map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 opacity-80">
                <span className="w-7 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{e.finished_place ? `#${e.finished_place}` : "—"}</span>
                <Avatar name={e.player_name || e.player_id} tone="muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium line-through decoration-muted-foreground/40">{e.player_name || e.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-destructive">Đã loại · entry {e.id.slice(-8)}</div>
                </div>
                {canMove && operationsReady && <Button variant="outline" className="min-h-11 shrink-0" onClick={() => setRestoreTarget({ entryId: e.id, name: `${e.player_name || e.player_id} · entry ${e.id.slice(-8)}` })}>
                  Hoàn tác bust nhầm
                </Button>}
              </div>
            ))}
          </div>
        )
      )}

      <RestoreBustDialog actorId={user?.id ?? null} tournamentId={tid} target={tournamentEnded ? null : restoreTarget} onClose={() => setRestoreTarget(null)} onRestored={() => {
        void load();
        // Refresh server-owned tournament totals even when Realtime is delayed.
        onTournamentChanged?.();
      }} />
      <PlayerActionSheet
        open={!tournamentEnded && selected !== null}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        seat={selected as ActionSeat | null}
        entryId={selected ? entryBySeat[selected.seat_id] : undefined}
        canMove={canMove && operationsReady}
        busting={busting}
        onMove={() => { if (selected) setMoveTarget(selected); }}
        onEditChips={() => { if (selected) setEditTarget(selected); }}
        editDisabledReason={selectedChipEditDisabledReason}
        onReceipt={() => openReceipt(selected)}
        onBust={() => { void requestBust(selected); }}
        onInfo={() => { if (selected) setInfoTarget(selected); }}
      />

      <PlayerInfoSheet
        open={!tournamentEnded && infoTarget !== null}
        onOpenChange={(v) => { if (!v) setInfoTarget(null); }}
        seat={infoTarget as ActionSeat | null}
        ticketNumber={infoTarget ? entryBySeat[infoTarget.seat_id] : undefined}
        canMove={canMove && operationsReady}
        busting={busting}
        onMove={() => { if (infoTarget) setMoveTarget(infoTarget); }}
        onReceipt={() => openReceipt(infoTarget)}
        onBust={() => { void requestBust(infoTarget); }}
      />

      {!tournamentEnded && moveTarget && entryBySeat[moveTarget.seat_id] && (
        <MovePlayerDialog
          actorId={user?.id ?? null}
          open={moveTarget !== null}
          onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
          tournamentId={tid}
          entryId={entryBySeat[moveTarget.seat_id]}
          playerName={moveTarget.player_name || moveTarget.player_id.slice(0, 8)}
          currentTournamentTableId={null}
          currentSeatNumber={moveTarget.seat_number}
          onMoved={load}
        />
      )}

      <EditChipsDialog
        open={!tournamentEnded && editTarget !== null}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        tournamentId={tid}
        seat={editTarget as ActionSeat | null}
        onSaved={load}
      />

      <ManualFloorBustConfirmDialog
        open={!tournamentEnded && manualBustTarget !== null}
        onOpenChange={(open) => { if (!open) setManualBustTarget(null); }}
        playerName={manualBustTarget?.player_name || manualBustTarget?.player_id.slice(0, 8) || "Người chơi"}
        chipCount={manualBustTarget?.chip_count ?? 0}
        busy={busting}
        onConfirm={() => {
          const target = manualBustTarget;
          if (!target) return;
          setManualBustTarget(null);
          void requestBust(target, true);
        }}
      />

      <SeatReceiptDialog open={receipt !== null} onOpenChange={(v) => { if (!v) setReceipt(null); }} receipt={receipt} />
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function Avatar({ name, tone = "primary" }: { name: string; tone?: "primary" | "warning" | "muted" }) {
  const parts = name.trim().split(" ");
  const ini = ((parts[0]?.[0] ?? "?") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
  const cls = tone === "warning" ? "bg-warning/15 text-warning" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary";
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium ${cls}`}>
      {ini || <User className="h-4 w-4" />}
    </span>
  );
}
