import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";

export interface DealerTableArrival {
  assignment_id: string;
  table_session_id: string;
  table_name: string;
  acknowledged_at: string | null;
  attendance_id: string;
  dispatch_at: string;
  incoming: boolean;
}

// Additive RPCs are pending generated type refresh, like the roster RPCs.
const db = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export function useTableArrival(dealerId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const live = dealerDataSource() === "live";
  const key = ["dealerTableArrival", user?.id, dealerId] as const;
  const query = useQuery({
    queryKey: key,
    enabled: live && !!user && !!dealerId,
    refetchInterval: 5_000,
    queryFn: async (): Promise<DealerTableArrival[]> => {
      const { data, error } = await db.rpc("dealer_get_table_arrivals_v1", { p_dealer_id: dealerId });
      if (error) throw error;
      if (!Array.isArray(data) || data.some((row) => !row || typeof row.assignment_id !== "string"
        || typeof row.table_session_id !== "string" || typeof row.table_name !== "string"
        || typeof row.attendance_id !== "string" || typeof row.dispatch_at !== "string"
        || typeof row.incoming !== "boolean"
        || !(row.acknowledged_at === null || typeof row.acknowledged_at === "string"))) {
        throw new Error("Invalid dealer arrival response");
      }
      return data as DealerTableArrival[];
    },
  });
  const acknowledge = useMutation({
    mutationFn: async (arrival: DealerTableArrival) => {
      if (!live || !user || !dealerId) throw new Error("Live dealer required");
      const { data, error } = await db.rpc("dealer_ack_table_arrival_v1", {
        p_assignment_id: arrival.assignment_id,
        p_table_session_id: arrival.table_session_id,
        p_attendance_id: arrival.attendance_id,
        p_dispatch_at: arrival.dispatch_at,
      });
      if (error) throw error;
      const ack = data as Partial<DealerTableArrival> | null;
      if (ack?.assignment_id !== arrival.assignment_id || ack.table_session_id !== arrival.table_session_id
        || ack.attendance_id !== arrival.attendance_id || ack.dispatch_at !== arrival.dispatch_at
        || typeof ack.acknowledged_at !== "string") throw new Error("Invalid arrival acknowledgement");
      return ack;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return { live, query, acknowledge };
}
