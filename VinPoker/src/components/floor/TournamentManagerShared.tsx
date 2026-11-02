import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Save, ListOrdered, Play, History, Award, Dices, Loader2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { FomoPrice } from "@/components/FomoPrice";
import { LiveStateEditor } from "@/components/LiveStateEditor";
import { BlindEditorPanel } from "@/components/cashier/tournament-live/BlindEditorPanel";
import { BlindDraftBuilder } from "@/components/cashier/tournament-live/BlindDraftBuilder";
import { formatDateTime, formatVND } from "@/lib/format";
import { BLIND_PRESETS, type BlindLevel, type BlindTemplate } from "@/lib/blindPresets";
import { isValidBlindDraft } from "@/lib/blindDraftSuggest";
import { createTournament, recoverTournamentCreate, readTournamentCreateJournal, tournamentCreateJournalKey, TournamentCreateError, type TournamentCreateRequest } from "@/lib/tournamentCreate";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import {loadTournamentEditContext,parseTournamentEditRequest,readTournamentEditJournal,tournamentEditJournalKey,
 retainTournamentEdit,verifyRetainedTournamentEdit,clearTournamentEdit,submitTournamentEdit,recoverTournamentEdit,TournamentEditError,
 type TournamentEditConfig,type TournamentEditContext,type TournamentEditRequest,type TournamentEditRpc} from '@/lib/tournamentEdit';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {TournamentLifecycleControls} from './TournamentLifecycleControls';

// Shared building blocks for the Floor tournament boards (Daily + Multi-day) and the
// legacy TournamentManagerPanel. Extracted verbatim so both surfaces reuse one source
// (no JSX/logic duplication). Dialogs + helpers + the per-tournament card live here.

export const GAME_TYPES = [
  { v: "nlh", l: "No Limit Hold'em" },
  { v: "plo", l: "Pot Limit Omaha" },
  { v: "mixed", l: "Mixed Games" },
];

export type ClubRow = { id: string; name: string };
export type FlightMeta = { entrants: number; survivors: number; itm: number; target: number; ready: boolean };
export type FinalMeta = { qualifiers: number; seated: number; pending: number };
type QualifierPlayer = { player_id: string; player_name: string; chip_count: number };

// Field size for ITM — registrations can undercount walk-ins, so never below seated/remaining.
export const flightEntrants = (regCount: number, survivors: number, playersRemaining: number | null | undefined): number =>
  Math.max(regCount || 0, survivors || 0, Number(playersRemaining) || 0);
export const qualifierTarget = (entrants: number, itmPercent: number): number =>
  Math.ceil((entrants * (Number(itmPercent) || 0)) / 100);

