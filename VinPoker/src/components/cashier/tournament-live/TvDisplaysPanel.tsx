import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useLiveClock } from "@/hooks/useLiveClock";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Tv, RefreshCw, Copy, QrCode, Pencil, Trash2, Plus, Wifi, WifiOff, ExternalLink,
} from "lucide-react";
import {
  claimDisplay, displayLabel, isDisplayOnline, listClubDisplays, pingDisplay,
  revokeDisplay, updateDisplay, type TvDisplayLayout, type TvDisplayRow,
} from "@/lib/tv/displayAdminRpc";
import { createRequestGenerationFence } from "@/lib/tv/requestGenerationFence";
import { TvLivePreviewCard } from "./TvLivePreviewCard";
import { TvBrandingEditor } from "./TvBrandingEditor";

interface TvDisplaysPanelProps {
  tournamentId: string;
  tournamentName: string;
  clubId: string;
  /** Parent's tournament list — used to populate the assign-tournament select. */
  tournaments: { id: string; name: string; club_id: string; status: string }[];
}

const LAYOUTS: TvDisplayLayout[] = ["clock", "break_screen", "announcement", "payouts", "multi_board"];

function displayUrl(token: string): string {
  return `${window.location.origin}/display/${token}`;
}

export function TvDisplaysPanel({ tournamentId, tournamentName, clubId, tournaments }: TvDisplaysPanelProps) {
  const { t } = useTranslation();
  const [displays, setDisplays] = useState<TvDisplayRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [code, setCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");
  const [claiming, setClaiming] = useState(false);

  const [editRow, setEditRow] = useState<TvDisplayRow | null>(null);
  const [qrRow, setQrRow] = useState<TvDisplayRow | null>(null);
  const [revokeRow, setRevokeRow] = useState<TvDisplayRow | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const loadFenceRef = useRef(createRequestGenerationFence());
  const nowMs = useLiveClock(); // 1s tick → recompute online dots from last_seen_at

  // Tournaments in this club, for the assign select.
  const clubTournaments = useMemo(
    () => tournaments.filter((tour) => tour.club_id === clubId),
    [tournaments, clubId],
  );

  const load = useCallback(async () => {
    const requestGeneration = loadFenceRef.current.begin();
    setRefreshing(true);
    const { data, error } = await listClubDisplays(clubId);
    if (!loadFenceRef.current.isCurrent(requestGeneration)) return;
    if (error) {
      setLoadError(error);
    } else {
      setLoadError(null);
      setDisplays(data);
    }
    setRefreshing(false);
  }, [clubId]);

  useEffect(() => {
    void load();
    return () => loadFenceRef.current.invalidate();
  }, [load]);

  // Realtime: new claims / heartbeats / config changes on this club's displays.
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`tv-displays:${clubId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tv_displays", filter: `club_id=eq.${clubId}` },
        () => { void load(); },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [clubId, load]);

  const handleClaim = async () => {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      toast.error(t("tournamentLive.tvDisplays.codeFormat"));
      return;
    }
    setClaiming(true);
    const { error, payloadError } = await claimDisplay(trimmed, clubId, newName.trim(), newZone.trim());
    setClaiming(false);
    if (error || payloadError) {
      const key = payloadError ? `tournamentLive.tvDisplays.claimErr.${payloadError}` : "";
      const msg = payloadError ? t(key) : error;
      toast.error(msg && msg !== key ? msg : t("tournamentLive.tvDisplays.claimFailed"));
      return;
    }
    toast.success(t("tournamentLive.tvDisplays.claimed"));
    setCode(""); setNewName(""); setNewZone("");
    void load();
  };

  // Optimistic patch + broadcast ping so the TV switches within seconds.
  const patchDisplay = async (row: TvDisplayRow, patch: Partial<TvDisplayRow>) => {
    setDisplays((prev) => prev?.map((d) => (d.id === row.id ? { ...d, ...patch } : d)) ?? prev);
    const { data, error } = await updateDisplay(row, patch);
    if (error) {
      toast.error(error);
      void load();
      return;
    }
    if (data) {
      setDisplays((prev) => prev?.map((display) => (display.id === data.id ? data : display)) ?? prev);
    }
    void pingDisplay(row.id);
  };

  const handleAssign = (row: TvDisplayRow, value: string) => {
    const assigned = value === "none" ? null : value;
    void patchDisplay(row, { assigned_tournament_id: assigned });
  };

  const handleRevoke = async () => {
    if (!revokeRow) return;
    const { error, payloadError } = await revokeDisplay(revokeRow.id);
    setRevokeRow(null);
    if (error || payloadError) {
      toast.error(error || payloadError || t("tournamentLive.tvDisplays.revokeFailed"));
      return;
    }
    toast.success(t("tournamentLive.tvDisplays.revoked"));
    void load();
  };

  const copyLink = async (row: TvDisplayRow) => {
    try {
      await navigator.clipboard.writeText(displayUrl(row.display_token));
      toast.success(t("tournamentLive.tvDisplays.linkCopied"));
    } catch {
      toast.error(t("tournamentLive.tvDisplays.copyFailed"));
    }
  };

  return (
    <div className="space-y-4">
      {/* The layout is shared by this tournament or its parent Main Event. */}
      <TvLivePreviewCard tournamentId={tournamentId} action={<TvBrandingEditor tournamentId={tournamentId} />} />

      {/* Pair a new TV */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="w-4 h-4 text-emerald-400" />
          {t("tournamentLive.tvDisplays.pairTitle")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("tournamentLive.tvDisplays.pairHint")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.code")}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="tracking-[0.3em] text-center font-mono text-lg"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.name")}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="TV 1" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.zone")}</Label>
            <Input value={newZone} onChange={(e) => setNewZone(e.target.value)} placeholder={t("tournamentLive.tvDisplays.zonePlaceholder")} />
          </div>
          <Button onClick={handleClaim} disabled={claiming || code.length !== 6}>
            {claiming ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Tv className="w-4 h-4 mr-1" />}
            {t("tournamentLive.tvDisplays.pairButton")}
          </Button>
        </div>
      </Card>

      {/* Display list */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-muted-foreground">
          {t("tournamentLive.tvDisplays.listTitle")}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
          {t("tournamentLive.tvDisplays.refresh")}
        </Button>
      </div>

      {loadError ? (
        <Card role="alert" className="p-6 text-center text-sm text-muted-foreground">{loadError}</Card>
      ) : displays === null ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : displays.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Tv className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {t("tournamentLive.tvDisplays.empty")}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {displays.map((row) => {
            const online = isDisplayOnline(row.last_seen_at, nowMs);
            const assignedHere = row.assigned_tournament_id === tournamentId;
            return (
              <Card key={row.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Tv className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-semibold truncate">{displayLabel(row)}</span>
                    </div>
                    {row.zone && <div className="text-xs text-muted-foreground truncate">{row.zone}</div>}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border shrink-0 ${
                      online
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {online ? t("tournamentLive.tvDisplays.online") : t("tournamentLive.tvDisplays.offline")}
                  </span>
                </div>

                {/* Assign tournament */}
                <div className="space-y-1">
                  <Label className="text-[11px]">{t("tournamentLive.tvDisplays.assigned")}</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={row.assigned_tournament_id ?? "none"}
                      onValueChange={(v) => handleAssign(row, v)}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("tournamentLive.tvDisplays.noTournament")}</SelectItem>
                        {clubTournaments.map((tour) => (
                          <SelectItem key={tour.id} value={tour.id}>{tour.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!assignedHere && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleAssign(row, tournamentId)}
                        title={tournamentName}
                      >
                        {t("tournamentLive.tvDisplays.assignThis")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => copyLink(row)}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> {t("tournamentLive.tvDisplays.copyLink")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setQrRow(row)}>
                    <QrCode className="w-3.5 h-3.5 mr-1" /> QR
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditRow(row)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> {t("tournamentLive.tvDisplays.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRevokeRow(row)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> {t("tournamentLive.tvDisplays.revoke")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {qrRow && (
        <Dialog open onOpenChange={(o) => !o && setQrRow(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{displayLabel(qrRow)}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="bg-white p-4 rounded-lg">
                <QRCodeSVG value={displayUrl(qrRow.display_token)} size={220} level="M" />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {t("tournamentLive.tvDisplays.qrHint")}
              </p>
              <a
                href={displayUrl(qrRow.display_token)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-400 inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> {t("tournamentLive.tvDisplays.openDisplay")}
              </a>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {editRow && (
        <EditDisplayDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSave={async (patch) => {
            await patchDisplay(editRow, patch);
            setEditRow(null);
          }}
        />
      )}

      <AlertDialog open={!!revokeRow} onOpenChange={(o) => !o && setRevokeRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tournamentLive.tvDisplays.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tournamentLive.tvDisplays.revokeConfirm", { name: revokeRow ? displayLabel(revokeRow) : "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("tournamentLive.tvDisplays.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditDisplayDialog({
  row,
  onClose,
  onSave,
}: {
  row: TvDisplayRow;
  onClose: () => void;
  onSave: (patch: Partial<TvDisplayRow>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(row.name ?? "");
  const [zone, setZone] = useState(row.zone ?? "");
  const [layout, setLayout] = useState<TvDisplayLayout>(row.layout);
  const [announcement, setAnnouncement] = useState(row.announcement ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave({
      name: name.trim() || null,
      zone: zone.trim() || null,
      layout,
      announcement: announcement.trim() || null,
    });
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("tournamentLive.tvDisplays.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="TV 1" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.zone")}</Label>
            <Input value={zone} onChange={(e) => setZone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">{t("tournamentLive.tvDisplays.layout")}</Label>
            <Select value={layout} onValueChange={(v) => setLayout(v as TvDisplayLayout)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LAYOUTS.map((l) => (
                  <SelectItem key={l} value={l}>{t(`tournamentLive.tvDisplays.layouts.${l}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">{t("tournamentLive.tvDisplays.layoutNote")}</p>
          </div>
          {layout === "announcement" && (
            <div className="space-y-1">
              <Label className="text-[11px]">{t("tournamentLive.tvDisplays.announcement")}</Label>
              <Textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} rows={3} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
