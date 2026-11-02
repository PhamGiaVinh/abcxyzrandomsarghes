import { describe, expect, it } from "vitest";

import { parseVoiceCommand } from "../../src/lib/trackerVoice/parser";
import { resolveVoiceProposal } from "../../src/lib/trackerVoice/proposal";
import type {VoiceProposalContext} from '../../src/lib/trackerVoice/types';
import {routeTrackerVoiceIntent} from '../../src/lib/trackerVoice/intentRouter';
import { parseTrackerVoiceCommand } from "../../supabase/functions/_shared/trackerVoiceParser";
import { VOICE_UAT_CORPUS } from "./voiceUatCorpus";

function browserShape(transcript: string, options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean }) {
  const parsed = parseVoiceCommand(transcript, options);
  return parsed
    ? {
        kind: parsed.kind,
        normalizedTranscript: parsed.normalizedTranscript,
        amount: parsed.amount?.value ?? null,
        amountAmbiguous: parsed.amount?.ambiguous ?? false,
        spokenSeatNumber: parsed.spokenSeatNumber,
        riskTier: parsed.riskTier,
        requiresConfirmation: parsed.requiresConfirmation,
        repairs: parsed.repairs,
      }
    : null;
}

function serverShape(transcript: string, options: { spokenAmountUnit?: number; amountUnitConfirmed?: boolean }) {
  const parsed = parseTrackerVoiceCommand(transcript, {
    spokenAmountUnit: options.spokenAmountUnit ?? 1,
    amountUnitConfirmed: options.amountUnitConfirmed ?? false,
  });
  return parsed ?? null;
}

