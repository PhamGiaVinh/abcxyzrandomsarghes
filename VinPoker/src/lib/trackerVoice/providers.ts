import type {
  RealtimeTranscriptionProvider,
  VoiceProviderHandlers,
  VoiceTranscriptEvent,
} from "./types";
import {
  createGeminiLiveAudioPayload,
  Pcm16FrameAccumulator,
  pcm16ToLittleEndianBytes,
  resampleMonoToPcm16,
} from "./geminiPcm";
import {
  buildGeminiLiveConnectConfig,
  buildGeminiVoiceProfile,
  TRACKER_VOICE_GEMINI_LEGACY_MODEL,
  TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL,
  TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY,
  type GeminiTranscribeLanguageProfile,
} from "./geminiTranscribeProfile";

export class MockRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  readonly kind = "mock" as const;
  private handlers: VoiceProviderHandlers | null = null;

  async connect(handlers: VoiceProviderHandlers): Promise<void> {
    this.handlers = handlers;
    handlers.onInputDevice?.({ deviceId: "mock-microphone", label: "Mock microphone" });
    handlers.onStatus("listening");
  }

  async disconnect(): Promise<void> {
    this.handlers?.onStatus("idle");
    this.handlers = null;
  }

  async pause(): Promise<void> {
    this.handlers?.onStatus("paused");
  }

  emit(transcript: string, options: { final?: boolean; confidence?: number; id?: string } = {}): void {
    if (!this.handlers) throw new Error("mock_provider_not_connected");
    const event: VoiceTranscriptEvent = {
      providerEventId: options.id ?? crypto.randomUUID(),
      transcript,
      isFinal: options.final ?? true,
      capturedAt: new Date().toISOString(),
      ...(options.confidence === undefined ? {} : { providerConfidence: options.confidence }),
    };
    this.handlers.onTranscript(event);
  }

  emitLevel(rms: number): void {
    if (!this.handlers) throw new Error("mock_provider_not_connected");
    this.handlers.onLevel?.(Math.max(0, Math.min(1, rms)));
  }
}

export interface OpenAIRealtimeSessionCredential {
  clientSecret: string;
  model: string;
  expiresAt: string;
}

export interface OpenAIRealtimeProviderOptions {
  getSessionCredential: () => Promise<OpenAIRealtimeSessionCredential>;
  language?: string;
  prompt?: string;
}

export function createTrackerVoiceOpenAiProvider(
  tournamentId: string,
  tournamentTableId: string,
): RealtimeTranscriptionProvider {
  return new OpenAIRealtimeTranscriptionProvider({
    language: "vi",
    prompt: "Poker actions: fold, check, call, bet, raise, all-in; chip amounts in Vietnamese or English.",
    getSessionCredential: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("tracker-voice-session", {
        body: { tournament_id: tournamentId, tournament_table_id: tournamentTableId },
      });
      if (error || !data?.client_secret || !data?.model || !data?.expires_at) {
        throw new Error(data?.error ?? "Không cấp được phiên Voice cho bàn này.");
      }
      return { clientSecret: data.client_secret, model: data.model, expiresAt: data.expires_at };
    },
  });
}

/**
 * This provider is deliberately isolated to the protected Preview diagnostic.
 * It never reads a production Voice config or invokes a Supabase Edge function.
 */
export function createTrackerVoicePreviewOpenAiProvider(): RealtimeTranscriptionProvider {
  return new OpenAIRealtimeTranscriptionProvider({
    getSessionCredential: async () => {
      const response = await fetch("/api/tracker-voice-uat-session", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        client_secret?: unknown;
        model?: unknown;
        expires_at?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof payload?.client_secret !== "string" || typeof payload.model !== "string" || typeof payload.expires_at !== "string") {
        throw new Error(typeof payload?.error === "string" ? payload.error : "preview_voice_session_unavailable");
      }
      return {
        clientSecret: payload.client_secret,
        model: payload.model,
        expiresAt: payload.expires_at,
      };
    },
  });
}

export interface GeminiLiveSessionCredential {
  ephemeralToken: string;
  model: string;
  expiresAt: string;
  languageProfile?: GeminiTranscribeLanguageProfile;
}

