// Super Admin → Poker IQ → Câu hỏi.
// Author / edit / approve the Poker IQ drill questions players answer. The bank is
// stored as a DrillHand[] JSON array in `app_settings` (key `poker_iq_questions`,
// public-read / super_admin-write RLS — same pattern as banners / packages). Only
// `approved` questions ever reach players, and only when the `pokerIqRemoteQuestions`
// flag is ON. Frontend-only: no migration, no RPC.
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Save, Check, Brain, BookOpen, AlertTriangle, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import {
  CONTENT_VERSION,
  DRILL_CATEGORIES,
  DRILL_HANDS,
  isValidDrillHand,
  type ContentConfidence,
  type DrillCategory,
  type DrillHand,
  type LeakTag,
  type ReviewStatus,
  type VillainProfile,
} from "@/lib/pokerIQ";
import { loadQuestionBank, saveQuestionBank } from "@/lib/pokerIQ/loadRemoteQuestions";

const CATEGORY_LABELS: Record<DrillCategory, string> = {
  preflop_discipline: "Kỷ luật preflop",
  position_steal: "Vị trí & steal",
  vs_aggro: "Đối thủ aggro",
  vs_nit_passive: "Đối thủ nit/passive",
  tournament_pressure: "Áp lực giải",
};
const DIFFICULTY_LABELS: Record<"easy" | "medium" | "hard", string> = { easy: "Dễ", medium: "Trung bình", hard: "Khó" };
const VILLAIN_LABELS: Record<VillainProfile, string> = { aggro: "Aggro", nit: "Nit", passive: "Passive", unknown: "Chưa rõ" };
const CONFIDENCE_LABELS: Record<ContentConfidence, string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const LEAK_TAGS: { value: LeakTag; label: string }[] = [
  { value: "tight_btn_co", label: "Quá chặt BTN/CO" },
  { value: "overfold_vs_aggro", label: "Over-fold vs aggro" },
  { value: "resteal_15_25", label: "Resteal 15–25BB kém" },
  { value: "overcall_oop", label: "Overcall OOP" },
  { value: "spew_vs_nit", label: "Spew vs nit" },
];
const OPTION_LETTERS = "abcdefgh".split("");

type EditOption = { id: string; label: string; score: number; leaks: LeakTag[] };
type EditForm = {
  id: string;
  category: DrillCategory;
  difficulty: "easy" | "medium" | "hard";
  villainProfile: VillainProfile;
  heroHand: string;
  position: string;
  stackBb: number;
  scenario: string;
  options: EditOption[];
  preferredBaseline: string;
  acceptableAlternatives: string[];
  explanation: string;
  contentConfidence: ContentConfidence;
  provenanceNote: string;
  reviewStatus: ReviewStatus;
};