describe("Tracker Voice browser and Edge parser parity", () => {
  it("contains the fixed 200-utterance real-voice UAT corpus", () => {
    expect(VOICE_UAT_CORPUS).toHaveLength(200);
    expect(new Set(VOICE_UAT_CORPUS.map((item) => item.id)).size).toBe(200);
  });

  it.each(VOICE_UAT_CORPUS)("classifies $id identically", (fixture) => {
    const options = fixture.options ?? { spokenAmountUnit: 1_000, amountUnitConfirmed: true };
    const browser = browserShape(fixture.transcript, options);
    const server = serverShape(fixture.transcript, options);
    expect(browser).toEqual(server);
    expect(browser && {
      kind: browser.kind,
      amount: browser.amount,
      amountAmbiguous: browser.amountAmbiguous,
    }).toEqual(fixture.expected.kind === null
      ? null
      : fixture.expected);
  });

  it("fails closed for bare amounts until the table configuration confirms a unit", () => {
    expect(browserShape("raise 120", {})).toMatchObject({ kind: "raise_to", amount: 120, amountAmbiguous: true });
    expect(serverShape("raise 120", {})).toMatchObject({ kind: "raise_to", amount: 120, amountAmbiguous: true });
    expect(browserShape("raise 120", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toMatchObject({ kind: "raise_to", amount: 120_000, amountAmbiguous: false });
  });

  it.each([
    ["seat number two raise four thousand", 2, 4_000],
    ["seat number three fold", 3, null],
    ["ghế số 6 raise 20.000", 6, 20_000],
  ])("keeps browser and Edge seat metadata identical for %s", (transcript, seat, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ spokenSeatNumber: seat, amount });
  });

  it.each([
    "fit 9 all in",
    "feet 9 all in",
    "FIT 9, ALL-IN!",
    "Feet 9: all in.",
  ])("rejects repaired all-in identically in browser and Edge: %s", (transcript) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape(transcript, options)).toBeNull();
    expect(serverShape(transcript, options)).toBeNull();
  });

  it("keeps exact and safe repaired commands identical", () => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: false };
    expect(browserShape("seat 9 all in", options)).toEqual(serverShape("seat 9 all in", options));
    expect(browserShape("seat 9 all in", options)).toMatchObject({
      kind: "all_in",
      spokenSeatNumber: 9,
      riskTier: "EXACT",
      requiresConfirmation: false,
    });
    expect(browserShape("fit 3 call", options)).toEqual(serverShape("fit 3 call", options));
    expect(browserShape("fit 3 call", options)).toMatchObject({
      kind: "call",
      spokenSeatNumber: 3,
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
    });
    expect(browserShape("dealer fit 9 all in", options)).toBeNull();
    expect(serverShape("fit feet 9 all in", options)).toBeNull();
  });

  it("keeps the existing bet unit conversion and ambiguity identical", () => {
    expect(browserShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toEqual(serverShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }));
    expect(browserShape("bet 9", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }))
      .toMatchObject({ kind: "bet_to", amount: 9_000, amountAmbiguous: false });
    expect(browserShape("bet 9", {})).toEqual(serverShape("bet 9", {}));
    expect(browserShape("bet 9", {})).toMatchObject({ kind: "bet_to", amount: 9, amountAmbiguous: true });
  });

  it.each([
    ["seat four raise 220.0", { spokenAmountUnit: 1_000, amountUnitConfirmed: true }, 220_000],
    ["seat four raise 5.000", {}, 5_000],
    ["seat four raise 11.300", {}, 11_300],
    ["seat four raise 11.322", {}, 11_322],
    ["seat four raise 101699", {}, 101_699],
  ])("keeps Gemini-formatted amount parity for %s", (transcript, options, amount) => {
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ kind: "raise_to", amount, amountAmbiguous: false });
  });

  it.each([
    ["seat four raise 120,0", 120],
  ])("fails closed for an unqualified Gemini decimal identically: %s", (transcript, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: true };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ kind: "raise_to", amount, amountAmbiguous: true });
  });

  it.each([
    ["seat four raise 1.750.0", 1_750_000],
    ["seat four raise 1 million and 200 thousand", 1_200_000],
  ])("normalizes a reviewed million transcript identically: %s", (transcript, amount) => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: true };
    expect(browserShape(transcript, options)).toEqual(serverShape(transcript, options));
    expect(browserShape(transcript, options)).toMatchObject({ kind: "raise_to", amount, amountAmbiguous: false });
  });

  it("normalizes the reviewed thousands transcript identically", () => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: true };
    expect(browserShape("seat four bet 300.0", options)).toEqual(serverShape("seat four bet 300.0", options));
    expect(browserShape("seat four bet 300.0", options)).toMatchObject({
      kind: "bet_to",
      amount: 300_000,
      amountAmbiguous: false,
      riskTier: "BOUNDED_REPAIR",
      requiresConfirmation: true,
    });
  });

  it("parses an exact spoken all-in amount identically", () => {
    const options = { spokenAmountUnit: 1, amountUnitConfirmed: true };
    expect(browserShape("seat 4 all in 200.000", options)).toEqual(serverShape("seat 4 all in 200.000", options));
    expect(browserShape("seat 4 all in 200.000", options)).toMatchObject({
      kind: "all_in",
      amount: 200_000,
      amountAmbiguous: false,
      spokenSeatNumber: 4,
    });
  });

  it.each(['dealer raise 30k','dealer bet 30k','dealer seat four fold','dealer call floor'])(
    'rejects an ambiguous dealer prefix in both parsers: %s',transcript=>{
      expect(browserShape(transcript, {})).toBeNull();
      expect(serverShape(transcript, {})).toBeNull();
      expect(routeTrackerVoiceIntent(transcript,'preflop_action')).toEqual({ok:false,code:'command_not_supported'});
    },
  );

  it("keeps spoken call totals identical and requires the engine-derived call amount", () => {
    const transcript='seat four call 30k';
    expect(browserShape(transcript, {})).toEqual(serverShape(transcript, {}));
    expect(browserShape(transcript, {})).toMatchObject({kind:'call',amount:30_000,amountAmbiguous:false,spokenSeatNumber:4});
    const context:VoiceProposalContext={handId:'hand',street:'preflop',workflowState:'preflop_action',actionOrder:3,
      expectedStateVersion:'revision',actor:{playerId:'player',playerName:'TEST',seatNumber:4,entryNumber:1,currentStack:100_000,currentBet:5_000},
      actorView:{toCall:25_000,minRaiseTo:60_000,legal:{fold:true,check:false,call:true,bet:false,raise:true,allIn:true}},
      handStarted:true,actionStepActive:true,readOnly:false,syncBlocked:false,correctionPending:false};
    expect(resolveVoiceProposal(parseVoiceCommand(transcript),context)).toMatchObject({ok:true,canonicalAction:'call',expectedActionAmount:25_000,betToTotal:30_000});
    expect(resolveVoiceProposal(parseVoiceCommand('seat four call 20k'),context)).toMatchObject({ok:false,code:'amount_out_of_range'});
    expect(resolveVoiceProposal(parseVoiceCommand('seat five call 30k'),context)).toMatchObject({ok:false,code:'OUT_OF_TURN'});
    expect(resolveVoiceProposal(parseVoiceCommand('seat four call 30'),context)).toMatchObject({ok:false,code:'amount_ambiguous'});
    expect(resolveVoiceProposal(parseVoiceCommand(transcript),{...context,syncBlocked:true})).toMatchObject({ok:false,code:'sync_blocked'});
  });
});
