import { useCallback, useEffect, useRef, useState } from "react";
import { waitForManualPlayerResponse } from '@/lib/floorManualPlayerIntent';
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Save, Plus, Trash2, Coffee, Lock, BookMarked } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { BLIND_PRESETS, normalizeLevels, type BlindLevel, type BlindTemplate } from "@/lib/blindPresets";

interface LevelRow {
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_minutes: number;
  is_break: boolean;
}

const SAVE_LIVE = FEATURES.blindEditorSave;

/**
 * Floor blind-structure editor. Reads tournament_levels, lets the floor add /
 * edit / delete levels, and full-replaces via the source-only
 * update_blind_structure RPC. Production-safe: while the RPC is not live
 * (FEATURES.blindEditorSave === false) the editor is a draft-local preview —
 * Save is disabled with "Cần bật RPC" and NEVER calls the RPC (no silent fail,
 * no wipe). The running clock (ClockPanel) only READS this structure.
 */
export function BlindEditorPanel(props: {tournamentId:string;tournamentStatus?:string}) {
  const ended = ["completed", "finished", "cancelled"].includes(props.tournamentStatus ?? "");
  return <ScopedBlindEditor key={JSON.stringify([props.tournamentId, ended])} {...props}/>;
}
function ScopedBlindEditor({
  tournamentId,
  tournamentStatus,
}: {
  tournamentId: string;
  tournamentStatus?: string;
}) {
  const [rows, setRows] = useState<LevelRow[]>([]);
  const tournamentEnded = ["completed", "finished", "cancelled"].includes(tournamentStatus ?? "");
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError,setLoadError]=useState<string|null>(null);
  const alive=useRef(true),generation=useRef(0),writing=useRef(false);

  const load = useCallback(async () => {
    const sequence=++generation.current;
    setInitialLoading(true);
    setLoadError(null);
    try {
      const [levelsRes, tourRes] = await waitForManualPlayerResponse(Promise.all([
        supabase
          .from("tournament_levels")
          .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
          .eq("tournament_id", tournamentId)
          .order("level_number"),
        supabase.from("tournaments").select("current_level, club_id").eq("id", tournamentId).single(),
      ]));
      if(!alive.current||sequence!==generation.current)return;
      if (levelsRes.error) throw levelsRes.error;
      if (tourRes.error) throw tourRes.error;
      if (!tourRes.data) throw new Error('Không xác minh được giải.');
      if (!Array.isArray(levelsRes.data) || levelsRes.data.some((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
        const row = raw as Record<string, unknown>;
        return typeof row.is_break !== 'boolean'
          || ['small_blind', 'big_blind', 'ante', 'duration_minutes'].some((field) =>
            typeof row[field] !== 'number' || !Number.isInteger(row[field]));
      })) throw new Error('Không xác minh được cấu trúc blind.');
      setRows(levelsRes.data.map((r: LevelRow) => ({
        small_blind: r.small_blind,
        big_blind: r.big_blind,
        ante: r.ante,
        duration_minutes: r.duration_minutes,
        is_break: r.is_break,
      })));
      setCurrentLevel((tourRes.data as any)?.current_level ?? null);
      setClubId((tourRes.data as any)?.club_id ?? null);
    } catch {
      if(alive.current&&sequence===generation.current){
        setRows([]);setCurrentLevel(null);setClubId(null);
        setLoadError('Không tải được cấu trúc blind hoặc thông tin giải. Tải lại trước khi sửa.');
      }
    } finally {
      if(alive.current&&sequence===generation.current)setInitialLoading(false);
    }
  }, [tournamentId]);

  const loadLevels = (levels: BlindLevel[]) =>
    setRows(levels.map((l) => ({
      small_blind: l.small_blind, big_blind: l.big_blind, ante: l.ante,
      duration_minutes: l.duration_minutes, is_break: l.is_break,
    })));

  useEffect(() => { alive.current=true;void load();return()=>{alive.current=false;}; }, [load]);

  const update = (i: number, field: keyof LevelRow, value: number | boolean) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const addLevel = () =>
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, last
        ? { ...last, is_break: false, small_blind: last.small_blind * 2, big_blind: last.big_blind * 2, ante: last.ante * 2 }
        : { small_blind: 100, big_blind: 200, ante: 0, duration_minutes: 20, is_break: false }];
    });

  const addBreak = () =>
    setRows((prev) => [...prev, { small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 15, is_break: true }]);

  const removeLevel = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const validate = (): string | null => {
    if (rows.length === 0) return "Chưa có level nào.";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if ([r.small_blind, r.big_blind, r.ante, r.duration_minutes].some((v) => !Number.isFinite(v) || v < 0))
        return `Level ${i + 1}: giá trị không hợp lệ (không được âm).`;
      if (!r.is_break && r.big_blind <= 0) return `Level ${i + 1}: BB phải > 0.`;
    }
    return null;
  };

  const save = async () => {
    if (tournamentEnded || !SAVE_LIVE || initialLoading || loadError || writing.current || !alive.current) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    const isLive = tournamentStatus === "live" || tournamentStatus === "active" || tournamentStatus === "break";
    if (isLive && !window.confirm("Giải đang chạy — thay toàn bộ cấu trúc blind? Đồng hồ sẽ đọc cấu trúc mới.")) return;
    writing.current=true;setSaving(true);
    try {
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(supabase.rpc("update_blind_structure", {
        p_tournament_id: tournamentId,
        p_levels: rows.map((r, i) => ({ level_number: i + 1, ...r })),
      })));
      if(!alive.current)return;
      if(error)throw error;
      if (!data || typeof data!=='object' || Array.isArray(data)
        || !('status' in data) || data.status!=='success'
        || !('levels_saved' in data) || data.levels_saved!==rows.length) {
        toast.error('Chưa xác minh được kết quả lưu blind. Kiểm tra lại dữ liệu trước khi gửi thao tác khác.');return;
      }
      toast.success(`Đã lưu ${rows.length} level`);
      await load();
    } catch {
      if(alive.current)toast.error('Chưa xác minh được kết quả lưu blind. Kiểm tra lại dữ liệu trước khi gửi thao tác khác.');
    } finally {
      writing.current=false;if(alive.current)setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      {tournamentEnded && <p role="status" className="text-sm text-muted-foreground">Giải đã kết thúc hoặc bị hủy. Chỉ xem cấu trúc blind.</p>}
      {loadError&&<div role="alert" className="space-y-2 text-destructive"><p>{loadError}</p>
        <Button variant="outline" onClick={()=>void load()}>Tải lại cấu trúc blind</Button></div>}
      <fieldset className="space-y-4 min-w-0" disabled={tournamentEnded||initialLoading||!!loadError||saving}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">Cấu trúc blind</div>
          <p className="text-xs text-muted-foreground">
            Floor đặt cấu trúc; đồng hồ chỉ đọc &amp; chạy theo cấu trúc này.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addBreak} disabled={initialLoading}>
            <Coffee className="w-3.5 h-3.5 mr-1" /> Break
          </Button>
          <Button size="sm" variant="outline" onClick={addLevel} disabled={initialLoading}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Level
          </Button>
          {SAVE_LIVE ? (
            <Button size="sm" onClick={save} disabled={saving || initialLoading || !!loadError}>
              <Save className="w-3.5 h-3.5 mr-1" /> Lưu
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled title="Cần apply RPC update_blind_structure">
              <Lock className="w-3.5 h-3.5 mr-1" /> Cần bật RPC
            </Button>
          )}
        </div>
      </div>

      {!tournamentEnded && FEATURES.blindTemplates && clubId && (
        <BlindTemplateBar key={clubId} clubId={clubId} currentRows={rows} onLoad={loadLevels} />
      )}

      {!SAVE_LIVE && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Chế độ xem/nháp: RPC <code>update_blind_structure</code> chưa được bật trên production —
          sửa được nhưng chưa lưu được. Bật sau khi apply RPC trong phiên DB có kiểm soát.
        </div>
      )}

      {initialLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Chưa có cấu trúc blind. Thêm Level để bắt đầu.</div>
      ) : (
        <div className="space-y-1.5">
          <div className="hidden sm:grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_auto] gap-2 px-2 text-xs text-muted-foreground">
            <span>Lv</span><span>SB</span><span>BB</span><span>Ante</span><span>Phút</span><span />
          </div>
          {rows.map((r, i) => {
            const isCurrent = currentLevel === i + 1;
            return (
              <div
                key={i}
                className={`grid grid-cols-2 gap-2 items-end rounded border p-2 sm:grid-cols-[2.5rem_1fr_1fr_1fr_1fr_auto] sm:items-center ${isCurrent ? "border-primary/50 bg-primary/5" : "border-border"}`}
              >
                <div className={`text-sm font-semibold tabular-nums ${isCurrent ? "text-primary" : ""}`}>
                  {isCurrent ? "▸ " : ""}{i + 1}
                </div>
                {r.is_break ? (
                  <div className="col-span-1 sm:col-span-4 flex items-center gap-2 text-sm text-amber-400">
                    <Coffee className="w-4 h-4" /> Break
                  </div>
                ) : (
                  <>
                    <LabeledInput label="SB" value={r.small_blind} onChange={(v) => update(i, "small_blind", v)} />
                    <LabeledInput label="BB" value={r.big_blind} onChange={(v) => update(i, "big_blind", v)} />
                    <LabeledInput label="Ante" value={r.ante} onChange={(v) => update(i, "ante", v)} />
                  </>
                )}
                <LabeledInput label="Phút" value={r.duration_minutes} onChange={(v) => update(i, "duration_minutes", v)} />
                <Button size="sm" variant="ghost" className="h-11 justify-self-end text-destructive" onClick={() => removeLevel(i)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      </fieldset>
    </Card>
  );
}

/**
 * Reusable blind-structure templates ("thư viện cấu trúc blind"). Load a built-in
 * preset or a saved club template into the editor, or save the current levels as a
 * named club template. Gated by FEATURES.blindTemplates — only mounted when the
 * blind_structure_templates table is live.
 */
function BlindTemplateBar({
  clubId, currentRows, onLoad,
}: {
  clubId: string;
  currentRows: LevelRow[];
  onLoad: (levels: BlindLevel[]) => void;
}) {
  const [templates, setTemplates] = useState<BlindTemplate[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveUnknown,setSaveUnknown]=useState(false);
  const templateWriting=useRef(false);
  const [templateReadError,setTemplateReadError]=useState(false);
  const [templateLoading,setTemplateLoading]=useState(true);
  const templateAlive=useRef(true),templateRead=useRef(0);

  const loadTemplates = useCallback(async () => {
    const sequence=++templateRead.current;
    setTemplateLoading(true);setTemplateReadError(false);setTemplates([]);
    try {
    const { data,error } = await waitForManualPlayerResponse(Promise.resolve((supabase as any)
      .from("blind_structure_templates")
      .select("id, club_id, name, levels")
      .eq("club_id", clubId)
      .order("name")));
    if(!templateAlive.current||sequence!==templateRead.current)return;
    if(error||!Array.isArray(data)||data.some(raw=>!raw||typeof raw!=='object'||Array.isArray(raw)
      ||typeof raw.id!=='string'||!raw.id||raw.club_id!==clubId||typeof raw.name!=='string'||!raw.name.trim())
      ||new Set(data.map(row=>row.id)).size!==data.length)throw new Error('BLIND_TEMPLATES_INVALID');
    setTemplates(data as BlindTemplate[]);
    } catch {
      if(templateAlive.current&&sequence===templateRead.current){setTemplates([]);setTemplateReadError(true);}
    } finally {
      if(templateAlive.current&&sequence===templateRead.current)setTemplateLoading(false);
    }
  }, [clubId]);

  useEffect(() => { templateAlive.current=true;void loadTemplates();return()=>{templateAlive.current=false;}; }, [loadTemplates]);

  const applyChoice = (val: string) => {
    if (val.startsWith("preset:")) {
      const p = BLIND_PRESETS.find((x) => x.key === val.slice(7));
      if (p) { onLoad(p.levels); toast.success(`Đã tải mẫu chuẩn "${p.name}"`); }
    } else if (val.startsWith("tpl:")) {
      const tpl = templates.find((x) => x.id === val.slice(4));
      if (tpl) {
        const levels:unknown=tpl.levels;
        if (!Array.isArray(levels)||levels.length===0||levels.some(raw=>{
          if(!raw||typeof raw!=='object'||Array.isArray(raw))return true;
          const row=raw as Record<string,unknown>;
          return typeof row.is_break!=='boolean'
            ||['small_blind','big_blind','ante','duration_minutes'].some(field=>
              typeof row[field]!=='number'||!Number.isSafeInteger(row[field])||Number(row[field])<0)
            ||(!row.is_break&&Number(row.big_blind)<=0);
        })) {
          toast.error('Mẫu blind không hợp lệ. Giữ nguyên cấu trúc đang sửa.');return;
        }
        onLoad(levels as BlindLevel[]); toast.success(`Đã tải mẫu "${tpl.name}"`);
      }
    }
  };

  const saveTemplate = async () => {
    if(templateWriting.current||saveUnknown)return;
    const nm = name.trim();
    if (!nm) { toast.error("Đặt tên cho mẫu"); return; }
    if (currentRows.length === 0) { toast.error("Chưa có level nào để lưu"); return; }
    templateWriting.current=true;setBusy(true);
    try {
      const { error } = await waitForManualPlayerResponse(Promise.resolve((supabase as any).from("blind_structure_templates").insert({
        club_id: clubId, name: nm, levels: normalizeLevels(currentRows),
      })));
      if (error) { toast.error(error.message); return; }
      toast.success(`Đã lưu mẫu "${nm}"`);
      setSaveOpen(false); setName(""); loadTemplates();
    } catch {
      setSaveUnknown(true);
      toast.error('Chưa xác minh được kết quả lưu mẫu. Kiểm tra danh sách mẫu trước khi tạo lại.');
    } finally {
      templateWriting.current=false;setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-md border border-border/60 bg-muted/30 px-2 py-2">
      <span className="text-xs text-muted-foreground">Mẫu cấu trúc:</span>
      {templateLoading&&<span role="status" className="text-xs text-muted-foreground">Đang tải mẫu CLB…</span>}
      {templateReadError&&<div role="alert" className="text-xs text-destructive"><p>Không tải được danh sách mẫu blind.</p>
       <Button type="button" variant="outline" size="sm" onClick={()=>void loadTemplates()}>Tải lại mẫu blind</Button></div>}
      <Select onValueChange={applyChoice}>
        <SelectTrigger className="h-8 w-[210px] text-xs"><SelectValue placeholder="Tải cấu trúc có sẵn…" /></SelectTrigger>
        <SelectContent>
          {templates.length > 0 && (
            <SelectGroup>
              <SelectLabel>Mẫu CLB</SelectLabel>
              {templates.map((t) => <SelectItem key={t.id} value={`tpl:${t.id}`}>{t.name}</SelectItem>)}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>Mẫu chuẩn</SelectLabel>
            {BLIND_PRESETS.map((p) => <SelectItem key={p.key} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-8"><BookMarked className="w-3.5 h-3.5 mr-1" />Lưu thành mẫu</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Lưu cấu trúc blind thành mẫu</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Tên mẫu</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Tour A, Turbo 15'…" />
            <p className="text-xs text-muted-foreground">Lưu {currentRows.length} level hiện tại để tái dùng khi tạo giải.</p>
            {saveUnknown&&<p role="alert" className="text-sm text-destructive">Chưa xác minh được kết quả lưu mẫu. Kiểm tra danh sách mẫu trước khi tạo lại.</p>}
            <Button onClick={saveTemplate} disabled={busy||saveUnknown} className="w-full">{busy ? "Đang lưu…" : "Lưu mẫu"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-0.5">
      <label className="text-[11px] text-muted-foreground sm:hidden">{label}</label>
      <Input className="h-11" type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
