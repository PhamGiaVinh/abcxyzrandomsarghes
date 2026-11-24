import { supabase } from "@/integrations/supabase/client";

/** Select before LIMIT: a table with no hand must never inherit another table's hand. */
export function loadLatestLiveHand(tournamentId: string, tableId: string | null) {
  let query = supabase.from("tournament_hands")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("is_voided", false);
  if (tableId) query = query.eq("table_id", tableId);
  return query.order("created_at", { ascending: false }).limit(1);
}
