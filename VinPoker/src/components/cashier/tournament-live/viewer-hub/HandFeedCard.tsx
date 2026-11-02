// One spectator HAND FEED card (RPT-Live-style): tags + pot(+BB) + board + per-player
// rows (avatar, name, 👑 winner, finish badge, revealed/face-down hole cards, chip
// delta abs&BB) + Share / View-hand. Presentational only — props in, no fetching.
// PokerVN / Stitch Dark identity: neon-green `--primary` accents on dark blue-black,
// `--destructive` for losses/eliminations, casino-gold `--warning` for HIGH HAND.

import { useTranslation } from "react-i18next";
import { Crown, Share2, Play } from "lucide-react";
import { PokerCard, CardBack } from "../PokerVisuals";
import { fmtCompact } from "./hubDerive";
import { formatViewerBBOrUnavailable } from "@/lib/tracker-poker/viewerAmounts";
import type { HandFeedItem, HandFeedTag } from "./handFeedDerive";
import { ViewerActionTimeline } from "./ViewerActionTimeline";
import type { ReplayTarget } from "./replayTarget";

const TAG_META: Record<HandFeedTag, { label: string; cls: string }> = {
  all_in: { label: "ALL-IN", cls: "border-[#991B1B] bg-[#991B1B]/25 text-[#ff9b9b]" },
  big_pot: { label: "BIG POT", cls: "border-success/40 bg-success/15 text-success" },
  high_hand: { label: "HIGH HAND", cls: "border-warning/40 bg-warning/15 text-warning" },
  eliminated: { label: "ELIMINATED", cls: "border-destructive/40 bg-destructive/15 text-destructive" },
};

