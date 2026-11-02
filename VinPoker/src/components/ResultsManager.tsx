import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ProofUploader } from "./ProofUploader";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
type ReadableResult = Pick<Tables<"player_results">,
  "id" | "tournament_name" | "event_date" | "buy_in" | "prize" | "venue" |
  "position" | "total_entries" | "proof_url" | "verified_by_admin">;

function isReadableResult(value: unknown): value is ReadableResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["id", "tournament_name", "event_date"].every(key => typeof row[key] === "string")
    && ["buy_in", "prize"].every(key => typeof row[key] === "number" && Number.isFinite(row[key]))
    && ["venue", "proof_url"].every(key => row[key] === null || typeof row[key] === "string")
    && ["position", "total_entries"].every(key => row[key] === null || (typeof row[key] === "number" && Number.isFinite(row[key])))
    && typeof row.verified_by_admin === "boolean";
}

export const ResultsManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [results, setResults] = useState<ReadableResult[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(initial());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);

  function initial() {
    return {
      tournament_name: "",
      venue: "",
      event_date: new Date().toISOString().slice(0, 10),
      buy_in: 0,
      prize: 0,
      position: "",
      total_entries: "",
      proof_url: null as string | null,
    };
  }

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setReadError(false);
    try {
      const { data, error } = await supabase
        .from("player_results")
        .select("*")
        .eq("player_id", user.id)
        .order("event_date", { ascending: false });
      if (error || !Array.isArray(data) || !data.every(isReadableResult)) throw new Error("RESULTS_READ_FAILED");
      setResults(data);
    } catch {
      setReadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const submit = async () => {
    if (!user) return;
    if (!form.tournament_name.trim() || !form.event_date) {
      toast.error(t("results.needNameDate"));
      return;
    }
    if (!form.proof_url) {
      toast.error("Bắt buộc tải ảnh chứng minh kết quả");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("player_results").insert({
      player_id: user.id,
      tournament_name: form.tournament_name.trim(),
      venue: form.venue.trim() || null,
      event_date: form.event_date,
      buy_in: Number(form.buy_in) || 0,
      prize: Number(form.prize) || 0,
      position: form.position ? Number(form.position) : null,
      total_entries: form.total_entries ? Number(form.total_entries) : null,
      proof_url: form.proof_url,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("results.added"));
    setOpen(false);
    setForm(initial());
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("results.confirmDelete"))) return;
    const { error } = await supabase.from("player_results").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("results.deleted")); load(); }
  };

  return (
    <Card className="p-4 space-y-3 border-primary/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t("results.title")}</h3>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="w-3 h-3 mr-1" /> {t("results.add")}
        </Button>
      </div>

      {loading ? (
        <p role="status" className="text-xs text-muted-foreground py-3 text-center">Đang tải kết quả…</p>
      ) : readError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Không tải được kết quả. Hãy thử lại.</p>
          <Button size="sm" variant="outline" onClick={() => { void load(); }}>Thử tải lại</Button>
        </div>
      ) : results.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">{t("results.empty")}</p>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const profit = r.prize - r.buy_in;
            return (
              <div key={r.id} className="rounded-lg border border-border/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{r.tournament_name}</span>
                      {r.verified_by_admin && (
                        <Badge className="bg-[hsl(var(--ds-active)_/_0.2)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.4)] text-[10px]">
                          <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> {t("results.verified")}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(r.event_date).toLocaleDateString("vi-VN")}
                      {r.venue && ` • ${r.venue}`}
                      {r.position && ` • ${t("results.rank")} ${r.position}${r.total_entries ? `/${r.total_entries}` : ""}`}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
                      <span className="text-muted-foreground">{t("results.buyIn")} <span className="text-foreground">{fmt(r.buy_in)}</span></span>
                      <span className="text-muted-foreground">{t("results.prize")} <span className="text-foreground">{fmt(r.prize)}</span></span>
                      <span className={`font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                        {profit >= 0 ? "+" : ""}{fmt(profit)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.proof_url && (
                      <a href={r.proof_url} target="_blank" rel="noreferrer">
                        <img src={r.proof_url} alt="proof" className="h-12 w-12 object-cover rounded border border-border" />
                      </a>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(r.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("results.addDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t("results.tournamentName")}>
              <Input value={form.tournament_name} onChange={(e) => setForm({ ...form, tournament_name: e.target.value })} />
            </Field>
            <Field label={t("results.venue")}>
              <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
            </Field>
            <Field label={t("results.date")}>
              <Input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("results.buyInVnd")}>
                <Input type="number" value={form.buy_in} onChange={(e) => setForm({ ...form, buy_in: e.target.value })} />
              </Field>
              <Field label={t("results.prizeVnd")}>
                <Input type="number" value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} />
              </Field>
              <Field label={t("results.position")}>
                <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </Field>
              <Field label={t("results.totalEntries")}>
                <Input type="number" value={form.total_entries} onChange={(e) => setForm({ ...form, total_entries: e.target.value })} />
              </Field>
            </div>
            <Field label={t("results.proof") + " *"}>
              <ProofUploader folder="results" value={form.proof_url} onChange={(url) => setForm({ ...form, proof_url: url })} required />
            </Field>
            <Button onClick={submit} disabled={saving || !form.proof_url} className="w-full">
              {saving ? t("results.saving") : t("results.submit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    {children}
  </div>
);
