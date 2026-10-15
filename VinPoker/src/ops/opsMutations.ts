import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertTournamentDeleted } from "@/lib/tournamentDeleteResult";

export type OpsClient = SupabaseClient<Database>;

// Money/registration mutations are source-only until both preview gates are
// explicitly set. Production has no VITE_FLOOR_UAT_ENV=preview, so these stay
// disabled even when the UI bundle contains the code.
export const OPS_CASHIER_MUTATIONS_ENABLED =
  import.meta.env.VITE_OPS_CASHIER_MUTATIONS === "preview" &&
  import.meta.env.VITE_FLOOR_UAT_ENV === "preview";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function mutationError(error: unknown, data?: unknown): Error {
  const record = asRecord(data);
  const code = typeof record?.error === "string" ? record.error : null;
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error && typeof error.message === "string"
      ? error.message
      : null;
  return new Error(code ?? message ?? "Thao tác không thành công. Máy chủ không xác nhận kết quả.");
}

export function assertMutationOk(data: unknown, error?: unknown): JsonRecord {
  if (error) throw mutationError(error, data);
  const record = asRecord(data);
  if (record && record.ok === false) throw mutationError(null, record);
  if (record && (record.error || record.success === false)) throw mutationError(null, record);
  return record ?? {};
}

export async function createTournament(client: OpsClient, input: {
  clubId: string;
  name: string;
  startTime: string;
  buyIn: number;
  startingStack: number;
  minutesPerLevel: number;
  lateRegCloseLevel: number;
  gameType?: string;
  rakeAmount?: number;
  serviceFeeAmount?: number;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ops_create_tournament", {
    p_club_id: input.clubId,
    p_name: input.name.trim(),
    p_start_time: input.startTime,
    p_buy_in: input.buyIn,
    p_starting_stack: input.startingStack,
    p_minutes_per_level: input.minutesPerLevel,
    p_late_reg_close_level: input.lateRegCloseLevel,
    p_game_type: input.gameType ?? "nlh",
  });
  return assertMutationOk(data, error);
}

export async function updateTournament(client: OpsClient, tournamentId: string, patch: {
  name?: string;
  startTime?: string;
  buyIn?: number;
  startingStack?: number;
  minutesPerLevel?: number;
  lateRegCloseLevel?: number;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ops_update_tournament", {
    p_tournament_id: tournamentId,
    p_name: patch.name?.trim() ?? "",
    p_start_time: patch.startTime ?? "",
    p_buy_in: patch.buyIn ?? 0,
    p_starting_stack: patch.startingStack ?? 0,
    p_minutes_per_level: patch.minutesPerLevel ?? 0,
    p_late_reg_close_level: patch.lateRegCloseLevel ?? 0,
  });
  return assertMutationOk(data, error);
}

export async function updateTournamentLive(client: OpsClient, input: {
  tournamentId: string;
  status: string;
  playersRemaining: number;
  level: number;
  blinds?: string | null;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ops_update_tournament_live", {
    p_tournament_id: input.tournamentId,
    p_status: input.status,
    p_players_remaining: input.playersRemaining,
    p_level: input.level,
    p_blinds: input.blinds ?? null,
    p_reason: "ops_floor_live_update",
  });
  return assertMutationOk(data, error);
}

export async function closeTournament(client: OpsClient, tournamentId: string): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.rpc("close_tournament", {
    p_tournament_id: tournamentId,
    p_reason: "ops_floor_close",
  });
  return assertMutationOk(data, error);
}

export async function deleteTournament(client: OpsClient, tournamentId: string): Promise<JsonRecord> {
  const { data, error } = await client.rpc("ops_delete_tournament_safe", {
    p_tournament_id: tournamentId,
    p_reason: "ops_floor_delete",
  });
  if (error) throw mutationError(error, data);
  return assertTournamentDeleted(data, tournamentId);
}

export async function confirmRegistration(client: OpsClient, input: {
  registrationId: string;
  actorUserId: string;
  drawMode?: string;
}): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.rpc("confirm_registration_and_assign_seat", {
    p_registration_id: input.registrationId,
    p_actor_user_id: input.actorUserId,
    p_draw_mode: input.drawMode ?? "random_balanced",
  });
  return assertMutationOk(data, error);
}

export async function confirmOfflineBuyIn(client: OpsClient, input: {
  tournamentId: string;
  playerName: string;
  idempotencyKey: string;
  phone?: string;
}): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.rpc("ops_create_offline_buyin_and_seat", {
    p_tournament_id: input.tournamentId,
    p_player_name: input.playerName.trim(),
    p_idempotency_key: input.idempotencyKey,
    p_phone: input.phone?.trim() || undefined,
    p_draw_mode: "random_balanced",
  });
  return assertMutationOk(data, error);
}

export async function confirmSepay(client: OpsClient, input: {
  bankTransactionId: string;
  registrationId: string;
  reason?: string;
}): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.rpc("manual_confirm_bank_transaction", {
    p_bank_transaction_id: input.bankTransactionId,
    p_registration_id: input.registrationId,
    p_reason: input.reason?.trim() || undefined,
  });
  return assertMutationOk(data, error);
}

export async function ignoreSepay(client: OpsClient, input: { bankTransactionId: string; reason: string }): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.rpc("ignore_bank_transaction", {
    p_bank_transaction_id: input.bankTransactionId,
    p_reason: input.reason.trim(),
  });
  return assertMutationOk(data, error);
}

export async function confirmStaking(client: OpsClient, input: { purchaseId: string; bankTxId?: string; note?: string }): Promise<JsonRecord> {
  if (!OPS_CASHIER_MUTATIONS_ENABLED) throw new Error("money_path_disabled");
  const { data, error } = await client.functions.invoke("admin-confirm-funded", {
    body: {
      purchase_id: input.purchaseId,
      bank_tx_id: input.bankTxId?.trim() || undefined,
      note: input.note?.trim() || undefined,
    },
  });
  return assertMutationOk(data, error);
}

export async function reviewVerification(client: OpsClient, input: {
  requestId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
}): Promise<JsonRecord> {
  const { data, error } = await client.rpc("approve_verification", {
    p_request_id: input.requestId,
    p_action: input.action,
    p_rejection_reason: input.rejectionReason?.trim() || undefined,
  });
  return assertMutationOk(data, error);
}
