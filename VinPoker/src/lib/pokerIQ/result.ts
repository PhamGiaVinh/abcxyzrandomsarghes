// Orchestrator: 20 answers → full provisional DrillResult. Pure & deterministic.
import { classifyArchetype, deriveLeaks, deriveStrengths } from "./archetype";
import { categoryScores, gradeFromScore, totalScore } from "./scorer";
import { suggestedEvent, weakestCategory } from "./selectors";
import {
  CONTENT_VERSION,
  DrillAnswer,
  DrillHand,
  DrillResult,
  RESULT_SCHEMA_VERSION,
  SCORING_VERSION,
} from "./types";

export function computeDrillResult(hands: DrillHand[], answers: DrillAnswer[]): DrillResult {
  const cs = categoryScores(hands, answers);
  const answeredCategories = new Set(hands.filter(hand => {
    const answer = answers.find(a => a.handId === hand.id);
    return answer && hand.options.some(option => option.id === answer.optionId);
  }).map(hand => hand.category));
  const total = totalScore(cs.filter(c => answeredCategories.has(c.category)));
  const weakest = weakestCategory(cs);
  const archetype = classifyArchetype(cs);

  return {
    scoringVersion: SCORING_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    contentVersion: CONTENT_VERSION,
    totalScore: total,
    categoryScores: cs,
    grade: gradeFromScore(total),
    isProvisional: true,
    confidence: "low", // drill-only ⇒ always low confidence in MVP 1
    archetype,
    strengths: deriveStrengths(cs, total),
    leaks: deriveLeaks(cs),
    weakestCategory: weakest,
    recommendedDrill: weakest,
    suggestedEvent: suggestedEvent(archetype, weakest),
    answered: answers.filter((a) => hands.some((h) => h.id === a.handId)).length,
    total: hands.length,
  };
}