const newId = () => `q_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function emptyForm(): EditForm {
  return {
    id: newId(),
    category: "preflop_discipline",
    difficulty: "medium",
    villainProfile: "unknown",
    heroHand: "",
    position: "",
    stackBb: 40,
    scenario: "",
    options: [
      { id: "a", label: "", score: 80, leaks: [] },
      { id: "b", label: "", score: 50, leaks: [] },
    ],
    preferredBaseline: "a",
    acceptableAlternatives: [],
    explanation: "",
    contentConfidence: "medium",
    provenanceNote: "",
    reviewStatus: "draft",
  };
}

function toForm(h: DrillHand): EditForm {
  return {
    id: h.id,
    category: h.category,
    difficulty: h.difficulty,
    villainProfile: h.villainProfile,
    heroHand: h.heroHand,
    position: h.position,
    stackBb: h.stackBb,
    scenario: h.scenario,
    options: h.options.map((o) => ({ id: o.id, label: o.label, score: o.score, leaks: (o.leaks ?? []) as LeakTag[] })),
    preferredBaseline: h.preferredBaseline,
    acceptableAlternatives: [...h.acceptableAlternatives],
    explanation: h.explanation,
    contentConfidence: h.contentConfidence,
    provenanceNote: h.provenanceNote,
    reviewStatus: h.reviewStatus,
  };
}

/** First validation failure (vi) or null if the form is a valid, round-trip-safe hand. */
function validate(f: EditForm): string | null {
  if (!f.heroHand.trim()) return "Thiếu bài tẩy (hero hand).";
  if (!f.position.trim()) return "Thiếu vị trí.";
  if (!Number.isFinite(f.stackBb) || f.stackBb <= 0) return "Stack BB phải lớn hơn 0.";
  if (!f.scenario.trim()) return "Thiếu mô tả tình huống.";
  if (f.options.length < 2) return "Cần ít nhất 2 lựa chọn.";
  for (const o of f.options) {
    if (!o.label.trim()) return "Mỗi lựa chọn cần nhãn.";
    if (!Number.isFinite(o.score) || o.score < 0 || o.score > 100) return "Điểm mỗi lựa chọn phải trong 0–100.";
  }
  if (new Set(f.options.map((o) => o.id)).size !== f.options.length) return "Mã lựa chọn bị trùng.";
  if (!f.options.some((o) => o.id === f.preferredBaseline)) return "Chọn 'Phương án nên dùng' hợp lệ.";
  if (!f.explanation.trim()) return "Thiếu phần giải thích.";
  if (!f.provenanceNote.trim()) return "Thiếu ghi chú nguồn (vì sao chọn baseline này).";
  return null;
}

function buildHand(f: EditForm): DrillHand {
  return {
    id: f.id,
    contentVersion: CONTENT_VERSION,
    reviewStatus: f.reviewStatus,
    category: f.category,
    difficulty: f.difficulty,
    villainProfile: f.villainProfile,
    heroHand: f.heroHand.trim(),
    position: f.position.trim(),
    stackBb: f.stackBb,
    scenario: f.scenario.trim(),
    options: f.options.map((o) => ({
      id: o.id,
      label: o.label.trim(),
      score: o.score,
      ...(o.leaks.length ? { leaks: o.leaks } : {}),
    })),
    preferredBaseline: f.preferredBaseline,
    acceptableAlternatives: f.acceptableAlternatives.filter((id) => f.options.some((o) => o.id === id)),
    explanation: f.explanation.trim(),
    contentConfidence: f.contentConfidence,
    provenanceNote: f.provenanceNote.trim(),
  };
}

export function PokerIqQuestionsEditor() {
  const [bank, setBank] = useState<DrillHand[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError,setReadError]=useState(false);
  const [readAttempt,setReadAttempt]=useState(0);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [isNew, setIsNew] = useState(true);

  useEffect(() => {
    let alive=true;const controller=new AbortController();setLoading(true);setReadError(false);
    void (async () => {
      try{const rows=await loadQuestionBank(controller.signal);if(alive)setBank(rows);}
      catch{if(alive){setBank([]);setReadError(true);}}
      finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;controller.abort();};
  }, [readAttempt]);

  const approvedCount = useMemo(() => bank.filter((h) => h.reviewStatus === "approved").length, [bank]);

  const persist = async (next: DrillHand[], successMsg: string) => {
    if(loading||readError||saving)return false;
    setSaving(true);
    const { error } = await saveQuestionBank(next);
    setSaving(false);
    if (error) {
      toast.error("Lưu thất bại: " + error);
      return false;
    }
    setBank(next);
    toast.success(successMsg);
    return true;
  };

  const openNew = () => { setForm(emptyForm()); setIsNew(true); setDialogOpen(true); };
  const openEdit = (h: DrillHand) => { setForm(toForm(h)); setIsNew(false); setDialogOpen(true); };

  const submit = async () => {
    const err = validate(form);
    if (err) return toast.error(err);
    const hand = buildHand(form);
    if (!isValidDrillHand(hand)) return toast.error("Câu hỏi chưa hợp lệ, vui lòng kiểm tra lại.");
    const exists = bank.some((h) => h.id === hand.id);
    const next = exists ? bank.map((h) => (h.id === hand.id ? hand : h)) : [...bank, hand];
    const ok = await persist(next, exists ? "Đã cập nhật câu hỏi" : "Đã thêm câu hỏi");
    if (ok) setDialogOpen(false);
  };

  const toggleApprove = (h: DrillHand) => {
    const nextStatus: ReviewStatus = h.reviewStatus === "approved" ? "draft" : "approved";
    const next = bank.map((x) => (x.id === h.id ? { ...x, reviewStatus: nextStatus } : x));
    persist(next, nextStatus === "approved" ? "Đã duyệt câu hỏi" : "Đã chuyển về nháp");
  };

  const remove = (h: DrillHand) => {
    if (!confirm(`Xoá câu hỏi này?\n\n"${h.scenario}"`)) return;
    persist(bank.filter((x) => x.id !== h.id), "Đã xoá câu hỏi");
  };

  const importSamples = () => {
    const ids = new Set(bank.map((h) => h.id));
    const missing = DRILL_HANDS.filter((h) => !ids.has(h.id));
    if (missing.length === 0) return toast.info("Bộ 20 câu mẫu đã có trong danh sách.");
    persist([...bank, ...missing], `Đã nhập ${missing.length} câu mẫu (ở trạng thái nháp)`);
  };

  // ── option editing helpers (operate on `form`) ───────────────────────────
  const setF = (patch: Partial<EditForm>) => setForm((p) => ({ ...p, ...patch }));
  const updateOption = (id: string, patch: Partial<EditOption>) =>
    setForm((p) => ({ ...p, options: p.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const addOption = () => {
    setForm((p) => {
      if (p.options.length >= OPTION_LETTERS.length) return p;
      const used = new Set(p.options.map((o) => o.id));
      const id = OPTION_LETTERS.find((l) => !used.has(l)) ?? `${p.options.length}`;
      return { ...p, options: [...p.options, { id, label: "", score: 50, leaks: [] }] };
    });
  };
  const removeOption = (id: string) => {
    setForm((p) => {
      if (p.options.length <= 2) return p;
      const options = p.options.filter((o) => o.id !== id);
      return {
        ...p,
        options,
        preferredBaseline: p.preferredBaseline === id ? options[0].id : p.preferredBaseline,
        acceptableAlternatives: p.acceptableAlternatives.filter((x) => x !== id),
      };
    });
  };
  const toggleLeak = (optId: string, leak: LeakTag) =>
    setForm((p) => ({
      ...p,
      options: p.options.map((o) =>
        o.id === optId
          ? { ...o, leaks: o.leaks.includes(leak) ? o.leaks.filter((l) => l !== leak) : [...o.leaks, leak] }
          : o,
      ),
    }));
  const toggleAlt = (id: string) =>
    setForm((p) => ({
      ...p,
      acceptableAlternatives: p.acceptableAlternatives.includes(id)
        ? p.acceptableAlternatives.filter((x) => x !== id)
        : [...p.acceptableAlternatives, id],
    }));

  return (
    <Card className="p-4 gradient-card space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Brain className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-lg">Câu hỏi Poker IQ</h3>
            <p className="text-xs text-muted-foreground max-w-prose">
              Soạn bộ câu hỏi drill cho người chơi. Mỗi câu có nhiều phương án với điểm chất lượng (0–100); người chơi
              chọn → hệ thống chấm phong cách & điểm mạnh. Chỉ câu <strong>đã duyệt</strong> mới hiển thị cho người chơi.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={importSamples} disabled={saving||loading||readError}>
            <BookOpen className="h-4 w-4 mr-1" />Nhập câu mẫu
          </Button>
          <Button size="sm" onClick={openNew} disabled={saving||loading||readError} className="gradient-neon text-primary-foreground border-0">
            <Plus className="h-4 w-4 mr-1" />Câu hỏi mới
          </Button>
        </div>
      </div>

      {/* Stats + flag state */}
      {!loading&&!readError&&<div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1">
          Tổng: <strong className="text-foreground">{bank.length}</strong>
        </span>
        <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-success">
          Đã duyệt: <strong>{approvedCount}</strong>
        </span>
        <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-warning">
          Nháp: <strong>{bank.length - approvedCount}</strong>
        </span>
      </div>}

      {FEATURES.pokerIqRemoteQuestions ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-xs text-success">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Tính năng đang <strong>BẬT</strong>: các câu đã duyệt được trộn vào bài drill của người chơi (đè theo mã câu, các câu mới được thêm vào sau bộ mẫu sẵn có).</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Tính năng hiển thị câu tự soạn cho người chơi đang <strong>TẮT</strong>. Bạn vẫn soạn & duyệt trước được; khi sẵn sàng, bật cờ <code className="rounded bg-background/60 px-1">pokerIqRemoteQuestions</code> để người chơi nhận câu đã duyệt.</span>
        </div>
      )}

      {/* List */}
      {readError ? (
        <div role="alert" className="space-y-3 rounded-lg border border-border p-4 text-sm">
          <p>Chưa xác minh được bộ câu hỏi. Không thể lưu hoặc nhập câu mẫu trước khi tải lại thành công.</p>
          <Button variant="outline" onClick={()=>setReadAttempt(n=>n+1)}>Thử tải lại câu hỏi</Button>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : bank.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">Chưa có câu hỏi nào.</p>
          <p className="text-xs text-muted-foreground mt-1">Bấm “Câu hỏi mới” để soạn, hoặc “Nhập câu mẫu” để bắt đầu từ bộ 20 câu có sẵn.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {DRILL_CATEGORIES.filter((c) => bank.some((h) => h.category === c)).map((cat) => (
            <div key={cat} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">{CATEGORY_LABELS[cat]}</div>
              {bank.filter((h) => h.category === cat).map((h) => (
                <Card key={h.id} className="p-3 bg-background/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full border",
                            h.reviewStatus === "approved"
                              ? "bg-success/15 text-success border-success/30"
                              : "bg-warning/15 text-warning border-warning/30",
                          )}
                        >
                          {h.reviewStatus === "approved" ? "Đã duyệt" : "Nháp"}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted-foreground">{DIFFICULTY_LABELS[h.difficulty]}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted-foreground">{VILLAIN_LABELS[h.villainProfile]}</span>
                        <span className="text-[10px] text-muted-foreground">{h.heroHand} · {h.position} · {h.stackBb}BB · {h.options.length} phương án</span>
                      </div>
                      <p className="text-sm mt-1 line-clamp-2">{h.scenario}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={h.reviewStatus === "approved" ? "Chuyển về nháp" : "Duyệt"}
                        onClick={() => toggleApprove(h)}
                        disabled={saving}
                      >
                        {h.reviewStatus === "approved"
                          ? <X className="h-4 w-4 text-warning" />
                          : <Check className="h-4 w-4 text-success" />}
                      </Button>
                      <Button variant="ghost" size="icon" title="Sửa" onClick={() => openEdit(h)} disabled={saving}>
                        <Pencil className="h-4 w-4 text-primary" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Xoá" onClick={() => remove(h)} disabled={saving}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isNew ? "Câu hỏi mới" : "Sửa câu hỏi"}</DialogTitle></DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Nhóm</Label>
                <Select value={form.category} onValueChange={(v) => setF({ category: v as DrillCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DRILL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Độ khó</Label>
                <Select value={form.difficulty} onValueChange={(v) => setF({ difficulty: v as EditForm["difficulty"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["easy", "medium", "hard"] as const).map((d) => <SelectItem key={d} value={d}>{DIFFICULTY_LABELS[d]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Kiểu đối thủ</Label>
                <Select value={form.villainProfile} onValueChange={(v) => setF({ villainProfile: v as VillainProfile })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["aggro", "nit", "passive", "unknown"] as const).map((v) => <SelectItem key={v} value={v}>{VILLAIN_LABELS[v]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Độ tin cậy nội dung</Label>
                <Select value={form.contentConfidence} onValueChange={(v) => setF({ contentConfidence: v as ContentConfidence })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["low", "medium", "high"] as const).map((c) => <SelectItem key={c} value={c}>{CONFIDENCE_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Bài tẩy</Label><Input value={form.heroHand} onChange={(e) => setF({ heroHand: e.target.value })} placeholder="A♠ Q♠" /></div>
              <div><Label className="text-xs">Vị trí</Label><Input value={form.position} onChange={(e) => setF({ position: e.target.value })} placeholder="CO" /></div>
              <div><Label className="text-xs">Stack (BB)</Label><Input type="number" value={form.stackBb} onChange={(e) => setF({ stackBb: +e.target.value })} /></div>
            </div>

            <div>
              <Label className="text-xs">Tình huống</Label>
              <Textarea rows={2} value={form.scenario} onChange={(e) => setF({ scenario: e.target.value })} placeholder="Bạn open 2.2BB ở CO, BTN (aggro) 3-bet lên 8BB…" />
            </div>

            {/* Options */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Phương án &amp; điểm (0–100)</Label>
                <Button size="sm" variant="outline" onClick={addOption} disabled={form.options.length >= OPTION_LETTERS.length} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" />Thêm
                </Button>
              </div>
              {form.options.map((o) => (
                <div key={o.id} className="rounded-lg border border-border bg-background/40 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold uppercase text-primary">{o.id}</span>
                    <Input className="h-8 text-sm" placeholder="Nhãn phương án (vd: Call)" value={o.label} onChange={(e) => updateOption(o.id, { label: e.target.value })} />
                    <Input className="h-8 w-20 text-sm" type="number" min={0} max={100} value={o.score} onChange={(e) => updateOption(o.id, { score: +e.target.value })} />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={form.options.length <= 2} onClick={() => removeOption(o.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 pl-7">
                    {LEAK_TAGS.map((lt) => {
                      const on = o.leaks.includes(lt.value);
                      return (
                        <button
                          key={lt.value}
                          type="button"
                          onClick={() => toggleLeak(o.id, lt.value)}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full border transition-colors",
                            on ? "bg-destructive/15 text-destructive border-destructive/40" : "border-border text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          {on ? "✓ " : ""}{lt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">Gắn “lỗi” (leak) cho phương án kém để hệ thống nhận diện điểm yếu của người chơi.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Phương án nên dùng (baseline)</Label>
                <Select value={form.preferredBaseline} onValueChange={(v) => setF({ preferredBaseline: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {form.options.map((o) => <SelectItem key={o.id} value={o.id}>{o.id.toUpperCase()} — {o.label || "(chưa đặt tên)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Trạng thái</Label>
                <Select value={form.reviewStatus} onValueChange={(v) => setF({ reviewStatus: v as ReviewStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Nháp</SelectItem>
                    <SelectItem value="approved">Đã duyệt (hiển thị cho người chơi)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Phương án cũng chấp nhận được (tuỳ chọn)</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {form.options.filter((o) => o.id !== form.preferredBaseline).map((o) => {
                  const on = form.acceptableAlternatives.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleAlt(o.id)}
                      className={cn(
                        "text-xs px-2 py-1 rounded-full border transition-colors",
                        on ? "bg-primary/15 text-primary border-primary/40" : "border-border text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {on ? "✓ " : ""}{o.id.toUpperCase()} — {o.label || "(chưa đặt tên)"}
                    </button>
                  );
                })}
                {form.options.length <= 1 && <span className="text-xs text-muted-foreground">Thêm phương án để chọn.</span>}
              </div>
            </div>

            <div>
              <Label className="text-xs">Giải thích</Label>
              <Textarea rows={2} value={form.explanation} onChange={(e) => setF({ explanation: e.target.value })} placeholder="Trong đa số tình huống mặc định, …" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Dùng “trong đa số tình huống mặc định”, tránh “đáp án đúng”.</p>
            </div>

            <div>
              <Label className="text-xs">Ghi chú nguồn (provenance)</Label>
              <Textarea rows={2} value={form.provenanceNote} onChange={(e) => setF({ provenanceNote: e.target.value })} placeholder="Vì sao baseline này được chọn — căn cứ review." />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Huỷ</Button>
            <Button onClick={submit} disabled={saving} className="gradient-neon text-primary-foreground border-0">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Lưu câu hỏi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
