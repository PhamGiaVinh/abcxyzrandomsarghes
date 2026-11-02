// Spectator completed-hand feed. The legacy layout remains available while
// liveViewerRPTShell is OFF; the new branch composes persisted hand view-models
// with optional editorial view-models supplied by the future owner-gated adapter.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Layers3, Loader2, Search, Sparkles } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { useCompletedHandsFeed } from "./useCompletedHandsFeed";
import { HandFeedCard } from "./HandFeedCard";
import { TournamentPostCard } from "./TournamentPostCard";
import type { HandFeedTag } from "./handFeedDerive";
import type { TournamentPostViewModel, ViewerFeedItem } from "./viewerTypes";
import type { ReplayTarget } from "./replayTarget";

export interface LiveHandFeedProps {
  tournamentId: string;
  /** Default table being watched; null means there is no table-scoped option. */
  featuredTableId?: string | null;
  variant?: "history" | "updates";
  /** History links open Updates with the chosen table and hands filter selected. */
  initialTableHistory?: boolean;
  tableNames?: Record<string, string>;
  editorialPosts?: TournamentPostViewModel[];
  focusedPostId?: string | null;
  onViewHand?: (target: ReplayTarget) => void;
  onShare?: (target: ReplayTarget) => void;
  onSharePost?: (postId: string) => void;
}

const FILTER_TAGS: { tag: HandFeedTag; label: string; cls: string }[] = [
  { tag: "all_in", label: "ALL-IN", cls: "border-[#991B1B] bg-[#991B1B]/25 text-[#ff9b9b]" },
  { tag: "big_pot", label: "BIG POT", cls: "border-success/50 bg-success/15 text-success" },
  { tag: "high_hand", label: "HIGH HAND", cls: "border-warning/50 bg-warning/15 text-warning" },
  { tag: "eliminated", label: "ELIMINATED", cls: "border-destructive/50 bg-destructive/15 text-destructive" },
];

type KindFilter = "all" | "news" | "hands";

function byOccurredAtDesc(a: ViewerFeedItem, b: ViewerFeedItem): number {
  if (a.kind === "editorial" && b.kind === "editorial" && !!a.post.isPinned !== !!b.post.isPinned) {
    return a.post.isPinned ? -1 : 1;
  }
  if (a.kind === "editorial" && a.post.isPinned && b.kind !== "editorial") return -1;
  if (b.kind === "editorial" && b.post.isPinned && a.kind !== "editorial") return 1;
  return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
}

