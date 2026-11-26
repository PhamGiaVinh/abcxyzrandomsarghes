import { supabase } from "@/integrations/supabase/client";
import * as admin from "@/lib/tv/displayAdminRpc";
import { TvDisplayManagement, type TvDisplaysPanelProps } from "./TvDisplayManagement";
import { TvLivePreviewCard } from "./TvLivePreviewCard";
import { TvBrandingEditor } from "./TvBrandingEditor";

export function TvDisplaysPanel(props: TvDisplaysPanelProps) {
  return <div className="space-y-4">
    <TvLivePreviewCard tournamentId={props.tournamentId} action={<TvBrandingEditor tournamentId={props.tournamentId} />} />
    <TvDisplayManagement key={props.clubId} {...props} client={supabase} admin={admin} />
  </div>;
}