export const TRACKER_VOICE_GEMINI_LIVE_MODEL = TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL;
export const GEMINI_LIVE_INPUT_LANGUAGE_CODES = ["vi-VN", "en-US"] as const;
export const TRACKER_VOICE_GEMINI_CUSTOM_VOCABULARY = TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY;

/** A short bounded wait prevents Stop from dropping Gemini's final transcript. */
export const GEMINI_LIVE_FINAL_FLUSH_TIMEOUT_MS = 2_500;

export interface GeminiLiveAudioReadiness {
  microphonePermissionGranted: boolean;
  streamLive: boolean;
  socketReady: boolean;
  audioContextRunning: boolean;
  captureReady: boolean;
  pcmFrameDelivered: boolean;
}

export const EMPTY_GEMINI_LIVE_AUDIO_READINESS: GeminiLiveAudioReadiness = {
  microphonePermissionGranted: false,
  streamLive: false,
  socketReady: false,
  audioContextRunning: false,
  captureReady: false,
  pcmFrameDelivered: false,
};

/** Gemini socket connection is intentionally weaker than a real listening state. */
export function isGeminiLiveListeningReady(readiness: GeminiLiveAudioReadiness): boolean {
  return readiness.microphonePermissionGranted
    && readiness.streamLive
    && readiness.socketReady
    && readiness.audioContextRunning
    && readiness.captureReady
    && readiness.pcmFrameDelivered;
}

/** Ignore callbacks from a closed generation after the user reconnects. */
export function isGeminiLiveConnectionCurrent(
  eventGeneration: number,
  activeGeneration: number,
  active: boolean,
): boolean {
  return active && eventGeneration === activeGeneration;
}

type ResumableAudioContext = Pick<AudioContext, "resume" | "state">;

/** Safari can keep a context suspended after permission is granted, so fail closed. */
export async function resumeGeminiLiveAudioContext(audioContext: ResumableAudioContext): Promise<void> {
  await audioContext.resume();
  if (audioContext.state !== "running") {
    throw new Error("MIC_AUDIO_CONTEXT_SUSPENDED: hãy chạm Cho phép microphone rồi thử lại.");
  }
}

export function isTrackerVoiceGeminiLiveModel(model: string | null | undefined): boolean {
  return model === TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL || model === TRACKER_VOICE_GEMINI_LEGACY_MODEL;
}

/** A closed or GoAway generation may obtain one fresh credential, never replay buffered audio. */
export function canRecoverGeminiLiveConnection(
  active: boolean,
  acceptingMicrophoneFrames: boolean,
  reconnectAttempts: number,
): boolean {
  return active && acceptingMicrophoneFrames && reconnectAttempts < 1;
}

export function isTrackerVoiceGeminiTranscribeModel(model: string | null | undefined): boolean {
  return model === TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL;
}

function hasGeminiGoAway(message: unknown): boolean {
  return Boolean(message && typeof message === "object" && "goAway" in message && (message as { goAway?: unknown }).goAway);
}

interface GeminiLiveSession {
  sendRealtimeInput(input: {
    audio?: { data: string; mimeType: "audio/pcm;rate=16000" };
    audioStreamEnd?: boolean;
  }): void;
  close(): void;
}

export type GeminiTranscriptState = {
  workingTranscript: string;
  confirmedTranscript: string;
  turnCompleteSeen: boolean;
  finalCount: number;
};

export type GeminiFlushStatus = "flushing" | "paused";

const EMPTY_GEMINI_TRANSCRIPT_STATE: GeminiTranscriptState = {
  workingTranscript: "",
  confirmedTranscript: "",
  turnCompleteSeen: false,
  finalCount: 0,
};

export function expireGeminiTranscriptFlush(state: GeminiTranscriptState): GeminiTranscriptState {
  return { ...EMPTY_GEMINI_TRANSCRIPT_STATE, finalCount: state.finalCount };
}

export function resolveGeminiFlushStatus(
  status: GeminiFlushStatus,
  events: readonly VoiceTranscriptEvent[],
): GeminiFlushStatus {
  return status === "flushing" && events.some((event) => event.isFinal) ? "paused" : status;
}