export function LiveHandFeed({
  tournamentId,
  featuredTableId,
  variant = "history",
  initialTableHistory = false,
  tableNames = {},
  editorialPosts = [],
  focusedPostId = null,
  onViewHand,
  onShare,
  onSharePost,
}: LiveHandFeedProps) {
  const { t } = useTranslation();
  const rpt = FEATURES.liveViewerRPTShell;
  const [tagFilter, setTagFilter] = useState<HandFeedTag[]>([]);
  const [allTables, setAllTables] = useState<boolean>(rpt && !initialTableHistory);
  const [kindFilter, setKindFilter] = useState<KindFilter>(initialTableHistory ? "hands" : "all");
  const [search, setSearch] = useState("");

  const { items, loading, hasMore, loadMore, error, reload } = useCompletedHandsFeed(tournamentId, {
    tableId: allTables ? null : featuredTableId ?? null,
    tags: tagFilter,
  });

  const toggleTag = (tag: HandFeedTag) =>
    setTagFilter((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));

  const shownHands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    const asNum = Number(q.replace(/[^0-9]/g, ""));
    return items.filter((item) =>
      (Number.isFinite(asNum) && asNum > 0 && item.handNumber === asNum) ||
      item.players.some((player) => player.name.toLowerCase().includes(q)) ||
      (item.tableId ? tableNames[item.tableId]?.toLowerCase().includes(q) : false),
    );
  }, [items, search, tableNames]);

  useEffect(() => {
    if (!rpt || !focusedPostId || !FEATURES.liveSpotlightPosts) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`viewer-post-${focusedPostId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [rpt, focusedPostId, editorialPosts.length, items.length]);

  const readError = error ? (
    <div role="alert" className="rounded-xl border border-border bg-card p-3 text-sm text-foreground">
      <p>{t("liveHub.handFeed.readError", "Không tải được lịch sử hand. Chưa thể xác minh dữ liệu mới nhất.")}</p>
      <button type="button" disabled={loading} onClick={() => { void reload(); }}
        className="mt-2 min-h-11 rounded-lg border border-border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {t("liveHub.handFeed.retry", "Thử tải lại lịch sử")}
      </button>
    </div>
  ) : null;
  const emptyHistory = items.length === 0 && !hasMore && !search.trim() && tagFilter.length === 0;
  const moreMatchesHint = t("liveHub.handFeed.noLoadedMatch", "Chưa có ván khớp trong dữ liệu đã tải. Có thể tải thêm để tìm tiếp.");

  // Keep the legacy layout while sharing filtered-pagination safeguards.
  if (!rpt) {
    return (
      <div className="space-y-1.5">
        <div className="tracker-display flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {t("liveHub.handFeed.title", "Các ván đã xong")}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TAGS.map(({ tag, label, cls }) => {
            const active = tagFilter.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                  active ? cls : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`liveHub.handFeed.tag.${tag}`, label)}
              </button>
            );
          })}
          {featuredTableId && (
            <button
              type="button"
              onClick={() => setAllTables((value) => !value)}
              className={`ml-auto rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                allTables ? "border-primary/50 bg-primary/15 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {allTables ? t("liveHub.handFeed.allTables", "Tất cả bàn") : t("liveHub.handFeed.thisTable", "Bàn này")}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("liveHub.handFeed.search", "Tìm theo số ván hoặc tên người chơi…")}
            className="h-8 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {readError || (loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card/50 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("liveHub.handFeed.loading", "Đang tải các ván…")}
          </div>
        ) : shownHands.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-6 text-center text-xs italic text-muted-foreground">
            {emptyHistory ? t("liveHub.handFeed.empty", "Chưa có ván nào hoàn tất") : hasMore ? moreMatchesHint : t("liveHub.handFeed.noMatch", "Không có ván khớp bộ lọc")}
          </div>
        ) : (
          <div className="space-y-2">
            {shownHands.map((item) => <HandFeedCard key={item.handId} item={item} onViewHand={onViewHand} onShare={onShare} />)}
          </div>
        ))}
        {hasMore && !error && (
          <button type="button" disabled={loading} onClick={loadMore} className="w-full rounded-xl border border-border/60 bg-card/50 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50">
            {t("liveHub.handFeed.more", "Xem thêm")}
          </button>
        )}
      </div>
    );
  }

  const hasEditorial = variant === "updates" && FEATURES.liveSpotlightPosts && editorialPosts.length > 0;
  const feedItems: ViewerFeedItem[] = [
    ...shownHands.map((hand): ViewerFeedItem => ({ kind: "hand", id: `hand:${hand.handId}`, occurredAt: hand.createdAt, hand })),
    ...(hasEditorial
      ? editorialPosts.map((post): ViewerFeedItem => ({ kind: "editorial", id: `post:${post.id}`, occurredAt: post.publishedAt, post }))
      : []),
  ].sort(byOccurredAtDesc);

  const q = search.trim().toLowerCase();
  const visibleFeed = feedItems.filter((entry) => {
    if (kindFilter === "news" && entry.kind !== "editorial") return false;
    if (kindFilter === "hands" && entry.kind !== "hand") return false;
    if (tagFilter.length > 0 && entry.kind !== "hand") return false;
    if (!q || entry.kind === "hand") return true;
    const post = entry.post;
    return [post.titleVi, post.titleEn, post.bodyVi, post.bodyEn, post.sourceLabel]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(q));
  });

  const kindOptions: { value: KindFilter; label: string; Icon: typeof Sparkles }[] = [
    { value: "all", label: t("liveHub.handFeed.kindAll", "Tất cả"), Icon: Sparkles },
    ...(FEATURES.liveSpotlightPosts ? [{ value: "news" as const, label: t("liveHub.handFeed.kindNews", "Tin tức"), Icon: FileText }] : []),
    { value: "hands", label: t("liveHub.handFeed.kindHands", "Ván đấu"), Icon: Layers3 },
  ];

  return (
    <section className="space-y-3" aria-labelledby={`viewer-feed-${variant}`}>
      <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--viewer-neon))]">
            {variant === "updates" ? t("liveHub.handFeed.eventLabel", "Dòng sự kiện") : t("liveHub.handFeed.archiveLabel", "Kho ván đấu")}
          </p>
          <h2 id={`viewer-feed-${variant}`} className="tracker-display mt-0.5 text-lg font-bold text-foreground">
            {variant === "updates" ? t("liveHub.handFeed.updatesTitle", "Tin mới và ván nổi bật") : t("liveHub.handFeed.title", "Các ván đã xong")}
          </h2>
        </div>
        {featuredTableId && (
          <button
            type="button"
            aria-pressed={allTables}
            onClick={() => setAllTables((value) => !value)}
            className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              allTables ? "border-[hsl(var(--viewer-neon)_/_0.5)] bg-[hsl(var(--viewer-neon)_/_0.12)] text-[hsl(var(--viewer-neon))]" : "border-border/65 text-muted-foreground hover:text-foreground"
            }`}
          >
            {allTables ? t("liveHub.handFeed.allTables", "Tất cả bàn") : t("liveHub.handFeed.thisTable", "Bàn hiện tại")}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-border/55 bg-card/45 p-2.5 sm:p-3">
        <div className="flex flex-wrap gap-2">
          {kindOptions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={kindFilter === value}
              onClick={() => setKindFilter(value)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                kindFilter === value ? "border-[hsl(var(--viewer-neon)_/_0.5)] bg-[hsl(var(--viewer-neon)_/_0.12)] text-[hsl(var(--viewer-neon))]" : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTER_TAGS.map(({ tag, label, cls }) => {
            const active = tagFilter.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag)}
                className={`min-h-11 shrink-0 snap-start rounded-xl border px-3 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? cls : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`liveHub.handFeed.tag.${tag}`, label)}
              </button>
            );
          })}
        </div>

        <label className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-border/65 bg-background/35 px-3 focus-within:border-[hsl(var(--viewer-neon)_/_0.55)] focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{t("liveHub.handFeed.searchLabel", "Tìm trong dòng sự kiện")}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={variant === "updates" ? t("liveHub.handFeed.searchMixed", "Tìm tin, người chơi, bàn hoặc số ván…") : t("liveHub.handFeed.search", "Tìm theo số ván hoặc tên người chơi…")}
            className="h-11 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
      </div>

      {readError || (loading && items.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-2xl border border-border/50 bg-card/45 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("liveHub.handFeed.loading", "Đang tải các ván…")}
        </div>
      ) : visibleFeed.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/55 bg-card/35 px-4 py-10 text-center text-sm text-muted-foreground">
          {emptyHistory && feedItems.length === 0 && kindFilter !== "news" ? t("liveHub.handFeed.empty", "Chưa có ván nào hoàn tất") : hasMore && kindFilter !== "news" ? moreMatchesHint : t("liveHub.handFeed.noMatch", "Không có nội dung khớp bộ lọc")}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleFeed.map((entry) => entry.kind === "editorial" ? (
            <TournamentPostCard key={entry.id} post={entry.post} focused={entry.post.id === focusedPostId} onShare={onSharePost} onViewHand={onViewHand} />
          ) : (
            <HandFeedCard
              key={entry.id}
              item={entry.hand}
              rpt
              tableName={entry.hand.tableId ? tableNames[entry.hand.tableId] ?? null : null}
              onViewHand={onViewHand}
              onShare={onShare}
            />
          ))}
        </div>
      ))}
      {hasMore && !error && kindFilter !== "news" && (
        <button type="button" disabled={loading} onClick={loadMore} className="min-h-11 w-full rounded-xl border border-border/65 bg-card/55 px-4 text-sm font-semibold text-muted-foreground transition hover:border-[hsl(var(--viewer-neon)_/_0.45)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          {t("liveHub.handFeed.more", "Xem thêm")}
        </button>
      )}
    </section>
  );
}
