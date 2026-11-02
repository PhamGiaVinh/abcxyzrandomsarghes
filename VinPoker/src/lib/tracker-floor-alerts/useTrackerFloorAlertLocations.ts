import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

type AlertLocation = { physical_table_id: string; hand_id: string | null };
export type FloorAlertLocation = { tableNumber?: number; handNumber?: number; handStatus?: string; handVoided?: boolean; unavailable?: boolean };

export function useTrackerFloorAlertLocations(client: SupabaseClient, alerts: readonly AlertLocation[]) {
  const [locations, setLocations] = useState<Record<string, FloorAlertLocation>>({});
  const tableIds = [...new Set(alerts.map((alert) => alert.physical_table_id))].sort().join(",");
  const handIds = [...new Set(alerts.map((alert) => alert.hand_id).filter((id): id is string => !!id))].sort().join(",");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLocations({});
    if (!tableIds) {
      return;
    }
    const load = async () => {
     try {
      const [tables, hands] = await observeTrackerContextRead(Promise.all([
        client.from("game_tables").select("id,table_number").in("id", tableIds.split(",")).abortSignal(controller.signal),
        handIds
          ? client.from("tournament_hands").select("id,hand_number,status,is_voided").in("id", handIds.split(",")).abortSignal(controller.signal)
          : Promise.resolve({ data: [], error: null }),
      ]));
      if (!active) return;
      if (tables.error || hands.error || !Array.isArray(tables.data) || !Array.isArray(hands.data)) throw new Error("floor_location_unavailable");
      const tableNumbers = new Map((tables.data ?? []).map((row) => [row.id, row.table_number]));
      const handRows = new Map((hands.data ?? []).map((row) => [row.id, row]));
      const next: Record<string, FloorAlertLocation> = {};
      for (const alert of alerts) {
        const number = tableNumbers.get(alert.physical_table_id);
        const hand = alert.hand_id ? handRows.get(alert.hand_id) : null;
        if (!Number.isSafeInteger(number) || Number(number) < 1 || (alert.hand_id && (!hand
          || !Number.isSafeInteger(hand.hand_number) || hand.hand_number < 1
          || typeof hand.status !== "string" || typeof hand.is_voided !== "boolean"))) {
          next[alert.physical_table_id + ":" + (alert.hand_id ?? "")] = { unavailable: true };
          continue;
        }
        next[alert.physical_table_id + ":" + (alert.hand_id ?? "")] = {
          tableNumber: tableNumbers.get(alert.physical_table_id) ?? undefined,
          handNumber: alert.hand_id ? handRows.get(alert.hand_id)?.hand_number ?? undefined : undefined,
          handStatus: alert.hand_id ? handRows.get(alert.hand_id)?.status ?? undefined : undefined,
          handVoided: alert.hand_id ? handRows.get(alert.hand_id)?.is_voided === true : undefined,
        };
      }
      setLocations(next);
     } catch {
      if (active) setLocations(Object.fromEntries(alerts.map(alert => [alert.physical_table_id + ":" + (alert.hand_id ?? ""), { unavailable: true }])));
     } finally { controller.abort(); }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [client, tableIds, handIds, alerts]);

  return (alert: AlertLocation) => locations[alert.physical_table_id + ":" + (alert.hand_id ?? "")];
}
