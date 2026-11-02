import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AwardInput = { position: string; ticketCount: string; cashVnd: string };
type Target = { id: string; name: string; start_time: string };
type Candidate = { playerId: string; displayName: string };
type IssuedTicket = { id: string; serial: number; code: string | null; position: number; winnerPlayerId: string; status: string };
type Issuance = { ok: true; issued: boolean; ticketTotal?: number; tickets?: IssuedTicket[]; results?: { position: number; playerId: string }[] };
type AwardPlan = {
  ok: true;
  locked: boolean;
  targetTournamentId?: string;
  targetEntryPriceVnd?: string;
  ticketTotal?: number;
  cashTotalVnd?: string;
  totalLiabilityVnd?: string;
  awardLines?: { position: number; ticketCount: number; cashVnd: string }[];
  lockedAt?: string;
};
type FundingPreview = {
  state: "READY" | "NOT_READY" | "OWNER_EXCEPTION_REQUIRED";
  sourcePoolVnd: string | null;
  feeVnd: string | null;
  targetEntryPriceVnd?: string;
  computedTicketCount?: number;
  cashRemainderVnd?: string;
  ticketShortfallVnd?: string;
  obligationShortfallVnd?: string;
  eligibleWinnerCount?: number;
  confirmedCount: number;
  unpaidCount: number;
  reversedCount: number;
  previewRevision: string;
  issues?: { registrationId: string; reason: string }[];
  awardPlan: AwardPlan;
};

const emptyRow = (): AwardInput => ({ position: "", ticketCount: "0", cashVnd: "0" });
const planRpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { message: string } | null }>;
const money = (value?: string) => value && /^\d{1,16}$/.test(value)
  ? `${Number(value).toLocaleString("en-US")} VND` : "—";

function parsePlan(raw: unknown): AwardPlan {
  if (!raw || typeof raw !== "object") throw new Error("Invalid award-plan response");
  const plan = raw as AwardPlan;
  if (plan.ok !== true || typeof plan.locked !== "boolean") throw new Error("Invalid award-plan response");
  if (plan.locked || plan.targetTournamentId) {
    if (!plan.targetTournamentId || !/^\d{1,16}$/.test(plan.targetEntryPriceVnd ?? "")
      || !/^\d{1,16}$/.test(plan.cashTotalVnd ?? "")
      || !/^\d{1,16}$/.test(plan.totalLiabilityVnd ?? "")
      || !Number.isInteger(plan.ticketTotal) || !Array.isArray(plan.awardLines)) {
      throw new Error("Incomplete award-plan response");
    }
    const lines = plan.awardLines;
    if (plan.ticketTotal! < 1 || lines.length < 1 || lines.length > 100
      || lines.some(line => !line || !Number.isInteger(line.position) || line.position < 1
        || !Number.isInteger(line.ticketCount) || line.ticketCount < 0 || line.ticketCount > 1
        || !/^\d{1,15}$/.test(line.cashVnd)
        || (line.ticketCount === 0 && /^0+$/.test(line.cashVnd)))
      || new Set(lines.map(line => line.position)).size !== lines.length
      || lines.reduce((sum, line) => sum + line.ticketCount, 0) !== plan.ticketTotal
      || lines.reduce((sum, line) => sum + BigInt(line.cashVnd), 0n) !== BigInt(plan.cashTotalVnd!)
      || BigInt(plan.ticketTotal!) * BigInt(plan.targetEntryPriceVnd!) + BigInt(plan.cashTotalVnd!)
        !== BigInt(plan.totalLiabilityVnd!)) {
      throw new Error("Invalid award-plan obligations");
    }
  }
  return plan;
}

function parseIssuance(raw: unknown): Issuance {
  if (!raw || typeof raw !== "object") throw new Error("Invalid ticket-ledger response");
  const value = raw as Issuance;
  if (value.ok !== true || typeof value.issued !== "boolean"
    || (value.issued && (!Array.isArray(value.tickets) || !Number.isInteger(value.ticketTotal)
      || value.tickets.length !== value.ticketTotal))) {
    throw new Error("Incomplete ticket-ledger response");
  }
  return value;
}