export function reduceGeminiTranscriptMessage(
  state: GeminiTranscriptState,
  message: unknown,
  capturedAt: string,
  model = TRACKER_VOICE_GEMINI_LIVE_MODEL,
  providerEventNamespace = "gemini-live",
): { state: GeminiTranscriptState; events: VoiceTranscriptEvent[] } {
  if (!message || typeof message !== "object") return { state, events: [] };
  const serverContent = (message as { serverContent?: unknown }).serverContent;
  if (!serverContent || typeof serverContent !== "object") return { state, events: [] };
  const content = serverContent as { turnComplete?: unknown };
  const { partial, confirmed } = collectGeminiTranscriptionTexts(serverContent);
  let workingTranscript = partial
    ? joinTranscript(state.workingTranscript, partial)
    : state.workingTranscript;
  const confirmedTranscript = confirmed
    ? joinTranscript(state.confirmedTranscript, confirmed)
    : state.confirmedTranscript;
  if (confirmed) workingTranscript = joinTranscript(workingTranscript, confirmed);
  const turnCompleteSeen = state.turnCompleteSeen || content.turnComplete === true;
  const events: VoiceTranscriptEvent[] = [];

  const finalIsReady = isTrackerVoiceGeminiTranscribeModel(model)
    ? Boolean(confirmed)
    : turnCompleteSeen && Boolean(confirmedTranscript);
  if (finalIsReady) {
    const finalCount = state.finalCount + 1;
    events.push({
      providerEventId: `${providerEventNamespace}:${finalCount}`,
      transcript: isTrackerVoiceGeminiTranscribeModel(model) ? confirmed : confirmedTranscript,
      isFinal: true,
      capturedAt,
    });
    return {
      state: { ...EMPTY_GEMINI_TRANSCRIPT_STATE, finalCount },
      events,
    };
  }

  if (workingTranscript && (partial || confirmed)) {
    events.push({
      providerEventId: `${providerEventNamespace}:partial:${state.finalCount}`,
      transcript: workingTranscript,
      isFinal: false,
      capturedAt,
    });
  }
  return {
    state: {
      workingTranscript,
      confirmedTranscript,
      turnCompleteSeen,
      finalCount: state.finalCount,
    },
    events,
  };
}

export interface GeminiLiveTranscriptionProviderOptions {
  getSessionCredential: () => Promise<GeminiLiveSessionCredential>;
  languageProfile?: GeminiTranscribeLanguageProfile;
}

/** Gemini can nest content parts; inspect every provided part without treating model text as a poker command. */
function collectGeminiTranscriptionTexts(content: object): { partial: string; confirmed: string } {
  const partials: string[] = [];
  const confirmed: string[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const partial = record.interimInputTranscription;
    const final = record.inputTranscription;
    if (partial && typeof partial === "object" && typeof (partial as { text?: unknown }).text === "string") {
      partials.push((partial as { text: string }).text.trim());
    }
    if (final && typeof final === "object" && typeof (final as { text?: unknown }).text === "string") {
      confirmed.push((final as { text: string }).text.trim());
    }
    const parts = record.parts;
    if (Array.isArray(parts)) parts.forEach(visit);
    visit(record.modelTurn);
  };
  visit(content);
  return {
    partial: partials.filter(Boolean).reduce(joinTranscript, ""),
    confirmed: confirmed.filter(Boolean).reduce(joinTranscript, ""),
  };
}

/**
 * Preview-only Gemini Live provider. It transcribes microphone input; all poker
 * parsing, legal-action checks, and write paths stay in the existing Tracker flow.
 */
export function createTrackerVoicePreviewGeminiProvider(
  languageProfile: GeminiTranscribeLanguageProfile = "auto",
): RealtimeTranscriptionProvider {
  return new GeminiLiveTranscriptionProvider({
    getSessionCredential: async () => {
      const response = await fetch("/api/tracker-voice-gemini-token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ languageProfile }),
      });
      const payload = await response.json().catch(() => null) as {
        ephemeral_token?: unknown;
        model?: unknown;
        expires_at?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof payload?.ephemeral_token !== "string" || typeof payload.model !== "string" || typeof payload.expires_at !== "string") {
        throw new Error(typeof payload?.error === "string" ? payload.error : "gemini_preview_session_unavailable");
      }
      return {
        ephemeralToken: payload.ephemeral_token,
        model: payload.model,
        expiresAt: payload.expires_at,
        languageProfile,
      };
    },
    languageProfile,
  });
}

