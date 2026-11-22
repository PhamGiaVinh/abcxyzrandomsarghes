import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Sparkles, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DEFAULT_SHIFT_TEMPLATE_SEEDS, buildTemplateSeedRows } from "@/lib/shiftPlanner";
import { cn } from "@/lib/utils";

// dealer_shift_templates not yet in generated types — untyped client (Phase 2).
const db = supabase as unknown as { from: (t: string) => any };

const CLUB_TZ = 420;
const SKILL_OPTIONS = ["Cash", "Tournament", "PLO", "FinalTable"];

interface TemplateRow {
  id: string;
  label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  required_skills: string[] | null;
  needs_lead: boolean | null;
  need_count: number | null;
}

function offsetStr(tz: number): string {
  const s = tz >= 0 ? "+" : "-";
  const a = Math.abs(tz);
  return `${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function localHHMM(iso: string): string {
  const d = new Date(Date.parse(iso) + CLUB_TZ * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  refDate: string; // anchor date for stored timestamps
  onChanged: () => void;
}

export default function ShiftTemplateEditor({ open, onOpenChange, clubId, refDate, onChanged }: Props) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // new-template form
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [skills, setSkills] = useState<string[]>([]);
  const [needsLead, setNeedsLead] = useState(false);
  const [needCount, setNeedCount] = useState(1);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("dealer_shift_templates")
        .select("id, label, scheduled_start_at, scheduled_end_at, required_skills, needs_lead, need_count")
        .eq("club_id", clubId)
        .eq("active", true)
        .order("scheduled_start_at");
      if (error) throw error;
      setRows((data ?? []) as TemplateRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Không tải được khung ca");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const toggleSkill = (s: string) =>
    setSkills((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const addTemplate = async () => {
    if (!label.trim()) { toast.error("Nhập nhãn ca"); return; }
    setBusy(true);
    try {
      const off = offsetStr(CLUB_TZ);
      const sH = parseInt(start.slice(0, 2), 10);
      const eH = parseInt(end.slice(0, 2), 10);
      const endDate = eH <= sH ? addDays(refDate, 1) : refDate;
      const { error } = await db.from("dealer_shift_templates").insert({
        club_id: clubId,
        label: label.trim(),
        scheduled_start_at: `${refDate}T${start}:00${off}`,
        scheduled_end_at: `${endDate}T${end}:00${off}`,
        default_hours: 8,
        required_skills: skills,
        needs_lead: needsLead,
        need_count: needCount,
        active: true,
      });
      if (error) throw error;
      toast.success(`Đã thêm ca ${label.trim()}`);
      setLabel("");
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Không thêm được ca");
    } finally {
      setBusy(false);
    }
  };

  const removeTemplate = async (id: string, lbl: string) => {
    setBusy(true);
    try {
      const { error } = await db.from("dealer_shift_templates").update({ active: false }).eq("id", id);
      if (error) throw error;
      toast.success(`Đã ẩn ca ${lbl}`);
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Không xoá được ca");
    } finally {
      setBusy(false);
    }
  };

  // Idempotent seed: insert only defaults whose label isn't already present.
  const seedDefaults = async () => {
    setBusy(true);
    try {
      const { data: existing, error: readErr } = await db
        .from("dealer_shift_templates")
        .select("label")
        .eq("club_id", clubId)
        .eq("active", true);
      if (readErr) throw readErr;
      const have = new Set((existing ?? []).map((r: any) => r.label));
      const toInsert = buildTemplateSeedRows(clubId, refDate, CLUB_TZ).filter((r) => !have.has(r.label));
      if (toInsert.length === 0) {
        toast.info("Đã có đủ khung ca mặc định");
      } else {
        const { error } = await db.from("dealer_shift_templates").insert(toInsert);
        if (error) throw error;
        toast.success(`Đã tạo ${toInsert.length} khung ca mặc định`);
      }
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Không seed được khung ca");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Quản lý khung ca</DialogTitle>
          <DialogDescription>
            Khung giờ vào ca dùng chung cho CLB (08–16, 16–00, 18–02…). Auto-fill xếp dealer theo các khung này.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{rows.length} khung đang dùng</span>
          <Button size="sm" variant="outline" onClick={seedDefaults} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            Tạo khung mặc định ({DEFAULT_SHIFT_TEMPLATE_SEEDS.length})
          </Button>
        </div>

        {/* Existing templates */}
        <div className="border border-border rounded-lg divide-y divide-border/60">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground text-center">Đang tải…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">
              Chưa có khung ca. Bấm "Tạo khung mặc định" hoặc thêm thủ công bên dưới.
            </div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-sm font-bold tabular-nums w-16">{r.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {localHHMM(r.scheduled_start_at)}–{localHHMM(r.scheduled_end_at)}
                </span>
                <div className="flex flex-wrap gap-1 flex-1">
                  {(r.required_skills ?? []).map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                  ))}
                  {r.needs_lead && <Badge variant="outline" className="text-[10px] bg-[hsl(var(--ds-preassign)_/_0.15)] text-[hsl(var(--ds-preassign))] border-[hsl(var(--ds-preassign)_/_0.3)]">Lead</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">cần {r.need_count ?? 1}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} onClick={() => removeTemplate(r.id, r.label)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Add new */}
        <div className="border border-dashed border-border rounded-lg p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Thêm khung ca</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Input placeholder="Nhãn (vd 08–16)" value={label} onChange={(e) => setLabel(e.target.value)} className="h-9" />
            <Input type="time" aria-label="Giờ bắt đầu ca" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
            <Input type="time" aria-label="Giờ kết thúc ca" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
            <Input type="number" min={0} max={20} value={needCount} onChange={(e) => setNeedCount(Math.max(0, parseInt(e.target.value || "0", 10)))} className="h-9" placeholder="Số dealer" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {SKILL_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSkill(s)}
                className={cn(
                  "px-2 py-1 rounded-md border text-[11px] font-semibold",
                  skills.includes(s) ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground border-border"
                )}
              >
                {skills.includes(s) && <X className="w-3 h-3 inline mr-0.5" />}{s}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
              Cần Lead <Switch checked={needsLead} onCheckedChange={setNeedsLead} className="scale-75" />
            </label>
          </div>
          <Button size="sm" onClick={addTemplate} disabled={busy} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
            Thêm khung ca
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