function parseFunding(raw: unknown): FundingPreview {
  if (!raw || typeof raw !== "object") throw new Error("Invalid funding-preview response");
  const value = raw as FundingPreview;
  if (!["READY", "NOT_READY", "OWNER_EXCEPTION_REQUIRED"].includes(value.state)
    || !/^v2:[0-9a-f]{32}$/.test(value.previewRevision ?? "")
    || !Number.isInteger(value.confirmedCount) || !Number.isInteger(value.unpaidCount)
    || !Number.isInteger(value.reversedCount)) throw new Error("Incomplete funding-preview response");
  value.awardPlan = parsePlan(value.awardPlan);
  if (value.state !== "NOT_READY" && (!/^\d{1,16}$/.test(value.sourcePoolVnd ?? "")
    || !/^\d{1,16}$/.test(value.feeVnd ?? "")
    || value.targetEntryPriceVnd !== value.awardPlan.targetEntryPriceVnd
    || !/^\d{1,16}$/.test(value.cashRemainderVnd ?? "")
    || !/^\d{1,16}$/.test(value.ticketShortfallVnd ?? "")
    || !/^\d{1,16}$/.test(value.obligationShortfallVnd ?? "")
    || !Number.isInteger(value.computedTicketCount) || value.computedTicketCount! < 0))
    throw new Error("Incomplete funding-preview totals");
  if (value.state === "NOT_READY" && (value.sourcePoolVnd !== null || value.feeVnd !== null))
    throw new Error("Inconsistent source cannot have a pool total");
  return value;
}