/**
 * Real Hand Input receives only a short-lived token from the authenticated
 * Edge session. The browser never sees the permanent Gemini API key.
 */
export function createTrackerVoiceGeminiProvider(
  tournamentId: string,
  tournamentTableId: string,
): RealtimeTranscriptionProvider {
  return new GeminiLiveTranscriptionProvider({
    getSessionCredential: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("tracker-voice-session", {
        body: { tournament_id: tournamentId, tournament_table_id: tournamentTableId },
      });
      if (
        error
        || data?.provider !== "gemini_live"
        || typeof data?.ephemeral_token !== "string"
        || typeof data?.model !== "string"
        || typeof data?.expires_at !== "string"
      ) {
        throw new Error(data?.error ?? "Không cấp được phiên Gemini Voice cho bàn này.");
      }
      return {
        ephemeralToken: data.ephemeral_token,
        model: data.model,
        expiresAt: data.expires_at,
        languageProfile: "auto",
      };
    },
    languageProfile: "auto",
  });
}

export class GeminiLiveTranscriptionProvider implements RealtimeTranscriptionProvider {
  readonly kind = "gemini_live" as const;
  private session: GeminiLiveSession | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentSink: GainNode | null = null;
  private levelFrame: number | null = null;
  private handlers: VoiceProviderHandlers | null = null;
  private active = false;
  private acceptingMicrophoneFrames = false;
  private activeGeneration = 0;
  private transcriptState: GeminiTranscriptState = EMPTY_GEMINI_TRANSCRIPT_STATE;
  private readiness: GeminiLiveAudioReadiness = { ...EMPTY_GEMINI_LIVE_AUDIO_READINESS };
  private flush: { generation: number; timer: number; resolve: () => void } | null = null;
  private readonly pcmFrames = new Pcm16FrameAccumulator();
  private sessionModel = TRACKER_VOICE_GEMINI_LIVE_MODEL;
  private reconnectAttempts = 0;
  private sessionResumptionHandle: string | null = null;
  private providerEventNamespace = "gemini-live";

  constructor(private readonly options: GeminiLiveTranscriptionProviderOptions) {}

  async connect(handlers: VoiceProviderHandlers): Promise<void> {
    this.handlers = handlers;
    if (this.active && this.session && !this.acceptingMicrophoneFrames) {
      await this.beginMicrophoneCapture(this.activeGeneration);
      return;
    }
    if (this.active) return;

    const generation = ++this.activeGeneration;
    this.active = true;
    this.reconnectAttempts = 0;
    this.readiness = { ...EMPTY_GEMINI_LIVE_AUDIO_READINESS };
    try {
      await this.openLiveSession(generation);
    } catch (error) {
      if (this.isCurrentGeneration(generation)) {
        this.active = false;
        this.acceptingMicrophoneFrames = false;
        this.session?.close();
        this.session = null;
        await this.releaseMicrophoneCapture();
      }
      throw error;
    }
  }

  private async openLiveSession(generation: number): Promise<void> {
    this.providerEventNamespace = `gemini-live:${crypto.randomUUID()}`;
    await this.beginMicrophoneCapture(generation);
    if (!this.isCurrentGeneration(generation)) return;

    this.handlers?.onStatus("connecting");
    const credential = await this.options.getSessionCredential();
    if (!this.isCurrentGeneration(generation)) return;
    const languageProfile = credential.languageProfile ?? this.options.languageProfile ?? "auto";
    const profile = buildGeminiVoiceProfile(credential.model, languageProfile);
    if (!profile || profile.model !== credential.model) {
      throw new Error("GEMINI_PROFILE_MISMATCH: phiên Voice không khớp profile server đã duyệt.");
    }
    this.sessionModel = credential.model;
    this.handlers?.onSession?.({ model: credential.model, expiresAt: credential.expiresAt });

    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({
      apiKey: credential.ephemeralToken,
      httpOptions: { apiVersion: "v1beta" },
    });
    const session = await client.live.connect({
      model: credential.model,
      // The profile comes only from the shared builder, never an arbitrary browser payload.
      config: buildGeminiLiveConnectConfig(profile, this.sessionResumptionHandle) as never,
      callbacks: {
        onopen: () => {
          if (this.isCurrentGeneration(generation)) this.readiness.socketReady = true;
        },
        onmessage: (message) => this.handleGeminiMessage(generation, message),
        onerror: () => {
          if (this.isCurrentGeneration(generation)) {
            this.handlers?.onStatus("error", "Gemini Live bị lỗi. Hãy kết nối lại microphone.");
          }
        },
        onclose: () => this.handleGeminiClose(generation),
      },
    });
    if (!this.isCurrentGeneration(generation)) {
      (session as unknown as GeminiLiveSession).close();
      return;
    }
    this.session = session as unknown as GeminiLiveSession;
    this.readiness.socketReady = true;
    this.handlers?.onStatus("connected");
    this.emitAudioReadyStatus();
  }

