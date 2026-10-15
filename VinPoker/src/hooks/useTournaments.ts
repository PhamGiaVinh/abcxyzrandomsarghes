// ═══════════════════════════════════════════════════════════════════════════════
// hooks/useTournaments.ts — Tournament CRUD with React Query
// ═══════════════════════════════════════════════════════════════════════════════

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { saveTournamentConfig, recoverTournamentConfigSave, type TournamentConfigRpc, type TournamentConfigSaveRequest } from "@/lib/tournamentConfigSave";
import type { Tournament, TournamentWithTables } from "@/types/tournament";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from '@/lib/floorTableControlV3';
import { assertTournamentDeleted } from '@/lib/tournamentDeleteResult';

export function useTournamentConfigTableInventory(clubId: string, actorId: string | undefined) {
  const supabase = useSupabaseClient();
  return useQuery({
    queryKey: ['tournament-config-inventory', actorId, clubId],
    enabled: !!clubId && !!actorId,
    queryFn: async () => {
      const client = createFloorTableControlV3Client(supabase.rpc.bind(supabase) as unknown as FloorTableControlV3Rpc);
      const result = await client.getClubTableInventory(clubId);
      if (result.ok === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 0,
    retry: false,
  });
}

// ─── Query key factory ──────────────────────────────────────────────────────

const tournamentKeys = {
  all: (clubId?: string) => ["tournaments", clubId] as const,
  active: (clubId?: string) => ["tournaments", clubId, "active"] as const,
};

// ─── Fetch all tournaments with tables ──────────────────────────────────────

export function useTournaments(clubId: string | undefined) {
  const supabase = useSupabaseClient();
  return useQuery({
    queryKey: tournamentKeys.all(clubId),
    queryFn: async () => {
      if (!clubId) return [];

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          `
          *,
          tournament_tables (
            id,
            table_id,
            game_table_id,
            table_session_id,
            status,
            canonical_game_table:game_tables!tournament_tables_game_table_id_v3_fkey (
              id,
              table_name
            ),
            game_tables!tournament_tables_table_id_fkey (
              id,
              table_name
            )
          )
        `
        )
        .eq("club_id", clubId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as TournamentWithTables[];
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Fetch active tournaments only ──────────────────────────────────────────

export function useActiveTournaments(clubId: string | undefined) {
  const supabase = useSupabaseClient();
  return useQuery({
    queryKey: tournamentKeys.active(clubId),
    queryFn: async () => {
      if (!clubId) return [];

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          `
          *,
          tournament_tables (
            id,
            table_id,
            game_table_id,
            table_session_id,
            status,
            canonical_game_table:game_tables!tournament_tables_game_table_id_v3_fkey (
              id,
              table_name
            ),
            game_tables!tournament_tables_table_id_fkey (
              id,
              table_name
            )
          ),
          tournament_levels (
            level_number,
            is_break
          )
        `
        )
        .eq("club_id", clubId)
        .in("status", ["active", "live", "break", "final_table"])
        .order("name");

      if (error) throw error;
      return (data ?? []) as unknown as TournamentWithTables[];
    },
    enabled: !!clubId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Create tournament ──────────────────────────────────────────────────────

export interface CreateTournamentInput {
  expected_actor_id: string;
  request_id: string;
  recover_only?: boolean;
  club_id: string;
  name: string;
  description?: string;
  swing_duration_minutes: number;
  warn_at_minutes?: number;
  crit_at_minutes?: number;
  table_ids: string[];
}

export function useCreateTournament() {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTournamentInput) => {
      const request = configRequest(input);
      // Fixed contract boundary until generated types include migration88.
      const rpc = supabase.rpc.bind(supabase) as unknown as TournamentConfigRpc;
      return input.recover_only ? recoverTournamentConfigSave(rpc, request) : saveTournamentConfig(rpc, request);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tournaments", variables.club_id],
      });
    },
  });
}

// ─── Update tournament ──────────────────────────────────────────────────────

export interface UpdateTournamentInput extends CreateTournamentInput {
  id: string;
  expected_updated_at: string;
  expected_active_table_ids: string[];
}

export function configRequest(input: CreateTournamentInput | UpdateTournamentInput): TournamentConfigSaveRequest {
  return {
    p_expected_actor_id: input.expected_actor_id,
    p_tournament_id: 'id' in input ? input.id : null,
    p_club_id: input.club_id,
    p_config: {name: input.name, description: input.description ?? null,
      swing_duration_minutes: input.swing_duration_minutes,
      warn_at_minutes: input.warn_at_minutes ?? 5, crit_at_minutes: input.crit_at_minutes ?? 2},
    p_table_ids: [...input.table_ids].sort(),
    p_expected_updated_at: 'id' in input ? input.expected_updated_at : null,
    p_expected_active_table_ids: 'id' in input ? [...input.expected_active_table_ids].sort() : [],
    p_request_id: input.request_id,
  };
}

export function useUpdateTournament() {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTournamentInput) => {
      const request = configRequest(input);
      const rpc = supabase.rpc.bind(supabase) as unknown as TournamentConfigRpc;
      return input.recover_only ? recoverTournamentConfigSave(rpc, request) : saveTournamentConfig(rpc, request);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tournaments", variables.club_id],
      });
    },
  });
}

// ─── Delete tournament ──────────────────────────────────────────────────────

export function useDeleteTournament() {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: async ({ id, club_id }: { id: string; club_id: string }) => {
      const { data, error } = await supabase.rpc("ops_delete_tournament_safe", {
        p_tournament_id: id,
        p_reason: "tournament_hook_delete",
      });
      if (error) throw error;
      assertTournamentDeleted(data, id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tournaments", variables.club_id],
      });
    },
  });
}
