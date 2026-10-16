import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Headphones, Loader2, Mic, MicOff, PhoneCall, Radio, RotateCcw, ShieldCheck } from "lucide-react";
import { useWakeLock } from "@/hooks/useWakeLock";
import { FEATURES } from "@/lib/featureFlags";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import {
  loadTrackerVoiceRuntimeContext,
  buildVoiceActionCanonicalRequest,
  buildVoiceBoardCanonicalRequest,
  buildVoiceFinishCanonicalRequest,
  buildVoiceHoleCardsCanonicalRequest,
  commitTrackerVoiceBoard,
  commitTrackerVoiceFinish,
  commitTrackerVoiceHoleCards,
  createTrackerVoiceGeminiProvider,
  createTrackerVoiceOpenAiProvider,
  isTrackerVoiceGeminiLiveModel,
  isVoiceHoleCardsConfirmCommand,
  looksLikePrivateHoleCardsTranscript,
  MockRealtimeTranscriptionProvider,
  parseVoiceCommand,
  parseVoiceHoleCardsCommand,
  prepareTrackerVoiceFinish,
  resolveNextVoiceHoleCardsSeatNumber,
  routeTrackerVoiceIntent,
  resolveVoiceBoardProposal,
  resolveVoiceFinishProposal,
  resolveVoiceHoleCardsProposal,
  resolveVoiceProposal,
  validateTrackerVoiceEvent,
  type RealtimeTranscriptionProvider,
  type TrackerVoiceRuntimeContext,
  type ValidateVoiceEventInput,
  type ValidatedVoiceEventReceipt,
  type VoiceExecutionMode,
  type VoiceActionProposal,
  type VoiceBoardProposal,
  type VoiceCanonicalRequest,
  type VoiceBoardCommitReceipt,
  type VoiceFinishCommitReceipt,
  type VoiceFinishProposal,
  type VoiceFinishProposalReceipt,
  type VoiceHoleCardsCommitReceipt,
  type VoiceHoleCardsProposal,
  type VoiceProposal,
  type VoiceProviderKind,
  type VoiceProviderStatus,
  type VoiceTranscriptEvent,
} from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";

interface TrackerVoicePanelProps {
  hook: StandaloneHandInput;
  compact?: boolean;
  providerOverride?: RealtimeTranscriptionProvider;
  runtimeOverride?: TrackerVoiceRuntimeContext;
  loadRuntimeOverride?: typeof loadTrackerVoiceRuntimeContext;
  validateEventOverride?: (input: ValidateVoiceEventInput) => Promise<ValidatedVoiceEventReceipt>;
  commitBoardOverride?: (input: Parameters<typeof commitTrackerVoiceBoard>[0]) => Promise<VoiceBoardCommitReceipt>;
  commitHoleCardsOverride?: (input: Parameters<typeof commitTrackerVoiceHoleCards>[0]) => Promise<VoiceHoleCardsCommitReceipt>;
  prepareFinishOverride?: (input: Parameters<typeof prepareTrackerVoiceFinish>[0]) => Promise<VoiceFinishProposalReceipt>;
  commitFinishOverride?: (input: Parameters<typeof commitTrackerVoiceFinish>[0]) => Promise<VoiceFinishCommitReceipt>;
  spokenAmountUnit?: number;
  amountUnitConfirmed?: boolean;
  onDiagnosticSnapshot?: (snapshot: TrackerVoiceDiagnosticSnapshot) => void;
}

export interface TrackerVoiceDiagnosticSnapshot {
  provider: VoiceProviderKind | null;
  status: VoiceProviderStatus;
  statusMessage: string | null;
  inputDevice: { deviceId: string | null; label: string | null } | null;
  session: { model: string; expiresAt: string } | null;
  rms: number;
  partialTranscript: string;
  finalTranscript: string;
  finalProviderEventId: string | null;
  finalCapturedAt: string | null;
  proposal: VoiceProposal | null;
  proposalProviderEventId: string | null;
  proposalLatencyMs: number | null;
  validationState: "idle" | "validating" | "validated" | "committing" | "committed" | "error";
  validationError: string | null;
}

interface VoiceEventAttempt {
  attemptId: string;
  event: VoiceTranscriptEvent;
  runtimeSnapshot: TrackerVoiceRuntimeContext | null;
  executionMode?: VoiceExecutionMode;
}

/** Deliberately excluded from diagnostics, exports, and generic Voice events. */
interface PrivateHoleCardsAttempt {
  event: VoiceTranscriptEvent;
  proposal: VoiceHoleCardsProposal;
  runtimeSnapshot: TrackerVoiceRuntimeContext;
}

interface VoiceFinishAttempt {
  event: VoiceTranscriptEvent;
  proposal: VoiceFinishProposal;
  runtimeSnapshot: TrackerVoiceRuntimeContext;
  receipt: VoiceFinishProposalReceipt;
}

export const MIC_TEST_DURATION_MS = 30_000;
export const ACTION_AUTO_COMMIT_MS = 1_800;
const MAX_BUFFERED_TRANSCRIPTS = 20;
const SPLIT_AMOUNT_CONTINUATION_MS = 4_000;

type PendingAmountPrefix = {
  event: VoiceTranscriptEvent;
  receivedAt: number;
};

function isIncompleteAmountCommand(transcript: string): boolean {
  if (parseVoiceCommand(transcript)) return false;
  const completed = parseVoiceCommand(`${transcript.trim()} 1 nghìn`, {
    spokenAmountUnit: 1,
    amountUnitConfirmed: false,
  });
  return completed?.kind === "bet_to" || completed?.kind === "raise_to";
}

function combineSplitAmountFinal(
  pending: PendingAmountPrefix,
  event: VoiceTranscriptEvent,
  receivedAt: number,
): VoiceTranscriptEvent | null {
  if (receivedAt - pending.receivedAt > SPLIT_AMOUNT_CONTINUATION_MS) return null;
  const transcript = `${pending.event.transcript.trim()} ${event.transcript.trim()}`;
  const completed = parseVoiceCommand(transcript, {
    spokenAmountUnit: 1,
    amountUnitConfirmed: false,
  });
  if (completed?.kind !== "bet_to" && completed?.kind !== "raise_to") return null;
  return {
    ...event,
    providerEventId: `${pending.event.providerEventId}+${event.providerEventId}`,
    transcript,
    ...(pending.event.providerConfidence === undefined || event.providerConfidence === undefined
      ? { providerConfidence: undefined }
      : { providerConfidence: Math.min(pending.event.providerConfidence, event.providerConfidence) }),
  };
}

type ManualFallbackAction = "fold" | "check" | "call" | "bet" | "raise" | "all_in";

const MANUAL_FALLBACK_ACTIONS: ReadonlyArray<{
  action: ManualFallbackAction;
  label: string;
  legalKey: "fold" | "check" | "call" | "bet" | "raise" | "allIn";
}> = [
  { action: "fold", label: "Fold", legalKey: "fold" },
  { action: "check", label: "Check", legalKey: "check" },
  { action: "call", label: "Call", legalKey: "call" },
  { action: "bet", label: "Bet", legalKey: "bet" },
  { action: "raise", label: "Raise", legalKey: "raise" },
  { action: "all_in", label: "All-in", legalKey: "allIn" },
];

function createDefaultProvider(
  hook: StandaloneHandInput,
  runtime: TrackerVoiceRuntimeContext,
): RealtimeTranscriptionProvider | null {
  if (!hook.tournamentTableId) return null;
  if (import.meta.env.VITE_TRACKER_VOICE_PROVIDER === "mock") {
    return new MockRealtimeTranscriptionProvider();
  }
  if (isTrackerVoiceGeminiLiveModel(runtime.config.provider_model)) {
    return createTrackerVoiceGeminiProvider(hook.tournamentId, hook.tournamentTableId);
  }
  return createTrackerVoiceOpenAiProvider(hook.tournamentId, hook.tournamentTableId);
}

function proposalTone(proposal: VoiceProposal | null): string {
  if (!proposal) return "border-white/10 bg-black/20 text-zinc-400";
  return proposal.ok
    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
    : "border-amber-400/35 bg-amber-400/10 text-amber-100";
}

function formatPrivateCard(card: string): string {
  const suit = card.at(-1);
  const symbol = suit === "h" ? "♥" : suit === "d" ? "♦" : suit === "c" ? "♣" : suit === "s" ? "♠" : "";
  return `${card.slice(0, -1)}${symbol}`;
}

