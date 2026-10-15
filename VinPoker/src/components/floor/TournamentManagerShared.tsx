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
import { tournamentStatusLabel } from "@/lib/tournament/statusPresentation";

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
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState(defaultClubId);
  const [f, setF] = useState({ name: "", start_time: "", buy_in: 1000000, rake_amount: 0, service_fee_amount: 0, guarantee_amount: "", starting_stack: 20000, location: "", description: "", game_type: "nlh", minutes_per_level: 20, late_reg_close_level: 6 });
  const [blindChoice, setBlindChoice] = useState("none");
  const [draftLevels, setDraftLevels] = useState<BlindLevel[]>([]);
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const createBusyRef = useRef(false);
  const mounted = useRef(true);
  const createScope = useRef("");
  createScope.current = `${user?.id ?? ""}:${clubId}`;
  const [pendingCreate, setPendingCreate] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    try { setPendingCreate(!!user && localStorage.getItem(tournamentCreateJournalKey(user.id, clubId)) !== null); }
    catch { setPendingCreate(true); }
  }, [open, user?.id, clubId]);
  const [mode, setMode] = useState<"single" | "multi" | "satellite">(lockMode ?? "single");
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

  const submitMultiDay = async () => {
    if (busy) return;
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    if (!f.name) return toast.error("Nhập tên Main Event");
    if (!finalStart) return toast.error("Chọn giờ Final Day");
    if (!flightCount || flightCount < 1 || flightCount > 11) return toast.error("Số flight 1–11 (A–K)");
    if (blindChoice === "draft" && !isValidBlindDraft(draftLevels)) return toast.error("Review the blind draft before creating this event.");
    setBusy(true);
    try {
      const levels = resolveLevels(blindChoice);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC 20261025000000, not in generated types
      const { data, error } = await (supabase.rpc as any)("create_tournament_event_with_flights", {
        p_club_id: clubId,
        p_name: f.name,
        p_itm_percent: Number(itmPercent) || 0,
        p_buy_in: Number(f.buy_in),
        p_rake_amount: Number(f.rake_amount) || 0,
        p_starting_stack: Number(f.starting_stack),
        p_game_type: f.game_type,
        p_minutes_per_level: Number(f.minutes_per_level),
        p_late_reg_close_level: Number(f.late_reg_close_level),
        p_flight_count: Number(flightCount),
        p_final_start_time: new Date(finalStart).toISOString(),
        p_flight_start_times: f.start_time ? Array.from({ length: Number(flightCount) }, () => new Date(f.start_time).toISOString()) : null,
        p_levels: levels.length ? levels : null,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string } | null;
      if (error || !res?.ok) { toast.error(res?.error || error?.message || "Tạo Main Event lỗi"); return; }
      toast.success(`Đã tạo "${f.name}" — ${flightCount} flight (${flightLabels}) + Final Day`);
      setOpen(false);
      onCreated();
    } finally { setBusy(false); }
  };

  const submit = async (retryOriginal = false) => {
    if (busy || createBusyRef.current) return;
    if (!user) return toast.error(t("createAtomic.signin"));
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    const scope = createScope.current;
    const key = tournamentCreateJournalKey(user.id, clubId);
    let request: TournamentCreateRequest;
    let recovering = false;
    try {
      const raw = localStorage.getItem(key);
      recovering = raw !== null;
      if (!recovering && FEATURES.multiDayTournaments && mode === "multi") return submitMultiDay();
      if (raw !== null) request = readTournamentCreateJournal(raw, user.id, clubId);
      else {
        if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
        if (blindChoice === "draft" && !isValidBlindDraft(draftLevels)) return toast.error("Review the blind draft before creating this tournament.");
        request = { p_club_id: clubId, p_expected_actor_id: user.id, p_request_id: crypto.randomUUID(),
          p_levels: FEATURES.blindTemplates ? resolveLevels(blindChoice) : [], p_config: {
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
        try { await recoverTournamentCreate(rpc, request); }
        catch (error) {
          if (!retryOriginal) throw error;
          // Explicit user retry only, after checking the original receipt.
          // Reuse the persisted payload and key, even if form fields changed.
          await createTournament(rpc, request);
        }
      } else await createTournament(rpc, request);
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
          <div><Label>GTD cam kết (VND)</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          <p className="text-[11px] text-muted-foreground -mt-1">Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool.</p>
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
export const EditTournamentDialog = ({ tournament, onSaved }: { tournament: any; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [f, setF] = useState({
    name: tournament.name,
    start_time: toLocalInput(tournament.start_time),
    buy_in: tournament.buy_in,
    rake_amount: tournament.rake_amount ?? 0,
    service_fee_amount: tournament.service_fee_amount ?? 0,
    guarantee_amount: tournament.guarantee_amount != null ? String(tournament.guarantee_amount) : "",
    starting_stack: tournament.starting_stack,
    location: tournament.location ?? "",
    description: tournament.description ?? "",
    game_type: tournament.game_type ?? "nlh",
    minutes_per_level: tournament.minutes_per_level ?? 20,
    late_reg_close_level: tournament.late_reg_close_level ?? 6,
  });
  const [saving, setSaving] = useState(false);
  const [blindChoice, setBlindChoice] = useState("none");
  const [clubTemplates, setClubTemplates] = useState<BlindTemplate[]>([]);
  const canPickBlinds = FEATURES.blindTemplates && FEATURES.blindEditorSave;
  useEffect(() => {
    if (!canPickBlinds || !open || !tournament.club_id) return;
    let cancelled = false;
    supabase
      .from("blind_structure_templates")
      .select("id, club_id, name, levels")
      .eq("club_id", tournament.club_id)
      .then(({ data }) => { if (!cancelled) setClubTemplates((data ?? []) as unknown as BlindTemplate[]); });
    return () => { cancelled = true; };
  }, [canPickBlinds, open, tournament.club_id]);
  const resolveLevels = (choice: string): BlindLevel[] => {
    if (choice.startsWith("preset:")) return BLIND_PRESETS.find((p) => p.key === choice.slice(7))?.levels ?? [];
    if (choice.startsWith("tpl:")) return (clubTemplates.find((t) => t.id === choice.slice(4))?.levels ?? []) as BlindLevel[];
    return [];
  };
  const save = async () => {
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
    setSaving(true);
    const { error } = await supabase.from("tournaments").update({
      name: f.name,
      start_time: new Date(f.start_time).toISOString(),
      buy_in: Number(f.buy_in),
      rake_amount: Number(f.rake_amount) || 0,
      ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
      guarantee_amount: parseGtd(f.guarantee_amount),
      starting_stack: Number(f.starting_stack),
      location: f.location,
      description: f.description,
      game_type: f.game_type,
      minutes_per_level: Number(f.minutes_per_level),
      late_reg_close_level: Number(f.late_reg_close_level),
    }).eq("id", tournament.id);
    if (error) { setSaving(false); toast.error(error.message); return; }
    if (canPickBlinds && blindChoice !== "none") {
      const levels = resolveLevels(blindChoice);
      if (levels.length) {
        const { error: blindErr } = await supabase.rpc("update_blind_structure", {
          p_tournament_id: tournament.id,
          p_levels: levels.map((l, i) => ({ level_number: i + 1, ...l })),
        });
        if (blindErr) { setSaving(false); toast.error("Lưu giải OK nhưng nạp cấu trúc blind lỗi: " + blindErr.message); return; }
      }
    }
    setSaving(false);
    toast.success("Saved");
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4 text-primary" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Tournament</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
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
          <div><Label>GTD cam kết (VND)</Label><Input type="number" min={0} value={f.guarantee_amount} onChange={e => setF({ ...f, guarantee_amount: e.target.value })} placeholder="Để trống nếu chưa có GTD" /></div>
          <p className="text-[11px] text-muted-foreground -mt-1">Cam kết của floor. Để trống = chưa có GTD (sẽ hiện “thiếu GTD”), không suy ra từ prize pool.</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
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
          <Button onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── TournamentCard — the per-tournament card, shared by every Floor board ────────────
export function TournamentCard({
  tour, flightMeta, finalMeta, multiClub, clubName, reload, onDelete, onSetStatus, onStart, onSelect, legacyMultiDayActions = true,
}: {
  tour: any;
  flightMeta?: FlightMeta;
  finalMeta?: FinalMeta;
  multiClub: boolean;
  clubName?: string;
  reload: () => void;
  onDelete: (id: string) => void;
  onSetStatus: (id: string, status: "scheduled" | "live" | "finished" | "cancelled") => void;
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
      <Select value={t2.status} onValueChange={(v) => onSetStatus(t2.id, v as any)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue>{tournamentStatusLabel(t2.status, t)}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="scheduled">{t("clubAdmin.scheduled")}</SelectItem>
          <SelectItem value="live">{t("clubAdmin.live")}</SelectItem>
          <SelectItem value="finished">{t("clubAdmin.finished")}</SelectItem>
          <SelectItem value="cancelled">{t("clubAdmin.cancelled")}</SelectItem>
        </SelectContent>
      </Select>
      <LiveStateEditor tournament={t2} onSaved={reload} />
      {onSelect && (
        <Button size="sm" variant="ghost" className="w-full h-8 text-xs text-primary hover:bg-primary/10" onClick={() => onSelect(t2.id)}>
          Vào giải (vận hành) →
        </Button>
      )}
      {t2.status !== "live" && (
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