function pad5(board: string[]): (string | null)[] {
  return [...board, ...Array(Math.max(0, 5 - board.length)).fill(null)].slice(0, 5);
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

export interface HandFeedCardProps {
  item: HandFeedItem;
  /** New Viewer shell composition. False preserves the current card markup. */
  rpt?: boolean;
  /** Human table name from the already-loaded hub table map. */
  tableName?: string | null;
  /** Open this specific hand in replay. Hand number is display-only. */
  onViewHand?: (target: ReplayTarget) => void;
  onShare?: (target: ReplayTarget) => void;
}

function publicPlayerName(name: string, playerId: string, fallback: string): string {
  const trimmed = name.trim();
  const prefix = playerId.slice(0, 6).toLowerCase();
  const looksLikeOpaqueId = /^[a-f0-9]{6}$/i.test(trimmed) || /^[a-f0-9-]{24,}$/i.test(trimmed);
  return !trimmed || trimmed.toLowerCase() === prefix || looksLikeOpaqueId ? fallback : trimmed;
}

export function HandFeedCard({ item, rpt = false, tableName, onViewHand, onShare }: HandFeedCardProps) {
  const { t, i18n } = useTranslation();
  const replayTarget: ReplayTarget = { handId: item.handId, tableId: item.tableId, handNumber: item.handNumber };
  const verificationLabel = item.verificationStatus === "verified"
    ? t("liveHub.handFeed.proofVerified", "Đã xác minh kết quả")
    : item.verificationStatus === "unavailable"
      ? t("liveHub.handFeed.proofUnavailable", "Không tải được xác minh")
      : t("liveHub.handFeed.proofUnverified", "Chưa xác minh kết quả");

  if (rpt) {
    const created = new Date(item.createdAt);
    const validDate = Number.isFinite(created.getTime());
    return (
      <article data-testid="viewer-rpt-hand-card" className="overflow-hidden rounded-[18px] border border-[hsl(var(--viewer-neon)_/_0.3)] bg-card/80 shadow-[0_18px_46px_hsl(var(--background)_/_0.34)]">
        <div className="h-0.5 bg-gradient-to-r from-[hsl(var(--viewer-neon))] via-[hsl(var(--viewer-neon)_/_0.34)] to-transparent" />
        <div className="space-y-3 p-3.5 sm:p-4">
          <header className="flex flex-wrap items-center gap-1.5">
            {item.tags.map((tag) => {
              const meta = TAG_META[tag];
              return (
                <span key={tag} className={`rounded-md border px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${meta.cls}`}>
                  {t(`liveHub.handFeed.tag.${tag}`, meta.label)}
                </span>
              );
            })}
            {item.handNumber > 0 && (
              <span className="tracker-num rounded-md bg-secondary/60 px-1.5 py-1 text-[9px] font-bold text-foreground/80">
                {t("liveHub.handFeed.hand", "Ván #{{n}}", { n: item.handNumber })}
              </span>
            )}
            {tableName && (
              <span className="rounded-md bg-secondary/60 px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {tableName}
              </span>
            )}
            {validDate && (
              <time className="ml-auto text-[10px] text-muted-foreground" dateTime={item.createdAt}>
                {new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(created)}
              </time>
            )}
          </header>
          <p data-testid="hand-verification-state" className="text-[10px] text-muted-foreground">{verificationLabel}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[hsl(var(--viewer-neon)_/_0.18)] bg-[hsl(var(--viewer-neon)_/_0.06)] px-3 py-2">
            {item.bigBlind > 0 && (
              <span className="tracker-num text-xs font-semibold text-muted-foreground">
                BB <strong className="text-foreground">{fmtCompact(item.bigBlind)}</strong>
              </span>
            )}
            <span className="tracker-num text-sm font-bold text-[hsl(var(--viewer-neon))]">
              {t("liveHub.handFeed.pot", "POT")} {formatViewerBBOrUnavailable(item.potChips, item.bigBlind)}
            </span>
            {item.sidePotCount > 0 && (
              <span className="tracker-num ml-auto text-[10px] font-bold text-warning">
                +{item.sidePotCount} {t("liveHub.handFeed.sidePot", "side")}
              </span>
            )}
            {item.bigBlind <= 0 && <span className="w-full text-[10px] text-amber-300">{t("liveHub.replay.missingBlind", "Chưa có blind của hand")}</span>}
          </div>

          <div data-testid="viewer-rpt-board" className="flex min-h-20 items-center justify-center gap-1.5 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t("liveHub.handFeed.board", "Bài chung") }>
            {pad5(item.board).map((card, index) => (
              <PokerCard
                key={index}
                card={card}
                size="md"
                className={card
                  ? "h-14 w-10 sm:h-[70px] sm:w-[50px] ring-1 ring-white/10 shadow-sm"
                  : "h-14 w-10 sm:h-[70px] sm:w-[50px] opacity-45"}
              />
            ))}
          </div>

          <div className="divide-y divide-border/35 rounded-xl bg-background/20 px-2">
            {item.players.map((player) => {
              const name = publicPlayerName(player.name, player.playerId, t("liveHub.handFeed.unknownPlayer", "Người chơi"));
              const showFinish = player.isEliminated && player.finishPosition != null && player.finishPosition > 0;
              return (
                <div key={player.playerId} className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/70 bg-secondary text-[10px] font-bold text-muted-foreground">
                    {player.avatarUrl ? (
                      <img src={player.avatarUrl} alt={name} loading="lazy" className="h-full w-full object-cover" />
                    ) : initials(name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-foreground">{name}</span>
                      {player.isWinner && <Crown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--viewer-neon))]" aria-label={t("liveHub.handFeed.winner", "Người thắng")} />}
                      {showFinish && <span className="rounded bg-destructive/15 px-1 text-[9px] font-bold text-destructive">#{player.finishPosition}</span>}
                    </div>
                    {player.seatNumber > 0 && <span className="text-[10px] text-muted-foreground">{t("liveHub.seat", "Ghế {{n}}", { n: player.seatNumber })}</span>}
                    {player.rankingText && (
                      <span className="block truncate text-[10px] font-semibold text-[hsl(var(--poker-gold))]">
                        {player.rankingText}
                      </span>
                    )}
                  </div>
                  <span data-testid="viewer-rpt-hole-cards" className="flex shrink-0 gap-1" aria-label={player.holeCards ? t("liveHub.handFeed.revealedCards", "Bài đã lộ") : t("liveHub.handFeed.hiddenCards", "Bài không được lộ")}>
                    {player.holeCards ? player.holeCards.map((card, index) => (
                      <PokerCard key={index} card={card} size="sm" className="h-12 w-9 text-sm min-[390px]:h-14 min-[390px]:w-10 ring-1 ring-white/10 shadow-[0_5px_14px_rgba(0,0,0,0.42)]" />
                    )) : <><CardBack size="sm" className="h-12 w-9 min-[390px]:h-14 min-[390px]:w-10 shadow-[0_5px_14px_rgba(0,0,0,0.42)]" /><CardBack size="sm" className="h-12 w-9 min-[390px]:h-14 min-[390px]:w-10 shadow-[0_5px_14px_rgba(0,0,0,0.42)]" /></>}
                  </span>
                  <span className={`tracker-num ml-auto min-w-[78px] text-right text-xs font-bold ${
                    player.deltaChips > 0 ? "text-success" : player.deltaChips < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}>
                    {player.deltaChips > 0 ? "+" : player.deltaChips < 0 ? "−" : ""}{formatViewerBBOrUnavailable(Math.abs(player.deltaChips), item.bigBlind)}
                  </span>
                </div>
              );
            })}
          </div>

          {item.showdownResult === "chop" && (
            <div className="rounded-xl border border-[hsl(var(--poker-gold)_/_0.38)] bg-[hsl(var(--poker-gold)_/_0.09)] px-3 py-2 text-center text-xs font-black uppercase tracking-[0.14em] text-[hsl(var(--poker-gold))]">
              Chop Pot
            </div>
          )}
          {item.showdownResult === "needs_resettle" && (
            <div className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-center text-[11px] font-semibold text-warning">
              Kết quả đang được kiểm tra lại
            </div>
          )}

          <ViewerActionTimeline actions={item.actions ?? []} bigBlind={item.bigBlind} />

          {item.handNumber > 0 && (onShare || onViewHand) && (
            <div className="flex gap-2 border-t border-border/40 pt-3">
              {onShare && (
                <button type="button" onClick={() => onShare(replayTarget)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border/70 px-3 text-xs font-semibold text-muted-foreground transition hover:border-[hsl(var(--viewer-neon)_/_0.5)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Share2 className="h-4 w-4" aria-hidden="true" /> {t("liveHub.handFeed.share", "Chia sẻ")}
                </button>
              )}
              {onViewHand && (
                <button data-testid="viewer-view-hand-button" type="button" onClick={() => onViewHand(replayTarget)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--viewer-neon))] px-3 text-xs font-bold text-[hsl(var(--viewer-neon-ink))] shadow-[0_0_0_1px_hsl(var(--viewer-neon)_/_0.32),0_0_22px_hsl(var(--viewer-neon)_/_0.34)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[hsl(var(--viewer-neon-bright))] hover:shadow-[0_0_0_1px_hsl(var(--viewer-neon)_/_0.5),0_0_34px_hsl(var(--viewer-neon)_/_0.52)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
                  <Play className="h-4 w-4 drop-shadow-[0_0_5px_hsl(var(--viewer-neon-ink)_/_0.3)]" aria-hidden="true" /> {t("liveHub.handFeed.viewHand", "Xem ván")}
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-3 shadow-[0_0_18px_rgba(0,0,0,0.25)]">
      {/* header: tags + hand # */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {item.tags.map((tag) => {
          const m = TAG_META[tag];
          return (
            <span key={tag} className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${m.cls}`}>
              {t(`liveHub.handFeed.tag.${tag}`, m.label)}
            </span>
          );
        })}
        <span className="tracker-num ml-auto text-[11px] text-muted-foreground">
          {t("liveHub.handFeed.hand", "Hand #{{n}}", { n: item.handNumber })}
        </span>
      </div>

      {/* pot */}
      <p data-testid="hand-verification-state" className="mb-2 text-[10px] text-muted-foreground">{verificationLabel}</p>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tracker-num text-lg font-bold text-primary">{formatViewerBBOrUnavailable(item.potChips, item.bigBlind)}</span>
        {item.sidePotCount > 0 && (
          <span className="tracker-num rounded-full border border-warning/40 px-1.5 text-[9px] font-bold text-warning">
            +{item.sidePotCount} {t("liveHub.handFeed.sidePot", "side")}
          </span>
        )}
      </div>

      {/* board */}
      <div className="mb-2 flex gap-1">
        {pad5(item.board).map((c, i) => (
          <PokerCard key={i} card={c} size="sm" />
        ))}
      </div>

      {/* players */}
      <div className="divide-y divide-border/40">
        {item.players.map((p) => (
          <div key={p.playerId} className="flex items-center gap-2 py-1.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary text-[9px] font-bold text-muted-foreground">
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                initials(p.name)
              )}
            </span>
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-xs font-semibold text-foreground">{p.name}</span>
              {p.isWinner && <Crown className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />}
              {p.isEliminated && p.finishPosition != null && (
                <span className="shrink-0 rounded bg-destructive/15 px-1 text-[9px] font-bold text-destructive">
                  #{p.finishPosition}
                </span>
              )}
            </div>
            <span className="ml-auto flex shrink-0 gap-0.5">
              {p.holeCards ? (
                p.holeCards.map((c, i) => <PokerCard key={i} card={c} size="xs" />)
              ) : (
                <>
                  <CardBack size="xs" />
                  <CardBack size="xs" />
                </>
              )}
            </span>
            <span
              className={`tracker-num w-[88px] shrink-0 text-right text-xs font-bold ${
                p.deltaChips > 0 ? "text-primary" : p.deltaChips < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {p.deltaChips > 0 ? "+" : p.deltaChips < 0 ? "−" : ""}
              {formatViewerBBOrUnavailable(Math.abs(p.deltaChips), item.bigBlind)}
            </span>
          </div>
        ))}
      </div>

      {/* actions */}
      {(onShare || onViewHand) && (
        <div className="mt-2 flex gap-2 border-t border-border/40 pt-2">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(replayTarget)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("liveHub.handFeed.share", "Chia sẻ")}
            </button>
          )}
          {onViewHand && (
            <button
              type="button"
              onClick={() => onViewHand(replayTarget)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-[11px] font-semibold text-primary-foreground transition active:scale-[0.99]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> {t("liveHub.handFeed.viewHand", "Xem ván")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
