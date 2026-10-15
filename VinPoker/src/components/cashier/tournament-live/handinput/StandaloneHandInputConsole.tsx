// Presentational shell for the STANDALONE operator console (`/tracker/hand-input`).
//
// Layout per the operator mockup: a full-screen floor-control console, NOT the
// embedded panel. Desktop = 2 columns (oval table map LEFT via the SHARED LiveFelt,
// fixed guided action region RIGHT). Mobile = 3 bottom tabs [Bàn][Action][Log].
//
// It owns ZERO game/write logic — every bit of state + every handler comes from
// `useStandaloneHandInput`, which itself reuses the SAME 7 Edge payload builders as
// the embedded HandInputPanel. This file only arranges the already-built guided
// sub-panels (Setup/Blind/Board/Showdown/Action/Review) + the SHARED LiveFelt.
//
// The LiveFelt seat tap selects the actor (mockup: tap the real seat). Its additive
// `onSeatClick`/`selectedSeat` props keep the public /live + replay render
// byte-identical when absent.

import { useState } from "react";
import { useTournamentTableAppearance } from "@/components/tracker/useTournamentTableAppearance";
import { ArrowLeft, Loader2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { displayCard, type Card } from "@/components/shared/CardSlotPicker";
import { LiveFelt } from "../LiveFelt";
import { InputTableMap } from "./InputTableMap";
import { useInputTableAlerts } from "./useInputTableAlerts";
import { SetupHandPanel } from "./SetupHandPanel";
import { ChipQuickEditPanel } from "./ChipQuickEditPanel";
import { SeatSetupPanel } from "./SeatSetupPanel";
import { BlindSetupPanel } from "./BlindSetupPanel";
import { BoardEntryPanel } from "./BoardEntryPanel";
import { RunoutBoardPanel } from "./RunoutBoardPanel";
import { ShowdownInputPanel } from "./ShowdownInputPanel";
import { ReviewHandPanel } from "./ReviewHandPanel";
import { ActionStepPanel } from "./ActionStepPanel";
import { BetSizingChips } from "./BetSizingChips";
import { HandControlsStrip } from "./HandControlsStrip";
import { ViewerSyncStatus } from "./ViewerSyncStatus";
import { WorkflowProgressRail } from "./WorkflowProgressRail";
import { TableStateSummary } from "./TableStateSummary";
import { OperatorActionLog } from "./OperatorActionLog";
import { HandGuideDrawer } from "./HandGuideDrawer";
import { playersToSeatInfo, lastActorIdOf, latestActionLogOf, selectedSeatOf } from "./standaloneFelt";
import type { StandaloneHandInput } from "./useStandaloneHandInput";

type MobileTab = "table" | "action" | "log";

export function StandaloneHandInputConsole({ hook }: { hook: StandaloneHandInput }) {
  const [tab, setTab] = useState<MobileTab>("action");
  const alertsByTable = useInputTableAlerts(hook.tournamentId);
  const appearance = useTournamentTableAppearance(hook.tournamentId);

  // No table chosen yet → operator table picker (full screen).
  if (!hook.tableId) {
    return (
      <div className="mx-auto max-w-3xl">
        <InputTableMap
          tables={hook.availableTables}
          activeTableId={null}
          onSelect={hook.handlePickTable}
          onTakeover={FEATURES.trackerMultiTable ? hook.handleTakeoverLock : undefined}
          loadState={hook.tableLoadState}
          loadError={hook.tableLoadError}
          onRetry={hook.retryTableLoad}
          selectionNotice={hook.tableSelectionNotice}
          alertsByTable={alertsByTable}
        />
      </div>
    );
  }

  const bigBlind = hook.bigBlind;
  const formatBB = (n: number): string | null =>
    bigBlind > 0 ? `${(n / bigBlind).toFixed(1).replace(/\.0$/, "")} BB` : null;
  const feltBlinds = hook.blindLevelSnapshot && hook.blindLevelSnapshot.big_blind > 0
    ? { sb: hook.blindLevelSnapshot.small_blind, bb: hook.blindLevelSnapshot.big_blind,
        ante: hook.blindLevelSnapshot.ante, level: hook.blindLevelSnapshot.level_number }
    : null;

  const seatInfo = playersToSeatInfo(hook.players, {
    tableId: hook.tableId,
    positionsBySeat: hook.positionsBySeat,
  });
  const displayCards = hook.communityCards.map((c) => (c ?? "") as string);

  const disabled = hook.submitting || hook.isReadOnly || hook.actionSyncBlocked;
  const showActionFallback =
    hook.handStarted && !hook.isSummary && hook.showActionStep;
  const showSizingChips =
    showActionFallback && !hook.needsPostSB && !hook.needsPostBB && !!hook.actorPlayer;

  const sizingCtx = {
    bigBlind,
    pot: hook.potSize,
    toCall: hook.actorViewData?.toCall ?? 0,
    actorCurrentBet: hook.actorPlayer?.current_bet ?? 0,
    actorCurrentStack: hook.actorPlayer?.current_stack ?? 0,
  };

  // The guided sub-panel for the current workflow state (engine-only).
  const actionRegion = (() => {
    if (!hook.handStarted && !hook.orphanHand) {
      return (
        <SetupHandPanel
          handNumber={hook.handNumber}
          onHandNumberChange={hook.setHandNumber}
          seats={hook.players}
          positions={hook.positionsBySeat}
          buttonSeat={hook.buttonSeat}
          buttonConfirmed={hook.buttonConfirmed}
          onTapSeat={hook.handleSeatTap}
          onResetButton={hook.handleResetButton}
          onStartHand={hook.handleStartHand}
          startDisabledReason={hook.startDisabledReason}
          submitting={disabled}
          lastHandId={hook.lastHandId}
          onVoid={hook.handleVoid}
          // Pre-hand roster setup takes precedence when trackerSeatSetup is on; else the
          // A3 chip quick-edit; else nothing. Both flags OFF → prop absent (byte-identical).
          chipEditor={
            FEATURES.trackerSeatSetup && hook.tableId ? (
              <SeatSetupPanel
                tournamentId={hook.tournamentId}
                tableId={hook.tableId}
                players={hook.players}
                maxSeats={hook.maxSeats}
                avatarSupported={hook.avatarSupported}
                disabled={disabled}
                onSetSeat={hook.handleSetRosterSeat}
              />
            ) : FEATURES.trackerChipQuickEdit && hook.players.length > 0 ? (
              <ChipQuickEditPanel
                tournamentId={hook.tournamentId}
                tableId={hook.tableId}
                players={hook.players}
                disabled={disabled}
                onUpdated={hook.handleChipQuickEdit}
              />
            ) : undefined
          }
        />
      );
    }
    if (hook.isSummary) {
      return (
        <ReviewHandPanel
          players={hook.players}
          board={hook.communityCards}
          endingStacks={hook.endingStacks}
          onEndingStackChange={hook.handleEndingStackChange}
          potSize={hook.potSize}
          conservationOk={hook.conservationOk}
          winnerDetermined={hook.winnerDetermined}
          canSubmit={hook.reviewValid}
          showdownLayers={hook.showdownLayers}
          onSubmit={hook.handleSubmitHand}
          onBack={() => hook.setEndingStacks({})}
          submitting={disabled}
          rankShifts={FEATURES.trackerChipQuickEdit ? hook.rankShifts : undefined}
          diagnostics={FEATURES.trackerWorkflowAids}
        />
      );
    }
    if (hook.showBlindSetup) {
      return (
        <BlindSetupPanel
          buttonSeat={hook.buttonSeat}
          sbSeat={hook.blindSbSeat}
          bbSeat={hook.blindBbSeat}
          firstActorSeat={hook.firstActorSeat}
          isHeadsUp={hook.isHeadsUp}
          players={hook.players}
          levelNumber={hook.blindLevelSnapshot?.level_number ?? null}
          ante={hook.blindLevelSnapshot?.ante ?? 0}
          levelMissing={hook.blindLevelMissing}
          lockedAmounts={hook.blindLevelCanonical}
          sbAmount={hook.sbAmount}
          bbAmount={hook.bbAmount}
          onSbAmountChange={hook.setSbAmount}
          onBbAmountChange={hook.setBbAmount}
          sbPosted={hook.sbPosted}
          bbPosted={hook.bbPosted}
          onPost={hook.handlePostBlind}
          onConfirm={hook.handleConfirmBlinds}
          disabled={disabled}
          deadSb={hook.deadSb}
          onToggleDeadSb={hook.handleToggleDeadSb}
          onRefreshLevel={FEATURES.trackerWorkflowAids && !hook.blindLevelCanonical ? hook.refreshLiveLevel : undefined}
        />
      );
    }
    if (hook.showRunoutReveal) {
      // P2-2 all-in runout: reveal hole cards FIRST (live procedure), then the
      // board-entry branch below runs out the remaining streets, then auto-settle.
      return (
        <ShowdownInputPanel
          players={hook.players}
          board={hook.communityCards}
          holeCards={hook.playerHoleCards}
          usedCards={hook.usedCards}
          mucked={hook.muckedPlayerIds}
          onHoleCardChange={hook.handleHoleCardChange}
          onToggleMuck={hook.handleToggleMuck}
          onReveal={hook.handleShowHoleCards}
          selectedWinners={hook.selectedWinners}
          onToggleWinner={hook.handleToggleWinner}
          onConfirmResult={hook.handleConfirmShowdownResult}
          submitting={disabled}
          revealOnly
          onRevealAndContinue={hook.handleRevealRunout}
          // UAT wave 2: no-card-info escape — flag OFF → prop absent (byte-identical).
          onSkipReveal={FEATURES.trackerCoverCallRunout ? hook.handleSkipRevealRunout : undefined}
          revealOrder={hook.showdownOrderIds}
        />
      );
    }
    if (FEATURES.trackerRunoutOneScreen && hook.allInRunout && hook.showBoardEntry) {
      // B2: multi-way all-in → one panel for every remaining board slot + one
      // "Chia hết bài" (staged flop→turn→river persist). Flag OFF → the per-street
      // BoardEntryPanel below runs byte-identically.
      return (
        <RunoutBoardPanel
          communityCards={hook.communityCards}
          persistedBoardCount={hook.persistedBoardCount}
          usedCards={hook.usedCards}
          onCardChange={(i, c) =>
            hook.setCommunityCards((prev) => {
              const n = [...prev];
              n[i] = c;
              return n;
            })
          }
          onDealAll={hook.handleRunoutDealAll}
          submitting={disabled}
        />
      );
    }
    if (hook.showBoardEntry && hook.boardEntryStreetNow) {
      return (
        <BoardEntryPanel
          street={hook.boardEntryStreetNow}
          communityCards={hook.communityCards}
          usedCards={hook.usedCards}
          onCardChange={(i, c) =>
            hook.setCommunityCards((prev) => {
              const n = [...prev];
              n[i] = c;
              return n;
            })
          }
          onSubmit={hook.handleUpdateCommunityCards}
          submitting={disabled}
          allInRunout={hook.allInRunout}
        />
      );
    }
    if (hook.showShowdownInput) {
      return (
        <ShowdownInputPanel
          players={hook.players}
          board={hook.communityCards}
          holeCards={hook.playerHoleCards}
          usedCards={hook.usedCards}
          mucked={hook.muckedPlayerIds}
          onHoleCardChange={hook.handleHoleCardChange}
          onToggleMuck={hook.handleToggleMuck}
          onReveal={hook.handleShowHoleCards}
          onAutoSettle={hook.handleAutoSettle}
          selectedWinners={hook.selectedWinners}
          onToggleWinner={hook.handleToggleWinner}
          onConfirmResult={hook.handleConfirmShowdownResult}
          submitting={disabled}
          revealOrder={hook.showdownOrderIds}
        />
      );
    }
    if (hook.showActionStep) {
      return (
        <div className="space-y-2">
          <ActionStepPanel
            actor={hook.actorPlayer}
            actorPosition={hook.actorPos}
            view={hook.actorViewData}
            betAmount={hook.betAmount}
            onBetAmountChange={hook.setBetAmount}
            bigBlind={bigBlind}
            onAction={hook.handleDockAction}
            needsPostSB={hook.needsPostSB}
            needsPostBB={hook.needsPostBB}
            betIsTotal
            disabled={disabled}
          />
          {showSizingChips && (
            <BetSizingChips ctx={sizingCtx} value={hook.betAmount} onChange={hook.setBetAmount} disabled={disabled} />
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/40 bg-card/50 py-8 text-sm text-muted-foreground">
        {/* UAT wave 2: during a runout the "no actor" moment is EXPECTED (betting is
            closed) — say so instead of an ambiguous spinner. Flag OFF → spinner as today. */}
        {FEATURES.trackerCoverCallRunout && hook.allInRunout ? (
          <span className="text-emerald-300">Runout — nhập board tiếp theo, không còn hành động.</span>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý bước tiếp theo…
          </>
        )}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-3">
      {/* HEADER — back-to-tables, identity, viewer-sync */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={hook.backToTableMap}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Bàn
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{hook.tableName}</div>
            <div className="text-[11px] text-muted-foreground">
              {hook.handStarted ? `Hand #${Number(hook.handNumber) || "?"}` : "Chưa bắt đầu"} · {hook.streetLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HandGuideDrawer />
          <ViewerSyncStatus phase={hook.syncPhase} lastLabel={hook.syncLabel} onReload={hook.reloadAfterActionUncertainty} />
        </div>
      </div>

      {/* ORPHAN RESUME — an unfinished hand exists on this table */}
      {hook.orphanHand && !hook.handStarted && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
          <span className="text-xs text-amber-200">
            Bàn này còn Hand #{hook.orphanHand.hand_number} đang dở. Tiếp tục nhập hay huỷ?
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => hook.handleContinueOrphan()}
              className="rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-40"
            >
              Tiếp tục
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={hook.handleVoidOrphan}
              className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 disabled:opacity-40"
            >
              Huỷ hand
            </button>
          </div>
        </div>
      )}

      {/* PROGRESS RAIL — read-only, full width when a hand is live */}
      {hook.handStarted && !hook.isSummary && (
        <WorkflowProgressRail state={hook.workflowState} allInRunout={hook.allInRunout} />
      )}

      {/* MOBILE TABS */}
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/50 bg-card p-1 md:hidden">
        {(
          [
            ["table", "Bàn"],
            ["action", "Action"],
            ["log", "Log"],
          ] as [MobileTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex min-h-[44px] items-center justify-center rounded-lg px-2 text-sm font-semibold transition ${
              tab === key ? "bg-emerald-500/20 text-emerald-200" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 min-[1200px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* LEFT — oval table map (shared LiveFelt) + state summary */}
        <div className={`${tab === "table" ? "block" : "hidden"} space-y-2 md:block`}>
          {hook.players.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card/50 py-10 text-center text-sm text-muted-foreground">
              Bàn này chưa có người chơi đang hoạt động.
            </div>
          ) : (
            <LiveFelt
              seats={seatInfo}
              lastActorId={lastActorIdOf(hook.actions)}
              toActId={hook.toActId}
              displayCards={displayCards}
              potSize={hook.potSize}
              potBreakdown={hook.potBreakdown}
              multiTableUnresolved={false}
              handNumber={Number(hook.handNumber) || null}
              latestAction={latestActionLogOf(hook.actions)}
              formatBB={formatBB}
              buttonSeat={hook.buttonSeat}
              onSeatClick={hook.handleSeatNumberTap}
              selectedSeat={selectedSeatOf(hook.players, hook.selectedActorId)}
              physicalSeats={hook.maxSeats}
              viewerLayout
              compact
              blinds={feltBlinds}
              appearance={appearance.data}
              runout={hook.allInRunout}
            />
          )}
          {hook.handStarted && !hook.isSummary && (
            <TableStateSummary
              streetLabel={hook.streetLabel}
              pot={hook.potSize}
              sidePotCount={hook.potBreakdown.sidePots.length}
              actorName={hook.actorPlayer?.display_name ?? null}
              actorSeat={hook.actorPlayer?.seat_number ?? null}
              actorStack={hook.actorPlayer?.current_stack ?? null}
              toCall={hook.actorViewData?.toCall ?? 0}
            />
          )}
          {hook.handStarted && !hook.showBoardEntry && hook.communityCards.some(Boolean) && (
            <div className="flex items-center justify-center gap-3 rounded-lg border border-emerald-700/30 bg-emerald-950/30 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Board</span>
              <span className="font-mono text-sm tracking-wide text-foreground">
                {hook.communityCards.filter((c): c is Card => c !== null).map((c) => displayCard(c)).join("   ")}
              </span>
            </div>
          )}
        </div>

        {/* RIGHT — guided action region */}
        <div className={`${tab === "action" ? "block" : "hidden"} space-y-2 md:block`}>
          {actionRegion}
          {hook.handStarted && !hook.isSummary && (
            <HandControlsStrip
              onUndo={hook.handleUndo}
              canUndo={hook.canUndo}
              onReset={hook.resetHand}
              onVoid={hook.handleVoid}
              hasVoidTarget={!!(hook.lastHandId || hook.handStarted)}
              disabled={disabled}
              streetRollback={hook.streetRollbackUi}
              onStreetRollback={hook.handleStreetRollback}
            />
          )}
          {hook.handStarted && !hook.isSummary && hook.blindLevelChanged && (
            <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-300">
              Level mới đã bắt đầu. Ván này vẫn dùng Level {hook.blindLevelSnapshot?.level_number}; ván tiếp theo dùng Level{" "}
              {hook.liveLevelNumber}.
            </div>
          )}
        </div>
      </div>

      {/* LOG — full width (its own tab on mobile) */}
      <div className={`${tab === "log" ? "block" : "hidden"} md:block`}>
        <OperatorActionLog actions={hook.actions} communityCards={hook.communityCards} />
      </div>
    </div>
  );
}
