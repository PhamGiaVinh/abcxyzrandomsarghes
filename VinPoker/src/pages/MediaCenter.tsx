import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Shield, Newspaper, Image as ImageIcon, Trophy, CalendarDays, LifeBuoy, Globe } from "lucide-react";
import { Loader2 } from "lucide-react";
import { BannersEditor, SeriesEditor } from "./SuperAdmin";
import { AdminSupportTab } from "@/components/admin/AdminSupportTab";
import { MediaClubSchedules } from "@/components/admin/MediaClubSchedules";
import { TournamentPhotosManager } from "@/components/admin/TournamentPhotosManager";
import News from "./News";
import InternationalEvents from "./InternationalEvents";
import { supabase } from "@/integrations/supabase/client";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { loadOpsCapabilities, type OpsRpcClient } from "@/ops/auth/opsCapabilityLoader";
import { Button } from "@/components/ui/button";

type MediaAccess = { actorKey: string; workspaceKey: string; canCms: boolean; hasPhotos: boolean };

function useMediaCenterAccess(actorId: string | null, epoch: number, disabled: boolean) {
  const actorKey = JSON.stringify([actorId, epoch]);
  const [snapshot, setSnapshot] = useState<MediaAccess | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!actorId || disabled) return;
    let alive = true, inFlight = false;
    let controller: AbortController | undefined;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      const current = new AbortController(); controller = current;
      const client: OpsRpcClient = { rpc: async (name, args) => await supabase.rpc(name as never, args as never).abortSignal(current.signal) };
      try {
        const [ops, media] = await observeTrackerContextRead(Promise.all([
          loadOpsCapabilities(client),
          supabase.from('user_roles').select('role').eq('user_id', actorId).eq('role', 'media').abortSignal(current.signal),
        ]));
        if (!alive) return;
        const roles: unknown = media.data;
        if (media.error || !Array.isArray(roles) || roles.length > 1 || roles.some(row => !row || typeof row !== 'object' || row.role !== 'media')) throw new Error('media_authority_unverified');
        const isGlobalMedia = roles.length === 1, isAdmin = ops.global.is_super_admin;
        const floorIds = ops.scope.filter(row => row.can_floor).map(row => row.club_id).sort();
        const next = { actorKey, workspaceKey: JSON.stringify([actorKey, isAdmin, isGlobalMedia, floorIds]), canCms: isAdmin || isGlobalMedia, hasPhotos: floorIds.length > 0 };
        setSnapshot(previous => previous?.workspaceKey === next.workspaceKey ? previous : next);
        setError(false);
      } catch {
        if (alive) { setSnapshot(null); setError(true); }
      } finally {
        current.abort(); inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 5000);
    return () => { alive = false; clearInterval(timer); controller?.abort(); };
  }, [actorId, actorKey, disabled, revision]);
  return { snapshot: !disabled && snapshot?.actorKey === actorKey ? snapshot : null, error: !disabled && error, retry: () => setRevision(value => value + 1) };
}

const MediaCenter = () => {
  const { t } = useTranslation();
  const { user, session, loading } = useAuth();
  const access = useMediaCenterAccess(user?.id ?? null, sessionReadEpoch(session), loading);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (access.error) return <Card role="alert" className="p-6 space-y-3"><p>Chưa xác minh được quyền Media hiện tại. Hãy thử lại trước khi thao tác.</p><Button variant="outline" onClick={access.retry}>Thử lại</Button></Card>;
  if (!access.snapshot) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  // Media/admin get the full CMS; a pure-floor user is allowed in for the photos tab only.
  if (!access.snapshot.canCms && !access.snapshot.hasPhotos) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">{t("mediaCenterPage.noPermissionTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("mediaCenterPage.noPermissionDesc")}</p>
    </Card>
  );

  // CMS (news/banners/series/etc.) is media/admin-only. Floor-only users see just "Ảnh giải đấu".
  const canCms = access.snapshot.canCms;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-[hsl(var(--ds-preassign))]" />
        <div>
          <h1 className="font-display text-2xl text-[hsl(var(--ds-preassign))]">{t("mediaCenterPage.heading")}</h1>
          <p className="text-xs text-muted-foreground">{t("mediaCenterPage.subtitle")}</p>
        </div>
      </div>

      <Tabs key={access.snapshot.workspaceKey} defaultValue={canCms ? "news" : "photos"}>
        <div className="overflow-x-auto -mx-2 px-2 pb-1">
          <TabsList className="inline-flex w-max min-w-full">
            {canCms && <TabsTrigger value="news" className="text-xs"><Newspaper className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabNews")}</TabsTrigger>}
            {canCms && <TabsTrigger value="banners" className="text-xs"><ImageIcon className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabBanners")}</TabsTrigger>}
            {canCms && <TabsTrigger value="series" className="text-xs"><Trophy className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSeries")}</TabsTrigger>}
            {canCms && <TabsTrigger value="international" className="text-xs"><Globe className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabInternational")}</TabsTrigger>}
            {canCms && <TabsTrigger value="schedules" className="text-xs"><CalendarDays className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSchedules")}</TabsTrigger>}
            <TabsTrigger value="photos" className="text-xs"><ImageIcon className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabPhotos", "Ảnh giải đấu")}</TabsTrigger>
            {canCms && <TabsTrigger value="support" className="text-xs"><LifeBuoy className="w-3.5 h-3.5 mr-1" />{t("mediaCenterPage.tabSupport")}</TabsTrigger>}
          </TabsList>
        </div>

        {canCms && <TabsContent value="news" className="mt-4"><News /></TabsContent>}
        {canCms && <TabsContent value="banners" className="mt-4"><BannersEditor /></TabsContent>}
        {canCms && <TabsContent value="series" className="mt-4"><SeriesEditor /></TabsContent>}
        {canCms && <TabsContent value="international" className="mt-4"><InternationalEvents /></TabsContent>}
        {canCms && <TabsContent value="schedules" className="mt-4"><MediaClubSchedules /></TabsContent>}
        <TabsContent value="photos" className="mt-4"><TournamentPhotosManager /></TabsContent>
        {canCms && <TabsContent value="support" className="mt-4"><AdminSupportTab /></TabsContent>}
      </Tabs>
    </div>
  );
};

export default MediaCenter;
