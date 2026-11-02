// Poker IQ Drill — shared types (MVP 1, frontend-only, no DB, no network).
//
// Honesty note: nothing here is an "đáp án đúng" / absolute correct answer. Each
// option carries a baseline-quality score that reflects a *preferred baseline*
// curated by a coach/TD; many spots have several acceptable lines.

export const CONTENT_VERSION = "v1";
// Bump SCORING_VERSION whenever answer→subscore→archetype mapping changes, so
// cohorts stay comparable and a grade shift is explainable.
export const SCORING_VERSION = "v2";
export const RESULT_SCHEMA_VERSION = "v1";

export type DrillCategory =
  | "preflop_discipline"
  | "position_steal"
  | "vs_aggro"
  | "vs_nit_passive"
  | "tournament_pressure";

export const DRILL_CATEGORIES: DrillCategory[] = [
  "preflop_discipline",
  "position_steal",
  "vs_aggro",
  "vs_nit_passive",
  "tournament_pressure",
];

export type ReviewStatus = "draft" | "approved";
export type VillainProfile = "aggro" | "nit" | "passive" | "unknown";
export type ContentConfidence = "low" | "medium" | "high";
export type ProfileConfidence = "low" | "medium" | "high";
export type SelfConfidence = "low" | "medium" | "high";

export type LeakTag =
  | "tight_btn_co"
  | "overfold_vs_aggro"
  | "resteal_15_25"
  | "overcall_oop"
  | "spew_vs_nit";

export type StrengthTag =
  | "preflop_discipline"
  | "read_nit"
  | "low_spew"
  | "position_aware"
  | "icm_aware";

export type Archetype =
  | "tight_solid"
  | "aggressive_builder"
  | "final_table_hunter"
  | "high_variance_attacker"
  | "passive_caller"
  | "bubble_survivor"
  | "rising_grinder"
  | "short_stack_specialist";

export type SuggestedEventType =
  | "deepstack_mid_field"
  | "deepstack_small_field"
  | "slow_structure"
  | "turbo_short_stack";

export interface DrillOption {
  id: string;
  /** vi label shown on the choice button (content is vi-canonical for MVP 1) */
  label: string;
  /** 0..100 baseline quality of this choice for the hand's category */
  score: number;
  /** leak tags revealed when this option is chosen */
  leaks?: LeakTag[];
}

export interface DrillHand {
  id: string;
  contentVersion: string;
  reviewStatus: ReviewStatus;
  category: DrillCategory;
  difficulty: "easy" | "medium" | "hard";
  villainProfile: VillainProfile;
  heroHand: string;
  position: string;
  stackBb: number;
  scenario: string;
  options: DrillOption[];
  /** option id that is the preferred baseline (NOT an absolute correct answer) */
  preferredBaseline: string;
  /** option ids that are also acceptable lines */
  acceptableAlternatives: string[];
  /** short, educational, non-overclaiming */
  explanation: string;
  /** confidence in the *content* itself (curation), not the player */
  contentConfidence: ContentConfidence;
  /** why this baseline was chosen — review provenance */
  provenanceNote: string;
}

export interface DrillAnswer {
  handId: string;
  optionId: string;
  selfConfidence: SelfConfidence;
}

export interface CategoryScore {
  category: DrillCategory;
  score: number; // 0..100
}

export interface SuggestedEvent {
  fit: SuggestedEventType;
  avoid: SuggestedEventType;
}

export interface DrillResult {
  scoringVersion: string;
  resultSchemaVersion: string;
  contentVersion: string;
  totalScore: number; // 0..100 Poker IQ
  categoryScores: CategoryScore[];
  grade: string; // provisional letter, e.g. "B+"
  isProvisional: boolean; // MVP 1 is always true
  confidence: ProfileConfidence; // drill-only ⇒ "low"
  archetype: Archetype;
  strengths: StrengthTag[];
  leaks: LeakTag[];
  weakestCategory: DrillCategory;
  recommendedDrill: DrillCategory; // = weakest
  suggestedEvent: SuggestedEvent;
  answered: number;
  total: number;
}
