import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Shuffle, Tv2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSupabaseBackendScope } from "@/integrations/supabase/SupabaseClientContext";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { floorRedrawJournalKey, readFloorRedrawJournal, saveFloorRedrawJournal, clearFloorRedrawJournal,
  type FloorRedrawJournal, type FloorRedrawScope } from "@/lib/floorRedrawIntent";
import {
  createFloorTableControlV3Client,
  type FloorRedrawPlan,
  type FloorTournamentInventoryItem,
  type FloorTournamentTableRoster,
} from "@/lib/floorTableControlV3";

type RedrawClient = Pick<
  ReturnType<typeof createFloorTableControlV3Client>,
  | "getTournamentTableInventory"
  | "planTournamentRedraw"
  | "applyTournamentRedraw"
  | "getActiveTournamentRedraw"
  | "continueTournamentRedraw"
  | "getRedrawIntent"
>;

export type RedrawProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  tables: readonly FloorTournamentTableRoster[];
  client: RedrawClient;
  onApplied: () => void | Promise<void>;
};
export function FloorRedrawWorkspaceV1(props: RedrawProps & { actorId?: string; sessionEpoch?: number }) {
  const backendScope = useSupabaseBackendScope();
  const clientVersion = useRef({client:props.client, revision:0});
  if (clientVersion.current.client !== props.client) clientVersion.current = {client:props.client, revision:clientVersion.current.revision+1};
  // Retire the entire workspace on auth/backend changes, including late mutation completions.
  return props.open ? <ScopedRedraw key={JSON.stringify([backendScope,props.actorId,props.tournamentId,props.sessionEpoch,clientVersion.current.revision])}
    {...props} actorId={props.actorId} backendScope={backendScope}/> : null;
}
function ScopedRedraw({
  open,
  onOpenChange,
  tournamentId,
  tables,
  client,
  onApplied,
  actorId,
  backendScope,
}: RedrawProps & {actorId?: string; backendScope: string | null}) {
  const [capacity, setCapacity] = useState<8 | 9>(9);
  const [inventory, setInventory] = useState<FloorTournamentInventoryItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<"setup" | "preview" | "done">("setup");
  const [plan, setPlan] = useState<FloorRedrawPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const [journal, setJournal] = useState<FloorRedrawJournal | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const alive = useRef(true), working = useRef(false), raw = useRef<string | null>(null), generation = useRef(0);
  const changed = useRef(onApplied); changed.current = onApplied;
  const scope = useMemo<FloorRedrawScope>(() => ({actorId: actorId ?? '', tournamentId, backendScope: backendScope ?? ''}), [actorId,tournamentId,backendScope]);
  const playerCount = useMemo(() => tables.reduce((sum, table) => sum + table.seats.length, 0), [tables]);
  const requiredTableCount = Math.max(1, Math.ceil(playerCount / capacity));
  const selectable = useMemo(
    () => inventory.filter((item) => item.tableNumber != null && (item.availabilityStatus === "available" || item.availabilityStatus === "current_tournament")),
    [inventory],
  );

  const persist = (next: FloorRedrawJournal) => {
    raw.current = saveFloorRedrawJournal(sessionStorage, scope, next, raw.current);
    setJournal(next);
  };
  const clear = useCallback(() => {
    if (raw.current === null) throw Error('REDRAW_JOURNAL_MISSING');
    clearFloorRedrawJournal(sessionStorage, scope, raw.current);
    raw.current = null; setJournal(null); setUnresolved(false);
  }, [scope]);
  const finishContinue = useCallback((clockResumed: boolean) => {
    clear(); setContinued(true);
    setError(clockResumed ? "Redraw finished. The tournament clock is running again."
      : "Redraw finished. The clock remains paused because it was already paused or changed during the display.");
  }, [clear]);
  const recoverIntent = useCallback(async (pending: FloorRedrawJournal, current = () => alive.current) => {
    const planned = await waitForManualPlayerResponse(client.getRedrawIntent(pending.planIntent));
    if (!current()) return;
    if (planned.ok === false) throw Error(planned.error);
    if (planned.data.status !== 'found' || planned.data.operation !== 'plan') throw Error('REDRAW_RECEIPT_UNKNOWN');
    const verified = planned.data.plan;
    if (pending.applyIntent && pending.applyIntent.batchId !== verified.batchId) throw Error('REDRAW_JOURNAL_BATCH_MISMATCH');
    setCapacity(verified.targetMaxSeats); setSelectedIds(pending.planIntent.gameTableIds);
    setPlan(verified); setPhase('preview');
    if (pending.applyIntent) {
      const applied = await waitForManualPlayerResponse(client.getRedrawIntent(pending.applyIntent));
      if (!current()) return;
      if (applied.ok === false) throw Error(applied.error);
      if (applied.data.status !== 'found' || applied.data.operation !== 'apply') throw Error('REDRAW_RECEIPT_UNKNOWN');
      if (applied.data.plan.batchId !== verified.batchId || applied.data.plan.status !== 'applied') throw Error('REDRAW_RECEIPT_UNVERIFIED');
      setPlan(applied.data.plan); setPhase('done');
    }
    if (pending.continueIntent) {
      const continuedResult = await waitForManualPlayerResponse(client.getRedrawIntent(pending.continueIntent));
      if (!current()) return;
      if (continuedResult.ok === false) throw Error(continuedResult.error);
      if (continuedResult.data.status !== 'found' || continuedResult.data.operation !== 'continue') throw Error('REDRAW_RECEIPT_UNKNOWN');
      finishContinue(continuedResult.data.clockResumed);
    }
    if (current()) setUnresolved(false);
  }, [client,finishContinue]);
  useEffect(() => {
    alive.current = true; working.current = true; setBusy(true);
    const sequence = ++generation.current;
    const current = () => alive.current && generation.current === sequence;
    void (async () => {
      let pending: FloorRedrawJournal | null;
      try {
        const key = floorRedrawJournalKey(scope);
        raw.current = sessionStorage.getItem(key);
        pending = raw.current !== null ? readFloorRedrawJournal(raw.current, scope) : null;
      } catch {
        if (current()) {setBlocked(true); setError('Không đọc được intent redraw đã lưu hoặc thiếu scope đăng nhập. Chưa được gửi thao tác mới.'); working.current=false; setBusy(false);}
        return;
      }
      try {
        setJournal(pending); setUnresolved(!!pending);
        if (pending) await recoverIntent(pending,current);
        if (!current()) return;
        const result = await waitForManualPlayerResponse(client.getTournamentTableInventory(tournamentId));
        if (!current()) return;
        if (result.ok === false) throw Error(result.error);
        setInventory(result.data);
        if (!pending) setSelectedIds(result.data.filter(i => i.availabilityStatus === 'current_tournament')
          .sort((a,b) => (a.tableNumber ?? 101)-(b.tableNumber ?? 101)).map(i => i.gameTableId));
      } catch (cause) {
        if (current()) {
          setError(cause instanceof Error ? cause.message : 'Không xác minh được redraw.');
        }
      } finally { if (current()) { working.current = false; setBusy(false); } }
    })();
    return () => { alive.current = false; };
  }, [client,scope,tournamentId,recoverIntent]);
  const run = async (task: () => Promise<void>) => {
    if (working.current || blocked || !alive.current) return;
    working.current = true; setBusy(true); setError(null);
    try {
      if (sessionStorage.getItem(floorRedrawJournalKey(scope)) !== raw.current) throw Error('REDRAW_JOURNAL_CHANGED');
      await task();
    }
    catch (cause) { if (alive.current) { setUnresolved(true); setError(`Chưa xác minh được kết quả. Giữ nguyên yêu cầu và đối chiếu receipt. ${cause instanceof Error ? cause.message : ''}`); } }
    finally { if (alive.current) { working.current = false; setBusy(false); } }
  };

  useEffect(() => {
    if (!open || inventory.length === 0 || phase !== "setup" || journal) return;
    setSelectedIds((current) => {
      const valid = current.filter((id) => selectable.some((item) => item.gameTableId === id)).slice(0, requiredTableCount);
      const fill = selectable
        .filter((item) => !valid.includes(item.gameTableId))
        .sort((a, b) => {
          const aCurrent = a.availabilityStatus === "current_tournament" ? 0 : 1;
          const bCurrent = b.availabilityStatus === "current_tournament" ? 0 : 1;
          return aCurrent - bCurrent || (a.tableNumber ?? 101) - (b.tableNumber ?? 101);
        })
        .map((item) => item.gameTableId);
      return [...valid, ...fill].slice(0, requiredTableCount);
    });
  }, [inventory, open, phase, requiredTableCount, selectable, journal]);

  const toggleTable = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : current.length < requiredTableCount
        ? [...current, id]
        : current);
  };

  const sendPlan = async (pending: FloorRedrawJournal) => {
    const result = await waitForManualPlayerResponse(client.planTournamentRedraw(pending.planIntent));
    if (!alive.current) return;
    if (result.ok === false) throw Error(redrawMessage(result.error));
    setPlan(result.data); setPhase('preview'); setUnresolved(false);
  };
  const preview = () => run(async () => {
    if (journal || selectedIds.length !== requiredTableCount) return;
    const pending: FloorRedrawJournal = {version:1,backendScope:scope.backendScope,
      planIntent:{actorId:scope.actorId,tournamentId,requestId:crypto.randomUUID(),operation:'plan',targetMaxSeats:capacity,gameTableIds:[...selectedIds]}};
    persist(pending); setUnresolved(true); await sendPlan(pending);
  });

  const apply = () => run(async () => {
    if (!plan || !journal || journal.continueIntent) return;
    const pending: FloorRedrawJournal = {...journal, applyIntent:journal.applyIntent ?? {
      actorId:scope.actorId,tournamentId,operation:'apply',batchId:plan.batchId,requestId:crypto.randomUUID()}};
    persist(pending); setUnresolved(true);
    const result = await waitForManualPlayerResponse(client.applyTournamentRedraw(pending.applyIntent!));
    if (!alive.current) return;
    if (result.ok === false) throw Error(redrawMessage(result.error));
    if (result.data.batchId !== pending.applyIntent!.batchId || result.data.status !== 'applied') throw Error('REDRAW_RECEIPT_UNVERIFIED');
    setPlan(result.data); setPhase('done'); setUnresolved(false); await changed.current();
  });

  const continueRedraw = () => run(async () => {
    if (!plan || !journal?.applyIntent || continued) return;
    let pending = journal;
    if (!pending.continueIntent) {
      const active = await waitForManualPlayerResponse(client.getActiveTournamentRedraw(tournamentId));
      if (!alive.current) return;
      if (active.ok === false) throw Error(redrawMessage(active.error));
      if (!active.data || active.data.batchId !== plan.batchId) throw Error(redrawMessage('REDRAW_HOLD_NOT_ACTIVE'));
      pending = {...pending,continueIntent:{actorId:scope.actorId,tournamentId,operation:'continue',batchId:plan.batchId,
        expectedRedrawRevision:active.data.redrawRevision,requestId:crypto.randomUUID()}};
      persist(pending);
    }
    setUnresolved(true);
    const result = await waitForManualPlayerResponse(client.continueTournamentRedraw(pending.continueIntent!));
    if (!alive.current) return;
    if (result.ok === false) throw Error(redrawMessage(result.error));
    finishContinue(result.data.clockResumed); await changed.current();
  });
  const retry = () => run(async () => {
    if (!journal) return;
    if (journal.continueIntent) { // Reuse the persisted revision even if public TV is already empty.
      const result = await waitForManualPlayerResponse(client.continueTournamentRedraw(journal.continueIntent));
      if (!alive.current) return;
      if (result.ok === false) throw Error(redrawMessage(result.error));
      finishContinue(result.data.clockResumed); await changed.current();
    } else if (journal.applyIntent) {
      const planned = await waitForManualPlayerResponse(client.getRedrawIntent(journal.planIntent));
      if (!alive.current) return;
      if (planned.ok === false) throw Error(planned.error);
      if (planned.data.status !== 'found' || planned.data.operation !== 'plan'
        || planned.data.plan.batchId !== journal.applyIntent.batchId) throw Error('REDRAW_JOURNAL_BATCH_MISMATCH');
      const result = await waitForManualPlayerResponse(client.applyTournamentRedraw(journal.applyIntent));
      if (!alive.current) return;
      if (result.ok === false) throw Error(redrawMessage(result.error));
      if (result.data.batchId !== journal.applyIntent.batchId || result.data.status !== 'applied') throw Error('REDRAW_RECEIPT_UNVERIFIED');
      setPlan(result.data); setPhase('done'); setUnresolved(false); await changed.current();
    } else await sendPlan(journal);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-0 bg-[#0d0913] p-0 sm:h-[90vh] sm:w-[calc(100vw-2rem)] sm:max-w-4xl sm:rounded-3xl sm:border sm:border-white/10">
        <DialogHeader className="border-b border-white/8 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-xl text-[#f2ece6]"><Shuffle className="h-5 w-5 text-[#c9a86a]" /> Tournament redraw</DialogTitle>
          <DialogDescription className="text-sm text-[#9b8e97]">
            {phase === "setup" ? "Choose 8-max or 9-max and the required tables for this tournament." : phase === "preview" ? "This preview is fixed. Confirm to apply these exact seat movements." : "The redraw is on the TV. Continue when players have reached their new seats."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
          {error && <div role="alert" className="mb-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-200">{error}</div>}
          {journal && unresolved && <div role="status" className="mb-3 space-y-2 rounded-2xl border border-amber-400/30 p-3 text-sm text-amber-100">
            <p>Đang giữ yêu cầu redraw chưa xác minh. Không tạo phương án hoặc request mới.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || blocked} onClick={() => void run(() => recoverIntent(journal))}>Đối chiếu receipt redraw</Button>
              <Button disabled={busy || blocked} onClick={() => void retry()}>Thử lại đúng yêu cầu redraw</Button>
            </div>
          </div>}
          {phase === "setup" ? (
            <div className="space-y-5">
              <section>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b8e97]">Seats per table</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {([8, 9] as const).map((value) => (
                    <button key={value} disabled={busy || blocked || !!journal} type="button" data-ops-action="floor.redraw.select_capacity" onClick={() => setCapacity(value)} className={cn("min-h-14 rounded-2xl border px-3 text-left", capacity === value ? "border-[#c9a86a] bg-[#c9a86a]/14 text-[#f2ece6]" : "border-white/10 bg-white/[0.035] text-[#9b8e97]") }>
                      <span className="block text-lg font-bold">{value}-max</span>
                      <span className="text-xs">Seats 1–{value}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b8e97]">Destination tables</div>
                    <div className="mt-1 text-sm text-[#f2ece6]">{playerCount} players → {requiredTableCount} tables required</div>
                  </div>
                  <div className={cn("font-mono text-sm", selectedIds.length === requiredTableCount ? "text-emerald-300" : "text-amber-300")}>{selectedIds.length}/{requiredTableCount}</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {selectable.map((item) => {
                    const selected = selectedIds.includes(item.gameTableId);
                    return (
                      <button key={item.gameTableId} disabled={busy || blocked || !!journal} type="button" data-ops-action="floor.redraw.select_table" onClick={() => toggleTable(item.gameTableId)} className={cn("min-h-14 rounded-2xl border px-3 py-2 text-left", selected ? "border-emerald-400/60 bg-emerald-400/12" : "border-white/10 bg-white/[0.035]") }>
                        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[#f2ece6]">Table {item.tableNumber}{selected && <Check className="h-4 w-4 text-emerald-300" />}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#9b8e97]">{item.availabilityStatus === "current_tournament" ? `In this tournament · ${item.maxSeats}-max` : "Available"}</span>
                      </button>
                    );
                  })}
                </div>
                {selectable.length < requiredTableCount && <p className="mt-2 text-xs text-rose-300">Not enough club tables are available. Tables assigned to another tournament, Cash, or VIP are hidden.</p>}
              </section>
            </div>
          ) : (
            <section className="space-y-3">
              <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/8 px-3 py-3 text-sm text-[#f2ece6]">
                {plan?.moves.length ?? 0} players · {plan?.targetTableCount ?? requiredTableCount} tables · {plan?.targetMaxSeats ?? capacity}-max
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                {(plan?.moves ?? []).map((move) => (
                  <div key={move.entryId} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/8 px-3 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-sm font-semibold text-[#f2ece6]">{move.playerName}</span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-[#9b8e97]">
                      T{move.fromTableNumber}·S{move.fromSeatNumber}<ArrowRight className="h-3.5 w-3.5 text-[#c9a86a]" /><b className="text-emerald-300">T{move.toTableNumber}·S{move.toSeatNumber}</b>
                    </span>
                  </div>
                ))}
              </div>
              {phase === "done" && <div className="flex items-center gap-2 rounded-2xl border border-[#c9a86a]/30 bg-[#c9a86a]/10 px-3 py-3 text-sm text-[#f2ece6]"><Tv2 className="h-5 w-5 text-[#c9a86a]" /> TV is showing this saved redraw. It will not generate or apply another draw.</div>}
            </section>
          )}
        </div>

        <footer className="border-t border-white/8 bg-[#0d0913]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 sm:pb-4">
          {phase === "setup" ? (
              <Button data-ops-action="floor.redraw.preview" className="min-h-12 w-full" disabled={busy || blocked || !!journal || selectedIds.length !== requiredTableCount || selectable.length < requiredTableCount} onClick={() => void preview()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />} Save preview
            </Button>
          ) : phase === "preview" ? (
            <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
              <Button variant="outline" className="min-h-12" disabled={busy || blocked || unresolved || !!journal?.applyIntent} onClick={() => void run(async () => { clear(); setPlan(null); setPhase("setup"); })}>Edit</Button>
              <Button data-ops-action="floor.redraw.apply" className="min-h-12 bg-rose-600 hover:bg-rose-500" disabled={busy || blocked || unresolved} onClick={() => void apply()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />} Confirm redraw
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_0.7fr]">
              <Button asChild variant="outline" className="min-h-12">
                <a data-ops-action="floor.redraw.open_tv" href={`/tv/${tournamentId}?scene=redraw`} target="_blank" rel="noreferrer">
                  <Tv2 className="mr-2 h-4 w-4" /> Open TV
                </a>
              </Button>
              <Button data-ops-action="floor.redraw.continue" className="min-h-12" disabled={busy || blocked || unresolved || continued} onClick={() => void continueRedraw()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {continued ? "Continued" : "Continue"}
              </Button>
              <Button variant="outline" className="min-h-12" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}


function redrawMessage(code: string): string {
  switch (code) {
    case "target_table_not_available": return "A destination table was just taken. Reload and try again.";
    case "target_table_count_mismatch": return "The selected table count no longer matches the required count.";
    case "insufficient_unlocked_capacity": return "There are not enough unlocked seats.";
    case "locked_seat_outside_capacity": return "Unlock seat 9 before switching this table to 8-max.";
    case "table_has_active_hand": return "A table still has an active hand. Finish it before redrawing.";
    case "STALE_REDRAW_PLAN": return "The tables, players, or seats changed after preview. Review a new plan.";
    case "no_active_players": return "There are no seated players to redraw.";
    case "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED": return "Tournament redraw is not enabled in this environment.";
    case "REDRAW_HOLD_NOT_ACTIVE": return "This redraw is no longer active. Reload the tournament view.";
    case "STALE_REDRAW_REVISION": return "The redraw changed. Reload before continuing.";
    case "redraw_table_hold_active": return "A redraw is still on hold. Continue it from the Floor screen first.";
    case "actor_not_allowed": return "Your account is not authorized to continue this tournament.";
    default: return `Redraw failed (${code}).`;
  }
}
