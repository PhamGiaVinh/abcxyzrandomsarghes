import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Hand #4 resume workflow contracts", () => {
  it("reads persisted hand identity by logical incarnation without changing the physical UI selection", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const load = source.slice(source.indexOf("const handleTableChange ="), source.indexOf("const handlePickTable ="));
    expect(load).toContain("setTableId(newTableId)");
    expect(load).toContain("const handTableId = tbl?.tournamentTableId ?? newTableId");
    expect(load.match(/\.eq\("table_id", handTableId\)/g)).toHaveLength(2);
    expect(load).toContain("buildNextHandNumberRequest(tournamentId, handTableId)");
    expect(source).toContain("buildNextHandNumberRequest(tournamentId, targetHandTableId)");
    const resumeStart = source.indexOf("const handleContinueOrphan =");
    const resumeEnd = source.indexOf("// A5 resilience: an orphan hand");
    expect(resumeStart).toBeGreaterThan(0);
    expect(resumeEnd).toBeGreaterThan(resumeStart);
    const resume = source.slice(resumeStart, resumeEnd);
    expect(resume).toContain('.eq("table_id", tournamentTableId ?? tableId)');
    const submit = source.slice(source.indexOf("const handleSubmitHand ="), source.indexOf("const handleVoid ="));
    expect(submit).toContain('.eq("table_id", tournamentTableId ?? tableId)');
  });
  it("distinguishes manual ending-stack edits from engine settlement", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const auto = source.slice(source.indexOf("const handleAutoSettle ="), source.indexOf("const handleConfirmShowdownResult ="));
    const manual = source.slice(source.indexOf("const handleConfirmShowdownResult ="), source.indexOf("const handleSubmitHand ="));
    const fold = source.slice(source.indexOf("const winner = foldWinner(engineState.seats);"));
    expect(auto).toContain("setEndingStacksManuallyEdited(false)");
    expect(manual.match(/setEndingStacksManuallyEdited\(true\)/g)).toHaveLength(2);
    expect(fold).toContain("setEndingStacksManuallyEdited(false)");
    expect(source).toContain("if (endingStacksManuallyEdited && !confirm(");
    expect(source).not.toContain("const stacksEdited = players.some(");
  });

  it("commits the persisted hand identity and only announces a successful resume", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    expect(source).toContain('.select("id, hand_number, table_id, button_seat, community_cards")');
    expect(source).toContain("setHandNumber(Number(hand.hand_number))");
    expect(source).toContain("if (!resumed) return;");
    expect(source).toContain("loadNextHandNumber: false");
    const backToMap = source.slice(source.indexOf("const backToTableMap ="), source.indexOf("const handleTakeoverLock ="));
    expect(backToMap).toContain("setTableReloadAttempt((attempt) => attempt + 1)");
  });

  it("restores same-session blind lineage before suggesting the next button", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const tableLoad = source.slice(source.indexOf("const handleTableChange ="), source.indexOf("const handlePickTable ="));

    expect(tableLoad).toContain('.select("id, button_seat, status, is_voided")');
    expect(tableLoad).toContain('.filter("table_session_id", "eq", loadedSessionId)');
    expect(tableLoad).toContain('lastHand.status === "completed" && !lastHand.is_voided');
    expect(tableLoad).toContain("readBlindLineageState(lastHand.id)");
    expect(tableLoad).toContain("if (!previousRead.available)");
    expect(tableLoad).toContain("setLastBlindLineage(previousLineage)");
    expect(tableLoad).toContain("previousSbPosition: previousLineage?.previousSbPosition ?? null");
  });

  it("uses the Floor level frozen in the hand for start and resume", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const start = source.slice(source.indexOf("const handleStartHand ="), source.indexOf("const handleContinueOrphan ="));
    const resume = source.slice(source.indexOf("const handleContinueOrphan ="), source.indexOf("const handleVoidOrphan ="));
    expect(start).toContain("await readHandBlindLevel(handData.hand_id)");
    expect(start.indexOf("setBlindLevelSnapshot(frozenLevel)")).toBeLessThan(start.indexOf("setHandStarted(true)"));
    expect(resume).toContain("await readHandBlindLevel(targetOrphan.id)");
    expect(source).toContain("!blindLevelCanonical && !sbPosted && !bbPosted");
    for (const file of ["StandaloneHandInputConsole.tsx", "RacetrackHandInputConsole.tsx"]) {
      expect(read(`src/components/cashier/tournament-live/handinput/${file}`))
        .toContain("lockedAmounts={hook.blindLevelCanonical}");
    }
  });

  it("uses the dead-button engine after both manual and Voice hand completion", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const voiceStart = source.indexOf("const applyVoiceFinishReceipt =");
    const manualStart = source.indexOf("const applyRecordedHand =");
    const voiceFinish = source.slice(voiceStart, source.indexOf("// B2", voiceStart));
    const manualFinish = source.slice(manualStart, source.indexOf("try {", manualStart));

    for (const finishPath of [voiceFinish, manualFinish]) {
      expect(finishPath).toContain("await readBlindLineageState(");
      expect(finishPath).toContain("setBlindLineageUnavailable(");
      expect(finishPath).toContain("nextButtonFromBlindLineage({");
      expect(finishPath).toContain("setButtonConfirmed(Boolean(nextSuggestion))");
      expect(finishPath).not.toContain("setButtonSeat(nextButton(activeNums, buttonSeat))");
    }
  });

  it("reconciles an uncertain hand submit by exact readback without retrying the writer", () => {
    const source = read("src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts");
    const submit = source.slice(source.indexOf("const handleSubmitHand ="), source.indexOf("const handleVoid ="));

    expect(submit.match(/supabase\.functions\.invoke\("tournament-live-update"/g)).toHaveLength(1);
    expect(submit).toContain('.from("tournament_hands")');
    expect(submit).toContain('.eq("id", submittedHandId)');
    expect(submit).toContain('.eq("tournament_id", tournamentId)');
    expect(submit).toContain('.eq("table_id", tableId)');
    expect(submit).toContain('.eq("hand_number", Number(handNumber))');
    expect(submit).toContain("isConfirmedCompletedHandReadback(completedHand, potSize)");
    expect(submit).toContain("await applyRecordedHand(completedHand.id, true)");
  });

  it("keeps cashier re-entry, registration VOID, and Tracker flags fail-closed", () => {
    expect(FEATURES.cashierReentry).toBe(false);
    expect(FEATURES.registrationExtensions).toBe(false);
    expect(FEATURES.trackerUnifiedOpsFlow).toBe(false);
    expect(FEATURES.trackerAtomicResettle).toBe(true);

    const reentry = read("src/components/cashier/ReentryPanel.tsx");
    const queue = read("src/components/cashier/tournament-live/RegistrationQueuePanel.tsx");
    expect(reentry).toContain("FEATURES.cashierReentry");
    expect(reentry).not.toContain("FEATURES.registrationExtensions");
    expect(queue).toContain("FEATURES.registrationExtensions");
  });

  it("signals React boot before the animation frame used for splash cleanup", () => {
    const source = read("src/main.tsx");
    const mounted = source.indexOf('window.dispatchEvent(new Event("vp:react-mounted"))');
    const frame = source.indexOf("requestAnimationFrame(() => {");
    expect(mounted).toBeGreaterThan(-1);
    expect(mounted).toBeLessThan(frame);
    expect(source.slice(frame)).not.toContain('window.dispatchEvent(new Event("vp:react-mounted"))');
  });
});
