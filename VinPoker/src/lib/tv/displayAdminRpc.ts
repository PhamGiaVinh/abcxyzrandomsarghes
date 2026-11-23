import { supabase } from "@/integrations/supabase/client";
import { createTvDisplayAdmin } from "./displayAdminService";
export { displayLabel, isDisplayOnline, type TvDisplayLayout, type TvDisplayRow, type TvDisplayStatusRow } from "./displayAdminService";

export const { listClubDisplays, claimDisplay, revokeDisplay, updateDisplay, pingDisplay } = createTvDisplayAdmin(supabase);
