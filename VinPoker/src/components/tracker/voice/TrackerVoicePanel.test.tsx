import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  MockRealtimeTranscriptionProvider,
  type CommitVoiceHoleCardsInput,
  type TrackerVoiceRuntimeContext,
  type ValidatedVoiceEventReceipt,
} from "@/lib/trackerVoice";
import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { ACTION_AUTO_COMMIT_MS, TrackerVoicePanel } from "./TrackerVoicePanel";
import type { TrackerVoiceDiagnosticSnapshot } from "./TrackerVoicePanel";
type VoicePanelProps = ComponentProps<typeof TrackerVoicePanel>;

function hookFixture(): StandaloneHandInput {
  return {
    tournamentId: "tournament-1",
    tableId: "physical-table-1",
    tournamentTableId: "canonical-table-1",
    handId: "hand-1",
    currentStreet: "flop",
    workflowState: "flop_action",
    actorPlayer: {
    player_id: "player-a",
    display_name: "Player A",
    seat_number: 3,
    entry_number: 1,
    current_stack: 10_000,
      current_bet: 1_000,
    },
    actorViewData: {
      toCall: 1_000,
      minRaiseTo: 4_000,
      legal: { fold: true, check: false, call: true, bet: false, raise: true, allIn: true },
    },
    handStarted: true,
    showActionStep: true,
    isReadOnly: false,
    actionSyncBlocked: false,
  } as unknown as StandaloneHandInput;
}

const runtimeFixture: TrackerVoiceRuntimeContext = {
  ok: true,
  can_mint_session: true,
  read_only: false,
  correction_pending: false,
  config: {
    enabled: true,
    configured_mode: "assist",
    provider_model: "gpt-live-transcribe",
    spoken_amount_unit: 1,
    amount_unit_confirmed: false,
    provider_confidence_threshold: null,
    server_auto_allowed: false,
    correction_state: "ready",
  },
  active_hand: {
    hand_id: "hand-1",
    hand_number: 1,
    status: "in_progress",
    state_version: "a".repeat(64),
  },
};

const handsFreeRuntimeFixture: TrackerVoiceRuntimeContext = {
  ...runtimeFixture,
  config: { ...runtimeFixture.config, server_auto_allowed: true },
};

const validatedReceipt: ValidatedVoiceEventReceipt = {
  ok: true,
  voice_event_id: "voice-event-1",
  idempotency_key: "voice:request-1",
  trace_id: "voice-trace:request-1",
  state_version: "a".repeat(64),
  execution_mode: "shadow",
  execution_result: "validated",
  correction_pending: false,
  alert_id: null,
};

const renderPanel = (
  hook = hookFixture(),
  provider = new MockRealtimeTranscriptionProvider(),
  validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => validatedReceipt),
) => ({
  provider,
  validateEventOverride,
  view: render(
    <TrackerVoicePanel
      hook={hook}
      providerOverride={provider}
      runtimeOverride={runtimeFixture}
      validateEventOverride={validateEventOverride}
    />,
  ),
});

