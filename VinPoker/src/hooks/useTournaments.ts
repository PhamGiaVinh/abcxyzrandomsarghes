// ═══════════════════════════════════════════════════════════════════════════════
// hooks/useTournaments.ts — Tournament CRUD with React Query
// ═══════════════════════════════════════════════════════════════════════════════

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { withTournamentCreateLiveStatus } from "@/lib/tournamentCreateCompatibility";
import type { Tournament, TournamentWithTables } from "@/types/tournament";

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
      const { table_ids, ...tournamentData } = input;

      // 1. Create tournament
      const { data: tournament, error: tournamentError } = await supabase
        .from("tournaments")
        .insert(withTournamentCreateLiveStatus({
          ...tournamentData,
          warn_at_minutes: input.warn_at_minutes ?? 5,
          crit_at_minutes: input.crit_at_minutes ?? 2,
        }))
        .select()
        .single();

      if (tournamentError) throw tournamentError;

      // 2. Link tables
      if (table_ids.length > 0) {
        // Remove existing links first (table can only belong to 1 tournament)
        await supabase
          .from("tournament_tables")
          .delete()
          .in("table_id", table_ids);

        // Create new links
        const { error: linkError } = await supabase
          .from("tournament_tables")
          .insert(
            table_ids.map((table_id) => ({
              tournament_id: tournament.id,
              table_id,
            }))
          );

        if (linkError) throw linkError;
      }

      return tournament;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tournaments", variables.club_id],
      });
    },
  });
}

// ─── Update tournament ──────────────────────────────────────────────────────

export interface UpdateTournamentInput {
  id: string;
  club_id: string;
  name?: string;
  description?: string;
  swing_duration_minutes?: number;
  warn_at_minutes?: number;
  crit_at_minutes?: number;
  status?: "active" | "completed" | "cancelled";
  table_ids?: string[];
}

export function useUpdateTournament() {
  const supabase = useSupabaseClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTournamentInput) => {
      const { id, club_id, table_ids, ...updateData } = input;

      // 1. Update tournament
      const { data: tournament, error: tournamentError } = await supabase
        .from("tournaments")
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (tournamentError) throw tournamentError;

      // 2. Update table links if provided
      if (table_ids !== undefined) {
        // Remove all existing links
        await supabase
          .from("tournament_tables")
          .delete()
          .eq("tournament_id", id);

        // Create new links
        if (table_ids.length > 0) {
          await supabase
            .from("tournament_tables")
            .delete()
            .in("table_id", table_ids);

          const { error: linkError } = await supabase
            .from("tournament_tables")
            .insert(
              table_ids.map((table_id) => ({
                tournament_id: id,
                table_id,
              }))
            );

          if (linkError) throw linkError;
        }
      }

      return tournament;
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
    mutationFn: async ({ id, club_id }: { id: string; club_id: string }) => {
      const { data, error } = await supabase.rpc("ops_delete_tournament_safe", {
        p_tournament_id: id,
        p_reason: "tournament_hook_delete",
      });
      if (error) throw error;
      const result = data as { ok?: boolean; error?: string } | null;
      if (result?.ok === false) throw new Error(result.error ?? "tournament_delete_failed");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["tournaments", variables.club_id],
      });
    },
  });
}
