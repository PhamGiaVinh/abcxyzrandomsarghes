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
  // The original Board registration RPC has no alert field. Normalize only
  // its validated no-alert case; action/alert receipts retain their contract.
  const boardWithoutAlert = input.canonicalRequest?.intentDomain === "board"
    && receipt?.execution_result === "validated" && receipt.alert_id === undefined;
  if (receipt?.ok !== true || Array.isArray(receipt)
    || typeof receipt.voice_event_id !== "string" || !receipt.voice_event_id.trim()
    || typeof receipt.idempotency_key !== "string" || !receipt.idempotency_key.trim()
    || typeof receipt.trace_id !== "string" || !receipt.trace_id.trim()
    || typeof receipt.state_version !== "string" || !/^[0-9a-f]{64}$/i.test(receipt.state_version)
    || receipt.state_version !== input.expectedStateVersion || receipt.execution_mode !== input.executionMode
    || !["validated", "alert_opened"].includes(receipt.execution_result)
    || typeof receipt.correction_pending !== "boolean"
    || (receipt.duplicate !== undefined && typeof receipt.duplicate !== "boolean")
    || (receipt.execution_result === "validated" ? receipt.alert_id !== null && !boardWithoutAlert
      : typeof receipt.alert_id !== "string" || !receipt.alert_id.trim())
    // A server-marked provider-event duplicate intentionally returns its
    // original immutable key/trace. Do not invent a new writer identity.
    || (receipt.duplicate !== true && (receipt.idempotency_key !== input.idempotencyKey || receipt.trace_id !== input.traceId))) {
    throw new Error("Voice validation không trả receipt hợp lệ.");
  }
  return boardWithoutAlert ? { ...receipt, alert_id: null } : receipt;
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
  const request = input.canonicalRequest;
  if (request.intentDomain !== "board"
    || receipt?.ok !== true
    || receipt.voice_event_id !== input.voiceEventId
    || typeof receipt.canonical_receipt_event_id !== "string" || !receipt.canonical_receipt_event_id.trim()
    || receipt.idempotency_key !== input.idempotencyKey
    || typeof receipt.trace_id !== "string" || !receipt.trace_id.trim()
    || (receipt.duplicate !== undefined && typeof receipt.duplicate !== "boolean")
    || (!receipt.duplicate && receipt.trace_id !== input.traceId)
    || receipt.state_version_before !== request.envelope.expectedStateVersion
    || !/^[0-9a-f]{64}$/.test(receipt.state_version_before)
    || typeof receipt.state_version_after !== "string" || !/^[0-9a-f]{64}$/.test(receipt.state_version_after)
    || receipt.state_version_after === receipt.state_version_before
    || receipt.street !== request.payload.street
    || !["flop", "turn", "river"].includes(receipt.street)
    || !Array.isArray(receipt.community_cards)
    || receipt.community_cards.length !== (receipt.street === "flop" ? 3 : receipt.street === "turn" ? 4 : 5)
    || receipt.community_cards.length !== request.payload.cumulativeCards.length
    || receipt.community_cards.some((card, index) => typeof card !== "string"
      || !/^[2-9TJQKA][cdhs]$/.test(card) || card !== request.payload.cumulativeCards[index])
    || new Set(receipt.community_cards).size !== receipt.community_cards.length
    || !Array.isArray(receipt.previous_board)
    || receipt.previous_board.length !== request.payload.expectedExistingBoardCount
    || receipt.previous_board.some((card, index) => card !== request.payload.cumulativeCards[index])) {
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
  const request = input.canonicalRequest;
  if (receipt?.ok !== true || receipt.redacted !== true
    || request.intentDomain !== "hole_cards"
    || typeof receipt.voice_event_id !== "string" || !receipt.voice_event_id.trim()
    || typeof receipt.canonical_receipt_event_id !== "string" || !receipt.canonical_receipt_event_id.trim()
    || receipt.idempotency_key !== input.idempotencyKey
    || typeof receipt.trace_id !== "string" || !receipt.trace_id.trim()
    || (receipt.duplicate !== undefined && typeof receipt.duplicate !== "boolean")
    || (!receipt.duplicate && receipt.trace_id !== input.traceId)
    || receipt.player_id !== request.payload.expectedPlayerId
    || receipt.entry_number !== request.payload.expectedEntryNumber
    || receipt.seat_number !== request.payload.seatNumber
    || receipt.state_version_before !== input.expectedStateVersion
    || receipt.state_version_before !== request.envelope.expectedStateVersion
    || !/^[0-9a-f]{64}$/.test(receipt.state_version_before)
    || typeof receipt.state_version_after !== "string" || !/^[0-9a-f]{64}$/.test(receipt.state_version_after)
    || receipt.state_version_after === receipt.state_version_before) {
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
  const summary = receipt?.summary;
  const isChip = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const isSeat = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (receipt?.ok !== true
    || !["engine_fold_win", "engine_showdown"].includes(receipt.settlement_origin)
    || typeof receipt.settlement_digest !== "string" || !/^[0-9a-f]{64}$/.test(receipt.settlement_digest)
    || receipt.state_version !== input.expectedStateVersion || !/^[0-9a-f]{64}$/.test(receipt.state_version)
    || !summary || !isChip(summary.conservation_total)
    || !Array.isArray(summary.ending_stacks) || !summary.ending_stacks.length
    || summary.ending_stacks.some((row) => !row || typeof row.player_id !== "string" || !row.player_id.trim()
      || !isSeat(row.seat_number) || !isChip(row.amount))
    || new Set(summary.ending_stacks.map((row) => row.player_id)).size !== summary.ending_stacks.length
    || new Set(summary.ending_stacks.map((row) => row.seat_number)).size !== summary.ending_stacks.length
    || summary.ending_stacks.reduce((total, row) => total + row.amount, 0) !== summary.conservation_total
    || !Array.isArray(summary.winners) || !summary.winners.length
    || summary.winners.some((row) => !row || !isChip(row.amount)
      || (row.player_name !== null && typeof row.player_name !== "string")
      || !summary.ending_stacks.some((player) => player.player_id === row.player_id && player.seat_number === row.seat_number))
    || new Set(summary.winners.map((row) => row.player_id)).size !== summary.winners.length
    || !Array.isArray(summary.pots) || !summary.pots.length
    || summary.pots.some((pot) => !pot || !["main", "side"].includes(pot.kind) || !isChip(pot.amount)
      || !Array.isArray(pot.winner_ids) || !pot.winner_ids.length
      || new Set(pot.winner_ids).size !== pot.winner_ids.length
      || pot.winner_ids.some((id) => !summary.winners.some((winner) => winner.player_id === id)))) {
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
  const request = input.canonicalRequest;
  if (receipt?.ok !== true || receipt.hand_id !== input.handId
    || request.intentDomain !== "finish_hand"
    || typeof receipt.voice_event_id !== "string" || !receipt.voice_event_id.trim()
    || typeof receipt.canonical_receipt_event_id !== "string" || !receipt.canonical_receipt_event_id.trim()
    || receipt.idempotency_key !== input.idempotencyKey
    || typeof receipt.trace_id !== "string" || !receipt.trace_id.trim()
    || (receipt.duplicate !== undefined && typeof receipt.duplicate !== "boolean")
    || (!receipt.duplicate && receipt.trace_id !== input.traceId)
    || !["engine_fold_win", "engine_showdown"].includes(receipt.settlement_origin)
    || receipt.settlement_origin !== request.payload.settlementOrigin
    || receipt.settlement_digest !== request.payload.settlementDigest
    || !/^[0-9a-f]{64}$/.test(receipt.settlement_digest)
    || receipt.state_version_before !== input.expectedStateVersion
    || receipt.state_version_before !== request.envelope.expectedStateVersion
    || !/^[0-9a-f]{64}$/.test(receipt.state_version_before)
    || typeof receipt.state_version_after !== "string" || !/^[0-9a-f]{64}$/.test(receipt.state_version_after)
    || receipt.state_version_after === receipt.state_version_before) {
    throw new Error("Voice Finish không trả canonical receipt hợp lệ.");
  }
  return receipt;
}