// GTD committed guarantee: empty -> null ("thiếu GTD", never faked from prize pool).
const parseGtd = (v: string): number | null => {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ── MD-2: FlightQualifiersDialog (🏅) ───────────────────────────────────────────────
export const FlightQualifiersDialog = ({ flight, meta, onDone }: { flight: any; meta?: FlightMeta; onDone: () => void }) => {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<QualifierPlayer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [advanced, setAdvanced] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const itm = meta?.itm ?? 0;
  const entrants = meta?.entrants ?? 0;
  const target = meta?.target ?? 0;
  const ready = meta?.ready ?? false;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: seats } = await (supabase as any)
        .from("tournament_seats")
        .select("player_id, player_name, chip_count, entry_number")
        .eq("tournament_id", flight.id)
        .eq("is_active", true)
        .order("chip_count", { ascending: false });
      const { data: q } = await (supabase as any)
        .from("tournament_event_qualifiers")
        .select("player_id")
        .eq("flight_tournament_id", flight.id);
      if (cancelled) return;
      const seen = new Set<string>();
      const uniq: QualifierPlayer[] = [];
      for (const s of ((seats ?? []) as any[])) {
        if (seen.has(s.player_id)) continue;
        seen.add(s.player_id);
        uniq.push({ player_id: s.player_id, player_name: s.player_name || "?", chip_count: s.chip_count || 0 });
      }
      const adv = new Set<string>(((q ?? []) as any[]).map((r) => r.player_id));
      setPlayers(uniq);
      setAdvanced(adv);
      setSelected(ready ? new Set([...adv, ...uniq.map((p) => p.player_id)]) : new Set(adv));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, flight.id, ready]);

  const toggle = (pid: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });
  const selectAll = () => setSelected(new Set(players.map((p) => p.player_id)));

  const confirm = async () => {
    if (busy) return;
    const ids = [...selected];
    if (!ids.length) return toast.error("Chọn ít nhất 1 người");
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("advance_flight_qualifiers", { p_flight_id: flight.id, p_player_ids: ids });
      const res = (data ?? null) as { ok?: boolean; advanced?: number; error?: string } | null;
      if (error || !res?.ok) { toast.error(res?.error || error?.message || "Chuyển qualified lỗi"); return; }
      toast.success(`Đã chuyển ${res.advanced} người vào Final Day (mang theo stack)`);
      setOpen(false);
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={ready ? "Đủ ITM — chốt qualified vào Final Day" : "Chọn qualified vào Final Day"} className={ready ? "ring-2 ring-amber-400 animate-pulse" : ""}>
          <Award className={`w-4 h-4 ${ready ? "text-amber-500" : "text-muted-foreground"}`} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="truncate">Qualified — {flight.name}</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {entrants} người vào giải · ITM {itm}% → <span className="text-primary font-semibold">cần {target} qualified</span> (làm tròn lên) · còn lại {players.length}.
            </p>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Stack mang sang Final Day lấy theo <span className="text-foreground font-medium">túi Bag &amp; Tag đã niêm phong</span> (chip master); chưa bag thì lấy stack hiện tại.
            </p>
            {ready && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                ✓ Đã về đúng số ITM — tất cả {players.length} người còn lại là qualified, đã tích sẵn. Bấm xác nhận để đưa vào Final Day.
              </div>
            )}
            {players.length === 0 ? (
              <p className="text-sm text-muted-foreground">Flight chưa có người chơi (active seat).</p>
            ) : (
              <>
                <div className="flex justify-end">
                  <button type="button" onClick={selectAll} className="text-[11px] text-primary hover:underline">Chọn tất cả người còn lại</button>
                </div>
                <div className="space-y-1">
                  {players.map((p) => {
                    const isSel = selected.has(p.player_id);
                    const wasAdv = advanced.has(p.player_id);
                    return (
                      <button key={p.player_id} type="button" onClick={() => toggle(p.player_id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${isSel ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"}`}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>{isSel ? "✓" : ""}</span>
                          <span className="truncate">{p.player_name}</span>
                          {wasAdv && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">đã qualified</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{p.chip_count.toLocaleString("vi-VN")}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="pt-1 text-xs text-muted-foreground">Đã chọn: <span className="text-primary font-semibold">{selected.size}</span> / cần {target}</div>
            <Button onClick={confirm} disabled={busy || selected.size === 0} className="w-full gradient-neon text-primary-foreground border-0">{busy ? "Đang chuyển…" : "Xác nhận qualified → Final Day"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── MD-3: Day2DrawDialog ("Bốc thăm Day 2") ─────────────────────────────────────────
export const Day2DrawDialog = ({ final, meta, onDone }: { final: any; meta?: FinalMeta; onDone: () => void }) => {
  const [open, setOpen] = useState(false);
  const [drawMode, setDrawMode] = useState("random_balanced");
  const [busy, setBusy] = useState(false);
  const qualifiers = meta?.qualifiers ?? 0;
  const seated = meta?.seated ?? 0;
  const pending = meta?.pending ?? 0;

  const draw = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("seat_day2_qualifiers", { p_final_id: final.id, p_draw_mode: drawMode });
      const res = (data ?? null) as { ok?: boolean; seated?: number; skipped_existing?: number; no_seat?: number; error?: string } | null;
      if (error || !res?.ok) { toast.error(res?.error || error?.message || "Bốc thăm Day 2 lỗi"); return; }
      if ((res.no_seat ?? 0) > 0) {
        toast.warning(`Đã xếp ${res.seated} người. Còn ${res.no_seat} chưa có ghế — mở thêm bàn rồi bốc lại.`);
      } else {
        toast.success(`Đã xếp ${res.seated} người vào Final Day${(res.skipped_existing ?? 0) > 0 ? ` (${res.skipped_existing} đã có ghế)` : ""}.`);
      }
      setOpen(false);
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={qualifiers === 0} className="w-full h-9 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10">
          <Dices className="w-3.5 h-3.5 mr-1" /> Bốc thăm Day 2 {pending > 0 ? `(${pending} chờ)` : qualifiers > 0 ? "(đã xếp đủ)" : "(chưa có qualified)"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="truncate">Bốc thăm Day 2 — {final.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {qualifiers} người qualified · đã xếp {seated} · <span className="text-amber-600 font-semibold">còn {pending} chờ ghế</span>. Bốc thăm sẽ xếp họ vào các bàn đang mở của Final Day, <span className="text-foreground font-medium">giữ nguyên stack</span> mang sang từ flight (không tính buy-in lại). Mở bàn trước khi bốc.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Chế độ xếp chỗ</Label>
            <Select value={drawMode} onValueChange={setDrawMode}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="random_balanced">Bốc thăm cân bàn (mặc định)</SelectItem>
                <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={draw} disabled={busy || pending === 0} className="w-full gradient-neon text-primary-foreground border-0">
            {busy ? "Đang bốc…" : `Bốc thăm ${pending} người → Final Day`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── GTD economic audit viewer (owner/super-admin only) ──────────────────────────────
type AuditLogRow = {
  id: string; changed_at: string; changed_by: string | null;
  changed_fields: string[]; old_values: Record<string, number | null>; new_values: Record<string, number | null>;
};
const AUDIT_FIELD_LABELS: Record<string, string> = {
  guarantee_amount: "GTD cam kết", buy_in: "Buy-in", rake_amount: "Rake / phí",
  service_fee_amount: "Phí dịch vụ", prize_pool: "Prize pool", starting_stack: "Starting stack", minutes_per_level: "Phút / level",
};
const AUDIT_MONEY_FIELDS = new Set(["guarantee_amount", "buy_in", "rake_amount", "service_fee_amount", "prize_pool"]);
const fmtAuditVal = (field: string, v: number | null): string => {
  if (v === null || v === undefined) return "—";
  return AUDIT_MONEY_FIELDS.has(field) ? formatVND(v) : Number(v).toLocaleString("vi-VN");
};

export const AuditHistoryDialog = ({ tournament }: { tournament: any }) => {
  const { isClubOwner, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("tournament_economic_audit_log")
        .select("id, changed_at, changed_by, changed_fields, old_values, new_values")
        .eq("tournament_id", tournament.id)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) toast.error(error.message);
      setRows(((data ?? []) as unknown) as AuditLogRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tournament.id]);

  if (!(isClubOwner || isAdmin)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Lịch sử kinh tế"><History className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lịch sử sửa kinh tế</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{tournament.name} · chỉ chủ CLB / super admin xem.</p>
        {loading && <p className="text-xs text-muted-foreground">Đang tải…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Chưa ghi nhận thay đổi kinh tế nào (chỉ ghi khi SỬA giải, không tính lúc tạo).</p>
        )}
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-2.5 space-y-1 border-primary/30">
              <div className="text-[11px] text-muted-foreground">
                {formatDateTime(r.changed_at)}{r.changed_by ? ` · ${r.changed_by.slice(0, 8)}` : ""}
              </div>
              <ul className="space-y-0.5 text-xs">
                {(r.changed_fields ?? []).map((field) => (
                  <li key={field} className="tabular-nums">
                    <span className="text-muted-foreground">{AUDIT_FIELD_LABELS[field] ?? field}:</span>{" "}
                    {fmtAuditVal(field, r.old_values?.[field] ?? null)}{" "}
                    <span className="text-muted-foreground">→</span>{" "}
                    <span className="text-primary">{fmtAuditVal(field, r.new_values?.[field] ?? null)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Create dialog. `lockMode` keeps each mode in its own Floor entry point. ──
export const NewTournamentDialog = ({
  clubs, defaultClubId, multiClub, onCreated, lockMode,
}: {
  clubs: ClubRow[]; defaultClubId: string; multiClub: boolean; onCreated: () => void;
  lockMode?: "single" | "multi" | "satellite";
}) => {
  const { user, session } = useAuth();
  const actorId = user?.id;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState(defaultClubId);
  const [f, setF] = useState({ name: "", start_time: "", buy_in: 1000000, rake_amount: 0, service_fee_amount: 0, guarantee_amount: "", starting_stack: 20000, location: "", description: "", game_type: "nlh", minutes_per_level: 20, late_reg_close_level: 6 });
  const invalidCreateMoney = (FEATURES.tournamentServiceFee && (!Number.isSafeInteger(Number(f.service_fee_amount)) || Number(f.service_fee_amount) < 0))
    || (f.guarantee_amount.trim() !== "" && (!Number.isSafeInteger(Number(f.guarantee_amount)) || Number(f.guarantee_amount) < 0));
  const [blindChoice, setBlindChoice] = useState("none");
  const [draftLevels, setDraftLevels] = useState<BlindLevel[]>([]);
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"single" | "multi" | "satellite">(lockMode ?? "single");
  const createKind = mode === "multi" ? "multi" : "single";
  const createBusyRef = useRef(false);
  const mounted = useRef(true);
  const createScope = useRef("");
  createScope.current = `${user?.id ?? ""}:${clubId}:${createKind}:${sessionReadEpoch(session)}`;
  const [pendingCreate, setPendingCreate] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try { setPendingCreate(!!actorId && localStorage.getItem(tournamentCreateJournalKey(actorId, clubId, createKind)) !== null); }
    catch { setPendingCreate(true); }
  }, [open, actorId, clubId, createKind]);
  const [itmPercent, setItmPercent] = useState("");
  const [flightCount, setFlightCount] = useState(3);
  const [finalStart, setFinalStart] = useState("");
  const flightLabels = Array.from({ length: Math.min(11, Math.max(1, flightCount)) }, (_, i) => String.fromCharCode(65 + i)).join(", ");
  const showToggle = FEATURES.multiDayTournaments && !lockMode;
  useEffect(() => { setClubId(defaultClubId); }, [defaultClubId]);
  useEffect(() => { if (lockMode) setMode(lockMode); }, [lockMode]);
  useEffect(() => {
    if (!FEATURES.blindTemplates || !open || !clubId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("blind_structure_templates")
        .select("id, club_id, name, levels")
        .eq("club_id", clubId)
        .order("name");
      if (!cancelled) setClubTemplates((data ?? []) as BlindTemplate[]);
    })();
    return () => { cancelled = true; };
  }, [open, clubId]);

  const resolveLevels = (choice: string): BlindLevel[] => {
    if (choice === "draft") return draftLevels;
    if (choice.startsWith("preset:")) return BLIND_PRESETS.find((p) => p.key === choice.slice(7))?.levels ?? [];
    if (choice.startsWith("tpl:")) return (clubTemplates.find((t) => t.id === choice.slice(4))?.levels ?? []) as BlindLevel[];
    return [];
  };

  const submit = async (retryOriginal = false) => {
    if (busy || createBusyRef.current) return;
    if (!user) return toast.error(t("createAtomic.signin"));
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    const scope = createScope.current;
    const key = tournamentCreateJournalKey(user.id, clubId, createKind);
    let request: TournamentCreateRequest;
    let recovering = false;
    try {
      const raw = localStorage.getItem(key);
      recovering = raw !== null;
      if (raw !== null) request = readTournamentCreateJournal(raw, user.id, clubId, createKind);
      else {
        if (!f.name || (createKind === "multi" ? !finalStart : !f.start_time)) return toast.error("Please fill all required fields");
        if (blindChoice === "draft" && !isValidBlindDraft(draftLevels)) return toast.error("Review the blind draft before creating this tournament.");
        if (invalidCreateMoney) return toast.error(t("mainEventCreate.invalidMoney"));
        request = { p_club_id: clubId, p_expected_actor_id: user.id, p_request_id: crypto.randomUUID(),
          p_levels: FEATURES.blindTemplates ? resolveLevels(blindChoice) : [], p_config: createKind === "multi" ? {
            name: f.name, itm_percent: Number(itmPercent) || 0, buy_in: Number(f.buy_in),
            rake_amount: Number(f.rake_amount) || 0, starting_stack: Number(f.starting_stack),
            ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) } : {}),
            guarantee_amount: parseGtd(f.guarantee_amount), location: f.location, description: f.description,
            game_type: f.game_type, minutes_per_level: Number(f.minutes_per_level),
            late_reg_close_level: Number(f.late_reg_close_level), flight_count: Number(flightCount),
            final_start_time: new Date(finalStart).toISOString(),
            flight_start_times: f.start_time ? Array.from({ length: Number(flightCount) }, () => new Date(f.start_time).toISOString()) : null,
          } : {
            name: f.name, start_time: new Date(f.start_time).toISOString(),
            ...(FEATURES.satelliteAwardsV1 ? { operations_mode: mode === "satellite" ? "satellite" : "standard" } : {}),
            buy_in: Number(f.buy_in), rake_amount: Number(f.rake_amount) || 0,
            ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
            guarantee_amount: parseGtd(f.guarantee_amount), starting_stack: Number(f.starting_stack),
            location: f.location, description: f.description, game_type: f.game_type,
            minutes_per_level: Number(f.minutes_per_level), late_reg_close_level: Number(f.late_reg_close_level),
          } };
        localStorage.setItem(key, JSON.stringify(request));
        if (localStorage.getItem(key) !== JSON.stringify(request)) throw new Error("Pending request could not be saved");
      }
    } catch { toast.error(t("createAtomic.storageError")); return; }
    createBusyRef.current = true;
    setBusy(true);
    const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never);
    try {
      if (recovering) {
        try { await recoverTournamentCreate(rpc, request, createKind); }
        catch (error) {
          if (!retryOriginal) throw error;
          // Explicit user retry only, after checking the original receipt.
          // Reuse the persisted payload and key, even if form fields changed.
          await createTournament(rpc, request, createKind);
        }
      } else await createTournament(rpc, request, createKind);
      // Journal cleanup cannot turn an authoritative commit into a failed create.
      let stillPending = true;
      try {
        if (localStorage.getItem(key) === JSON.stringify(request)) localStorage.removeItem(key);
        stillPending = localStorage.getItem(key) !== null;
      } catch { /* Keep the original identity available for later receipt recovery. */ }
      if (!mounted.current || createScope.current !== scope) return;
      setPendingCreate(stillPending);
      toast.success("Tournament created");
      setOpen(false);
      onCreated();
    } catch (error) {
      let stillPending = true;
      try {
        if (!recovering && error instanceof TournamentCreateError && !error.unknownOutcome
          && localStorage.getItem(key) === JSON.stringify(request)) localStorage.removeItem(key);
        stillPending = localStorage.getItem(key) !== null;
      } catch { /* Storage failure is not permission to create a fresh request. */ }
      if (!mounted.current || createScope.current !== scope) return;
      setPendingCreate(stillPending);
      toast.error(error instanceof TournamentCreateError && !error.unknownOutcome ? error.message : t("createAtomic.unknown"));
    } finally { createBusyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const triggerLabel = lockMode === "satellite" ? "Create Satellite" : lockMode === "multi" ? "Create Multi-day" : lockMode === "single" ? "Tạo giải thường" : "Tạo giải";
  const titleLabel = lockMode === "satellite" ? "Create Satellite tournament" : lockMode === "multi" ? "Create Multi-day Event" : lockMode === "single" ? "Tạo giải thường" : "Tạo giải đấu";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-primary/50 text-primary"><Plus className="w-4 h-4 mr-1" />{triggerLabel}</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{titleLabel}</DialogTitle><DialogDescription>Configure this tournament before creating it. Blind suggestions remain editable drafts until saved.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {multiClub && (
            <>
              <Label>Câu lạc bộ</Label>
              <Select value={clubId} onValueChange={setClubId}>
                <SelectTrigger><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
                <SelectContent>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          {showToggle && (
            <div className="flex gap-1 rounded-lg bg-muted/40 p-1">
              <button type="button" onClick={() => setMode("single")} className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${mode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Giải thường</button>
              <button type="button" onClick={() => setMode("multi")} className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${mode === "multi" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Multi-day (nhiều flight)</button>
            </div>
          )}
          {mode === "satellite" && <p className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">Satellite mode: create the event here, then lock ticket and cash awards in Payout before results are closed. A ticket covers the exact target buy-in and fees. No in-app transfer or deal tools.</p>}
          <Label>{mode === "multi" ? "Main Event name" : "Name"}</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={mode === "multi" ? "Main Event" : ""} />
          <Label>{mode === "multi" ? "Flight start time (default; edit each flight later)" : "Start time"}</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          {mode === "multi" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>ITM % per flight</Label><Input type="number" step="0.1" min={0} value={itmPercent} onChange={e => setItmPercent(e.target.value)} placeholder="12.5" /></div>
                <div><Label>Flight count (A–K)</Label><Input type="number" min={1} max={11} value={flightCount} onChange={e => setFlightCount(Math.min(11, Math.max(1, Math.floor(+e.target.value) || 1)))} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">Create {flightCount} flights ({flightLabels}) and one Final Day. ITM% is set here; set a separate Day2% with bag policy and minimum cash in Floor tournament design before the first entry. Each flight rounds both targets up from valid entries.</p>
              <Label>Final Day start time</Label><Input type="datetime-local" value={finalStart} onChange={e => setFinalStart(e.target.value)} />
            </>
          )}
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: +e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: +e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Người chơi trả: <span className="text-primary font-medium">{formatVND((Number(f.buy_in) || 0) + (Number(f.rake_amount) || 0) + (FEATURES.tournamentServiceFee ? (Number(f.service_fee_amount) || 0) : 0))}</span> <span className="opacity-70">(buy-in + rake{FEATURES.tournamentServiceFee ? " + phí dịch vụ" : ""})</span></p>
          <div><Label>{createKind === "multi" ? t("mainEventCreate.guaranteeLabel") : "GTD cam kết (VND)"}</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          {invalidCreateMoney && <p role="alert" className="text-sm text-destructive">{t("mainEventCreate.invalidMoney")}</p>}
          <p className="text-[11px] text-muted-foreground -mt-1">{createKind === "multi" ? t("mainEventCreate.guaranteeNote") : "Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool."}</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="tour-starting-stack">Starting stack</Label><Input id="tour-starting-stack" type="number" value={f.starting_stack} onChange={e => { setF({ ...f, starting_stack: +e.target.value }); setDraftLevels([]); if (blindChoice === "draft") setBlindChoice("none"); }} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => { setF({ ...f, minutes_per_level: +e.target.value }); setDraftLevels([]); if (blindChoice === "draft") setBlindChoice("none"); }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          {FEATURES.blindTemplates && (
            <>
              <Label>Cấu trúc blind</Label>
              <Select value={blindChoice} onValueChange={setBlindChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Để trống (đặt sau ở tab Blind)</SelectItem>
                  {FEATURES.blindDraftSuggest && draftLevels.length > 0 && <SelectItem value="draft">Reviewed draft ({draftLevels.length} levels)</SelectItem>}
                  {clubTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Mẫu CLB</SelectLabel>
                      {clubTemplates.map((t) => <SelectItem key={t.id} value={`tpl:${t.id}`}>{t.name}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Mẫu chuẩn</SelectLabel>
                    {BLIND_PRESETS.map((p) => <SelectItem key={p.key} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground -mt-1">Chọn cấu trúc có sẵn để giải chạy được ngay (đồng hồ/tracker đọc theo cấu trúc này).</p>
              {FEATURES.blindDraftSuggest && <BlindDraftBuilder key={`${f.starting_stack}:${f.minutes_per_level}`}
                startingStack={Number(f.starting_stack)} levelMinutes={Number(f.minutes_per_level)} disabled={busy}
                onUse={levels => { setDraftLevels(levels); setBlindChoice("draft"); }}
              />}
            </>
          )}
          <Button onClick={() => void submit()} disabled={busy} className="w-full gradient-neon text-primary-foreground border-0">{busy ? "Đang tạo…" : pendingCreate ? t("createAtomic.check") : "Create"}</Button>
          {pendingCreate && <>
            <p role="status" className="text-xs text-muted-foreground">{t("createAtomic.pending")}</p>
            <Button variant="outline" onClick={() => void submit(true)} disabled={busy} className="w-full">{t("createAtomic.retry")}</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Blind structure editor dialog ───────────────────────────────────────────────────
export const BlindStructureDialog = ({ tournament }: { tournament: any }) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Sửa cấu trúc blind"><ListOrdered className="w-4 h-4 text-primary" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Cấu trúc blind — {tournament.name}</DialogTitle></DialogHeader>
        <BlindEditorPanel tournamentId={tournament.id} tournamentStatus={tournament.status} />
      </DialogContent>
    </Dialog>
  );
};

// ── Edit dialog ─────────────────────────────────────────────────────────────────────
export const EditTournamentDialog = (props: { tournament: any; onSaved: () => void }) => {
  const {user,session,loading}=useAuth();
  return <ScopedEditTournamentDialog key={JSON.stringify([user?.id,sessionReadEpoch(session),loading,props.tournament.club_id,props.tournament.id])} {...props}/>;
};
const ScopedEditTournamentDialog = ({ tournament, onSaved }: { tournament: any; onSaved: () => void }) => {
  const {user,loading:authLoading}=useAuth();
  const writing=useRef(false),alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [open, setOpen] = useState(false);
  const toForm = (config:TournamentEditConfig) => {
    const iso=config.start_time;
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return {name:config.name,game_type:config.game_type,start_time:new Date(d.getTime() - off * 60000).toISOString().slice(0,16),
      buy_in:String(config.buy_in),rake_amount:String(config.rake_amount),service_fee_amount:String(config.service_fee_amount),
      guarantee_amount:config.guarantee_amount===null?'':String(config.guarantee_amount),starting_stack:String(config.starting_stack),
      minutes_per_level:String(config.minutes_per_level),late_reg_close_level:String(config.late_reg_close_level),
      location:config.location??'',description:config.description??''};
  };
  const [f, setF] = useState({
    name:'',start_time:'',buy_in:'',rake_amount:'',service_fee_amount:'',guarantee_amount:'',starting_stack:'',
    location:'',description:'',game_type:'',minutes_per_level:'',late_reg_close_level:'',
  });
  const [saving, setSaving] = useState(false);
  const [context,setContext]=useState<TournamentEditContext|null>(null);
  const [contextLoading,setContextLoading]=useState(false);
  const [contextError,setContextError]=useState<string|null>(null);
  const [storageError,setStorageError]=useState<string|null>(null);
  const [pending,setPending]=useState<TournamentEditRequest|null>(null);
  const [revision,setRevision]=useState(0);
  const [blindChoice, setBlindChoice] = useState("none");
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const [templateError,setTemplateError]=useState(false);
  const canPickBlinds = FEATURES.blindTemplates && FEATURES.blindEditorSave&&context?.canEditBlinds===true;
  const rpc:TournamentEditRpc=(name,args)=>supabase.rpc(name as never,args as never);
  useEffect(()=>{
    if(!open||!user?.id||authLoading)return;
    let active=true;const controller=new AbortController();
    setContext(null);setContextLoading(true);setContextError(null);setStorageError(null);setBlindChoice('none');
    try{
      const raw=localStorage.getItem(tournamentEditJournalKey(user.id,tournament.club_id,tournament.id));
      const saved=raw===null?null:readTournamentEditJournal(raw,user.id,tournament.club_id,tournament.id);
      setPending(saved);
      if(saved){setF(toForm(saved.p_config));setContextLoading(false);return;}
    }catch{
      setStorageError('Không đọc được journal lần lưu trước. Giữ dữ liệu và đối chiếu trước khi lưu thêm.');setContextLoading(false);return;
    }
    void loadTournamentEditContext((name,args)=>supabase.rpc(name as never,args as never).abortSignal(controller.signal),tournament.id,tournament.club_id,user.id)
      .then(value=>{if(active){setContext(value);setF(toForm(value.state.config));}})
      .catch(()=>{if(active)setContextError('Không xác minh được cấu hình giải. Tải lại thông tin trước khi sửa.');})
      .finally(()=>{controller.abort();if(active)setContextLoading(false);});
    return()=>{active=false;controller.abort();};
    // The keyed outer component owns actor/session/tour lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,revision]);
  useEffect(() => {
    if (!canPickBlinds || !open || !tournament.club_id) return;
    let cancelled = false;const controller=new AbortController();setTemplateError(false);setClubTemplates([]);
    void waitForManualPlayerResponse(Promise.resolve(supabase
      .from("blind_structure_templates")
      .select("id, club_id, name, levels")
      .eq("club_id", tournament.club_id).abortSignal(controller.signal)))
      .then(({data,error})=>{
        if(cancelled)return;
        if(error||!Array.isArray(data)||data.some(row=>row.club_id!==tournament.club_id||!Array.isArray(row.levels)||typeof row.name!=='string'))throw new Error('template_read_unverified');
        setClubTemplates(data as unknown as BlindTemplate[]);
      }).catch(()=>{if(!cancelled)setTemplateError(true);}).finally(()=>controller.abort());
    return () => { cancelled = true;controller.abort(); };
  }, [canPickBlinds, open, tournament.club_id]);
  const resolveLevels = (choice: string): BlindLevel[] => {
    if (choice.startsWith("preset:")) return BLIND_PRESETS.find((p) => p.key === choice.slice(7))?.levels ?? [];
    if (choice.startsWith("tpl:")) return (clubTemplates.find((t) => t.id === choice.slice(4))?.levels ?? []) as BlindLevel[];
    return [];
  };
  const save = async (retryOriginal=false) => {
    if(!user?.id||authLoading||writing.current||!alive.current)return;
    if(storageError||contextLoading||(!pending&&!context))return;
    writing.current=true;setSaving(true);
    let request:TournamentEditRequest|null=pending;
    let retained=false;
    try{
      if(!request){
        const integer=(value:string)=>{if(!value.trim())throw new Error('required_number');const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error('invalid_number');return n;};
        const levels=blindChoice==='none'?null:resolveLevels(blindChoice).map((level,i)=>({level_number:i+1,small_blind:level.small_blind,
          big_blind:level.big_blind,ante:level.ante,duration_minutes:level.duration_minutes,is_break:level.is_break}));
        if(levels&&(!canPickBlinds||levels.length===0||(blindChoice.startsWith('tpl:')&&templateError)))throw new Error('unverified_template');
        request=parseTournamentEditRequest({p_tournament_id:tournament.id,p_club_id:tournament.club_id,p_expected_actor_id:user.id,p_request_id:crypto.randomUUID(),
          p_expected_state:context!.state,p_config:{...f,start_time:new Date(f.start_time).toISOString(),buy_in:integer(f.buy_in),rake_amount:integer(f.rake_amount),
            service_fee_amount:FEATURES.tournamentServiceFee?integer(f.service_fee_amount):context!.state.config.service_fee_amount,
            guarantee_amount:f.guarantee_amount.trim()===''?null:integer(f.guarantee_amount),starting_stack:integer(f.starting_stack),
            minutes_per_level:integer(f.minutes_per_level),late_reg_close_level:integer(f.late_reg_close_level)},p_levels:levels},user.id,tournament.club_id,tournament.id);
        retainTournamentEdit(localStorage,request);retained=true;setPending(request);
        await submitTournamentEdit(rpc,request);
      }else{
        verifyRetainedTournamentEdit(localStorage,request);retained=true;
        if(retryOriginal)await submitTournamentEdit(rpc,request);else await recoverTournamentEdit(rpc,request);
      }
      if(!alive.current)return;
      try{clearTournamentEdit(localStorage,request);}catch{toast.error('Đã xác minh lần lưu nhưng chưa dọn được journal. Giữ nguyên dữ liệu để đối chiếu.');}
      setPending(null);toast.success('Saved');setOpen(false);onSaved();
    }catch(error){
      if(!alive.current)return;
      if(request&&!retained){setStorageError('Không xác minh được journal đúng yêu cầu. Giữ nguyên dữ liệu và tải lại trước khi thao tác tiếp.');toast.error('Chưa gửi yêu cầu: journal chưa được xác minh.');return;}
      if(error instanceof TournamentEditError&&error.unknownOutcome){
        if(request)setPending(request);
        toast.error('Chưa xác minh được lần lưu trước. Giữ nguyên yêu cầu và kiểm tra receipt; không tạo lần lưu khác.');
      }else if(request){
        try{clearTournamentEdit(localStorage,request);setPending(null);}catch{setStorageError('Không đối chiếu được journal. Chưa thể gửi yêu cầu khác.');}
        setContext(null);setContextError('Yêu cầu không được lưu. Tải lại cấu hình để kiểm tra quyền, phiên bản và dữ liệu trước khi thử tiếp.');
        toast.error('Không lưu được cấu hình và blind; tải lại thông tin trước khi thử tiếp.');
      }else toast.error('Kiểm tra tên, thời gian, các số nguyên không âm và cấu trúc blind đã chọn. Chưa gửi yêu cầu lưu.');
    }finally{
      writing.current=false;if(alive.current)setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={next=>{if(!writing.current&&!authLoading&&user?.id)setOpen(next);}}>
      <DialogTrigger asChild>
        <Button aria-label="Sửa thông tin giải" disabled={authLoading||!user} variant="ghost" size="icon"><Pencil className="w-4 h-4 text-primary" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Tournament</DialogTitle><DialogDescription>Cấu hình và blind lưu cùng một lần; không thay giá đã chốt của đăng ký trước.</DialogDescription></DialogHeader>
        {contextLoading&&<p role="status">Đang xác minh cấu hình…</p>}
        {storageError&&<p role="alert">{storageError}</p>}
        {contextError&&<div role="alert"><p>{contextError}</p><Button variant="outline" onClick={()=>setRevision(n=>n+1)} disabled={saving}>Tải lại thông tin</Button></div>}
        {pending&&<p role="status">Còn yêu cầu lưu chưa đối chiếu. Các trường đang khóa theo đúng payload cũ.</p>}
        <fieldset disabled={saving||contextLoading||!context||!!pending||!!storageError} className="space-y-2 min-w-0">
          <Label>Name</Label><Input aria-label="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input aria-label="Start time" type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input aria-label="Buy-in (VND)" type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input aria-label="Rake / phí giải (VND)" type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input aria-label="Phí dịch vụ (VND)" type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Giá cấu hình: <span className="text-primary font-medium">{[f.buy_in,f.rake_amount,f.service_fee_amount].every(value=>value.trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0)
            ?formatVND(Number(f.buy_in)+Number(f.rake_amount)+Number(f.service_fee_amount)):'Chưa đủ thông tin'}</span> <span className="opacity-70">(buy-in + rake + phí dịch vụ nếu có)</span></p>
          <div><Label>GTD cam kết (VND)</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          <p className="text-[11px] text-muted-foreground -mt-1">Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input aria-label="Starting stack" type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input aria-label="Minutes / level" type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input aria-label="Late reg close at level" type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input aria-label="Location" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea aria-label="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
          {templateError&&<p role="status">Không tải được mẫu CLB. Chỉ dùng cấu trúc hiện tại hoặc mẫu chuẩn đã xác minh.</p>}
          {canPickBlinds && (
            <>
              <Label>Cấu trúc blind</Label>
              <Select value={blindChoice} onValueChange={setBlindChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Giữ cấu trúc hiện tại</SelectItem>
                  {clubTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Mẫu CLB</SelectLabel>
                      {clubTemplates.map((t) => <SelectItem key={t.id} value={`tpl:${t.id}`}>{t.name}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Mẫu chuẩn</SelectLabel>
                    {BLIND_PRESETS.map((p) => <SelectItem key={p.key} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground -mt-1">
                Chọn mẫu sẽ <span className="text-primary font-medium">THAY</span> toàn bộ cấu trúc blind hiện tại. Hoặc bấm nút{" "}
                <ListOrdered className="inline w-3 h-3 align-text-bottom" /> ở danh sách giải để sửa từng level.
              </p>
            </>
          )}
        </fieldset>
          <Button onClick={()=>void save()} disabled={saving||contextLoading||!!storageError||(!pending&&!context)} className="w-full gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : pending?'Kiểm tra lần lưu trước':"Save Changes"}
          </Button>
          {pending&&<Button variant="outline" disabled={saving||!!storageError} onClick={()=>void save(true)}>Gửi lại đúng yêu cầu cũ</Button>}
      </DialogContent>
    </Dialog>
  );
};

// ── TournamentCard — the per-tournament card, shared by every Floor board ────────────
export function TournamentCard({
  tour, flightMeta, finalMeta, multiClub, clubName, reload, onDelete, onStart, onSelect, legacyMultiDayActions = true,
}: {
  tour: any;
  flightMeta?: FlightMeta;
  finalMeta?: FinalMeta;
  multiClub: boolean;
  clubName?: string;
  reload: () => void;
  onDelete: (id: string) => void;
  onStart: (id: string) => void;
  /** When provided, the card title becomes a button that enters the tournament's operational tabs. */
  onSelect?: (id: string) => void;
  legacyMultiDayActions?: boolean;
}) {
  const { t } = useTranslation();
  const t2 = tour;
  const title = (
    <div className="font-semibold truncate flex items-center gap-1">
      {onSelect ? (
        <button type="button" onClick={() => onSelect(t2.id)} className="truncate text-left hover:text-primary hover:underline">{t2.name}</button>
      ) : (
        <span className="truncate">{t2.name}</span>
      )}
      {FEATURES.multiDayTournaments && t2.phase === "flight" && <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">Flight {t2.flight_label}</span>}
      {FEATURES.multiDayTournaments && t2.phase === "final" && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">Final</span>}
    </div>
  );
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {title}
          <div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)}</div>
          <div className="mt-0.5"><FomoPrice tournament={t2} /></div>
          <div className="text-[11px] text-muted-foreground">
            {t("clubAdmin.stack")}: {t2.starting_stack?.toLocaleString?.() ?? t2.starting_stack}
            {t2.location ? ` · 📍 ${t2.location}` : ""}
            {multiClub && clubName ? ` · 🏠 ${clubName}` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          <EditTournamentDialog tournament={t2} onSaved={reload} />
          <AuditHistoryDialog tournament={t2} />
          {FEATURES.multiDayTournaments && legacyMultiDayActions && t2.phase === "flight" && <FlightQualifiersDialog flight={t2} meta={flightMeta} onDone={reload} />}
          {FEATURES.blindTemplates && <BlindStructureDialog tournament={t2} />}
          <Button variant="ghost" size="icon" onClick={() => onDelete(t2.id)}>
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
      <TournamentLifecycleControls tournament={t2} onChanged={reload}/>
      <LiveStateEditor tournament={t2} onSaved={reload} />
      {onSelect && (
        <Button size="sm" variant="ghost" className="w-full h-8 text-xs text-primary hover:bg-primary/10" onClick={() => onSelect(t2.id)}>
          Vào giải (vận hành) →
        </Button>
      )}
      {!["live","completed","cancelled","finished"].includes(t2.status) && (
        <Button size="sm" variant="outline" className="w-full h-9 text-xs border-primary/50 text-primary hover:bg-primary/10" onClick={() => onStart(t2.id)}>
          <Play className="w-3.5 h-3.5 mr-1" /> Bắt đầu giải (chạy đồng hồ + lên live)
        </Button>
      )}
      {FEATURES.multiDayTournaments && legacyMultiDayActions && t2.phase === "final" && (
        <Day2DrawDialog final={t2} meta={finalMeta} onDone={reload} />
      )}
    </Card>
  );
}
