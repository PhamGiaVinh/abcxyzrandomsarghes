import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

interface Props {
  playerId: string | null;
  playerName?: string;
  avatarUrl?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const fmt = (n: number) =>
  "₫" + Math.round(n).toLocaleString("vi-VN");

const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}₫${(abs / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")} tỷ`;
  if (abs >= 1_000_000) return `${sign}₫${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")} tr`;
  if (abs >= 1_000) return `${sign}₫${(abs / 1_000).toFixed(0)}k`;
  return `${sign}₫${abs}`;
};

export default function PlayerHistoryDialog(props: Props) {
  return <ScopedPlayerHistoryDialog key={JSON.stringify([props.playerId,props.open])} {...props} />;
}

function ScopedPlayerHistoryDialog({ playerId, playerName, avatarUrl, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let active=true;
    const controller=new AbortController();
    setRows([]);setLoading(true);setReadError(false);
    if (!open || !playerId) {setLoading(false);setReadError(true);return ()=>controller.abort();}
    const load=async()=>{try {
    const {data,error}=await observeTrackerContextRead(supabase
      .from("player_results")
      .select("*")
      .eq("player_id", playerId)
      .eq("verified_by_admin", true)
      .order("event_date", { ascending: false }).abortSignal(controller.signal));
    if(!active)return;
    if(error||!Array.isArray(data)||data.some(row=>!row||row.player_id!==playerId||row.verified_by_admin!==true
      || typeof row.id!=="string" || !row.id.trim()
      || (row.tournament_name!=null&&typeof row.tournament_name!=="string")
      || (row.event_date!=null&&typeof row.event_date!=="string")))throw new Error("player_history_unverified");
    setRows(data);
    }catch{if(active)setReadError(true);}finally{controller.abort();if(active)setLoading(false);}};
    void load();
    return ()=>{active=false;controller.abort();};
  }, [open, playerId,readAttempt]);

  const totalPrize = rows.reduce((s, r) => s + Number(r.prize || 0), 0);
  const totalBuyIn = rows.reduce((s, r) => s + Number(r.buy_in || 0), 0);
  const profit = totalPrize - totalBuyIn;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto w-[calc(100vw-1rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {avatarUrl && (
              <img src={avatarUrl} alt={playerName} className="w-10 h-10 rounded-full object-cover border border-border" />
            )}
            <span className="truncate">{playerName || t("playerHistory.playerFallback")}</span>
          </DialogTitle>
        </DialogHeader>

        {!loading&&!readError&&<div className="grid grid-cols-3 gap-2 my-3">
          <div className="rounded-md border border-border p-2 text-center min-w-0">
            <div className="text-[10px] sm:text-xs text-muted-foreground">{t("playerHistory.prizeCount")}</div>
            <div className="font-display text-primary text-base sm:text-lg tabular-nums">{rows.length}</div>
          </div>
          <div className="rounded-md border border-border p-2 text-center min-w-0">
            <div className="text-[10px] sm:text-xs text-muted-foreground">{t("playerHistory.totalCashout")}</div>
            <div className="font-display text-gold text-sm sm:text-lg tabular-nums truncate">
              <span className="sm:hidden">{fmtShort(totalPrize)}</span>
              <span className="hidden sm:inline">{fmt(totalPrize)}</span>
            </div>
          </div>
          <div className="rounded-md border border-border p-2 text-center min-w-0">
            <div className="text-[10px] sm:text-xs text-muted-foreground">{t("playerHistory.profitLoss")}</div>
            <div className={`font-display text-sm sm:text-lg tabular-nums truncate ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
              <span className="sm:hidden">{fmtShort(profit)}</span>
              <span className="hidden sm:inline">{fmt(profit)}</span>
            </div>
          </div>
        </div>}

        {loading ? (
          <div role="status" aria-label={t("playerHistory.loading")} className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : readError ? <div className="space-y-3 py-8 text-center"><p role="alert">{t("playerHistory.loadError")}</p><Button type="button" variant="outline" className="min-h-11" onClick={()=>setReadAttempt(value=>value+1)}>{t("playerHistory.retry")}</Button></div> : rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">{t("playerHistory.noVerifiedResults")}</div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3 bg-card/50">
                  <div className="text-sm font-semibold leading-tight break-words">
                    {r.tournament_name || "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {r.event_date} {r.position != null && <>· {t("playerHistory.rank")} <span className="text-foreground font-medium">{r.position}</span></>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("playerHistory.buyIn")}</div>
                      <div className="tabular-nums">{fmt(Number(r.buy_in || 0))}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("playerHistory.winnings")}</div>
                      <div className="tabular-nums text-gold font-semibold">{fmt(Number(r.prize || 0))}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("playerHistory.date")}</TableHead>
                    <TableHead>{t("playerHistory.tournament")}</TableHead>
                    <TableHead className="text-right">{t("playerHistory.rank")}</TableHead>
                    <TableHead className="text-right">{t("playerHistory.buyIn")}</TableHead>
                    <TableHead className="text-right">{t("playerHistory.winnings")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{r.event_date}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{r.tournament_name}</TableCell>
                      <TableCell className="text-right">{r.position ?? "-"}</TableCell>
                      <TableCell className="text-right">{fmt(Number(r.buy_in || 0))}</TableCell>
                      <TableCell className="text-right text-gold">{fmt(Number(r.prize || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