  /**
   * Stop sending microphone frames without closing Gemini so delayed final
   * inputTranscription can reach the existing deterministic proposal flow.
   */
  async pause(): Promise<void> {
    if (!this.active || !this.session || !this.acceptingMicrophoneFrames) {
      this.handlers?.onStatus("paused");
      return;
    }
    if (this.flush) return;

    const generation = this.activeGeneration;
    this.acceptingMicrophoneFrames = false;
    this.handlers?.onStatus("flushing", "Đang hoàn tất câu cuối từ Gemini Live.");
    const flushComplete = this.beginFlush(generation);
    try {
      this.flushPendingPcmFrame(generation);
      this.session.sendRealtimeInput({ audioStreamEnd: true });
    } catch (error) {
      this.finishFlush("error", "FINAL_TRANSCRIPT_FLUSH_FAILED: không thể hoàn tất câu cuối.");
      throw error;
    }
    await this.releaseMicrophoneCapture();
    await flushComplete;
  }

  async disconnect(): Promise<void> {
    this.activeGeneration += 1;
    this.active = false;
    this.acceptingMicrophoneFrames = false;
    this.clearFlush();
    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      // The provider may already have closed the WebSocket.
    }
    this.session?.close();
    this.session = null;
    this.pcmFrames.clear();
    this.sessionResumptionHandle = null;
    await this.releaseMicrophoneCapture();
    this.transcriptState = EMPTY_GEMINI_TRANSCRIPT_STATE;
    this.readiness = { ...EMPTY_GEMINI_LIVE_AUDIO_READINESS };
    this.handlers?.onStatus("idle");
    this.handlers = null;
  }

  private async beginMicrophoneCapture(generation: number): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return;
    this.handlers?.onStatus("requesting_permission");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.isCurrentGeneration(generation)) {
      this.stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live") {
      throw new Error("MIC_TRACK_UNAVAILABLE: không nhận được microphone đang hoạt động.");
    }
    this.readiness = {
      ...EMPTY_GEMINI_LIVE_AUDIO_READINESS,
      microphonePermissionGranted: true,
      streamLive: true,
      socketReady: this.session !== null,
    };
    this.handlers?.onInputDevice?.({
      deviceId: audioTrack.getSettings().deviceId ?? null,
      label: audioTrack.label || null,
    });
    this.handlers?.onStatus("preparing_audio");
    await this.prepareAudioPipeline(generation);
    if (!this.isCurrentGeneration(generation)) return;
    this.acceptingMicrophoneFrames = true;
    this.startLevelMeter();
    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (this.isCurrentGeneration(generation) && this.acceptingMicrophoneFrames) {
          this.handlers?.onStatus("offline", "Microphone đã ngắt khỏi thiết bị.");
        }
      }, { once: true });
    });
    this.emitAudioReadyStatus();
  }

  private async prepareAudioPipeline(generation: number): Promise<void> {
    if (!this.stream) throw new Error("gemini_live_audio_unavailable");
    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("web_audio_not_supported");

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(this.stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const processor = audioContext.createScriptProcessor(2_048, 1, 1);
    const silentSink = audioContext.createGain();
    silentSink.gain.setValueAtTime(0, audioContext.currentTime);
    source.connect(analyser);
    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(audioContext.destination);
    processor.onaudioprocess = (event) => {
      if (!this.isCurrentGeneration(generation) || !this.acceptingMicrophoneFrames || !this.session) return;
      const samples = resampleMonoToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      if (samples.length === 0) return;
      this.pcmFrames.push(samples).forEach((frame) => this.sendPcmFrame(generation, frame));
    };
    this.audioContext = audioContext;
    this.mediaSource = source;
    this.analyser = analyser;
    this.processor = processor;
    this.silentSink = silentSink;
    try {
      await resumeGeminiLiveAudioContext(audioContext);
    } catch (error) {
      this.handlers?.onStatus(
        "error",
        error instanceof Error ? error.message : "MIC_AUDIO_CONTEXT_SUSPENDED",
      );
      throw error;
    }
    this.readiness.audioContextRunning = true;
    this.readiness.captureReady = true;
  }

  private emitAudioReadyStatus(): void {
    if (!this.readiness.socketReady || !this.readiness.audioContextRunning || !this.readiness.captureReady) return;
    this.handlers?.onStatus("audio_running", "PCM 16 kHz đã sẵn sàng; chờ khung âm thanh đầu tiên.");
    this.emitListeningIfReady();
  }

  private emitListeningIfReady(): void {
    if (isGeminiLiveListeningReady(this.readiness)) {
      this.handlers?.onStatus("listening", "Microphone đang gửi PCM 16 kHz tới Gemini Live.");
    }
  }

  private startLevelMeter(): void {
    const analyser = this.analyser;
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    const sample = () => {
      if (!this.active || !this.acceptingMicrophoneFrames || !this.analyser || !this.handlers) return;
      this.analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      this.handlers.onLevel?.(Math.min(1, Math.sqrt(energy / samples.length) * 5));
      this.levelFrame = requestAnimationFrame(sample);
    };
    this.levelFrame = requestAnimationFrame(sample);
  }

  private handleGeminiMessage(generation: number, message: unknown): void {
    if (!this.isCurrentGeneration(generation) || !this.handlers) return;
    this.captureGeminiSessionResumption(message);
    const result = reduceGeminiTranscriptMessage(
      this.transcriptState,
      message,
      new Date().toISOString(),
      this.sessionModel,
      this.providerEventNamespace,
    );
    this.transcriptState = result.state;
    result.events.forEach((event) => this.handlers?.onTranscript(event));
    if (this.flush?.generation === generation && resolveGeminiFlushStatus("flushing", result.events) === "paused") {
      this.finishFlush("paused", "Voice đã tạm dừng sau khi hoàn tất câu cuối.");
    }
    if (hasGeminiGoAway(message)) {
      this.beginGeminiRecovery(generation, "Gemini Live sắp hết phiên. Đang kết nối lại bằng credential mới.");
    }
  }

  private handleGeminiClose(generation: number): void {
    if (!this.isCurrentGeneration(generation)) return;
    if (this.flush?.generation === generation) {
      this.session = null;
      this.acceptingMicrophoneFrames = false;
      this.active = false;
      void this.releaseMicrophoneCapture();
      this.finishFlush("offline", "Gemini Live ngắt trước khi nhận được final transcript.");
      return;
    }
    this.beginGeminiRecovery(generation, "Gemini Live đã ngắt kết nối.");
  }

  private beginGeminiRecovery(generation: number, message: string): void {
    const shouldRecover = canRecoverGeminiLiveConnection(
      this.active,
      this.acceptingMicrophoneFrames,
      this.reconnectAttempts,
    );
    this.session = null;
    this.acceptingMicrophoneFrames = false;
    if (!shouldRecover) {
      this.active = false;
      void this.releaseMicrophoneCapture();
      this.handlers?.onStatus("offline", message);
      return;
    }
    this.reconnectAttempts += 1;
    const nextGeneration = ++this.activeGeneration;
    this.handlers?.onStatus("recovering", `${message} Âm thanh cũ sẽ không được gửi lại.`);
    void this.reconnectAfterClose(nextGeneration);
  }

  private async reconnectAfterClose(generation: number): Promise<void> {
    await this.releaseMicrophoneCapture();
    if (!this.isCurrentGeneration(generation)) return;
    this.readiness = { ...EMPTY_GEMINI_LIVE_AUDIO_READINESS };
    try {
      await this.openLiveSession(generation);
    } catch {
      if (!this.isCurrentGeneration(generation)) return;
      this.active = false;
      this.acceptingMicrophoneFrames = false;
      await this.releaseMicrophoneCapture();
      this.handlers?.onStatus("offline", "Gemini Live không thể kết nối lại. Hãy bấm Kết nối microphone.");
    }
  }

  private sendPcmFrame(generation: number, frame: Int16Array): void {
    if (!this.isCurrentGeneration(generation) || !this.session || frame.length === 0) return;
    try {
      this.session.sendRealtimeInput({ audio: createGeminiLiveAudioPayload(pcm16ToLittleEndianBytes(frame)) });
      if (!this.readiness.pcmFrameDelivered) {
        this.readiness.pcmFrameDelivered = true;
        this.emitListeningIfReady();
      }
    } catch {
      this.acceptingMicrophoneFrames = false;
      this.handlers?.onStatus("error", "PCM_FRAME_DELIVERY_FAILED: Gemini chưa nhận được âm thanh.");
    }
  }

  private flushPendingPcmFrame(generation: number): void {
    const tail = this.pcmFrames.flush();
    if (tail) this.sendPcmFrame(generation, tail);
  }

  private captureGeminiSessionResumption(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const update = (message as { sessionResumptionUpdate?: unknown }).sessionResumptionUpdate;
    if (!update || typeof update !== "object") return;
    const candidate = update as { resumable?: unknown; newHandle?: unknown };
    this.sessionResumptionHandle = candidate.resumable === true
      && typeof candidate.newHandle === "string"
      && candidate.newHandle.length > 0
      && candidate.newHandle.length <= 4_096
      ? candidate.newHandle
      : null;
  }

  private beginFlush(generation: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.flush?.generation !== generation) return;
        this.transcriptState = expireGeminiTranscriptFlush(this.transcriptState);
        this.finishFlush("paused", "FINAL_TRANSCRIPT_TIMEOUT: không có final transcript để phân tích.");
      }, GEMINI_LIVE_FINAL_FLUSH_TIMEOUT_MS);
      this.flush = { generation, timer, resolve };
    });
  }

  private finishFlush(status: "paused" | "offline" | "error", message?: string): void {
    const flush = this.flush;
    if (!flush) return;
    window.clearTimeout(flush.timer);
    this.flush = null;
    this.handlers?.onStatus(status, message);
    flush.resolve();
  }

  private clearFlush(): void {
    const flush = this.flush;
    if (!flush) return;
    window.clearTimeout(flush.timer);
    this.flush = null;
    flush.resolve();
  }

  private async releaseMicrophoneCapture(): Promise<void> {
    this.acceptingMicrophoneFrames = false;
    this.pcmFrames.clear();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.mediaSource?.disconnect();
    this.analyser?.disconnect();
    this.silentSink?.disconnect();
    try {
      await this.audioContext?.close();
    } catch {
      // Closing an already interrupted browser audio context is safe to ignore.
    }
    this.stream = null;
    this.processor = null;
    this.mediaSource = null;
    this.analyser = null;
    this.silentSink = null;
    this.audioContext = null;
    this.readiness = {
      ...this.readiness,
      microphonePermissionGranted: false,
      streamLive: false,
      audioContextRunning: false,
      captureReady: false,
      pcmFrameDelivered: false,
    };
  }

  private isCurrentGeneration(generation: number): boolean {
    return isGeminiLiveConnectionCurrent(generation, this.activeGeneration, this.active);
  }
}