/** Satellite-only TD surface. Redemption is a separate Cashier server workflow. */
export function SatelliteAwardPlanPanel({ tournamentId, clubId }: { tournamentId: string; clubId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [locked, setLocked] = useState<AwardPlan | null>(null);
  const [targetId, setTargetId] = useState("");
  const [rows, setRows] = useState<AwardInput[]>([{ position: "1", ticketCount: "1", cashVnd: "0" }]);
  const [preview, setPreview] = useState<{ funding: FundingPreview; input: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [issuance, setIssuance] = useState<Issuance | null>(null);
  const [winners, setWinners] = useState<Record<number, string>>({});
  const [secretReason, setSecretReason] = useState("");
  const [ticketActionError, setTicketActionError] = useState<string | null>(null);
  const seq = useRef(0);
  const lockRequest = useRef<{ input: string; id: string } | null>(null);
  const issueRequest = useRef<{ input: string; id: string } | null>(null);
  const secretRequest = useRef<{ input: string; id: string } | null>(null);

  const load = useCallback(async () => {
    const request = ++seq.current;
    setLoading(true);
    setLoadError(null);
    setPreview(null);
    try {
      const [planResult, targetsResult, issuanceResult, candidatesResult] = await Promise.all([
        planRpc("satellite_get_award_plan_v1", { p_source_tournament_id: tournamentId }),
        supabase.from("tournaments")
          .select("id,name,start_time")
          .eq("club_id", clubId).eq("operations_mode", "standard")
          .in("status", ["scheduled", "live"])
          .is("registration_closed_at", null).neq("id", tournamentId)
          .order("start_time", { ascending: true }),
        planRpc("satellite_get_issuance_v1", { p_source_tournament_id: tournamentId }),
        planRpc("satellite_get_award_candidates_v1", { p_source_tournament_id: tournamentId }),
      ]);
      if (request !== seq.current) return;
      if (planResult.error || targetsResult.error || issuanceResult.error || candidatesResult.error) {
        throw new Error(planResult.error?.message || targetsResult.error?.message
          || issuanceResult.error?.message || candidatesResult.error?.message || "Could not load Satellite setup");
      }
      const plan = parsePlan(planResult.data);
      setLocked(plan.locked ? plan : null);
      setTargets((targetsResult.data ?? []) as Target[]);
      const currentIssuance = parseIssuance(issuanceResult.data);
      setIssuance(currentIssuance);
      const candidateData = candidatesResult.data as { ok?: boolean; players?: Candidate[] } | null;
      if (candidateData?.ok !== true || !Array.isArray(candidateData.players)) throw new Error("Incomplete winner list");
      setCandidates(candidateData.players);
    } catch (error) {
      if (request === seq.current) setLoadError(error instanceof Error ? error.message : "Could not load Satellite setup");
    } finally {
      if (request === seq.current) setLoading(false);
    }
  }, [clubId, tournamentId]);

  useEffect(() => {
    const sequence = seq;
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  const updateRow = (index: number, patch: Partial<AwardInput>) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setPreview(null);
    setPreviewError(null);
    lockRequest.current = null;
  };
  const input = JSON.stringify({ targetId, rows });
  const previewCurrent = preview?.input === input ? preview.funding : null;

  const submit = async () => {
    if (busy || !targetId) return;
    const awards = rows.map(row => ({
      position: Number(row.position), ticketCount: Number(row.ticketCount), cashVnd: row.cashVnd,
    }));
    if (rows.length < 1 || rows.length > 100 || awards.reduce((sum, row) => sum + row.ticketCount, 0) < 1 || awards.some((row) =>
      !Number.isInteger(row.position) || row.position < 1 || row.position > 99999
      || !Number.isInteger(row.ticketCount) || row.ticketCount < 0 || row.ticketCount > 1
      || !/^\d{1,15}$/.test(row.cashVnd)
      || (row.ticketCount === 0 && Number(row.cashVnd) === 0)
    ) || new Set(awards.map(row => row.position)).size !== awards.length) {
      toast.error("Use unique ranks, at most one ticket per rank, and a non-negative cash amount.");
      return;
    }
    setBusy(true);
    setPreviewError(null);
    try {
      const { data, error } = await planRpc("satellite_source_funding_preview_v2", {
        p_source_tournament_id: tournamentId,
        p_target_tournament_id: targetId,
        p_awards: awards,
      });
      if (error) throw error;
      const funding = parseFunding(data);
      if (funding.awardPlan.targetTournamentId !== targetId || funding.awardPlan.locked)
        throw new Error("Server preview did not match the requested target");
      setPreview({ funding, input });
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : "Could not load Satellite funding preview");
    } finally { setBusy(false); }
  };

  const lockPlan = async () => {
    if (busy || !previewCurrent || previewCurrent.state !== "READY" || !targetId) return;
    const currentInput = input;
    const request = lockRequest.current?.input === currentInput
      ? lockRequest.current.id : globalThis.crypto.randomUUID();
    lockRequest.current = { input: currentInput, id: request };
    setBusy(true);
    setPreviewError(null);
    try {
      const { data, error } = await planRpc("satellite_lock_award_plan_v1", {
        p_source_tournament_id: tournamentId,
        p_target_tournament_id: targetId,
        p_awards: rows.map(row => ({
          position: Number(row.position), ticketCount: Number(row.ticketCount), cashVnd: row.cashVnd,
        })),
        p_expected_preview_revision: previewCurrent.previewRevision,
        p_request_id: request,
      });
      if (error) throw error;
      const result = data as { ok?: boolean; locked?: boolean; error?: string } | null;
      if (result?.error === "stale_preview") {
        setPreview(null);
        lockRequest.current = null;
        throw new Error("Source funding changed. Refresh the preview before locking.");
      }
      if (result?.ok !== true || result.locked !== true) throw new Error("Lock was not confirmed by the server");
      await load();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not lock Satellite awards");
    } finally { setBusy(false); }
  };

  const issueTickets = async () => {
    if (busy || !locked || issuance?.issued) return;
    const ranks = locked.awardLines?.filter(line => line.ticketCount === 1) ?? [];
    if (ranks.length !== locked.ticketTotal || ranks.some(line => !winners[line.position])
      || new Set(ranks.map(line => winners[line.position])).size !== ranks.length) {
      setTicketActionError("Choose one distinct eligible winner for every ticket rank.");
      return;
    }
    const results = ranks.map(line => ({ position: line.position, playerId: winners[line.position] }));
    const fingerprint = JSON.stringify(results);
    const requestId = issueRequest.current?.input === fingerprint
      ? issueRequest.current.id : globalThis.crypto.randomUUID();
    issueRequest.current = { input: fingerprint, id: requestId };
    setBusy(true); setTicketActionError(null);
    try {
      const { error } = await planRpc("satellite_issue_tickets_v2", {
        p_source_tournament_id: tournamentId,
        p_results: results, p_request_id: requestId,
      });
      if (error) throw error;
      await load();
    } catch (error) {
      setTicketActionError(error instanceof Error ? error.message : "Ticket issuance failed");
    } finally { setBusy(false); }
  };

  const changeTicket = async (ticket: IssuedTicket, action: "rotate" | "void") => {
    if (busy || ticket.status !== "issued" || !ticket.code || secretReason.trim().length < 3) {
      setTicketActionError("Enter a reason of at least 3 characters."); return;
    }
    const fingerprint = JSON.stringify({ id: ticket.id, code: ticket.code, action, reason: secretReason.trim() });
    const requestId = secretRequest.current?.input === fingerprint
      ? secretRequest.current.id : globalThis.crypto.randomUUID();
    secretRequest.current = { input: fingerprint, id: requestId };
    setBusy(true); setTicketActionError(null);
    try {
      const { error } = await planRpc("satellite_change_ticket_secret_v1", {
        p_ticket_id: ticket.id, p_current_code: ticket.code, p_action: action,
        p_reason: secretReason.trim(), p_request_id: requestId,
      });
      if (error) throw error;
      setSecretReason("");
      await load();
    } catch (error) {
      setTicketActionError(error instanceof Error ? error.message : "Ticket change failed");
    } finally { setBusy(false); }
  };

  if (loading) return <Card className="p-4" role="status">Loading Satellite awards…</Card>;
  if (loadError) return <Card className="space-y-3 p-4"><p role="alert" className="text-destructive">{loadError}</p><Button variant="outline" onClick={() => void load()}>Retry</Button></Card>;

  return <Card className="space-y-4 p-4 border-amber-500/30">
    <div className="flex items-start gap-2"><Ticket className="mt-0.5 h-5 w-5 text-amber-400" /><div><h2 className="font-semibold">Satellite award plan</h2><p className="text-xs text-muted-foreground">TD locks ticket ranks and cash prizes before results close. This does not issue or redeem tickets.</p></div></div>
    {locked ? <div className="space-y-3" role="status">
      <p className="text-sm text-primary">Locked{locked.lockedAt ? ` · ${new Date(locked.lockedAt).toLocaleString()}` : ""}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Exact target</dt><dd>{targets.find(t => t.id === locked.targetTournamentId)?.name ?? locked.targetTournamentId}</dd></div><div><dt className="text-muted-foreground">Ticket value · buy-in + fees</dt><dd>{money(locked.targetEntryPriceVnd)}</dd></div><div><dt className="text-muted-foreground">Tickets to issue</dt><dd>{locked.ticketTotal}</dd></div><div><dt className="text-muted-foreground">Cash owed</dt><dd>{money(locked.cashTotalVnd)}</dd></div></dl>
      <p className="text-xs text-muted-foreground">Total ticket + cash obligation: {money(locked.totalLiabilityVnd)}. Issuance, redemption, and pool reconciliation are separate server steps.</p>
      <div className="space-y-3 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Ticket issuance</h3>
        {issuance?.issued ? <div role="status" className="space-y-2"><p className="text-sm text-emerald-400">Issued {issuance.ticketTotal} / {locked.ticketTotal} tickets</p>
          <p className="text-xs text-muted-foreground">Serials are for reconciliation; redemption codes are private. Never display this list on the tournament TV.</p>
          <div className="space-y-2"><Label htmlFor="sat-secret-reason">Reason for rotate or void</Label><Input id="sat-secret-reason" value={secretReason} onChange={e => setSecretReason(e.target.value)} /></div>
          <div className="max-h-64 space-y-2 overflow-auto">{issuance.tickets?.map(ticket => <div key={ticket.serial} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-border p-2 text-xs"><strong>#{ticket.serial}</strong><span>Rank {ticket.position}</span><span>{candidates.find(c => c.playerId === ticket.winnerPlayerId)?.displayName ?? ticket.winnerPlayerId}</span><span>{ticket.status}</span>{ticket.status === "issued" && ticket.code && <><code className="break-all select-all" aria-label={`Private code for ticket ${ticket.serial}`}>{ticket.code}</code><Button size="sm" variant="outline" disabled={busy} onClick={() => void changeTicket(ticket,"rotate")}>Rotate</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => void changeTicket(ticket,"void")}>Void</Button></>}</div>)}</div>
        </div> : <>
          <p className="text-xs text-muted-foreground">Choose a verified winner for each locked ticket rank. The server checks results and funding again at Issue.</p>
          {locked.awardLines?.filter(line => line.ticketCount === 1).map(line => <div key={line.position} className="space-y-1"><Label>Rank {line.position} winner</Label><Select value={winners[line.position] ?? ""} onValueChange={value => setWinners(current => ({ ...current, [line.position]: value }))}><SelectTrigger aria-label={`Rank ${line.position} winner`}><SelectValue placeholder="Select eligible winner" /></SelectTrigger><SelectContent>{candidates.map(candidate => <SelectItem key={candidate.playerId} value={candidate.playerId}>{candidate.displayName}</SelectItem>)}</SelectContent></Select></div>)}
          <Button disabled={busy} onClick={() => void issueTickets()}>{busy ? "Issuing…" : "Issue tickets"}</Button>
        </>}
        {ticketActionError && <p role="alert" className="text-sm text-destructive">{ticketActionError}</p>}
      </div>
    </div> : <>
      <div className="space-y-1"><Label htmlFor="satellite-target">Target tournament</Label><Select value={targetId} onValueChange={value => { setTargetId(value); setPreview(null); setPreviewError(null); lockRequest.current = null; }}><SelectTrigger id="satellite-target"><SelectValue placeholder="Select the exact tournament" /></SelectTrigger><SelectContent>{targets.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>{targets.length === 0 && <p className="text-xs text-amber-400">No open target tournament in this club.</p>}</div>
      <div className="space-y-2"><p className="text-sm font-medium">Awards by finishing place</p>{rows.map((row, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:border-0 sm:p-0"><div><Label htmlFor={`sat-rank-${index}`} className="text-xs">Rank</Label><Input id={`sat-rank-${index}`} inputMode="numeric" value={row.position} onChange={e => updateRow(index, { position: e.target.value })} /></div><div><Label htmlFor={`sat-ticket-${index}`} className="text-xs">Tickets</Label><Input id={`sat-ticket-${index}`} inputMode="numeric" value={row.ticketCount} onChange={e => updateRow(index, { ticketCount: e.target.value })} /></div><div><Label htmlFor={`sat-cash-${index}`} className="text-xs">Cash · VND</Label><Input id={`sat-cash-${index}`} inputMode="numeric" value={row.cashVnd} onChange={e => updateRow(index, { cashVnd: e.target.value })} /></div><Button type="button" size="icon" variant="ghost" className="self-end justify-self-end" aria-label={`Remove rank ${index + 1}`} onClick={() => { setRows(current => current.filter((_, i) => i !== index)); setPreview(null); }}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
      <Button type="button" variant="outline" onClick={() => { setRows(current => [...current, emptyRow()]); setPreview(null); }} disabled={rows.length >= 100}><Plus className="mr-1 h-4 w-4" />Add rank</Button>
      <div className="border-t border-border pt-3 space-y-3"><Button type="button" variant="outline" disabled={busy || !targetId} onClick={() => void submit()}>{busy ? "Working…" : "Preview funding"}</Button>{previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}{previewCurrent && <div role="status" className="rounded bg-muted/40 p-3 text-sm"><p>Source status: {previewCurrent.state === "NOT_READY" ? "Inconsistent — review registrations" : previewCurrent.state === "OWNER_EXCEPTION_REQUIRED" ? "Owner exception required — too few eligible winners" : "Source ledger reconciled"}</p><p>Confirmed: {previewCurrent.confirmedCount} · Unpaid: {previewCurrent.unpaidCount} · Reversed: {previewCurrent.reversedCount}</p>{previewCurrent.state === "NOT_READY" ? <p className="text-destructive">Pool and fees are unavailable. {previewCurrent.issues?.length ?? 0} inconsistent registration(s).</p> : <><p>Source pool: {money(previewCurrent.sourcePoolVnd ?? undefined)} · Fees: {money(previewCurrent.feeVnd ?? undefined)}</p><p>Target entry: {money(previewCurrent.targetEntryPriceVnd)}</p><p>Computed capacity: {previewCurrent.computedTicketCount} tickets · Remainder: {money(previewCurrent.cashRemainderVnd)}</p><p>TD awards: {previewCurrent.awardPlan.ticketTotal} tickets · Cash: {money(previewCurrent.awardPlan.cashTotalVnd)}</p><p className="font-semibold">TD obligation: {money(previewCurrent.awardPlan.totalLiabilityVnd)} · Unfunded: {money(previewCurrent.obligationShortfallVnd)}</p><p>TD versus computed: {previewCurrent.awardPlan.ticketTotal === previewCurrent.computedTicketCount && previewCurrent.awardPlan.cashTotalVnd === previewCurrent.cashRemainderVnd ? "matches capacity and remainder" : "differs in ticket count or cash remainder — review the rank choices"}. This comparison does not approve awards.</p><p>Ticket guarantee shortfall: {money(previewCurrent.ticketShortfallVnd)} — not funded by an overlay.</p></>}<p className="mt-1 text-xs text-muted-foreground">Evidence revision: {previewCurrent.previewRevision}. The server will recheck this at Lock.</p></div>}{previewCurrent?.state === "READY" && <Button type="button" disabled={busy} onClick={() => void lockPlan()}>{busy ? "Locking…" : "Lock award plan"}</Button>}<p className="text-xs text-amber-400">Registration must be closed before Lock. Issue remains paused; any unfunded shortfall is not a paid overlay.</p></div>
    </>}
  </Card>;
}
