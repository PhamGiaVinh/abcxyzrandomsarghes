import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkflowProgressRail,
  railStepIndex,
  RAIL_STEPS,
} from "@/components/cashier/tournament-live/handinput/WorkflowProgressRail";
import type { TrackerWorkflowState } from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

const ALL_STATES: TrackerWorkflowState[] = [
  "setup_hand",
  "setup_blinds",
  "preflop_action",
  "enter_flop",
  "flop_action",
  "enter_turn",
  "turn_action",
  "enter_river",
  "river_action",
  "showdown_input",
  "review_hand",
  "submit_ready",
  "hand_complete",
];

describe("WorkflowProgressRail (read-only progress rail)", () => {
  it("renders all nine operator-visible step labels", () => {
    const html = renderToStaticMarkup(<WorkflowProgressRail state="setup_hand" />);
    for (const step of RAIL_STEPS) {
      expect(html).toContain(step.label);
    }
    // exactly nine steps
    expect(RAIL_STEPS).toHaveLength(9);
  });

  it("is NON-interactive — no buttons, no street tabs, no 'Next'/'Sang'", () => {
    const html = renderToStaticMarkup(<WorkflowProgressRail state="flop_action" />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Next");
    expect(html).not.toContain("Sang ");
  });

  it("marks the current step with aria-current='step' (exactly once)", () => {
    const html = renderToStaticMarkup(<WorkflowProgressRail state="turn_action" />);
    const matches = html.match(/aria-current="step"/g) || [];
    expect(matches).toHaveLength(1);
  });

  it("shows a ✓ on already-completed steps (river action ⇒ earlier steps done)", () => {
    const html = renderToStaticMarkup(<WorkflowProgressRail state="river_action" />);
    expect(html).toContain("✓");
  });

  it("shows the all-in runout hint only when flagged", () => {
    const off = renderToStaticMarkup(<WorkflowProgressRail state="enter_turn" />);
    expect(off).not.toContain("Runout sau all-in");
    const on = renderToStaticMarkup(<WorkflowProgressRail state="enter_turn" allInRunout />);
    expect(on).toContain("Runout sau all-in");
    expect(on).not.toContain("All-in nhiều người");
  });

  it("railStepIndex maps every workflow state into 0..8 with the documented collapses", () => {
    const expected: Record<TrackerWorkflowState, number> = {
      setup_hand: 0,
      setup_blinds: 1,
      preflop_action: 2,
      enter_flop: 3,
      flop_action: 3,
      enter_turn: 4,
      turn_action: 4,
      enter_river: 5,
      river_action: 5,
      showdown_input: 6,
      review_hand: 7,
      submit_ready: 8,
      hand_complete: 8,
    };
    for (const s of ALL_STATES) {
      const idx = railStepIndex(s);
      expect(idx).toBe(expected[s]);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(8);
    }
  });
});
