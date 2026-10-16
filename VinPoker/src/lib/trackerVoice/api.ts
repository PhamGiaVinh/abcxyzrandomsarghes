import type {
  CommitVoiceHoleCardsInput,
  CommitVoiceBoardInput,
  CommitVoiceFinishInput,
  PrepareVoiceFinishInput,
  TrackerVoiceRuntimeContext,
  ValidateVoiceEventInput,
  ValidatedVoiceEventReceipt,
  VoiceBoardCommitReceipt,
  VoiceHoleCardsCommitReceipt,
  VoiceFinishCommitReceipt,
  VoiceFinishProposalReceipt,
} from "./types";

async function throwEdgeFunctionError(error: { message: string; context?: Response }): Promise<never> {
  let payload: { error?: string; code?: string } | null = null;
  try {
    payload = error.context
      ? await error.context.clone().json() as { error?: string; code?: string }
      : null;
  } catch {
    // Supabase may provide a non-JSON proxy response; preserve its own message.
  }
  throw new Error(payload?.error ?? payload?.code ?? error.message);
}

export async function loadTrackerVoiceRuntimeContext(
  tournamentId: string,
  tournamentTableId: string,
): Promise<TrackerVoiceRuntimeContext> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.rpc("get_tracker_voice_runtime_context" as never, {
    p_tournament_id: tournamentId,
    p_tournament_table_id: tournamentTableId,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as unknown as TrackerVoiceRuntimeContext | null;
  if (result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "Không tải được quyền Voice cho bàn này.");
  const config = result.config;
  const hand = result.active_hand;
  if (Array.isArray(result)
    || typeof result.can_mint_session !== "boolean" || typeof result.read_only !== "boolean"
    || typeof result.correction_pending !== "boolean"
    || (result.tournament_table_id !== undefined && result.tournament_table_id !== tournamentTableId)
    || !config || typeof config !== "object" || Array.isArray(config)
    || typeof config.enabled !== "boolean" || !["shadow", "assist", "auto"].includes(config.configured_mode)
    || typeof config.provider_model !== "string" || !config.provider_model.trim()
    || ![1, 1000].includes(config.spoken_amount_unit)
    || typeof config.amount_unit_confirmed !== "boolean" || typeof config.server_auto_allowed !== "boolean"
    || !["ready", "correction_pending"].includes(config.correction_state)
    || (config.provider_confidence_threshold !== null && (typeof config.provider_confidence_threshold !== "number"
      || !Number.isFinite(config.provider_confidence_threshold) || config.provider_confidence_threshold < 0 || config.provider_confidence_threshold > 1))
    || (hand !== null && (!hand || typeof hand !== "object" || Array.isArray(hand)
      || typeof hand.hand_id !== "string" || !hand.hand_id.trim()
      || !Number.isInteger(hand.hand_number) || hand.hand_number < 1 || hand.status !== "in_progress"
      || typeof hand.state_version !== "string" || !/^[0-9a-f]{64}$/i.test(hand.state_version)))) {
    throw new Error("tracker_voice_runtime_malformed");
  }
  return result;
}

export async function validateTrackerVoiceEvent(
  input: ValidateVoiceEventInput,
): Promise<ValidatedVoiceEventReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "validate_voice_event",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      provider_confidence: input.providerConfidence ?? null,
      execution_mode: input.executionMode,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      voice_request: input.canonicalRequest,
    },
  });
  if (error) {
    await throwEdgeFunctionError(error as { message: string; context?: Response });
  }
  const envelope = data as { data?: unknown; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data as ValidatedVoiceEventReceipt | null;
  if (receipt?.ok !== true || Array.isArray(receipt)
    || typeof receipt.voice_event_id !== "string" || !receipt.voice_event_id.trim()
    || typeof receipt.idempotency_key !== "string" || !receipt.idempotency_key.trim()
    || typeof receipt.trace_id !== "string" || !receipt.trace_id.trim()
    || typeof receipt.state_version !== "string" || !/^[0-9a-f]{64}$/i.test(receipt.state_version)
    || receipt.state_version !== input.expectedStateVersion || receipt.execution_mode !== input.executionMode
    || !["validated", "alert_opened"].includes(receipt.execution_result)
    || typeof receipt.correction_pending !== "boolean"
    || (receipt.duplicate !== undefined && typeof receipt.duplicate !== "boolean")
    || (receipt.execution_result === "validated" ? receipt.alert_id !== null
      : typeof receipt.alert_id !== "string" || !receipt.alert_id.trim())
    // A server-marked provider-event duplicate intentionally returns its
    // original immutable key/trace. Do not invent a new writer identity.
    || (receipt.duplicate !== true && (receipt.idempotency_key !== input.idempotencyKey || receipt.trace_id !== input.traceId))) {
    throw new Error("Voice validation không trả receipt hợp lệ.");
  }
  return receipt;
}

/** Commits one already-validated Board proposal through the atomic RPC Edge seam. */
export async function commitTrackerVoiceBoard(
  input: CommitVoiceBoardInput,
): Promise<VoiceBoardCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_board",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      voice_event_id: input.voiceEventId,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      // Diagnostic only. The Edge/RPC reconstruct from the immutable root.
      voice_request: input.canonicalRequest,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceBoardCommitReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || !Array.isArray(receipt.community_cards)) {
    throw new Error("Voice Board không trả canonical receipt hợp lệ.");
  }
  return receipt;
}

/**
 * Confirms one private hole-card proposal. Unlike generic Voice validation,
 * this sends the raw speech only at touch-confirm and expects a redacted receipt.
 */
export async function commitTrackerVoiceHoleCards(
  input: CommitVoiceHoleCardsInput,
): Promise<VoiceHoleCardsCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_hole_cards",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      voice_request: input.canonicalRequest,
    },
  });
  if (error) await throwEdgeFunctionError(error as { message: string; context?: Response });
  const envelope = data as {
    data?: VoiceHoleCardsCommitReceipt | { ok?: false; error?: string };
    error?: string;
  } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (receipt?.ok === false && typeof receipt.error === "string") {
    throw new Error(receipt.error);
  }
  if (!receipt?.ok || receipt.redacted !== true || typeof receipt.player_id !== "string") {
    throw new Error("Voice bài tẩy không trả redacted canonical receipt hợp lệ.");
  }
  return receipt;
}

/** Reads a server-recomputed settlement preview. It never writes poker state. */
export async function prepareTrackerVoiceFinish(
  input: PrepareVoiceFinishInput,
): Promise<VoiceFinishProposalReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "prepare_voice_finish",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceFinishProposalReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || typeof receipt.settlement_digest !== "string") {
    throw new Error("Voice Finish không trả proposal settlement hợp lệ.");
  }
  return receipt;
}

/** Touch-confirmed server recomputation followed by the atomic canonical writer. */
export async function commitTrackerVoiceFinish(
  input: CommitVoiceFinishInput,
): Promise<VoiceFinishCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_finish",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      voice_request: input.canonicalRequest,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceFinishCommitReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || typeof receipt.hand_id !== "string") {
    throw new Error("Voice Finish không trả canonical receipt hợp lệ.");
  }
  return receipt;
}
