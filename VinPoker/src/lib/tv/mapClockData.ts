import type { TournamentClockData, PayoutRow } from "@/components/tournament-clock/types";
import type { TvData, TvLevel } from "@/types/tv";
import { bigBlindsOf, formatBlinds, formatChips } from "@/lib/tv/format";

// Map the frozen live TvData contract → the presentational neon-green clock's props.
// All money/chips are formatted to strings here (the component is locale-dumb). The
// data-correctness rules below are the owner's P0 review items — keep the comments.

const RANK = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const rankLabel = (pos: number) => RANK[pos - 1] ?? `${pos}th`;
// Prize pool + payouts show plain grouped numbers (no "đ" suffix) — owner preference.
const money = (n: number) => formatChips(n);

function levelStr(l: TvLevel | null): string {
  if (!l) return "—";
  const base = formatBlinds(l.smallBlind, l.bigBlind);
  return l.ante > 0 ? `${base} / ${formatChips(l.ante)}` : base;
}

export function mapTvDataToClock(d: TvData): TournamentClockData {
  const terminalStatus = d.status === 'finished' || d.status === 'cancelled' ? d.status : undefined;
  // Canonical participation already includes waiting players. Zero is a valid
  // remaining count, not permission to resurrect busted historical entries.
  const players = d.playersRemaining;

  // Canonical participation reads supply the exact total. Reconstructing it from
  // a rounded average loses chips. Preserve the old estimate for legacy/mock data only.
  const totalChips = d.totalChips ?? (
    d.averageStack > 0 && d.playersRemaining > 0
      ? d.averageStack * d.playersRemaining
      : d.totalEntries * (d.startingStack || 0));

  // Legacy/mock P0-2: a raw row may be stale/manual. Keep its historical
  // precedence: positive prize_pool → GTD → estimate. Current authenticated
  // and paired TV read models explicitly mark their canonical value; zero and
  // unknown must survive that composition instead of becoming gross buy-ins.
  // Legacy estimates use confirmed buy-ins, else entries × (buy_in − rake).
  // Unknown canonical values render "—"; canonical zero renders "0".
  const estimate =
    d.totalBuyIns != null && d.totalBuyIns > 0
      ? d.totalBuyIns
      : d.buyIn != null
        ? d.totalEntries * Math.max(0, d.buyIn - (d.rakeAmount ?? 0))
        : null;
  const prizePoolValue = d.prizePoolIsCanonical
    ? (d.prizePool != null && Number.isFinite(d.prizePool) && d.prizePool >= 0 ? d.prizePool : null)
    : d.prizePool != null && d.prizePool > 0
      ? d.prizePool
      : d.guarantee != null && d.guarantee > 0
        ? d.guarantee
        : estimate;

  const payouts: PayoutRow[] = d.prizes.map((p) => ({ rank: rankLabel(p.position), amount: money(p.amount) }));

  const bb = bigBlindsOf(d.averageStack, d.currentLevel?.bigBlind);
  const averageStack =
    d.averageStack > 0
      ? bb != null
        ? `${formatChips(d.averageStack)} · ${bb} BB`
        : formatChips(d.averageStack)
      : "—";

  return {
    title: d.tournamentName,
    players,
    entries: d.totalEntries,
    reEntries: d.reEntries ?? 0,
    prizePool: prizePoolValue != null ? money(prizePoolValue) : "—",
    totalChips: totalChips > 0 ? formatChips(totalChips) : "—",
    averageStack,
    terminalStatus,
    levelLabel: terminalStatus ? terminalStatus === 'finished' ? 'Finished' : 'Cancelled'
      : d.currentLevel ? `Level ${d.currentLevel.levelNumber}` : d.isBreak ? "Break" : "—",
    secondsLeft: d.remainingSeconds,
    // P0-4 — nextBreakSeconds is already number|null; pass it through, never `|| 0`.
    nextBreakSecondsLeft: terminalStatus ? null : d.nextBreakSeconds,
    currentLevel: levelStr(d.currentLevel),
    nextLevel: terminalStatus ? '—' : levelStr(d.nextLevel),
    payouts,
    footerNote: [d.eventNote ?? d.sponsorText,
      d.mainEventGuarantee != null && d.mainEventGuarantee > 0
        ? `Main Event GTD (all flights): ${money(d.mainEventGuarantee)}` : null,
    ].filter(Boolean).join(' · '),
    brandName: d.brandName ?? undefined,
    clubBackgroundUrl: d.clubCoverUrl ?? null,
    clubLogoUrl: d.clubLogoUrl ?? null,
    brandingLayout: d.brandingLayout,
  };
}
