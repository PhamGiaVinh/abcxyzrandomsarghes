import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Play } from "lucide-react";
import {
  ALL_CONTENT_APPROVED,
  computeDrillResult,
  DRILL_HANDS,
  DrillAnswer,
  DrillCategory,
  DrillHand,
  mergeHands,
} from "@/lib/pokerIQ";
import { FEATURES } from "@/lib/featureFlags";
import { loadRemoteApprovedHands } from "@/lib/pokerIQ/loadRemoteQuestions";
import { DraftRibbon } from "@/components/pokerIQ/DraftRibbon";
import { HandQuestion } from "@/components/pokerIQ/HandQuestion";
import { ResultCard } from "@/components/pokerIQ/ResultCard";

type Phase = "intro" | "playing" | "result";

/**
 * Poker IQ Drill — focused full-screen flow (no global nav chrome). MVP 1:
 * frontend-only, in-memory result, no persistence, no real ITM/FT odds.
 */
export default function PokerIQ() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Built-in static bank by default; when the flag is ON, merge any APPROVED
  // questions the Super Admin authored (shape-guarded, append/override by id). On
  // any failure we keep the static bank, so the drill always works.
  const [hands, setHands] = useState<DrillHand[]>(DRILL_HANDS);
  // A remote update is available for the next run, never a new answer key for
  // the question currently displayed or a result the player already finished.
  const [runHands, setRunHands] = useState<DrillHand[]>(DRILL_HANDS);
  useEffect(() => {
    if (!FEATURES.pokerIqRemoteQuestions) return;
    let cancelled = false;
    loadRemoteApprovedHands().then((remote) => {
      if (!cancelled && remote.length > 0) setHands(mergeHands(DRILL_HANDS, remote));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [phase, setPhase] = useState<Phase>("intro");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);

  const result = useMemo(
    () => (phase === "result" ? computeDrillResult(runHands, answers) : null),
    [phase, runHands, answers],
  );

  const handleAnswer = (answer: DrillAnswer) => {
    const next = [...answers.filter((a) => a.handId !== answer.handId), answer];
    setAnswers(next);
    if (idx + 1 >= runHands.length) {
      setPhase("result");
    } else {
      setIdx(idx + 1);
    }
  };

  const restart = () => {
    setRunHands(hands);
    setAnswers([]);
    setIdx(0);
    setPhase("playing");
  };

  const goBack = () => navigate(-1);
  const drillLabel = (c: DrillCategory) => t(`pokerDrill.category.${c}`);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      {!ALL_CONTENT_APPROVED && <DraftRibbon />}

      <header className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={goBack}
          aria-label={t("pokerDrill.intro.back")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium text-foreground">{t("pokerDrill.intro.title")}</span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-md">
          {phase === "intro" && (
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div className="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
                {t("pokerDrill.intro.kicker")}
              </div>
              <h1 className="text-2xl font-medium">{t("pokerDrill.intro.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("pokerDrill.intro.subtitle")}</p>
              <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{t("pokerDrill.intro.note")}</p>
              <button
                type="button"
                onClick={restart}
                className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {t("pokerDrill.intro.start")}
              </button>
            </div>
          )}

          {phase === "playing" && (
            <div className="py-2">
              <HandQuestion key={runHands[idx].id} hand={runHands[idx]} index={idx} total={runHands.length} onAnswer={handleAnswer} />
            </div>
          )}

          {phase === "result" && result && (
            <div className="py-2">
              <ResultCard result={result} />
            </div>
          )}
        </div>
      </main>

      {/* Sticky CTA — owns the bottom of the focused flow, above the safe-area inset. */}
      {phase === "result" && result && (
        <div
          className="sticky bottom-0 border-t border-border bg-background px-4 pt-3.5"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="mx-auto w-full max-w-md">
            <button
              type="button"
              onClick={restart}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {t("pokerDrill.result.cta", { drill: drillLabel(result.recommendedDrill) })}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-muted-foreground">{t("pokerDrill.result.ctaSub")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