export function TrackerVoicePanel({
  hook,
  compact = false,
  providerOverride,
  runtimeOverride,
  loadRuntimeOverride = loadTrackerVoiceRuntimeContext,
  validateEventOverride = validateTrackerVoiceEvent,
  commitBoardOverride = commitTrackerVoiceBoard,
  commitHoleCardsOverride = commitTrackerVoiceHoleCards,
  prepareFinishOverride = prepareTrackerVoiceFinish,
  commitFinishOverride = commitTrackerVoiceFinish,
  spokenAmountUnit = 1,
  amountUnitConfirmed = false,
  onDiagnosticSnapshot,
}: TrackerVoicePanelProps) {
  const providerRef = useRef<RealtimeTranscriptionProvider | null>(providerOverride ?? null);
  const connectionGenerationRef = useRef(0);
  const connectionScopeKey = JSON.stringify([hook.tournamentId, hook.tournamentTableId]);
  const connectionScopeRef = useRef(connectionScopeKey);
  if (connectionScopeRef.current !== connectionScopeKey) {
    connectionScopeRef.current = connectionScopeKey;
    ++connectionGenerationRef.current;
  }
  const [status, setStatus] = useState<VoiceProviderStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [proposal, setProposal] = useState<VoiceProposal | null>(null);
  const [mode, setMode] = useState<VoiceExecutionMode>(compact ? "assist" : "shadow");
  const [mockText, setMockText] = useState("raise 120k");
  const [providerConfidence, setProviderConfidence] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [inputDevice, setInputDevice] = useState<{ deviceId: string | null; label: string | null } | null>(null);
  const [session, setSession] = useState<{ model: string; expiresAt: string } | null>(null);
  const [lastFinalProviderEventId, setLastFinalProviderEventId] = useState<string | null>(null);
  const [lastFinalCapturedAt, setLastFinalCapturedAt] = useState<string | null>(null);
  const [proposalProviderEventId, setProposalProviderEventId] = useState<string | null>(null);
  const [proposalLatencyMs, setProposalLatencyMs] = useState<number | null>(null);
  const [micTestStartedAt, setMicTestStartedAt] = useState<number | null>(null);
  const [micTestElapsedMs, setMicTestElapsedMs] = useState(0);
  const [micTestResult, setMicTestResult] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<TrackerVoiceRuntimeContext | null>(runtimeOverride ?? null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<"idle" | "validating" | "validated" | "committing" | "committed" | "error">("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedReceipt, setValidatedReceipt] = useState<ValidatedVoiceEventReceipt | null>(null);
  const [validatedProposal, setValidatedProposal] = useState<VoiceProposal | null>(null);
  const [finalAttempt, setFinalAttempt] = useState<VoiceEventAttempt | null>(null);
  const [privateHoleCardsAttempts, setPrivateHoleCardsAttempts] = useState<PrivateHoleCardsAttempt[]>([]);
  const [actionCountdownMs, setActionCountdownMs] = useState<number | null>(null);
  const [finishAttempt, setFinishAttempt] = useState<VoiceFinishAttempt | null>(null);
  const [confirmedHoleSeat, setConfirmedHoleSeat] = useState<number | null>(null);
  const [bufferedEvents, setBufferedEvents] = useState<VoiceTranscriptEvent[]>([]);
  const [bufferStatus, setBufferStatus] = useState<string | null>(null);
  const validationGenerationRef = useRef(0);
  const validationPromisesRef = useRef(new Map<string, Promise<ValidatedVoiceEventReceipt>>());
  const requestIdentitiesRef = useRef(new Map<string, { idempotencyKey: string; traceId: string }>());
  const assistCommitRef = useRef<Promise<boolean> | null>(null);
  const privateHoleCardsAttemptsRef = useRef<PrivateHoleCardsAttempt[]>([]);
  const handsFreeActionCommitRef = useRef<(() => Promise<boolean>) | null>(null);
  const cancelPendingActionRef = useRef<(() => void) | null>(null);
  const confirmBoardAssistRef = useRef<(() => Promise<void>) | null>(null);
  const confirmHoleCardsQueueRef = useRef<(() => Promise<boolean>) | null>(null);
  const autoBoardCommitEventRef = useRef<string | null>(null);
  const micTestMaxLevelRef = useRef(0);
  const micTestFinalCountRef = useRef(0);
  const micTestActiveRef = useRef(false);
  const statusRef = useRef<VoiceProviderStatus>("idle");
  const runtimeRef = useRef<TrackerVoiceRuntimeContext | null>(runtimeOverride ?? null);
  const runtimeReadGenerationRef = useRef(0);
  const runtimeScopeKey = JSON.stringify([hook.tournamentId, hook.tournamentTableId, hook.handId]);
  const runtimeScopeRef = useRef(runtimeScopeKey);
  if (runtimeScopeRef.current !== runtimeScopeKey) {
    runtimeScopeRef.current = runtimeScopeKey;
    ++runtimeReadGenerationRef.current;
  }
  const processedAttemptIdsRef = useRef(new Set<string>());
  const finalReceivedAtRef = useRef(new Map<string, number>());
  const pendingAmountPrefixRef = useRef<PendingAmountPrefix | null>(null);

  useWakeLock(status === "listening");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  // A Board draft is tied to one exact server state/prefix. Any manual write,
  // workflow change, lock/correction change, or hand switch makes it unusable.
  useEffect(() => {
    if (!proposal?.ok || !("intentDomain" in proposal) || proposal.intentDomain !== "board") return;
    const persistedBoardCount = Number.isInteger(hook.persistedBoardCount) ? hook.persistedBoardCount : 0;
    const persisted = (hook.communityCards ?? [])
      .slice(0, persistedBoardCount)
      .filter((card): card is string => card !== null);
    const workflowMatches = proposal.expectedWorkflowState === hook.workflowState
      || (proposal.expectedWorkflowState === "runout_reveal" && hook.allInRunout);
    const stale = proposal.expectedStateVersion !== runtime?.active_hand?.state_version
      || !workflowMatches
      || (proposal.expectedWorkflowState !== "runout_reveal"
        && proposal.expectedStreet !== (hook.currentStreet === "flop" || hook.currentStreet === "turn" || hook.currentStreet === "river" ? hook.currentStreet : null))
      || proposal.persistedBoardCards.join("|") !== persisted.join("|")
      || runtime?.correction_pending === true
      || hook.isReadOnly
      || runtime?.active_hand?.hand_id !== hook.handId;
    if (!stale) return;
    validationGenerationRef.current += 1;
    setProposal(null);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationState("idle");
    setValidationError("Đề xuất Board đã hết hiệu lực vì trạng thái bàn thay đổi.");
  }, [hook.allInRunout, hook.communityCards, hook.currentStreet, hook.handId, hook.isReadOnly, hook.persistedBoardCount, hook.workflowState, proposal, runtime?.active_hand?.hand_id, runtime?.active_hand?.state_version, runtime?.correction_pending]);

  // Private card speech is invalidated on any authoritative hand transition.
  // The raw text stays in this state only until cancellation or successful commit.
  useEffect(() => {
    if (privateHoleCardsAttempts.length === 0 || validationState === "committing") return;
    const stale = privateHoleCardsAttempts.some((attempt) => (
      attempt.proposal.expectedStateVersion !== runtime?.active_hand?.state_version
    ))
      || hook.workflowState !== "runout_reveal"
      || runtime?.correction_pending === true
      || hook.isReadOnly
      || runtime?.active_hand?.hand_id !== hook.handId;
    if (!stale) return;
    privateHoleCardsAttemptsRef.current = [];
    setPrivateHoleCardsAttempts([]);
    setValidationState("idle");
    setValidationError("Đề xuất bài tẩy đã hết hiệu lực vì trạng thái bàn thay đổi.");
  }, [hook.handId, hook.isReadOnly, hook.workflowState, privateHoleCardsAttempts, runtime?.active_hand?.hand_id, runtime?.active_hand?.state_version, runtime?.correction_pending, validationState]);

  useEffect(() => {
    if (!finishAttempt) return;
    const stale = finishAttempt.proposal.expectedStateVersion !== runtime?.active_hand?.state_version
      || hook.workflowState !== "submit_ready"
      || runtime?.correction_pending === true
      || hook.isReadOnly
      || runtime?.active_hand?.hand_id !== hook.handId;
    if (!stale) return;
    setFinishAttempt(null);
    setValidationState("idle");
    setValidationError("Đề xuất Finish đã hết hiệu lực vì trạng thái hand thay đổi.");
  }, [finishAttempt, hook.handId, hook.isReadOnly, hook.workflowState, runtime?.active_hand?.hand_id, runtime?.active_hand?.state_version, runtime?.correction_pending]);

  const voiceActorPlayer = hook.engineActor
    ? hook.players.find((player) => player.player_id === hook.engineActor?.player_id) ?? null
    : hook.actorPlayer;
  const proposalContext = useMemo(
    () => ({
      handId: hook.handId,
      street: hook.currentStreet,
      workflowState: hook.workflowState,
      // `actions` is present in the live hook. Keep the panel fail-closed but
      // mountable while an older/read-only adapter has not loaded it yet.
      actionOrder: (hook.actions?.at(-1)?.action_order ?? 0) + 1,
      expectedStateVersion: runtime?.active_hand?.hand_id === hook.handId
        ? runtime.active_hand.state_version
        : null,
      actor: voiceActorPlayer
        ? {
            playerId: voiceActorPlayer.player_id,
            playerName: voiceActorPlayer.display_name,
            seatNumber: voiceActorPlayer.seat_number,
            entryNumber: voiceActorPlayer.entry_number,
            currentStack: voiceActorPlayer.current_stack,
            currentBet: voiceActorPlayer.current_bet,
          }
        : null,
      actorView: hook.actorViewData
        ? {
            toCall: hook.actorViewData.toCall,
            minRaiseTo: hook.actorViewData.minRaiseTo,
            legal: hook.actorViewData.legal,
          }
        : null,
      handStarted: hook.handStarted,
      actionStepActive: hook.showActionStep,
      readOnly: hook.isReadOnly,
      syncBlocked: hook.actionSyncBlocked,
      correctionPending: runtime?.correction_pending ?? false,
      persistedBoardCards: (hook.communityCards ?? [])
        .slice(0, Number.isInteger(hook.persistedBoardCount) ? hook.persistedBoardCount : 0)
        .filter((card): card is string => card !== null),
    }),
    [
      hook.actionSyncBlocked,
      hook.actorViewData,
      hook.actions,
      hook.currentStreet,
      hook.communityCards,
      hook.handId,
      hook.handStarted,
      hook.isReadOnly,
      hook.showActionStep,
      hook.persistedBoardCount,
      hook.workflowState,
      runtime?.active_hand?.hand_id,
      runtime?.active_hand?.state_version,
      runtime?.correction_pending,
      voiceActorPlayer,
    ],
  );

  const holeCardsProposalContext = useMemo(() => ({
    handId: hook.handId,
    workflowState: hook.workflowState,
    expectedStateVersion: runtime?.active_hand?.hand_id === hook.handId
      ? runtime.active_hand.state_version
      : null,
    handStarted: hook.handStarted,
    readOnly: hook.isReadOnly,
    syncBlocked: hook.actionSyncBlocked,
    correctionPending: runtime?.correction_pending ?? false,
    players: (hook.players ?? []).map((player) => ({
      playerId: player.player_id,
      playerName: player.display_name,
      seatNumber: player.seat_number,
      entryNumber: player.entry_number,
    })),
    localCardsByPlayerId: hook.playerHoleCards ?? {},
  }), [
    hook.actionSyncBlocked,
    hook.handId,
    hook.handStarted,
    hook.isReadOnly,
    hook.playerHoleCards,
    hook.players,
    hook.workflowState,
    runtime?.active_hand?.hand_id,
    runtime?.active_hand?.state_version,
    runtime?.correction_pending,
  ]);

  const impliedHoleCardsSeatNumber = useMemo(() => resolveNextVoiceHoleCardsSeatNumber({
    players: (hook.players ?? []).map((player) => ({
      playerId: player.player_id,
      seatNumber: player.seat_number,
      isFolded: Boolean(player.is_folded),
      hasCards: (hook.playerHoleCards?.[player.player_id] ?? []).filter(Boolean).length === 2
        || privateHoleCardsAttempts.some((attempt) => attempt.proposal.player.playerId === player.player_id),
    })),
    actions: (hook.actions ?? []).map((action) => ({
      street: action.street,
      actionType: action.action_type,
      actionOrder: action.action_order,
      seatNumber: action.seat_number,
    })),
    buttonSeat: hook.buttonSeat ?? 0,
  }), [hook.actions, hook.buttonSeat, hook.playerHoleCards, hook.players, privateHoleCardsAttempts]);

  const refreshRuntime = useCallback(async () => {
    if (runtimeScopeRef.current !== runtimeScopeKey) return null;
    const generation = ++runtimeReadGenerationRef.current;
    const isCurrent = () => generation === runtimeReadGenerationRef.current
      && runtimeScopeRef.current === runtimeScopeKey;
    if (!hook.tournamentTableId && !runtimeOverride) {
      setRuntime(null);
      setRuntimeError("KhÃ´ng xÃ¡c minh Ä‘Æ°á»£c bÃ n canonical cho Voice.");
      return null;
    }
    if (runtimeOverride) {
      setRuntime(runtimeOverride);
      setRuntimeError(null);
      return runtimeOverride;
    }
    try {
      const next = await observeTrackerContextRead(loadRuntimeOverride(hook.tournamentId, hook.tournamentTableId));
      if (!isCurrent()) return null;
      setRuntime(next);
      setRuntimeError(null);
      return next;
    } catch (error) {
      if (!isCurrent()) return null;
      const message = error instanceof Error && error.message === "tracker_context_read_timeout"
        ? "Hết thời gian tải quyền Voice. Hãy kết nối lại để thử lại."
        : error instanceof Error ? error.message : "Không tải được quyền Voice.";
      setRuntime(null);
      setRuntimeError(message);
      return null;
    }
  }, [hook.tournamentId, hook.tournamentTableId, loadRuntimeOverride, runtimeOverride, runtimeScopeKey]);
  const refreshRuntimeRef = useRef(refreshRuntime);
  refreshRuntimeRef.current = refreshRuntime;

  useEffect(() => {
    const reads = runtimeReadGenerationRef;
    void refreshRuntime();
    return () => { ++reads.current; };
  }, [hook.handId, refreshRuntime]);

  useEffect(() => {
    validationGenerationRef.current += 1;
    setFinalAttempt(null);
    privateHoleCardsAttemptsRef.current = [];
    setPrivateHoleCardsAttempts([]);
    setActionCountdownMs(null);
    autoBoardCommitEventRef.current = null;
    setConfirmedHoleSeat(null);
    setFinalTranscript("");
    setProposal(null);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationState("idle");
    setValidationError(null);
    setBufferedEvents([]);
    setBufferStatus(null);
    processedAttemptIdsRef.current.clear();
    validationPromisesRef.current.clear();
    requestIdentitiesRef.current.clear();
    finalReceivedAtRef.current.clear();
    pendingAmountPrefixRef.current = null;
    setInputDevice(null);
    setSession(null);
    setLastFinalProviderEventId(null);
    setLastFinalCapturedAt(null);
    setProposalProviderEventId(null);
    setProposalLatencyMs(null);
  }, [hook.handId]);

  useEffect(() => {
    onDiagnosticSnapshot?.({
      provider: providerRef.current?.kind ?? null,
      status,
      statusMessage,
      inputDevice,
      session,
      rms: audioLevel,
      partialTranscript: partial,
      finalTranscript,
      finalProviderEventId: lastFinalProviderEventId,
      finalCapturedAt: lastFinalCapturedAt,
      proposal,
      proposalProviderEventId,
      proposalLatencyMs,
      validationState,
      validationError,
    });
  }, [
    audioLevel,
    finalTranscript,
    inputDevice,
    lastFinalCapturedAt,
    lastFinalProviderEventId,
    onDiagnosticSnapshot,
    partial,
    proposal,
    proposalProviderEventId,
    proposalLatencyMs,
    session,
    status,
    statusMessage,
    validationError,
    validationState,
  ]);

  useEffect(() => {
    if (!finalAttempt || processedAttemptIdsRef.current.has(finalAttempt.attemptId)) return;
    processedAttemptIdsRef.current.add(finalAttempt.attemptId);
    const finalEvent = finalAttempt.event;
    const attemptRuntime = finalAttempt.runtimeSnapshot ?? runtime;
    const attemptMode = finalAttempt.executionMode ?? mode;
    const unit = attemptRuntime?.config.spoken_amount_unit ?? spokenAmountUnit;
    const unitConfirmed = attemptRuntime?.config.amount_unit_confirmed ?? amountUnitConfirmed;
    const localContext = {
      ...proposalContext,
      expectedStateVersion: attemptRuntime?.active_hand?.hand_id === hook.handId
        ? attemptRuntime.active_hand.state_version
        : null,
      correctionPending: attemptRuntime?.correction_pending ?? false,
    };
    const route = routeTrackerVoiceIntent(finalEvent.transcript, localContext.workflowState, {
      spokenAmountUnit: unit,
      amountUnitConfirmed: unitConfirmed,
      impliedHoleCardsSeatNumber,
    });
    if (isVoiceHoleCardsConfirmCommand(finalEvent.transcript)) {
      setFinalTranscript("");
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      setFinishAttempt(null);
      if (
        attemptMode !== "assist"
        || attemptRuntime?.config.server_auto_allowed !== true
        || localContext.workflowState !== "runout_reveal"
        || privateHoleCardsAttemptsRef.current.length === 0
      ) {
        setValidationState("idle");
        setValidationError("Chỉ nhận lệnh xác nhận khi đang có bài tẩy all-in chờ ghi.");
        return;
      }
      void confirmHoleCardsQueueRef.current?.();
      return;
    }
    const finishCommand = route.ok && route.intentDomain === "finish_hand" ? route.command : null;
    if (finishCommand) {
      const finishProposal = resolveVoiceFinishProposal(finishCommand, {
        handId: hook.handId,
        workflowState: localContext.workflowState,
        expectedStateVersion: localContext.expectedStateVersion,
        handStarted: localContext.handStarted,
        readOnly: localContext.readOnly,
        syncBlocked: localContext.syncBlocked,
        correctionPending: localContext.correctionPending,
      });
      const receivedAt = finalReceivedAtRef.current.get(finalEvent.providerEventId);
      setProposalLatencyMs(receivedAt === undefined ? null : Math.max(0, performance.now() - receivedAt));
      setFinalTranscript(finalEvent.transcript);
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      privateHoleCardsAttemptsRef.current = [];
      setPrivateHoleCardsAttempts([]);
      setFinishAttempt(null);
      setValidationError(null);
      setProposalProviderEventId(finalEvent.providerEventId);
      if (finishProposal.ok === false || !finishProposal.expectedStateVersion || !attemptRuntime || !hook.tournamentTableId || !hook.handId) {
        setValidationState("error");
        setValidationError(finishProposal.ok === true
          ? "Không xác minh được bàn canonical cho Voice Finish."
          : finishProposal.message);
        return;
      }
      const prepare = async () => {
        const generation = ++validationGenerationRef.current;
        setValidationState("validating");
        try {
          const receipt = await prepareFinishOverride({
            tournamentId: hook.tournamentId,
            tournamentTableId: hook.tournamentTableId,
            handId: hook.handId,
            finalTranscript: finalEvent.transcript,
            providerName: providerRef.current?.kind ?? "openai_realtime",
            providerModel: attemptRuntime.config.provider_model,
            providerEventId: finalEvent.providerEventId,
            expectedStateVersion: finishProposal.expectedStateVersion,
          });
          if (validationGenerationRef.current !== generation) return;
          setFinishAttempt({ event: finalEvent, proposal: finishProposal, runtimeSnapshot: attemptRuntime, receipt });
          setValidationState("validated");
        } catch (error) {
          if (validationGenerationRef.current !== generation) return;
          setValidationState("error");
          setValidationError(error instanceof Error ? error.message : "Không thể xác minh settlement Finish.");
        }
      };
      void prepare();
      return;
    }
    const privateCommand = route.ok && route.intentDomain === "hole_cards"
      ? route.command
      : parseVoiceHoleCardsCommand(finalEvent.transcript, impliedHoleCardsSeatNumber);
    if (privateCommand || looksLikePrivateHoleCardsTranscript(finalEvent.transcript)) {
      const privateProposal = privateCommand
        ? resolveVoiceHoleCardsProposal(privateCommand, {
        ...holeCardsProposalContext,
        expectedStateVersion: attemptRuntime?.active_hand?.hand_id === hook.handId
          ? attemptRuntime.active_hand.state_version
          : null,
        correctionPending: attemptRuntime?.correction_pending ?? false,
        })
        : {
            ok: false as const,
            command: null,
            code: "command_not_supported" as const,
            message: "Hãy đọc đúng hai lá bài; chỉ cần nói Seat/Ghế khi muốn chỉ rõ người chơi.",
          };
      const receivedAt = finalReceivedAtRef.current.get(finalEvent.providerEventId);
      setProposalLatencyMs(receivedAt === undefined ? null : Math.max(0, performance.now() - receivedAt));
      setFinalTranscript("");
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      setFinishAttempt(null);
      setValidationError(null);
      setProposalProviderEventId(null);
      if (privateProposal.ok === false) {
        setProposal(privateProposal);
        setValidationState("idle");
        return;
      }
      if (!attemptRuntime) {
        setProposal({ ok: false, command: null, code: "no_active_hand", message: "Không xác minh được phiên bàn hiện tại." });
        setValidationState("idle");
        return;
      }
      const duplicateQueuedCard = privateHoleCardsAttemptsRef.current.some((attempt) => (
        attempt.proposal.player.playerId !== privateProposal.player.playerId
        && attempt.proposal.command.cards.some((card) => privateProposal.command.cards.includes(card))
      ));
      if (duplicateQueuedCard) {
        setProposal({
          ok: false,
          command: null,
          code: "duplicate_card",
          message: "Bài tẩy vừa đọc trùng lá với ghế khác đang chờ xác nhận.",
        });
        setValidationState("idle");
        return;
      }
      setPrivateHoleCardsAttempts((current) => {
        const next = [
          ...current.filter((attempt) => attempt.proposal.player.playerId !== privateProposal.player.playerId),
          { event: finalEvent, proposal: privateProposal, runtimeSnapshot: attemptRuntime },
        ];
        privateHoleCardsAttemptsRef.current = next;
        return next;
      });
      setValidationState("validated");
      return;
    }
    const nextProposal: VoiceProposal = route.ok === false
      ? {
          ok: false,
          command: null,
          code: route.code,
          message: route.code === "wrong_workflow"
            ? "Câu Voice không hợp lệ ở bước Tracker hiện tại."
            : route.code === "showdown_hole_cards_deferred_muck_authority"
              ? "Showdown Voice chưa mở vì muck chưa có bằng chứng server-authoritative."
            : "Chưa nhận ra một lệnh Voice duy nhất.",
        }
      : route.intentDomain === "board"
        ? resolveVoiceBoardProposal(route.command, hook.allInRunout
          ? { ...localContext, workflowState: "runout_reveal" }
          : localContext)
        : route.intentDomain === "action" ? resolveVoiceProposal({
            kind: route.command.kind,
            transcript: finalEvent.transcript.trim(),
            normalizedTranscript: route.command.normalizedTranscript,
            amount: route.command.amount,
            spokenSeatNumber: route.command.spokenSeatNumber,
            riskTier: route.command.riskTier,
            repairs: route.command.repairs,
            requiresConfirmation: route.command.requiresConfirmation,
          }, localContext) : { ok: false, command: null, code: "command_not_supported", message: "Lệnh không thuộc bước action hiện tại." };
    const receivedAt = finalReceivedAtRef.current.get(finalEvent.providerEventId);
    setProposalLatencyMs(receivedAt === undefined ? null : Math.max(0, performance.now() - receivedAt));
    setFinalTranscript(finalEvent.transcript);
    setFinishAttempt(null);
    setProposal(nextProposal);
    setProposalProviderEventId(finalEvent.providerEventId);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationError(null);
    if (!nextProposal.ok) {
      setValidationState("idle");
      return;
    }
    const activeHand = attemptRuntime?.active_hand;
    if (!attemptRuntime?.can_mint_session || !activeHand || activeHand.hand_id !== hook.handId) {
      setValidationState("error");
      setValidationError(runtimeError ?? "Voice chưa có assignment hoặc active hand hợp lệ.");
      return;
    }

    if (!hook.tournamentTableId) {
      setValidationState("error");
      setValidationError("KhÃ´ng xÃ¡c minh Ä‘Æ°á»£c bÃ n canonical cho Voice.");
      return;
    }

    // Poker commands stay local in Shadow. Control commands intentionally go
    // through the existing alert path, which never records a poker action.
    const requiresServerValidation = attemptMode !== "shadow" || "controlAction" in nextProposal;
    if (!requiresServerValidation) {
      setValidatedProposal(nextProposal);
      setValidationState("validated");
      return;
    }

    const validateFinal = async () => {
      let identity = requestIdentitiesRef.current.get(finalEvent.providerEventId);
      if (!identity) {
        identity = {
          idempotencyKey: `voice:${crypto.randomUUID()}`,
          traceId: `voice-trace:${crypto.randomUUID()}`,
        };
        requestIdentitiesRef.current.set(finalEvent.providerEventId, identity);
      }
      const generation = ++validationGenerationRef.current;
      const canonicalRequest: VoiceCanonicalRequest | undefined = "canonicalAction" in nextProposal
        ? await buildVoiceActionCanonicalRequest({
            rawTranscript: finalEvent.transcript,
            expectedStateVersion: activeHand.state_version,
            expectedWorkflowState: nextProposal.expectedWorkflowState,
            expectedStreet: nextProposal.expectedStreet,
            payload: {
              canonicalAction: nextProposal.canonicalAction,
              actorPlayerId: nextProposal.actor.playerId,
              entryNumber: nextProposal.actor.entryNumber,
              seatNumber: nextProposal.actor.seatNumber,
              street: nextProposal.expectedStreet,
              actionAmount: nextProposal.expectedActionAmount,
              actionOrder: nextProposal.expectedActionOrder,
            },
          })
        : nextProposal.ok && "intentDomain" in nextProposal && nextProposal.intentDomain === "board"
          ? await buildVoiceBoardCanonicalRequest({
              rawTranscript: finalEvent.transcript,
              expectedStateVersion: activeHand.state_version,
              expectedWorkflowState: nextProposal.expectedWorkflowState,
              expectedStreet: nextProposal.expectedStreet,
              payload: {
                street: nextProposal.expectedStreet,
                newCards: nextProposal.command.newCards,
                cumulativeCards: nextProposal.cumulativeCards,
                expectedExistingBoardCount: nextProposal.expectedExistingBoardCount,
              },
            })
        : undefined;
      // A final transcript may finish hashing after navigation or a hand change.
      // Never register a Voice event for the context that has already been left.
      if (validationGenerationRef.current !== generation) return;
      const input: ValidateVoiceEventInput = {
        tournamentId: hook.tournamentId,
        tournamentTableId: hook.tournamentTableId,
        handId: activeHand.hand_id,
        finalTranscript: finalEvent.transcript,
        providerName: providerRef.current?.kind ?? "openai_realtime",
        providerModel: attemptRuntime.config.provider_model,
        providerEventId: finalEvent.providerEventId,
        ...(finalEvent.providerConfidence === undefined
          ? {}
          : { providerConfidence: finalEvent.providerConfidence }),
        executionMode: attemptMode,
        expectedStateVersion: activeHand.state_version,
        ...identity,
        ...(canonicalRequest ? { canonicalRequest } : {}),
      };
      let pending = validationPromisesRef.current.get(finalEvent.providerEventId);
      if (!pending) {
        pending = validateEventOverride(input);
        validationPromisesRef.current.set(finalEvent.providerEventId, pending);
      }
      setValidationState("validating");
      try {
        const receipt = await pending;
        if (validationGenerationRef.current !== generation) return;
        setValidatedReceipt(receipt);
        setValidatedProposal(nextProposal);
        setValidationState("validated");
        if (receipt.correction_pending) {
          setRuntime((current) => current && !current.correction_pending
            ? { ...current, correction_pending: true }
            : current);
        }
      } catch (error) {
        if (validationGenerationRef.current !== generation) return;
        setValidationState("error");
        setValidationError(error instanceof Error ? error.message : "Voice validation thất bại.");
      }
    };
    void validateFinal();
  }, [
    amountUnitConfirmed,
    finalAttempt,
    hook.allInRunout,
    hook.handId,
    hook.tournamentId,
    hook.tournamentTableId,
    mode,
    holeCardsProposalContext,
    impliedHoleCardsSeatNumber,
    proposalContext,
    runtime,
    runtimeError,
    spokenAmountUnit,
    prepareFinishOverride,
    validateEventOverride,
  ]);

  useEffect(() => () => {
    ++connectionGenerationRef.current;
    void providerRef.current?.disconnect();
  }, [connectionScopeKey]);

  useEffect(() => {
    if (micTestStartedAt === null) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - micTestStartedAt;
      setMicTestElapsedMs(Math.min(MIC_TEST_DURATION_MS, elapsed));
      if (elapsed < MIC_TEST_DURATION_MS) return;
      window.clearInterval(timer);
      micTestActiveRef.current = false;
      setMicTestStartedAt(null);
      if (micTestMaxLevelRef.current < 0.015) {
        setMicTestResult("Không nhận được âm thanh. Kiểm tra quyền mic hoặc chọn lại thiết bị.");
      } else if (micTestFinalCountRef.current === 0) {
        setMicTestResult("Mic có tín hiệu nhưng chưa nhận final transcript. Hãy thử nói rõ một action.");
      } else {
        setMicTestResult(`Mic ổn định · ${micTestFinalCountRef.current} final transcript trong 30 giây.`);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [micTestStartedAt]);

  useEffect(() => {
    const stopCapture = () => {
      ++connectionGenerationRef.current;
      ++runtimeReadGenerationRef.current;
      pendingAmountPrefixRef.current = null;
      cancelPendingActionRef.current?.();
      micTestActiveRef.current = false;
      setMicTestStartedAt(null);
      setAudioLevel(0);
      void providerRef.current?.disconnect().catch(() => undefined);
    };
    const handleOffline = () => {
      if (statusRef.current === "idle") return;
      stopCapture();
      statusRef.current = "offline";
      setStatus("offline");
      setStatusMessage("Thiết bị mất mạng. Voice đã dừng ghi action.");
    };
    const handleDeviceChange = () => {
      if (statusRef.current === "idle") return;
      stopCapture();
      statusRef.current = "recovering";
      setStatus("recovering");
      setStatusMessage("Danh sách microphone vừa thay đổi. Hãy kết nối lại để xác nhận đúng thiết bị.");
    };
    window.addEventListener("offline", handleOffline);
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      window.removeEventListener("offline", handleOffline);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  const connect = async () => {
    const generation = ++connectionGenerationRef.current;
    const isCurrent = () => generation === connectionGenerationRef.current
      && connectionScopeRef.current === connectionScopeKey;
    statusRef.current = "connecting";
    setStatus("connecting");
    const currentRuntime = await refreshRuntimeRef.current();
    if (!isCurrent()) return;
    if (!currentRuntime?.can_mint_session) {
      setStatus("error");
      setStatusMessage(currentRuntime?.error ?? "Không xác minh được quyền Voice cho bàn này. Hãy kết nối lại.");
      return;
    }
    const expectedProviderKind = import.meta.env.VITE_TRACKER_VOICE_PROVIDER === "mock"
      ? "mock"
      : isTrackerVoiceGeminiLiveModel(currentRuntime.config.provider_model)
        ? "gemini_live"
        : "openai_realtime";
    // Test and Preview seams inject an explicit provider. Never replace it
    // from the runtime model; production has no override and remains server-selected.
    const provider = providerOverride
      ?? (providerRef.current?.kind === expectedProviderKind
        ? providerRef.current
        : createDefaultProvider(hook, currentRuntime));
    if (!provider) {
      setStatus("error");
      setStatusMessage("KhÃ´ng xÃ¡c minh Ä‘Æ°á»£c bÃ n canonical cho Voice.");
      return;
    }
    providerRef.current = provider;
    pendingAmountPrefixRef.current = null;
    setAudioLevel(0);
    setStatusMessage(null);
    const acceptFinalEvent = (finalEvent: VoiceTranscriptEvent, receivedAt: number) => {
      if (!isCurrent()) return;
      const eventScope = runtimeScopeRef.current;
      setPartial("");
      setProposal(null);
      setProposalProviderEventId(null);
      setProposalLatencyMs(null);
      setFinalTranscript("");
      setLastFinalProviderEventId(finalEvent.providerEventId);
      setLastFinalCapturedAt(finalEvent.capturedAt);
      finalReceivedAtRef.current.set(finalEvent.providerEventId, receivedAt);
      setProviderConfidence(finalEvent.providerConfidence ?? null);
      if (micTestActiveRef.current) micTestFinalCountRef.current += 1;
      if (runtimeRef.current?.correction_pending) {
        setBufferedEvents((current) => {
          if (current.some((candidate) => candidate.providerEventId === finalEvent.providerEventId)) return current;
          return [...current, finalEvent].slice(-MAX_BUFFERED_TRANSCRIPTS);
        });
        setBufferStatus("Transcript được giữ cục bộ. Voice sẽ không ghi action khi Floor chưa sửa xong.");
        return;
      }
      void refreshRuntimeRef.current().then((freshRuntime) => {
        if (!isCurrent() || runtimeScopeRef.current !== eventScope) return;
        if (!freshRuntime) {
          setValidationState("error");
          setValidationError("Không tải lại được trạng thái bàn. Hãy thử nói lại action.");
          return;
        }
        if (freshRuntime.correction_pending) {
          setBufferedEvents((current) => {
            if (current.some((candidate) => candidate.providerEventId === finalEvent.providerEventId)) return current;
            return [...current, finalEvent].slice(-MAX_BUFFERED_TRANSCRIPTS);
          });
          setBufferStatus("Transcript được giữ cục bộ. Voice sẽ không ghi action khi Floor chưa sửa xong.");
          return;
        }
        setFinalAttempt({
          attemptId: `provider:${finalEvent.providerEventId}`,
          event: finalEvent,
          runtimeSnapshot: freshRuntime,
        });
      });
    };
    try {
      await provider.connect({
        onStatus: (next, message) => {
          if (!isCurrent()) return;
          setStatus(next);
          setStatusMessage(message ?? null);
        },
        onTranscript: (event) => {
          if (!isCurrent()) return;
          if (!event.isFinal) {
            setPartial(looksLikePrivateHoleCardsTranscript(event.transcript)
              ? "Đang nhận diện đề xuất bài tẩy riêng tư..."
              : event.transcript);
            return;
          }
          const receivedAt = performance.now();
          const pendingAmountPrefix = pendingAmountPrefixRef.current;
          const combinedEvent = pendingAmountPrefix
            ? combineSplitAmountFinal(pendingAmountPrefix, event, receivedAt)
            : null;
          pendingAmountPrefixRef.current = null;
          if (!combinedEvent && isIncompleteAmountCommand(event.transcript)) {
            pendingAmountPrefixRef.current = { event, receivedAt };
            setPartial("");
            setFinalTranscript(event.transcript);
            setLastFinalProviderEventId(event.providerEventId);
            setLastFinalCapturedAt(event.capturedAt);
            setProposal(null);
            setProposalProviderEventId(null);
            setProposalLatencyMs(null);
            setValidationState("idle");
            setValidationError("Đã nhận lệnh Raise/Bet, đang chờ số chip.");
            return;
          }
          const finalEvent = combinedEvent ?? event;
          const pendingActionCommit = handsFreeActionCommitRef.current;
          if (pendingActionCommit) {
            const parsedNext = parseVoiceCommand(finalEvent.transcript, {
              spokenAmountUnit: runtimeRef.current?.config.spoken_amount_unit ?? spokenAmountUnit,
              amountUnitConfirmed: runtimeRef.current?.config.amount_unit_confirmed ?? amountUnitConfirmed,
            });
            if (parsedNext?.kind === "report_wrong_action") {
              cancelPendingActionRef.current?.();
              return;
            }
            if (!parsedNext || parsedNext.kind === "call_floor") {
              setValidationError("Action đang đếm ngược. Hãy đọc action hợp lệ tiếp theo hoặc nói Báo sai.");
              return;
            }
            if (parsedNext.spokenSeatNumber === null) {
              setValidationError("Action kế tiếp phải đọc rõ Ghế. Action đang chờ vẫn tiếp tục đếm ngược.");
              return;
            }
            handsFreeActionCommitRef.current = null;
            void pendingActionCommit().then((committed) => {
              if (committed) acceptFinalEvent(finalEvent, receivedAt);
            });
            return;
          }
          acceptFinalEvent(finalEvent, receivedAt);
        },
        onLevel: (rms) => {
          if (!isCurrent()) return;
          const normalized = Math.max(0, Math.min(1, rms));
          setAudioLevel(normalized);
          if (micTestActiveRef.current) micTestMaxLevelRef.current = Math.max(micTestMaxLevelRef.current, normalized);
        },
        onInputDevice: (device) => { if (isCurrent()) setInputDevice(device); },
        onSession: (nextSession) => { if (isCurrent()) setSession(nextSession); },
      });
    } catch (error) {
      if (!isCurrent()) return;
      await provider.disconnect().catch(() => undefined);
      if (!isCurrent()) return;
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Không mở được microphone.");
    }
  };

  const disconnect = async () => {
    const generation = ++connectionGenerationRef.current;
    pendingAmountPrefixRef.current = null;
    await providerRef.current?.disconnect();
    if (generation !== connectionGenerationRef.current) return;
    setStatus("idle");
    setAudioLevel(0);
    setPartial("");
    setSession(null);
    micTestActiveRef.current = false;
    setMicTestStartedAt(null);
  };

  const pause = async () => {
    const provider = providerRef.current;
    if (!provider?.pause) {
      await disconnect();
      return;
    }
    try {
      await provider.pause();
      setAudioLevel(0);
      micTestActiveRef.current = false;
      setMicTestStartedAt(null);
    } catch (error) {
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Không thể hoàn tất transcript cuối.");
    }
  };

  const reconnect = async () => {
    await disconnect();
    await connect();
  };

  const submitControlAction = useCallback((controlAction: "report_wrong_action" | "call_floor") => {
    const currentRuntime = runtimeRef.current ?? runtime;
    const activeHand = currentRuntime?.active_hand;
    if (
      !currentRuntime?.can_mint_session
      || currentRuntime.read_only
      || !activeHand
      || activeHand.hand_id !== hook.handId
    ) {
      setStatusMessage("Voice chưa có quyền hợp lệ trên hand này. Không tạo yêu cầu Floor.");
      return;
    }
    const now = new Date().toISOString();
    const providerEventId = `voice-control:${crypto.randomUUID()}`;
    const transcript = controlAction === "report_wrong_action" ? "báo sai action" : "gọi floor";
    const event: VoiceTranscriptEvent = {
      providerEventId,
      transcript,
      isFinal: true,
      capturedAt: now,
    };
    finalReceivedAtRef.current.set(providerEventId, performance.now());
    setFinalTranscript(transcript);
    setLastFinalProviderEventId(providerEventId);
    setLastFinalCapturedAt(now);
    setProviderConfidence(null);
    // Alert creation remains server-owned and refuses stale assignment or hand state.
    setFinalAttempt({
      attemptId: `manual-control:${providerEventId}`,
      event,
      runtimeSnapshot: currentRuntime,
      executionMode: "shadow",
    });
  }, [hook.handId, runtime]);

  const manualFallbackBlocked = !hook.handStarted || !hook.showActionStep
    || hook.submitting || hook.actionSyncBlocked || hook.isReadOnly;
  const runManualFallback = useCallback((action: ManualFallbackAction) => {
    if (
      manualFallbackBlocked
      || !hook.actorPlayer
      || typeof hook.handleDockAction !== "function"
    ) return;
    const control = MANUAL_FALLBACK_ACTIONS.find((item) => item.action === action);
    if (!control || !hook.actorViewData?.legal[control.legalKey]) return;
    const betTo = action === "bet" || action === "raise"
      ? hook.actorViewData?.minRaiseTo
      : undefined;
    hook.handleDockAction(action, betTo);
  }, [hook, manualFallbackBlocked]);

  const startMicTest = () => {
    if (status !== "listening") return;
    micTestMaxLevelRef.current = 0;
    micTestFinalCountRef.current = 0;
    micTestActiveRef.current = true;
    setMicTestElapsedMs(0);
    setMicTestResult(null);
    setMicTestStartedAt(Date.now());
  };

  const emitMock = () => {
    const provider = providerRef.current;
    if (!(provider instanceof MockRealtimeTranscriptionProvider)) return;
    provider.emit(mockText, { final: true });
  };

  const revalidateBufferedEvent = async () => {
    const nextRuntime = await refreshRuntime();
    if (!nextRuntime) {
      setBufferStatus("Không đọc được trạng thái bàn. Transcript chưa được gửi; hãy thử lại.");
      return;
    }
    if (!hook.handId || nextRuntime.active_hand?.hand_id !== hook.handId) {
      setBufferedEvents([]);
      setBufferStatus("Hand đã thay đổi. Transcript cũ đã được bỏ; hãy đọc lại action nếu cần.");
      return;
    }
    if (nextRuntime.correction_pending) {
      setBufferStatus("Floor còn cảnh báo chưa xử lý. Mở Cảnh báo Floor để xem hand/action; hand đã void có nút đóng cảnh báo. Voice không ghi action lúc này.");
      return;
    }
    const [nextEvent, ...remaining] = bufferedEvents;
    if (!nextEvent) return;
    setBufferedEvents(remaining);
    setBufferStatus(remaining.length > 0 ? `Còn ${remaining.length} transcript chờ xác nhận Assist.` : null);
    setMode("assist");
    setFinalTranscript(nextEvent.transcript);
    setProviderConfidence(nextEvent.providerConfidence ?? null);
    requestIdentitiesRef.current.delete(nextEvent.providerEventId);
    setFinalAttempt({
      attemptId: `revalidate:${crypto.randomUUID()}`,
      event: { ...nextEvent },
      runtimeSnapshot: nextRuntime,
      executionMode: "assist",
    });
  };

  const assistAllowed = runtime?.config.configured_mode === "assist" || runtime?.config.configured_mode === "auto";
  const handsFreeAssistEnabled = mode === "assist" && runtime?.config.server_auto_allowed === true;
  const autoAllowed = Boolean(
    FEATURES.trackerVoiceAutoCommit
    && runtime?.config.configured_mode === "auto"
    && runtime.config.server_auto_allowed
    && runtime.config.provider_confidence_threshold !== null
    && providerConfidence !== null,
  );

  const confirmAssist = async (): Promise<boolean> => {
    if (
      !hook.tournamentTableId
      ||
      validationState !== "validated"
      || !validatedReceipt
      || !validatedProposal?.ok
      || !("canonicalAction" in validatedProposal)
    ) return false;
    if (assistCommitRef.current) return assistCommitRef.current;
    setValidationState("committing");
    setValidationError(null);
    const actionProposal = validatedProposal as VoiceActionProposal;
    const commit = hook.handleVoiceAction(actionProposal, {
      source: "voice",
      tournamentTableId: hook.tournamentTableId,
      voiceEventId: validatedReceipt.voice_event_id,
      idempotencyKey: validatedReceipt.idempotency_key,
      traceId: validatedReceipt.trace_id,
      expectedStateVersion: validatedReceipt.state_version,
    });
    assistCommitRef.current = commit;
    try {
      const committed = await commit;
      if (!committed) {
        setValidationState("error");
        setValidationError("Action không được canonical writer xác nhận. Hãy tải lại trạng thái bàn.");
        return false;
      }
      const readBack = await refreshRuntime();
      if (!readBack || readBack.active_hand?.hand_id !== hook.handId) {
        setValidationState("error");
        setValidationError("Action đã gửi nhưng không đọc lại được trạng thái bàn. Hãy tải lại trước khi tiếp tục.");
        return false;
      }
      if (!runtimeOverride && readBack.active_hand.state_version === validatedReceipt.state_version) {
        setValidationState("error");
        setValidationError("Server chưa xác nhận state version mới. Hãy tải lại trước khi tiếp tục.");
        return false;
      }
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      setValidationState("committed");
      return true;
    } catch (error) {
      setValidationState("error");
      setValidationError(error instanceof Error
        ? error.message
        : "Không thể xác nhận action Voice. Hãy tải lại trạng thái bàn.");
      return false;
    } finally {
      assistCommitRef.current = null;
    }
  };

  const confirmBoardAssist = async () => {
    const validationGeneration = validationGenerationRef.current;
    const connectionGeneration = connectionGenerationRef.current;
    const isCurrent = () => runtimeScopeRef.current === runtimeScopeKey
      && validationGenerationRef.current === validationGeneration
      && connectionGenerationRef.current === connectionGeneration;
    if (
      !isCurrent()
      || !hook.tournamentTableId
      || validationState !== "validated"
      || !validatedReceipt
      || !validatedProposal?.ok
      || !("intentDomain" in validatedProposal && validatedProposal.intentDomain === "board")
      || assistCommitRef.current
    ) return;
    setValidationState("committing");
    setValidationError(null);
    const boardProposal = validatedProposal as VoiceBoardProposal;
    const commit = (async () => {
      const canonicalRequest = await buildVoiceBoardCanonicalRequest({
        rawTranscript: boardProposal.command.rawTranscript,
        expectedStateVersion: validatedReceipt.state_version,
        expectedWorkflowState: boardProposal.expectedWorkflowState,
        expectedStreet: boardProposal.expectedStreet,
        payload: {
          street: boardProposal.expectedStreet,
          newCards: boardProposal.command.newCards,
          cumulativeCards: boardProposal.cumulativeCards,
          expectedExistingBoardCount: boardProposal.expectedExistingBoardCount,
        },
      });
      if (!isCurrent()) return false;
      const receipt = await commitBoardOverride({
        tournamentId: hook.tournamentId,
        tournamentTableId: hook.tournamentTableId!,
        handId: hook.handId!,
        voiceEventId: validatedReceipt.voice_event_id,
        idempotencyKey: validatedReceipt.idempotency_key,
        traceId: validatedReceipt.trace_id,
        canonicalRequest,
      });
      if (!isCurrent()) return false;
      if (!hook.applyVoiceBoardReceipt(receipt)) {
        throw new Error("Receipt Board không khớp hand đang mở. Hãy tải lại bàn.");
      }
      const readBack = await refreshRuntime();
      if (!isCurrent()) return false;
      if (!readBack || readBack.active_hand?.hand_id !== hook.handId
        || (!runtimeOverride && readBack.active_hand.state_version !== receipt.state_version_after)) {
        throw new Error("Board đã gửi nhưng không đọc lại được trạng thái server. Hãy tải lại trước khi tiếp tục.");
      }
      return true;
    })();
    assistCommitRef.current = commit;
    try {
      const committed = await commit;
      if (!isCurrent() || !committed) return;
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      setValidationState("committed");
    } catch (error) {
      if (!isCurrent()) return;
      // Preserve the immutable event/idempotency key. A retry uses the same
      // key, and the transactional RPC returns its receipt instead of writing twice.
      setValidationState("validated");
      setValidationError(error instanceof Error ? error.message : "Không thể xác nhận Board Voice.");
    } finally {
      if (assistCommitRef.current === commit) assistCommitRef.current = null;
    }
  };

  const cancelPendingAction = () => {
    if (validationState === "committing") return;
    validationGenerationRef.current += 1;
    handsFreeActionCommitRef.current = null;
    setActionCountdownMs(null);
    setProposal(null);
    setValidatedProposal(null);
    setValidatedReceipt(null);
    setValidationError(null);
    setValidationState("idle");
  };

  const handsFreeActionReady = handsFreeAssistEnabled
    && validationState === "validated"
    && Boolean(validatedReceipt)
    && Boolean(validatedProposal?.ok && "canonicalAction" in validatedProposal);

  useEffect(() => {
    handsFreeActionCommitRef.current = handsFreeActionReady ? confirmAssist : null;
    cancelPendingActionRef.current = handsFreeActionReady ? cancelPendingAction : null;
    confirmBoardAssistRef.current = confirmBoardAssist;
  });

  useEffect(() => {
    if (!handsFreeActionReady) {
      setActionCountdownMs(null);
      return;
    }

    const deadline = performance.now() + ACTION_AUTO_COMMIT_MS;
    setActionCountdownMs(ACTION_AUTO_COMMIT_MS);
    const interval = window.setInterval(() => {
      setActionCountdownMs(Math.max(0, deadline - performance.now()));
    }, 100);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      setActionCountdownMs(0);
      if (document.visibilityState !== "visible" || !navigator.onLine || statusRef.current !== "listening") {
        handsFreeActionCommitRef.current = null;
        setValidationError("Đã dừng tự ghi vì tab, mạng hoặc microphone không còn sẵn sàng.");
        return;
      }
      const commit = handsFreeActionCommitRef.current;
      handsFreeActionCommitRef.current = null;
      void commit?.();
    }, ACTION_AUTO_COMMIT_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [handsFreeActionReady]);

  useEffect(() => {
    const boardReady = handsFreeAssistEnabled
      && validationState === "validated"
      && Boolean(validatedReceipt)
      && Boolean(validatedProposal?.ok
        && "intentDomain" in validatedProposal
        && validatedProposal.intentDomain === "board");
    if (!boardReady || !validatedReceipt) return;
    if (autoBoardCommitEventRef.current === validatedReceipt.voice_event_id) return;
    if (document.visibilityState !== "visible" || !navigator.onLine || statusRef.current !== "listening") {
      setValidationError("Board chưa tự ghi vì tab, mạng hoặc microphone không còn sẵn sàng.");
      return;
    }
    autoBoardCommitEventRef.current = validatedReceipt.voice_event_id;
    void confirmBoardAssistRef.current?.();
  }, [handsFreeAssistEnabled, validationState, validatedProposal, validatedReceipt]);

  const confirmHoleCardsAssist = async (): Promise<boolean> => {
    const validationGeneration = validationGenerationRef.current;
    const connectionGeneration = connectionGenerationRef.current;
    const isCurrent = () => runtimeScopeRef.current === runtimeScopeKey
      && validationGenerationRef.current === validationGeneration
      && connectionGenerationRef.current === connectionGeneration;
    const attempts = [...privateHoleCardsAttemptsRef.current];
    if (
      !isCurrent()
      || attempts.length === 0
      || !hook.tournamentTableId
      || mode !== "assist"
      || assistCommitRef.current
    ) return false;
    const queuedCards = attempts.flatMap((attempt) => [...attempt.proposal.command.cards]);
    if (new Set(queuedCards).size !== queuedCards.length) {
      setValidationError("Các bài tẩy đang chờ có lá trùng nhau. Hãy hủy và đọc lại.");
      return false;
    }
    setValidationState("committing");
    setValidationError(null);
    const committedProviderEventIds = new Set<string>();
    const commit = (async () => {
      let currentRuntime = await refreshRuntime();
      if (!isCurrent()) return null;
      if (!currentRuntime?.active_hand || currentRuntime.active_hand.hand_id !== hook.handId) {
        throw new Error("Không đọc lại được hand trước khi xác nhận bài tẩy.");
      }
      let lastSeat: number | null = null;
      for (const privateAttempt of attempts) {
        const expectedStateVersion = currentRuntime.active_hand.state_version;
        let identity = requestIdentitiesRef.current.get(privateAttempt.event.providerEventId);
        if (!identity) {
          identity = {
            idempotencyKey: `voice:${crypto.randomUUID()}`,
            traceId: `voice-trace:${crypto.randomUUID()}`,
          };
          requestIdentitiesRef.current.set(privateAttempt.event.providerEventId, identity);
        }
        const canonicalRequest = await buildVoiceHoleCardsCanonicalRequest({
          rawTranscript: privateAttempt.event.transcript,
          expectedStateVersion,
          payload: {
            seatNumber: privateAttempt.proposal.player.seatNumber,
            expectedPlayerId: privateAttempt.proposal.player.playerId,
            expectedEntryNumber: privateAttempt.proposal.player.entryNumber,
            cards: privateAttempt.proposal.command.cards,
          },
        });
        if (!isCurrent()) return null;
        const receipt = await commitHoleCardsOverride({
          tournamentId: hook.tournamentId,
          tournamentTableId: hook.tournamentTableId,
          handId: hook.handId!,
          finalTranscript: privateAttempt.event.transcript,
          providerName: providerRef.current?.kind ?? "openai_realtime",
          providerModel: privateAttempt.runtimeSnapshot.config.provider_model,
          providerEventId: privateAttempt.event.providerEventId,
          expectedStateVersion,
          ...identity,
          canonicalRequest,
        });
        if (!isCurrent()) return null;
        if (!hook.applyVoiceHoleCardsReceipt({
          receipt,
          playerId: privateAttempt.proposal.player.playerId,
          entryNumber: privateAttempt.proposal.player.entryNumber,
          cards: privateAttempt.proposal.command.cards,
        })) {
          throw new Error("Receipt bài tẩy không khớp hand đang mở. Hãy tải lại bàn.");
        }
        committedProviderEventIds.add(privateAttempt.event.providerEventId);
        lastSeat = receipt.seat_number;
        if (runtimeOverride) {
          currentRuntime = {
            ...currentRuntime,
            active_hand: { ...currentRuntime.active_hand, state_version: receipt.state_version_after },
          };
        } else {
          const readBack = await refreshRuntime();
          if (!isCurrent()) return null;
          if (!readBack?.active_hand || readBack.active_hand.hand_id !== hook.handId
            || readBack.active_hand.state_version !== receipt.state_version_after) {
            throw new Error("Bài tẩy đã gửi nhưng không đọc lại được trạng thái server. Hãy tải lại trước khi tiếp tục.");
          }
          currentRuntime = readBack;
        }
      }
      return lastSeat;
    })();
    // Keep the single-flight guard settled even when the receipt request fails.
    // The original promise below still preserves the proposal and idempotency key for retry.
    const guard = commit.then(() => true, () => false);
    assistCommitRef.current = guard;
    try {
      const lastSeat = await commit;
      if (!isCurrent()) return false;
      privateHoleCardsAttemptsRef.current = [];
      setPrivateHoleCardsAttempts([]);
      setConfirmedHoleSeat(lastSeat);
      setProposal(null);
      setValidatedProposal(null);
      setValidatedReceipt(null);
      setValidationState("committed");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const remaining = attempts.filter((attempt) => !committedProviderEventIds.has(attempt.event.providerEventId));
      privateHoleCardsAttemptsRef.current = remaining;
      setPrivateHoleCardsAttempts(remaining);
      setValidationState("validated");
      setValidationError(error instanceof Error ? error.message : "Không thể xác nhận bài tẩy Voice.");
      return false;
    } finally {
      if (assistCommitRef.current === guard) assistCommitRef.current = null;
    }
  };

  const cancelHoleCardsAssist = () => {
    if (validationState === "committing") return;
    privateHoleCardsAttemptsRef.current = [];
    setPrivateHoleCardsAttempts([]);
    setValidationError(null);
    setValidationState("idle");
  };

  useEffect(() => {
    confirmHoleCardsQueueRef.current = handsFreeAssistEnabled && privateHoleCardsAttempts.length > 0
      ? confirmHoleCardsAssist
      : null;
  });

  const confirmFinishAssist = async () => {
    const validationGeneration = validationGenerationRef.current;
    const connectionGeneration = connectionGenerationRef.current;
    const isCurrent = () => runtimeScopeRef.current === runtimeScopeKey
      && validationGenerationRef.current === validationGeneration
      && connectionGenerationRef.current === connectionGeneration;
    const attempt = finishAttempt;
    const expectedStateVersion = attempt?.proposal.expectedStateVersion;
    if (
      !isCurrent()
      || !attempt
      || !expectedStateVersion
      || !hook.tournamentTableId
      || mode !== "assist"
      || assistCommitRef.current
    ) return;
    setValidationState("committing");
    setValidationError(null);
    let identity = requestIdentitiesRef.current.get(attempt.event.providerEventId);
    if (!identity) {
      identity = {
        idempotencyKey: `voice:${crypto.randomUUID()}`,
        traceId: `voice-trace:${crypto.randomUUID()}`,
      };
      requestIdentitiesRef.current.set(attempt.event.providerEventId, identity);
    }
    const commit = (async () => {
      const canonicalRequest = await buildVoiceFinishCanonicalRequest({
        rawTranscript: attempt.event.transcript,
        expectedStateVersion,
        payload: {
          settlementOrigin: attempt.receipt.settlement_origin,
          settlementDigest: attempt.receipt.settlement_digest,
        },
      });
      if (!isCurrent()) return null;
      const receipt = await commitFinishOverride({
        tournamentId: hook.tournamentId,
        tournamentTableId: hook.tournamentTableId,
        handId: hook.handId!,
        finalTranscript: attempt.event.transcript,
        providerName: providerRef.current?.kind ?? "openai_realtime",
        providerModel: attempt.runtimeSnapshot.config.provider_model,
        providerEventId: attempt.event.providerEventId,
        expectedStateVersion,
        ...identity,
        canonicalRequest,
      });
      if (!isCurrent()) return null;
      const readBack = await refreshRuntime();
      if (!isCurrent()) return null;
      if (!readBack || readBack.active_hand?.hand_id === receipt.hand_id) {
        throw new Error("Hand đã gửi nhưng chưa đọc lại được trạng thái canonical. Hãy tải lại bàn.");
      }
      if (!await hook.applyVoiceFinishReceipt(receipt)) {
        throw new Error("Receipt Finish không khớp hand đang mở. Hãy tải lại bàn.");
      }
      return receipt;
    })();
    const guard = commit.then(() => true, () => false);
    assistCommitRef.current = guard;
    try {
      const receipt = await commit;
      if (!isCurrent() || !receipt) return;
      setFinishAttempt(null);
      setFinalTranscript("");
      setValidationState("committed");
    } catch (error) {
      if (!isCurrent()) return;
      setValidationState("validated");
      setValidationError(error instanceof Error ? error.message : "Không thể xác nhận lưu Hand bằng Voice.");
    } finally {
      if (assistCommitRef.current === guard) assistCommitRef.current = null;
    }
  };

  const cancelFinishAssist = () => {
    if (validationState === "committing") return;
    setFinishAttempt(null);
    setValidationError(null);
    setValidationState("idle");
  };

  const proposalLabel = proposal?.ok === true
    ? "intentDomain" in proposal
      ? `${proposal.expectedStreet.toUpperCase()} · ${proposal.command.newCards.join(" ")}`
      : "controlAction" in proposal
      ? proposal.controlAction === "call_floor" ? "Gọi Floor" : "Báo sai action"
      : `${proposal.actor.playerName} · ${proposal.canonicalAction}${proposal.betToTotal ? ` tới ${proposal.betToTotal.toLocaleString("vi-VN")}` : ""}`
    : proposal?.ok === false ? proposal.message : (mode === "assist" ? "Đọc action, Board hoặc bài tẩy all-in." : "Nói một lệnh để tạo đề xuất Shadow.");

  const providerKind = providerRef.current?.kind ??
    (import.meta.env.VITE_TRACKER_VOICE_PROVIDER === "mock"
      ? "mock"
      : isTrackerVoiceGeminiLiveModel(runtime?.config.provider_model)
        ? "gemini_live"
        : "openai_realtime");
  const microphoneBusy = status === "requesting_permission"
    || status === "preparing_audio"
    || status === "connecting"
    || status === "connected"
    || status === "audio_running"
    || status === "flushing";
  const microphoneButtonLabel = status === "listening"
    ? "Tạm dừng Voice"
    : status === "requesting_permission"
      ? "Đang chờ quyền mic..."
      : status === "preparing_audio"
        ? "Đang chuẩn bị âm thanh..."
        : status === "connecting"
          ? "Đang kết nối Gemini..."
          : status === "connected" || status === "audio_running"
            ? "Đang khởi động PCM..."
            : status === "flushing"
              ? "Đang hoàn tất câu cuối..."
              : status === "paused"
                ? "Tiếp tục Voice"
                : "Cho phép microphone";
  const microphoneStatusLabel = status === "listening"
    ? "Microphone đã kết nối"
    : status === "requesting_permission"
      ? "Đang chờ bạn cho phép microphone"
      : status === "preparing_audio"
        ? "Đã có quyền mic, đang chuẩn bị âm thanh"
        : status === "connecting"
          ? "Đang kết nối Gemini Live"
          : status === "connected"
            ? "Gemini đã kết nối, đang kiểm tra PCM"
            : status === "audio_running"
              ? "PCM đã chạy, chờ khung âm thanh đầu tiên"
              : status === "flushing"
                ? "Đang nhận final transcript cuối"
                : status === "paused"
                  ? "Voice đã tạm dừng an toàn"
                  : "Microphone chưa được kết nối";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-[linear-gradient(135deg,rgba(5,18,14,.95),rgba(8,10,13,.96))] shadow-[0_18px_50px_rgba(0,0,0,.28)]"
      aria-label="Voice Tracker"
      data-compact={compact}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-300">
            <Radio className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-100">{compact ? "Voice Assist" : "Voice Tracker"}</h2>
            <p className={`truncate text-[11px] text-zinc-500 ${compact ? "hidden" : ""}`}>
              {providerKind === "mock"
                ? "Mock mic · Preview"
                : providerKind === "gemini_live"
                  ? "Gemini Live · Dealer assignment bắt buộc"
                  : "OpenAI Realtime · Dealer assignment bắt buộc"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={status === "listening" ? () => void pause() : () => void connect()}
            disabled={microphoneBusy}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 text-xs font-semibold text-emerald-200 outline-none transition hover:bg-emerald-300/15 focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-70"
          >
            {status === "listening" || status === "flushing" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {microphoneButtonLabel}
          </button>
          {status !== "idle" && status !== "requesting_permission" && status !== "preparing_audio" && (
            <button
              type="button"
              onClick={() => void reconnect()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <RotateCcw className="h-4 w-4" /> Kết nối lại
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <details open={compact ? undefined : true} className="dealer-voice-settings">
        {compact && <summary className="cursor-pointer py-2 text-xs text-emerald-100/70">Microphone & chế độ · {microphoneStatusLabel}</summary>}
        <div className="grid grid-cols-3 gap-2" aria-label="Chế độ Voice">
          {(["shadow", "assist", "auto"] as const).map((item) => {
            const unavailable = item === "assist" ? !assistAllowed : item === "auto" ? !autoAllowed : false;
            return (
              <button
                key={item}
                type="button"
                disabled={unavailable}
                onClick={() => setMode(item)}
                className={`min-h-11 rounded-xl border px-2 text-[11px] font-semibold uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-35 ${
                  mode === item
                    ? "border-emerald-300/45 bg-emerald-300/15 text-emerald-200"
                    : "border-white/10 bg-white/[0.03] text-zinc-400"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-white/8 bg-black/25 px-3">
          <span className={`h-2.5 w-2.5 rounded-full ${status === "listening" ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.8)]" : "bg-zinc-600"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-200">{microphoneStatusLabel}</div>
            <div className="truncate text-[11px] text-zinc-500">{statusMessage ?? (partial || "Final transcript mới được phân tích.")}</div>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500" title="Trạng thái tai nghe và microphone">
            <Headphones className="h-4 w-4" />
            {status === "listening" ? "Mic đang theo dõi" : status === "flushing" ? "Đang flush câu cuối" : "Mic chưa sẵn sàng"}
          </span>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-semibold text-zinc-300">Tín hiệu microphone</span>
            <span className="font-mono text-zinc-500">{Math.round(audioLevel * 100)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/7" aria-label="Mức tín hiệu microphone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(audioLevel * 100)} role="meter">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-300 to-amber-300 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(2, audioLevel * 100)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={status !== "listening" || micTestStartedAt !== null}
              onClick={startMicTest}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-35"
            >
              {micTestStartedAt === null ? "Kiểm tra mic 30 giây" : `Đang test ${Math.ceil((MIC_TEST_DURATION_MS - micTestElapsedMs) / 1000)}s`}
            </button>
            {(status === "recovering" || status === "offline" || status === "error") && (
              <button
                type="button"
                onClick={reconnect}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 text-xs font-semibold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <RotateCcw className="h-4 w-4" /> Kết nối lại
              </button>
            )}
          </div>
          {micTestStartedAt !== null && (
            <div className="mt-3 grid min-h-24 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] text-center" aria-live="polite">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200/75">Kiểm tra microphone</span>
              <strong className="text-3xl font-black tabular-nums text-emerald-200">{Math.max(0, Math.ceil((MIC_TEST_DURATION_MS - micTestElapsedMs) / 1000))}s</strong>
            </div>
          )}
          {micTestResult && <p className="mt-2 text-[11px] text-zinc-400" aria-live="polite">{micTestResult}</p>}
        </div>

        </details>
        <div className="grid grid-cols-2 gap-2" aria-label="Floor alerts">
          <button
            type="button"
            disabled
            title="Báo sai action đang tạm khóa; dùng Gọi Floor để được hỗ trợ. Hand chưa tự dừng."
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/30 bg-rose-300/[0.08] px-3 text-xs font-bold text-rose-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
          >
            <AlertTriangle className="h-4 w-4" /> Báo sai action (chưa khả dụng)
          </button>
          <button
            type="button"
            onClick={() => submitControlAction("call_floor")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/[0.08] px-3 text-xs font-bold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            <PhoneCall className="h-4 w-4" /> Gọi Floor
          </button>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/20 p-3" aria-label="Fallback hand actions">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-zinc-300">Fallback thao tác tay</span>
            <span className="text-[10px] text-zinc-500">Không qua Voice</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MANUAL_FALLBACK_ACTIONS.map(({ action, label, legalKey }) => {
              const isLegal = Boolean(hook.actorViewData?.legal[legalKey]);
              const disabled = manualFallbackBlocked || !hook.actorPlayer || typeof hook.handleDockAction !== "function" || !isLegal;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  onClick={() => runManualFallback(action)}
                  className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-xs font-bold text-zinc-200 outline-none transition hover:border-emerald-300/30 hover:bg-emerald-300/[0.08] focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {providerKind === "mock" && (
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="tracker-voice-mock-transcript">Mock transcript</label>
            <input
              id="tracker-voice-mock-transcript"
              value={mockText}
              onChange={(event) => setMockText(event.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            />
            <button
              type="button"
              onClick={emitMock}
              disabled={status !== "listening"}
              className="min-h-11 rounded-xl bg-emerald-300 px-4 text-xs font-bold text-emerald-950 disabled:opacity-35"
            >
              Phát final
            </button>
          </div>
        )}

        {bufferedEvents.length > 0 && (
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3" aria-live="polite">
            <div className="text-xs font-semibold text-amber-100">
              {bufferedEvents.length} transcript đang chờ Floor
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
              {bufferStatus ?? "Không action nào được ghi trong khi correction pending."}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-amber-100/80">
              Nếu hand còn mở, Dealer có thể chuyển sang Thủ công để sửa và tiếp tục. Hand đã lưu cần luồng sửa hand/Floor. Voice vẫn tạm dừng cho tới khi cảnh báo được xử lý.
            </p>
            <button
              type="button"
              onClick={() => { setBufferedEvents([]); setBufferStatus(null); }}
              className="mt-3 min-h-11 w-full rounded-xl border border-amber-200/30 px-3 text-xs font-bold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Bỏ transcript chờ
            </button>
            <button
              type="button"
              onClick={() => void revalidateBufferedEvent()}
              className="mt-3 min-h-11 w-full rounded-xl border border-amber-200/30 bg-black/20 px-3 text-xs font-bold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Kiểm tra lại sau khi Floor sửa
            </button>
          </div>
        )}

        <div className={`dealer-voice-proposal rounded-xl border p-3 ${proposalTone(proposal)}`} aria-live="polite" aria-atomic="true">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">
            {proposal?.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Voice Assist proposal
          </div>
          <div className="text-sm font-semibold">{proposalLabel}</div>
          {finalTranscript && <div className="mt-1 text-[11px] opacity-65">“{finalTranscript}”</div>}
          {proposal?.ok && "intentDomain" in proposal && proposal.intentDomain === "board" && (
            <div className="mt-2 space-y-1 text-[11px] opacity-80">
              <div>Board đã lưu: {proposal.persistedBoardCards.join(" ") || "chưa có"}</div>
              <div>Board đề xuất: {proposal.cumulativeCards.join(" ")}</div>
              <div className="font-semibold text-amber-100">
                {handsFreeAssistEnabled ? "ĐANG GHI BOARD QUA SERVER" : "CẦN CHẠM XÁC NHẬN · CHƯA GHI BOARD"}
              </div>
            </div>
          )}
          {providerConfidence === null && finalTranscript && !handsFreeAssistEnabled && (
            <div className="mt-2 text-[10px] opacity-70">Provider không trả confidence tương thích: Auto bị khóa.</div>
          )}
          {validationState === "validating" && (
            <div className="mt-2 flex items-center gap-2 text-[11px] opacity-75">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang xác minh assignment và luật action trên server
            </div>
          )}
          {validationState === "validated" && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-200">
              <Check className="h-3.5 w-3.5" />
              {validatedReceipt?.execution_result === "alert_opened"
                ? "Alert đã vào hàng đợi Floor."
                : mode === "shadow"
                  ? "Shadow hợp lệ, không gọi server và chưa ghi action."
                  : handsFreeAssistEnabled
                    ? "Đã xác minh. Hands-free đang xử lý."
                    : "Đã xác minh, chờ Dealer xác nhận."}
            </div>
          )}
          {handsFreeAssistEnabled
            && actionCountdownMs !== null
            && validatedProposal?.ok
            && "canonicalAction" in validatedProposal && (
              <div className="mt-3 flex items-center gap-3" role="timer" aria-label="Đếm ngược tự ghi action">
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full p-[3px]"
                  style={{ background: `conic-gradient(rgb(110 231 183) ${Math.max(0, actionCountdownMs / ACTION_AUTO_COMMIT_MS) * 360}deg, rgba(255,255,255,.1) 0deg)` }}
                >
                  <span className="grid h-full w-full place-items-center rounded-full bg-[#07110e] text-base font-black tabular-nums text-emerald-200">
                    {Math.max(1, Math.ceil(actionCountdownMs / 1000))}
                  </span>
                </div>
                <div className="text-[11px] leading-relaxed text-emerald-100/80">
                  Tự ghi sau 3 giây. Đọc action kế tiếp để chốt ngay, hoặc nói “Báo sai”.
                </div>
              </div>
            )}
          {validationError && <div className="mt-2 text-[11px] text-rose-200">{validationError}</div>}
        </div>

        {privateHoleCardsAttempts.length > 0 && (
          <div
            className="rounded-xl border border-fuchsia-300/35 bg-fuchsia-300/[0.07] p-3 text-fuchsia-50"
            data-testid="voice-private-hole-cards-proposal"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-fuchsia-200/80">Voice Hole Cards</div>
            <div className="mt-3 space-y-2">
              {privateHoleCardsAttempts.map((attempt) => (
                <div key={attempt.event.providerEventId} className="flex items-center justify-between gap-3 rounded-lg border border-fuchsia-200/20 bg-black/20 p-2">
                  <div className="text-sm font-semibold">
                    Ghế {attempt.proposal.player.seatNumber} · {attempt.proposal.player.playerName}
                  </div>
                  <div className="flex gap-2" aria-label={`Bài tẩy đề xuất cho Ghế ${attempt.proposal.player.seatNumber}`}>
                    {attempt.proposal.command.cards.map((card) => (
                      <span key={card} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-fuchsia-200/35 bg-black/25 px-3 font-mono text-lg font-black">
                        {formatPrivateCard(card)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-semibold text-amber-100">CHƯA GHI BÀI · NÓI “XÁC NHẬN”</p>
            <p className="mt-1 text-[11px] text-fuchsia-100/70">Các transcript riêng tư chỉ giữ trong trình duyệt cho tới khi xác nhận hoặc hủy.</p>
            {mode === "assist" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void confirmHoleCardsAssist()}
                  disabled={validationState === "committing"}
                  className="min-h-11 rounded-xl bg-fuchsia-200 px-3 text-sm font-bold text-fuchsia-950 outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                >
                  {validationState === "committing"
                    ? "Đang xác nhận..."
                    : privateHoleCardsAttempts.length === 1
                      ? `Xác nhận bài Ghế ${privateHoleCardsAttempts[0].proposal.player.seatNumber}`
                      : `Xác nhận ${privateHoleCardsAttempts.length} ghế`}
                </button>
                <button
                  type="button"
                  onClick={cancelHoleCardsAssist}
                  disabled={validationState === "committing"}
                  className="min-h-11 rounded-xl border border-white/15 bg-black/20 px-3 text-sm font-bold text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-100 disabled:opacity-50"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-fuchsia-100/70">SHADOW · Không tự ghi bài. Chuyển Assist mới có thể xác nhận.</p>
            )}
          </div>
        )}

        {finishAttempt && (
          <div
            className="rounded-xl border border-amber-300/35 bg-amber-300/[0.07] p-3 text-amber-50"
            data-testid="voice-finish-proposal"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/80">VOICE FINISH ASSIST</div>
            <div className="mt-1 text-sm font-semibold">
              {finishAttempt.receipt.settlement_origin === "engine_fold_win" ? "Fold win đã được engine xác minh" : "Showdown đã được engine xác minh"}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-amber-50/85">
              <div>Winner: {finishAttempt.receipt.summary.winners.map((winner) => `Ghế ${winner.seat_number}${winner.player_name ? ` · ${winner.player_name}` : ""} +${winner.amount.toLocaleString("vi-VN")}`).join(" | ") || "—"}</div>
              <div>Pot: {finishAttempt.receipt.summary.pots.map((pot) => `${pot.kind === "main" ? "Main" : "Side"} ${pot.amount.toLocaleString("vi-VN")}`).join(" · ") || "—"}</div>
              <div>Ending stack: {finishAttempt.receipt.summary.ending_stacks.map((stack) => `Ghế ${stack.seat_number} ${stack.amount.toLocaleString("vi-VN")}`).join(" | ") || "—"}</div>
              <div>Conservation: {finishAttempt.receipt.summary.conservation_total.toLocaleString("vi-VN")} chip</div>
            </div>
            <p className="mt-3 text-[11px] font-semibold text-amber-100">CHƯA LƯU HAND</p>
            <p className="mt-1 text-[11px] font-semibold text-amber-100">CẦN CHẠM XÁC NHẬN</p>
            {mode === "assist" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void confirmFinishAssist()}
                  disabled={validationState === "committing"}
                  className="min-h-11 rounded-xl bg-amber-200 px-3 text-sm font-bold text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                >
                  {validationState === "committing" ? "Đang xác nhận..." : "XÁC NHẬN LƯU HAND"}
                </button>
                <button
                  type="button"
                  onClick={cancelFinishAssist}
                  disabled={validationState === "committing"}
                  className="min-h-11 rounded-xl border border-white/15 bg-black/20 px-3 text-sm font-bold text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-100 disabled:opacity-50"
                >
                  HỦY
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-amber-100/70">SHADOW · Không tự lưu Hand. Chuyển Assist mới có thể xác nhận.</p>
            )}
          </div>
        )}

        {mode === "assist"
          && validationState === "validated"
          && validatedProposal?.ok
          && "canonicalAction" in validatedProposal && (
            <button
              type="button"
              onClick={() => void confirmAssist()}
              className="min-h-11 w-full rounded-xl bg-emerald-300 px-4 text-sm font-bold text-emerald-950 outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
            >
              {handsFreeAssistEnabled ? "Chốt ngay" : "Xác nhận action"}
            </button>
          )}
        {mode === "assist"
          && (!handsFreeAssistEnabled || Boolean(validationError))
          && validationState === "validated"
          && validatedProposal?.ok
          && "intentDomain" in validatedProposal
          && validatedProposal.intentDomain === "board" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={confirmBoardAssist}
                className="min-h-11 rounded-xl bg-emerald-300 px-4 text-sm font-bold text-emerald-950 outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
              >
                Xác nhận {validatedProposal.expectedStreet === "flop" ? "Flop" : validatedProposal.expectedStreet === "turn" ? "Turn" : "River"}
              </button>
              <button
                type="button"
                onClick={() => {
                  validationGenerationRef.current += 1;
                  setProposal(null);
                  setValidatedProposal(null);
                  setValidatedReceipt(null);
                  setValidationError(null);
                  setValidationState("idle");
                }}
                className="min-h-11 rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-bold text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
              >
                Hủy
              </button>
            </div>
          )}
        {validationState === "committing" && (
          <div className="flex min-h-11 items-center justify-center gap-2 text-xs text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang ghi qua canonical writer
          </div>
        )}
        {validationState === "committed" && (
          <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-xs font-semibold text-emerald-200">
            <Check className="h-4 w-4" /> {confirmedHoleSeat === null
              ? "Canonical receipt đã được Viewer/Replay nhận qua luồng hiện tại"
              : `Đã xác nhận bài Ghế ${confirmedHoleSeat}`}
          </div>
        )}
        {runtimeError && (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
            Chỉ xem: {runtimeError}
          </div>
        )}
      </div>
    </section>
  );
}
