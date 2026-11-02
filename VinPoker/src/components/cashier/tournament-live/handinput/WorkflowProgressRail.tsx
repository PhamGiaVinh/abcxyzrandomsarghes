// Read-only progress rail for Tracker Engine Mode (Operator UX v2). Renders the
// nine visible steps of a hand (Setup → … → Submit) and highlights the current
// one, derived purely from the workflow state. It is NON-INTERACTIVE on purpose:
// in engine mode the operator never jumps streets — the state machine advances
// the hand, so there are no street tabs and no "Next" here.

import type { TrackerWorkflowState } from "./trackerWorkflow";

type Tone = "amber" | "emerald" | "purple" | "blue";

export interface RailStep {
  key: string;
  label: string;
  tone: Tone;
}

/** The nine operator-visible steps (13 workflow states collapse onto these). */
export const RAIL_STEPS: RailStep[] = [
  { key: "setup", label: "Setup", tone: "amber" },
  { key: "blinds", label: "Blind", tone: "amber" },
  { key: "preflop", label: "Preflop", tone: "emerald" },
  { key: "flop", label: "Flop", tone: "emerald" },
  { key: "turn", label: "Turn", tone: "emerald" },
  { key: "river", label: "River", tone: "emerald" },
  { key: "showdown", label: "Showdown", tone: "purple" },
  { key: "review", label: "Review", tone: "blue" },
  { key: "submit", label: "Gửi", tone: "blue" },
];

/** Map a 13-state workflow state onto its 0-based rail step index. */
export function railStepIndex(state: TrackerWorkflowState): number {
  switch (state) {
    case "setup_hand": return 0;
    case "setup_blinds": return 1;
    case "preflop_action": return 2;
    case "enter_flop":
    case "flop_action": return 3;
    case "enter_turn":
    case "turn_action": return 4;
    case "enter_river":
    case "river_action": return 5;
    case "showdown_input": return 6;
    case "review_hand": return 7;
    case "submit_ready":
    case "hand_complete": return 8;
    default: return 0;
  }
}

const ACTIVE_TONE: Record<Tone, string> = {
  amber: "border-amber-400 bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50",
  emerald: "border-emerald-400 bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/50",
  purple: "border-purple-400 bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50",
  blue: "border-blue-400 bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/50",
};

interface WorkflowProgressRailProps {
  state: TrackerWorkflowState;
  /** Betting is closed after an all-in; the covering player may retain chips. */
  allInRunout?: boolean;
}

export function WorkflowProgressRail({ state, allInRunout }: WorkflowProgressRailProps) {
  const current = railStepIndex(state);

  return (
    <div className="rounded-lg border border-border/30 bg-card p-2 shadow-sm" aria-label="Tiến trình ván bài">
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {RAIL_STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const cls = active
            ? ACTIVE_TONE[step.tone]
            : done
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300/80"
              : "border-border/40 bg-transparent text-muted-foreground/60";
          return (
            <div key={step.key} className="flex items-center gap-1 shrink-0">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${cls}`}
                aria-current={active ? "step" : undefined}
              >
                {done && <span aria-hidden="true">✓</span>}
                {step.label}
              </span>
              {i < RAIL_STEPS.length - 1 && (
                <span className="text-[10px] text-border" aria-hidden="true">›</span>
              )}
            </div>
          );
        })}
      </div>
      {allInRunout && (
        <div className="mt-1 px-1 text-[10px] text-amber-300/90">
          Runout sau all-in — nhập từng board để cập nhật viewer.
        </div>
      )}
    </div>
  );
}