describe("TrackerVoicePanel", () => {
  it("lets an explicit UAT runtime and provider reach the microphone permission seam", async () => {
    const hook = hookFixture() as StandaloneHandInput & { tournamentTableId?: string };
    delete hook.tournamentTableId;
    renderPanel(hook, new MockRealtimeTranscriptionProvider());

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));

    expect(await screen.findByText("Microphone đã kết nối")).toBeInTheDocument();
    expect(screen.queryByText(/canonical cho Voice/)).not.toBeInTheDocument();
  });

  it("turns only a final transcript into a Shadow proposal", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => validatedReceipt);
    render(
      <TrackerVoicePanel
        hook={hookFixture()}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={validateEventOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("raise", { final: false, id: "partial" }));
    expect(screen.queryByText(/Player A · raise/)).not.toBeInTheDocument();
    act(() => provider.emit("seat three raise 6k", { final: true, id: "final" }));
    expect(await screen.findByText("Player A · raise tới 6.000")).toBeInTheDocument();
    expect(await screen.findByText("Shadow hợp lệ, không gọi server và chưa ghi action.")).toBeInTheDocument();
    expect(validateEventOverride).not.toHaveBeenCalled();
    expect(screen.getByText(/Auto bị khóa/)).toBeInTheDocument();
  });

  it("shows the authoritative total for a spoken all-in amount", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three all in 11.000", { final: true, id: "all-in-amount" }));

    expect(await screen.findByText("Player A · all_in tới 11.000")).toBeInTheDocument();
    expect(screen.getByText("Shadow hợp lệ, không gọi server và chưa ghi action.")).toBeInTheDocument();
  });

  it("joins one VAD-split Raise prefix with the immediately following amount final", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    const hook = {
      ...hookFixture(),
      actorPlayer: {
        ...hookFixture().actorPlayer,
        current_stack: 2_000_000,
      },
      actorViewData: {
        ...hookFixture().actorViewData,
        minRaiseTo: 4_000,
      },
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three raise", { final: true, id: "raise-prefix" }));
    expect(await screen.findByText("Đã nhận lệnh Raise/Bet, đang chờ số chip.")).toBeInTheDocument();
    expect(screen.queryByText(/Player A · raise tới/)).not.toBeInTheDocument();

    act(() => provider.emit("1 triệu 750 nghìn", { final: true, id: "raise-amount" }));
    expect(await screen.findByText("Player A · raise tới 1.750.000")).toBeInTheDocument();
    expect(snapshots.some((snapshot) => (
      snapshot.finalTranscript === "seat three raise 1 triệu 750 nghìn"
      && snapshot.proposal?.ok
    ))).toBe(true);
  });

  it("keeps an amount-only final fail-closed without an immediately preceding action prefix", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);

    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("1 triệu 750 nghìn", { final: true, id: "amount-only" }));

    expect(await screen.findByText("Chưa nhận ra một lệnh Voice duy nhất.")).toBeInTheDocument();
    expect(screen.queryByText(/Player A · raise tới/)).not.toBeInTheDocument();
  });

  it("keeps a Board transcript as a draft until the Dealer confirms one atomic receipt", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceBoardReceipt = vi.fn(() => true);
    const commitBoardOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["commitBoardOverride"]>>[0]) => ({
      ok: true as const,
      voice_event_id: "voice-board-1",
      canonical_receipt_event_id: "board-receipt-1",
      idempotency_key: "voice:request-1",
      trace_id: "voice-trace:request-1",
      street: "flop" as const,
      previous_board: [],
      community_cards: ["Ah", "5s", "2d"],
      state_version_before: "a".repeat(64),
      state_version_after: "b".repeat(64),
    }));
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => ({
      ...validatedReceipt,
      execution_mode: "assist" as const,
      voice_event_id: "voice-board-1",
    }));
    const hook = {
      ...hookFixture(),
      currentStreet: "flop",
      workflowState: "enter_flop",
      showActionStep: false,
      persistedBoardCount: 0,
      communityCards: [null, null, null, null, null],
      applyVoiceBoardReceipt,
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={validateEventOverride}
        commitBoardOverride={commitBoardOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("Flop ace hearts five spades two diamonds", { final: true, id: "board-final" }));

    expect(await screen.findByText("CẦN CHẠM XÁC NHẬN · CHƯA GHI BOARD")).toBeInTheDocument();
    expect(applyVoiceBoardReceipt).not.toHaveBeenCalled();
    expect(commitBoardOverride).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận Flop" }));
    await waitFor(() => expect(commitBoardOverride).toHaveBeenCalledOnce());
    expect(commitBoardOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "board",
      payload: { cumulativeCards: ["Ah", "5s", "2d"], expectedExistingBoardCount: 0 },
    });
    expect(applyVoiceBoardReceipt).toHaveBeenCalledOnce();
  });

  it("auto-commits a validated Assist action after the visible 1.8-second countdown", async () => {
    expect(ACTION_AUTO_COMMIT_MS).toBe(1_800);
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    render(
      <TrackerVoicePanel
        hook={{ ...hookFixture(), handleVoiceAction }}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={vi.fn(async () => ({ ...validatedReceipt, execution_mode: "assist" as const }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three call", { final: true, id: "hands-free-countdown" }));

    expect(await screen.findByRole("timer", { name: "Đếm ngược tự ghi action" })).toBeInTheDocument();
    expect(handleVoiceAction).not.toHaveBeenCalled();
    await waitFor(() => expect(handleVoiceAction).toHaveBeenCalledOnce(), { timeout: 3_000 });
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
  });

  it("commits the pending action before accepting the next spoken poker action", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    const validateEventOverride = vi.fn(async (input) => ({
      ...validatedReceipt,
      voice_event_id: `voice-${input.finalTranscript}`,
      execution_mode: "assist" as const,
    }));
    render(
      <TrackerVoicePanel
        hook={{ ...hookFixture(), handleVoiceAction }}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={validateEventOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three call", { final: true, id: "hands-free-first" }));
    await screen.findByRole("timer", { name: "Đếm ngược tự ghi action" });

    act(() => provider.emit("seat three fold", { final: true, id: "hands-free-next" }));
    await waitFor(() => expect(handleVoiceAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(validateEventOverride).toHaveBeenCalledTimes(2));
    expect(validateEventOverride.mock.calls[1][0].finalTranscript).toBe("seat three fold");
  });

  it("cancels the pending hands-free action when Dealer says Báo sai", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    render(
      <TrackerVoicePanel
        hook={{ ...hookFixture(), handleVoiceAction }}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={vi.fn(async () => ({ ...validatedReceipt, execution_mode: "assist" as const }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three call", { final: true, id: "hands-free-cancel" }));
    await screen.findByRole("timer", { name: "Đếm ngược tự ghi action" });

    act(() => provider.emit("báo sai", { final: true, id: "hands-free-report-wrong" }));
    await waitFor(() => expect(screen.queryByRole("timer", { name: "Đếm ngược tự ghi action" })).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, ACTION_AUTO_COMMIT_MS + 100));
    expect(handleVoiceAction).not.toHaveBeenCalled();
  }, 8_000);

  it("does not fast-commit the pending action for a seatless next command", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    render(
      <TrackerVoicePanel
        hook={{ ...hookFixture(), handleVoiceAction }}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={vi.fn(async () => ({ ...validatedReceipt, execution_mode: "assist" as const }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three call", { final: true, id: "hands-free-seat-bound" }));
    await screen.findByRole("timer", { name: "Đếm ngược tự ghi action" });

    act(() => provider.emit("call", { final: true, id: "hands-free-seatless-next" }));
    expect(await screen.findByText("Action kế tiếp phải đọc rõ Ghế. Action đang chờ vẫn tiếp tục đếm ngược.")).toBeInTheDocument();
    expect(handleVoiceAction).not.toHaveBeenCalled();
    act(() => provider.emit("báo sai", { final: true, id: "hands-free-seatless-cancel" }));
    await waitFor(() => expect(screen.queryByRole("timer", { name: "Đếm ngược tự ghi action" })).not.toBeInTheDocument());
    expect(handleVoiceAction).not.toHaveBeenCalled();
  });

  it("auto-commits a validated Board through the existing atomic writer", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceBoardReceipt = vi.fn(() => true);
    const commitBoardOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["commitBoardOverride"]>>[0]) => ({
      ok: true as const,
      voice_event_id: "voice-board-auto",
      canonical_receipt_event_id: "board-receipt-auto",
      idempotency_key: "voice:board-auto",
      trace_id: "voice-trace:board-auto",
      street: "flop" as const,
      previous_board: [],
      community_cards: ["Ah", "5s", "2d"],
      state_version_before: "a".repeat(64),
      state_version_after: "b".repeat(64),
    }));
    const hook = {
      ...hookFixture(),
      currentStreet: "flop",
      workflowState: "enter_flop",
      showActionStep: false,
      persistedBoardCount: 0,
      communityCards: [null, null, null, null, null],
      applyVoiceBoardReceipt,
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={vi.fn(async () => ({
          ...validatedReceipt,
          execution_mode: "assist" as const,
          voice_event_id: "voice-board-auto",
        }))}
        commitBoardOverride={commitBoardOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("flop át cơ năm bích hai rô", { final: true, id: "board-auto" }));

    await waitFor(() => expect(commitBoardOverride).toHaveBeenCalledOnce());
    expect(applyVoiceBoardReceipt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Xác nhận Flop" })).not.toBeInTheDocument();
  });

  it("offers a manual retry when hands-free Board commit fails", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const commitBoardOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["commitBoardOverride"]>>[0]) => {
      throw new Error("Board writer unavailable");
    });
    const hook = {
      ...hookFixture(),
      currentStreet: "flop",
      workflowState: "enter_flop",
      showActionStep: false,
      persistedBoardCount: 0,
      communityCards: [null, null, null, null, null],
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        validateEventOverride={vi.fn(async () => ({
          ...validatedReceipt,
          execution_mode: "assist" as const,
          voice_event_id: "voice-board-retry",
        }))}
        commitBoardOverride={commitBoardOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("flop át cơ năm bích hai rô", { final: true, id: "board-retry" }));

    expect(await screen.findByText("Board writer unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận Flop" })).toBeInTheDocument();
  });

  it("keeps the canonical runout workflow after hole cards reveal moves the UI to flop entry", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => ({
      ...validatedReceipt,
      execution_mode: "assist" as const,
      voice_event_id: "voice-runout-flop",
    }));
    const hook = {
      ...hookFixture(),
      currentStreet: "flop",
      workflowState: "enter_flop",
      allInRunout: true,
      showActionStep: false,
      persistedBoardCount: 0,
      communityCards: [null, null, null, null, null],
    } as StandaloneHandInput;

    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("flop 4 cơ 5 bích 6 tép", { final: true, id: "runout-flop-final" }));

    expect(await screen.findByRole("button", { name: "Xác nhận Flop" })).toBeInTheDocument();
    await waitFor(() => expect(validateEventOverride).toHaveBeenCalledOnce());
    expect(validateEventOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "board",
      envelope: {
        expectedWorkflowState: "runout_reveal",
        expectedStreet: "flop",
      },
      payload: {
        newCards: ["4h", "5s", "6c"],
        cumulativeCards: ["4h", "5s", "6c"],
      },
    });
  });

  it("keeps Hole Cards speech outside generic diagnostics until the Dealer confirms", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceHoleCardsReceipt = vi.fn(() => true);
    const commitHoleCardsOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["commitHoleCardsOverride"]>>[0]) => ({
      ok: true as const,
      voice_event_id: "voice-hole-8",
      canonical_receipt_event_id: "hole-receipt-8",
      idempotency_key: "voice:hole-8",
      trace_id: "voice-trace:hole-8",
      seat_number: 8,
      player_id: "player-eight",
      entry_number: 2,
      redacted: true as const,
      state_version_before: "a".repeat(64),
      state_version_after: "b".repeat(64),
    }));
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    const hook = {
      ...hookFixture(),
      workflowState: "runout_reveal",
      showActionStep: false,
      players: [
        { player_id: "player-eight", display_name: "Player Eight", seat_number: 8, entry_number: 2 },
        { player_id: "player-nine", display_name: "Player Nine", seat_number: 9, entry_number: 1 },
      ],
      playerHoleCards: {},
      applyVoiceHoleCardsReceipt,
    } as unknown as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        commitHoleCardsOverride={commitHoleCardsOverride}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("ace hearts ace spades", { final: true, id: "private-hole-8" }));

    expect(await screen.findByTestId("voice-private-hole-cards-proposal")).toBeInTheDocument();
    expect(screen.getByText("A♥")).toBeInTheDocument();
    expect(screen.getByText("A♠")).toBeInTheDocument();
    expect(screen.queryByText("ace hearts ace spades")).not.toBeInTheDocument();
    expect(snapshots.some((snapshot) => (
      snapshot.finalTranscript === "ace hearts ace spades"
      || JSON.stringify(snapshot.proposal).includes("ace hearts")
    ))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bài Ghế 8" }));
    await waitFor(() => expect(commitHoleCardsOverride).toHaveBeenCalledOnce());
    expect(commitHoleCardsOverride.mock.calls[0][0]).toMatchObject({
      finalTranscript: "ace hearts ace spades",
      canonicalRequest: {
        intentDomain: "hole_cards",
        payload: { seatNumber: 8, expectedPlayerId: "player-eight", expectedEntryNumber: 2, cards: ["Ah", "As"] },
      },
    });
    expect(applyVoiceHoleCardsReceipt).toHaveBeenCalledWith(expect.objectContaining({
      playerId: "player-eight",
      entryNumber: 2,
      cards: ["Ah", "As"],
    }));
    expect(await screen.findByText("Đã xác nhận bài Ghế 8")).toBeInTheDocument();
    expect(screen.queryByTestId("voice-private-hole-cards-proposal")).not.toBeInTheDocument();
  });

  it("accepts either explicit runout seat first and commits each confirmed hand separately", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceHoleCardsReceipt = vi.fn(() => true);
    const commitHoleCardsOverride = vi.fn(async (input: CommitVoiceHoleCardsInput) => {
      if (input.canonicalRequest.intentDomain !== "hole_cards") throw new Error("unexpected domain");
      const payload = input.canonicalRequest.payload;
      return {
        ok: true as const,
        voice_event_id: `voice-hole-${payload.seatNumber}`,
        canonical_receipt_event_id: `hole-receipt-${payload.seatNumber}`,
        idempotency_key: input.idempotencyKey,
        trace_id: input.traceId,
        seat_number: payload.seatNumber,
        player_id: payload.expectedPlayerId,
        entry_number: payload.expectedEntryNumber,
        redacted: true as const,
        state_version_before: "a".repeat(64),
        state_version_after: "b".repeat(64),
      };
    });
    const hook = {
      ...hookFixture(),
      workflowState: "runout_reveal",
      showActionStep: false,
      players: [
        { player_id: "player-eight", display_name: "Player Eight", seat_number: 8, entry_number: 2 },
        { player_id: "player-nine", display_name: "Player Nine", seat_number: 9, entry_number: 1 },
      ],
      playerHoleCards: {},
      applyVoiceHoleCardsReceipt,
    } as unknown as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        commitHoleCardsOverride={commitHoleCardsOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    act(() => provider.emit("Ghế 9 cầm Q dô Q tép", { final: true, id: "private-hole-9" }));
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận bài Ghế 9" }));
    expect(await screen.findByText("Đã xác nhận bài Ghế 9")).toBeInTheDocument();

    act(() => provider.emit("Ghế 8 có K bích K cơ", { final: true, id: "private-hole-8" }));
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận bài Ghế 8" }));
    expect(await screen.findByText("Đã xác nhận bài Ghế 8")).toBeInTheDocument();

    expect(commitHoleCardsOverride).toHaveBeenCalledTimes(2);
    expect(commitHoleCardsOverride.mock.calls.map(([input]) => (
      input.canonicalRequest.intentDomain === "hole_cards" ? input.canonicalRequest.payload.seatNumber : null
    ))).toEqual([9, 8]);
    expect(applyVoiceHoleCardsReceipt).toHaveBeenCalledTimes(2);
  });

  it("queues either runout seat order and commits both after one spoken xác nhận", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const applyVoiceHoleCardsReceipt = vi.fn(() => true);
    const commitHoleCardsOverride = vi.fn(async (input: CommitVoiceHoleCardsInput) => {
      if (input.canonicalRequest.intentDomain !== "hole_cards") throw new Error("unexpected domain");
      const payload = input.canonicalRequest.payload;
      const stateVersionAfter = payload.seatNumber === 9 ? "b".repeat(64) : "c".repeat(64);
      return {
        ok: true as const,
        voice_event_id: `voice-hole-${payload.seatNumber}`,
        canonical_receipt_event_id: `hole-receipt-${payload.seatNumber}`,
        idempotency_key: input.idempotencyKey,
        trace_id: input.traceId,
        seat_number: payload.seatNumber,
        player_id: payload.expectedPlayerId,
        entry_number: payload.expectedEntryNumber,
        redacted: true as const,
        state_version_before: input.expectedStateVersion,
        state_version_after: stateVersionAfter,
      };
    });
    const hook = {
      ...hookFixture(),
      workflowState: "runout_reveal",
      showActionStep: false,
      players: [
        { player_id: "player-eight", display_name: "Player Eight", seat_number: 8, entry_number: 2 },
        { player_id: "player-nine", display_name: "Player Nine", seat_number: 9, entry_number: 1 },
      ],
      playerHoleCards: {},
      applyVoiceHoleCardsReceipt,
    } as unknown as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={handsFreeRuntimeFixture}
        commitHoleCardsOverride={commitHoleCardsOverride}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    act(() => provider.emit("Ghế 9 cầm Q dô Q tép", { final: true, id: "queue-hole-9" }));
    expect(await screen.findByRole("button", { name: "Xác nhận bài Ghế 9" })).toBeInTheDocument();
    act(() => provider.emit("Ghế 8 có K bích K cơ", { final: true, id: "queue-hole-8" }));
    expect(await screen.findByRole("button", { name: "Xác nhận 2 ghế" })).toBeInTheDocument();
    act(() => provider.emit("xác nhận", { final: true, id: "queue-confirm" }));

    await waitFor(() => expect(commitHoleCardsOverride).toHaveBeenCalledTimes(2));
    expect(commitHoleCardsOverride.mock.calls[0][0]).toMatchObject({ expectedStateVersion: "a".repeat(64) });
    expect(commitHoleCardsOverride.mock.calls[1][0]).toMatchObject({ expectedStateVersion: "b".repeat(64) });
    expect(applyVoiceHoleCardsReceipt).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("voice-private-hole-cards-proposal")).not.toBeInTheDocument();
  });

  it("keeps Finish as a server summary until one Dealer touch confirms it", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const runtime: TrackerVoiceRuntimeContext = {
      ...runtimeFixture,
      active_hand: { ...runtimeFixture.active_hand },
    };
    const applyVoiceFinishReceipt = vi.fn(async () => true);
    const prepareFinishOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["prepareFinishOverride"]>>[0]) => ({
      ok: true as const,
      settlement_origin: "engine_showdown" as const,
      settlement_digest: "b".repeat(64),
      state_version: "a".repeat(64),
      summary: {
        winners: [{ player_id: "player-a", seat_number: 3, player_name: "Player A", amount: 20_000 }],
        pots: [{ kind: "main" as const, amount: 20_000, winner_ids: ["player-a"] }],
        ending_stacks: [{ player_id: "player-a", seat_number: 3, amount: 20_000 }],
        conservation_total: 20_000,
      },
    }));
    const commitFinishOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["commitFinishOverride"]>>[0]) => {
      runtime.active_hand = null;
      return {
        ok: true as const,
        voice_event_id: "voice-finish-1",
        canonical_receipt_event_id: "finish-receipt-1",
        idempotency_key: "voice:finish-1",
        trace_id: "voice-trace:finish-1",
        settlement_origin: "engine_showdown" as const,
        settlement_digest: "b".repeat(64),
        state_version_before: "a".repeat(64),
        state_version_after: "c".repeat(64),
        hand_id: "hand-1",
      };
    });
    const hook = {
      ...hookFixture(),
      currentStreet: "showdown",
      workflowState: "submit_ready",
      showActionStep: false,
      applyVoiceFinishReceipt,
    } as StandaloneHandInput;
    render(
      <TrackerVoicePanel
        hook={hook}
        providerOverride={provider}
        runtimeOverride={runtime}
        prepareFinishOverride={prepareFinishOverride}
        commitFinishOverride={commitFinishOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("kết thúc hand", { final: true, id: "finish-final" }));

    expect(await screen.findByTestId("voice-finish-proposal")).toBeInTheDocument();
    expect(screen.getByText("CHƯA LƯU HAND")).toBeInTheDocument();
    expect(screen.getByText(/Ending stack: Ghế 3 20\.000/)).toBeInTheDocument();
    expect(commitFinishOverride).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "XÁC NHẬN LƯU HAND" }));
    await waitFor(() => expect(commitFinishOverride).toHaveBeenCalledOnce());
    expect(commitFinishOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "finish_hand",
      payload: { settlementOrigin: "engine_showdown", settlementDigest: "b".repeat(64) },
    });
    expect(applyVoiceFinishReceipt).toHaveBeenCalledWith(expect.objectContaining({ hand_id: "hand-1" }));
  });

  it("keys each diagnostic proposal to its own final transcript", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const snapshots: TrackerVoiceDiagnosticSnapshot[] = [];
    render(
      <TrackerVoicePanel
        hook={hookFixture()}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={vi.fn(async () => validatedReceipt)}
        onDiagnosticSnapshot={(snapshot) => snapshots.push(snapshot)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    act(() => provider.emit("seat three fold", { final: true, id: "final-fold" }));
    await waitFor(() => expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-fold"
      && snapshot.proposalProviderEventId === "final-fold"
      && snapshot.proposal?.command && "kind" in snapshot.proposal.command && snapshot.proposal.command.kind === "fold"
    ))).toBe(true));

    act(() => provider.emit("seat number five call", { final: true, id: "final-seat-five" }));
    await waitFor(() => expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-seat-five"
      && snapshot.proposalProviderEventId === "final-seat-five"
      && snapshot.proposal?.command && "kind" in snapshot.proposal.command && snapshot.proposal.command.kind === "call"
    ))).toBe(true));

    expect(snapshots.some((snapshot) => (
      snapshot.finalProviderEventId === "final-seat-five"
      && snapshot.proposalProviderEventId === "final-fold"
    ))).toBe(false);
    expect(await screen.findByText("Đang tới Ghế 3. Hãy đọc lại action cho Ghế 3.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xác nhận action" })).not.toBeInTheDocument();
  });

  it("fails closed when the actor changes before proposal validation", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const hook = hookFixture();
    const { view } = renderPanel(hook, provider);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    view.rerender(
      <TrackerVoicePanel
        hook={{ ...hook, actorPlayer: null, actorViewData: null }}
        providerOverride={provider}
        runtimeOverride={runtimeFixture}
        validateEventOverride={vi.fn(async () => validatedReceipt)}
      />,
    );
    act(() => provider.emit("call", { final: true }));
    expect(await screen.findByText("Chưa xác định được người đang tới lượt.")).toBeInTheDocument();
  });

  it("disconnects the provider on unmount", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const disconnect = vi.spyOn(provider, "disconnect");
    const { view } = renderPanel(hookFixture(), provider);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await waitFor(() => expect(screen.getByText("Microphone đã kết nối")).toBeInTheDocument());
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("pauses a capable provider without treating its final-transcript flush as a disconnect", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const pause = vi.spyOn(provider, "pause");
    const disconnect = vi.spyOn(provider, "disconnect");
    renderPanel(hookFixture(), provider);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng Voice" }));

    expect(await screen.findByText("Voice đã tạm dừng an toàn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp tục Voice" })).toBeInTheDocument();
    expect(pause).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("commits a spoken fold as fold once through the canonical Assist hook", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    const hook = { ...hookFixture(), handleVoiceAction };
    const receipt = { ...validatedReceipt, execution_mode: "assist" as const };
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => receipt);
    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three fold", { final: true, id: "assist-final" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
    expect(handleVoiceAction.mock.calls[0][0]).toMatchObject({
      canonicalAction: "fold",
      actor: { playerId: "player-a", seatNumber: 3 },
    });
    expect(handleVoiceAction.mock.calls[0][1]).toMatchObject({
      source: "voice",
      tournamentTableId: "canonical-table-1",
      voiceEventId: "voice-event-1",
      expectedStateVersion: "a".repeat(64),
    });
    expect(validateEventOverride.mock.calls[0][0].canonicalRequest).toMatchObject({
      intentDomain: "action",
      payload: {
        canonicalAction: "fold",
        actorPlayerId: "player-a",
        entryNumber: 1,
        seatNumber: 3,
      },
    });
  });

  it("refreshes the authoritative state version before validating the next Assist transcript", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const stateAfterPriorAction = "c".repeat(64);
    const initialRuntime = {
      ...runtimeFixture,
      active_hand: { ...runtimeFixture.active_hand },
    };
    const refreshedRuntime = {
      ...runtimeFixture,
      active_hand: {
        ...runtimeFixture.active_hand,
        state_version: stateAfterPriorAction,
      },
    };
    const loadRuntimeOverride = vi.fn()
      .mockResolvedValueOnce(initialRuntime)
      .mockResolvedValueOnce({...runtimeFixture,active_hand:{...runtimeFixture.active_hand,state_version:"b".repeat(64)}})
      .mockResolvedValue(refreshedRuntime);
    const validateEventOverride = vi.fn(async (input) => ({
      ...validatedReceipt,
      state_version: input.expectedStateVersion,
      execution_mode: "assist" as const,
    }));

    render(
      <TrackerVoicePanel
        hook={hookFixture()}
        providerOverride={provider}
        loadRuntimeOverride={loadRuntimeOverride}
        validateEventOverride={validateEventOverride}
      />,
    );

    const assist = screen.getByRole("button", { name: "assist" });
    await waitFor(() => expect(assist).toBeEnabled());
    fireEvent.click(assist);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    expect(loadRuntimeOverride).toHaveBeenCalledTimes(2); // mount + connection authority check
    act(() => provider.emit("seat three call", { final: true, id: "after-prior-action" }));

    await screen.findByRole("button", { name: "Xác nhận action" });
    expect(loadRuntimeOverride).toHaveBeenCalledTimes(3); // final transcript must read newer state
    expect(validateEventOverride).toHaveBeenCalledWith(expect.objectContaining({
      expectedStateVersion: stateAfterPriorAction,
    }));
  });

  it("single-flights two rapid Assist confirmations", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    let resolveCommit: ((value: boolean) => void) | null = null;
    const handleVoiceAction = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveCommit = resolve;
    }));
    const hook = { ...hookFixture(), handleVoiceAction };
    renderPanel(hook, provider, vi.fn(async () => ({ ...validatedReceipt, execution_mode: "assist" as const })));
    fireEvent.click(screen.getByRole("button", { name: "assist" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("seat three call", { final: true, id: "assist-race" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(handleVoiceAction).toHaveBeenCalledOnce();
    resolveCommit?.(true);
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
  });

  it("deduplicates duplicate provider completion callbacks", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => validatedReceipt);
    renderPanel(hookFixture(), provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => {
      provider.emit("seat three call", { final: true, id: "same-provider-item" });
      provider.emit("seat three call", { final: true, id: "same-provider-item" });
    });
    await screen.findByText("Shadow hợp lệ, không gọi server và chưa ghi action.");
    expect(validateEventOverride).not.toHaveBeenCalled();
  });

  it("buffers during correction and revalidates in Assist after Floor resolves", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    const hook = { ...hookFixture(), handleVoiceAction };
    const validateEventOverride = vi.fn(async (input) => {
      if (input.finalTranscript.includes("sai")) {
        return {
          ...validatedReceipt,
          execution_result: "alert_opened" as const,
          correction_pending: true,
          alert_id: "floor-alert-1",
        };
      }
      return {
        ...validatedReceipt,
        voice_event_id: "voice-event-buffered",
        execution_mode: "assist" as const,
      };
    });
    renderPanel(hook, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");

    act(() => provider.emit("báo sai action", { final: true, id: "wrong-action" }));
    expect(await screen.findByText("Alert đã vào hàng đợi Floor.")).toBeInTheDocument();

    act(() => provider.emit("seat three call", { final: true, id: "buffered-call" }));
    expect(await screen.findByText("1 transcript đang chờ Floor")).toBeInTheDocument();
    expect(validateEventOverride).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại sau khi Floor sửa" }));
    const confirm = await screen.findByRole("button", { name: "Xác nhận action" });
    expect(validateEventOverride).toHaveBeenCalledTimes(2);
    expect(validateEventOverride.mock.calls[1][0]).toMatchObject({
      finalTranscript: "seat three call",
      executionMode: "assist",
    });
    fireEvent.click(confirm);
    expect(await screen.findByText(/Canonical receipt đã được Viewer\/Replay nhận/)).toBeInTheDocument();
    expect(handleVoiceAction).toHaveBeenCalledOnce();
  });

  it("lets Dealer discard buffered speech without writing an action", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    const validateEventOverride = vi.fn(async (_input: Parameters<NonNullable<VoicePanelProps["validateEventOverride"]>>[0]) => ({
      ...validatedReceipt,
      execution_result: "alert_opened" as const,
      correction_pending: true,
      alert_id: "floor-alert-1",
    }));
    renderPanel({ ...hookFixture(), handleVoiceAction }, provider, validateEventOverride);
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emit("báo sai action", { final: true, id: "wrong-action-discard" }));
    expect(await screen.findByText("Alert đã vào hàng đợi Floor.")).toBeInTheDocument();
    act(() => provider.emit("seat three call", { final: true, id: "buffered-discard" }));
    expect(await screen.findByText("1 transcript đang chờ Floor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ transcript chờ" }));
    expect(screen.queryByText("1 transcript đang chờ Floor")).not.toBeInTheDocument();
    expect(validateEventOverride).toHaveBeenCalledOnce();
    expect(handleVoiceAction).not.toHaveBeenCalled();
  });

  it("shows the live RMS meter and enables the bounded iPad mic test", async () => {
    const provider = new MockRealtimeTranscriptionProvider();
    renderPanel(hookFixture(), provider);
    expect(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cho phép microphone" }));
    await screen.findByText("Microphone đã kết nối");
    act(() => provider.emitLevel(0.4));
    expect(screen.getByRole("meter", { name: "Mức tín hiệu microphone" })).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra mic 30 giây" }));
    expect(screen.getByRole("button", { name: /Đang test 30s/ })).toBeDisabled();
    expect(screen.getByText("30s")).toBeInTheDocument();
  });

  it("keeps wrong-action reporting unavailable until server correction-pending is proven", () => {
    const validateEventOverride = vi.fn();
    const handleVoiceAction = vi.fn(async (..._args: Parameters<NonNullable<StandaloneHandInput["handleVoiceAction"]>>) => true);
    renderPanel({ ...hookFixture(), handleVoiceAction }, new MockRealtimeTranscriptionProvider(), validateEventOverride);

    expect(screen.getByRole("button", { name: "Báo sai action (chưa khả dụng)" })).toBeDisabled();
    expect(validateEventOverride).not.toHaveBeenCalled();
    expect(handleVoiceAction).not.toHaveBeenCalled();
  });

  it("keeps fallback controls on the existing manual action handler", () => {
    const handleDockAction = vi.fn();
    renderPanel({ ...hookFixture(), handleDockAction });

    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(handleDockAction).toHaveBeenCalledWith("call", undefined);
  });

  it.each([
    { handStarted: false },
    { showActionStep: false, workflowState: "setup_blinds" },
    { showActionStep: false, workflowState: "enter_flop" },
    { submitting: true },
    { actionSyncBlocked: true },
    { isReadOnly: true },
  ])("blocks manual fallback outside an available action step: %j", (state) => {
    const handleDockAction = vi.fn();
    renderPanel({ ...hookFixture(), ...state, handleDockAction } as StandaloneHandInput);
    for (const name of ["Fold", "Check", "Call", "Bet", "Raise", "All-in"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(handleDockAction).not.toHaveBeenCalled();
  });
});


describe('Voice split amounts across interrupted capture',()=>{
 it.each(['paused','recovering','offline','error'] as const)('does not join a pre-interruption Raise to an amount after %s',async(status)=>{
  const provider=new MockRealtimeTranscriptionProvider();
  let handlers:Parameters<typeof provider.connect>[0]|undefined;
  const connect=provider.connect.bind(provider);
  vi.spyOn(provider,'connect').mockImplementation(async(next)=>{handlers=next;await connect(next);});
  const validate=vi.fn(async()=>validatedReceipt);
  renderPanel(hookFixture(),provider,validate);
  fireEvent.click(screen.getByRole('button',{name:'Cho phép microphone'}));
  await screen.findByText('Microphone đã kết nối');
  act(()=>provider.emit('seat three raise',{final:true,id:'before-gap'}));
  await screen.findByText('Đã nhận lệnh Raise/Bet, đang chờ số chip.');
  act(()=>{handlers!.onStatus(status);handlers!.onStatus('listening');});
  act(()=>provider.emit('6000',{final:true,id:'after-gap'}));
  await screen.findByText('Chưa nhận ra một lệnh Voice duy nhất.');
  expect(screen.queryByText('Player A · raise tới 6.000')).not.toBeInTheDocument();
  expect(validate).not.toHaveBeenCalled();
 });
});