function joinTranscript(current: string, next: string): string {
  if (!current) return next;
  if (next === current || next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return `${current} ${next}`.replace(/\s+/g, " ").trim();
}

export class OpenAIRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  readonly kind = "openai_realtime" as const;
  private generation = 0;
  private signaling: AbortController | null = null;
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private levelFrame: number | null = null;
  private handlers: VoiceProviderHandlers | null = null;
  private readonly partialTranscripts = new Map<string, string>();

  constructor(private readonly options: OpenAIRealtimeProviderOptions) {}

  async connect(handlers: VoiceProviderHandlers): Promise<void> {
    void this.disconnect();
    const generation = ++this.generation;
    const current = () => this.generation === generation;
    this.handlers = handlers;
    handlers.onStatus("requesting_permission");
    try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!current()) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.stream = stream;
    const audioTrack = this.stream.getAudioTracks()[0];
    handlers.onInputDevice?.({
      deviceId: audioTrack?.getSettings().deviceId ?? null,
      label: audioTrack?.label || null,
    });
    this.startLevelMeter(this.stream);
    handlers.onStatus("connecting");
    const credential = await this.options.getSessionCredential();
    if (!current()) return;
    const peer = new RTCPeerConnection();
    this.peer = peer;
    for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.addEventListener("message", (message) => { if (current()) this.handleProviderMessage(message.data); });
    channel.addEventListener("open", () => { if (current()) handlers.onStatus("listening"); });
    channel.addEventListener("close", () => { if (current()) handlers.onStatus("offline"); });
    peer.addEventListener("connectionstatechange", () => {
      if (!current()) return;
      if (peer.connectionState === "disconnected") handlers.onStatus("recovering", "Kết nối microphone đang khôi phục.");
      if (peer.connectionState === "failed") handlers.onStatus("error", "Kết nối Voice bị lỗi. Hãy kết nối lại.");
    });
    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => { if (current()) handlers.onStatus("offline", "Microphone đã ngắt khỏi thiết bị."); }, { once: true });
    });

    const offer = await peer.createOffer();
    if (!current()) return;
    await peer.setLocalDescription(offer);
    if (!current()) return;
    const signaling = new AbortController();
    this.signaling = signaling;
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
      signal: signaling.signal,
    });
    if (!current()) return;
    if (!response.ok) throw new Error("openai_realtime_connect_failed");
    const sdp = await response.text();
    if (!current()) return;
    await peer.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      if (!current()) return;
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    ++this.generation;
    this.signaling?.abort();
    this.signaling = null;
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    this.mediaSource?.disconnect();
    this.analyser?.disconnect();
    const audioContext = this.audioContext;
    const handlers = this.handlers;
    this.mediaSource = null;
    this.analyser = null;
    this.audioContext = null;
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.partialTranscripts.clear();
    this.handlers = null;
    handlers?.onStatus("idle");
    await audioContext?.close().catch(() => undefined);
  }

  private startLevelMeter(stream: MediaStream): void {
    const generation = this.generation;
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      this.audioContext = audioContext;
      this.analyser = analyser;
      this.mediaSource = source;
      const samples = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (this.generation !== generation || !this.analyser || !this.handlers) return;
        this.analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) energy += value * value;
        this.handlers.onLevel?.(Math.min(1, Math.sqrt(energy / samples.length) * 5));
        this.levelFrame = requestAnimationFrame(sample);
      };
      this.levelFrame = requestAnimationFrame(sample);
    } catch {
      // Meter failure must not disable transcription; the UI reports level as unavailable.
      this.handlers?.onLevel?.(0);
    }
  }

  private handleProviderMessage(raw: unknown): void {
    if (!this.handlers || typeof raw !== "string") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "";
    const isFinal = type === "conversation.item.input_audio_transcription.completed";
    const isPartial = type === "conversation.item.input_audio_transcription.delta";
    if (!isFinal && !isPartial) return;
    const itemId = typeof event.item_id === "string" ? event.item_id : "";
    if (!itemId) return;

    let transcript = "";
    if (isPartial) {
      const nextDelta = typeof event.delta === "string" ? event.delta : "";
      transcript = `${this.partialTranscripts.get(itemId) ?? ""}${nextDelta}`;
      this.partialTranscripts.set(itemId, transcript);
    } else {
      transcript = typeof event.transcript === "string"
        ? event.transcript
        : this.partialTranscripts.get(itemId) ?? "";
      this.partialTranscripts.delete(itemId);
    }
    if (!transcript) return;
    this.handlers.onTranscript({
      providerEventId: itemId,
      transcript,
      isFinal,
      capturedAt: new Date().toISOString(),
    });
  }
}
