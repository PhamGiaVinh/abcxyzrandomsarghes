import type { CSSProperties } from "react";
import { ClockRing } from "./ClockRing";
import type { TournamentClockData } from "./types";
import { TvBrandingOverlay } from "./TvBrandingOverlay";
import "./vinPokerClock.css";

/**
 * VinPoker neon-green broadcast tournament clock — presentational, 16:9, props-only.
 * FIXED neon-green theme (scoped in vinPokerClock.css; never follows the app's
 * --primary, so it stays green in dark AND warm). Each club swaps only the
 * background photo via `clubBackgroundUrl`; the dark overlay + translucent glass
 * panels keep text readable over any photo. No data fetching here — the live
 * mapper (PR Clock-B) feeds `data`.
 */
export function VinPokerTournamentClock({
  data,
  brandingEditing = false,
  editorPreview = false,
  onBrandingLayoutChange,
}: {
  data: TournamentClockData;
  brandingEditing?: boolean;
  editorPreview?: boolean;
  onBrandingLayoutChange?: (layout: NonNullable<TournamentClockData["brandingLayout"]>) => void;
}) {
  // The club photo is injected as a CSS variable on the root; the .vpc-bg layer
  // reads it (with a dark fallback). TS needs the cast for the custom property.
  const rootStyle = {
    containerType: "inline-size",
    ...(editorPreview ? { height: "100%", minHeight: 0, maxHeight: "100%", aspectRatio: "16 / 9" } : {}),
    "--club-bg-image": data.clubBackgroundUrl ? `url("${data.clubBackgroundUrl}")` : "none",
    "--club-bg-position": data.brandingLayout
      ? `${data.brandingLayout.backgroundX}% ${data.brandingLayout.backgroundY}%`
      : "center",
  } as CSSProperties;
  const layout = data.brandingLayout;

  const rule: CSSProperties = {
    display: "inline-block",
    width: "min(160px, 14vmin)",
    height: 3,
    background: "linear-gradient(90deg, transparent, var(--clock-green), transparent)",
    boxShadow: "0 0 14px var(--clock-green)",
  };
  const labelUpper: CSSProperties = { fontSize: "clamp(13px, 1.5vmin, 26px)", textTransform: "uppercase" };
  const midValue: CSSProperties = { fontSize: "clamp(18px, 2.4vmin, 44px)" };

  return (
    <div className={`vpc-root${layout ? " vpc-has-custom-brand" : ""}${editorPreview ? " vpc-editor-preview" : ""}`} style={rootStyle} aria-label="VinPoker tournament clock" data-tv-branding-canvas>
      <div className="vpc-bg" aria-hidden="true" />
      <div className="vpc-overlay" aria-hidden="true" />
      <div className="vpc-frame" aria-hidden="true" />

      {layout ? (
        <TvBrandingOverlay
          layout={layout}
          logoUrl={data.clubLogoUrl}
          brandName={data.brandName}
          editing={brandingEditing}
          onLayoutChange={onBrandingLayoutChange}
        />
      ) : null}

      <div className="vpc-grid">
        {/* Title */}
        <h1
          className="vpc-title vpc-title-cell flex items-center justify-center text-center"
          style={{ fontSize: "clamp(28px, 5.4vmin, 92px)", gap: "2.4vmin" }}
        >
          <span aria-hidden className="hidden sm:inline-block" style={rule} />
          <span className="truncate">{data.title}</span>
          <span aria-hidden className="hidden sm:inline-block" style={rule} />
        </h1>

        {/* Left column */}
        <aside className="vpc-aside-l grid content-start" style={{ gap: "1.8vmin" }}>
          <div className="vpc-panel grid grid-cols-3 items-center" style={{ padding: "2vmin 2.2vmin", minHeight: "13vmin" }}>
            <Stat label="Players" value={data.players.toLocaleString("vi-VN")} />
            <Stat label="Entries" value={data.entries.toLocaleString("vi-VN")} divider />
            <Stat label="Incl. Re-Entries" value={data.reEntries.toLocaleString("vi-VN")} divider />
          </div>

          <div
            className="vpc-panel grid"
            style={{ padding: "2.2vmin 2.4vmin 3vmin", gridTemplateRows: "auto 1fr auto", gap: "1.4vmin", minHeight: "34vmin" }}
          >
            <div>
              <div className="vpc-label" style={labelUpper}>Prize Pool</div>
              <div className="vpc-value" style={{ fontSize: "clamp(24px, 3.6vmin, 60px)" }}>{data.prizePool}</div>
            </div>
            <div className="vpc-brand-default contents">
                <div
                  className="vpc-chip justify-self-center self-center grid place-items-center"
                  style={{ width: "16vmin", height: "16vmin", overflow: "hidden" }}
                  aria-label="VinPoker emblem"
                >
                  {data.clubLogoUrl ? (
                    <img src={data.clubLogoUrl} alt="" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <span style={{ fontSize: "7vmin", color: "#d8ffe0", textShadow: "0 0 20px var(--clock-green)", lineHeight: 1 }}>♠</span>
                  )}
                </div>
                <div className="justify-self-center text-center">
                  <div className="vpc-brand-default-name" style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "clamp(22px, 3.4vmin, 56px)", letterSpacing: ".08em", color: "#ecfff0", textShadow: "0 0 16px rgba(98,255,143,.78), 0 3px 0 rgba(0,0,0,.7)", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.brandName || "VINPOKER"}</div>
                  <div style={{ color: "var(--clock-green)", letterSpacing: ".34em", textIndent: ".34em", marginTop: ".5vmin", fontSize: "clamp(12px, 1.4vmin, 20px)", textShadow: "0 0 10px var(--clock-green)" }}>♠♥♦♣</div>
                </div>
            </div>
          </div>

          <div className="vpc-panel grid grid-cols-2 items-center" style={{ padding: "2vmin 2.2vmin", gap: "2vmin", minHeight: "13vmin" }}>
            <div>
              <div className="vpc-label" style={labelUpper}>Total Chips</div>
              <div className="vpc-value" style={midValue}>{data.totalChips}</div>
            </div>
            <div className="vpc-divider-x" style={{ paddingLeft: "2vmin" }}>
              <div className="vpc-label" style={labelUpper}>Average</div>
              <div className="vpc-value" style={midValue}>{data.averageStack}</div>
            </div>
          </div>
        </aside>

        {/* Center ring */}
        <section className="vpc-center grid place-items-center self-stretch">
          <ClockRing
            levelLabel={data.levelLabel}
            secondsLeft={data.secondsLeft}
            nextBreakSecondsLeft={data.nextBreakSecondsLeft}
            terminal={data.terminalStatus != null}
          />
        </section>

        {/* Right column */}
        <aside className="vpc-aside-r grid content-start" style={{ gap: "1.8vmin" }}>
          <div className="vpc-panel text-center" style={{ padding: "1.8vmin 2.2vmin" }}>
            <div className="vpc-label" style={labelUpper}>Current Level</div>
            <div className="vpc-value" style={midValue}>{data.currentLevel}</div>
          </div>

          <div className="vpc-panel grid content-center" style={{ padding: "2vmin 2.4vmin", minHeight: "34vmin" }}>
            <div className="vpc-label" style={{ ...labelUpper, marginBottom: "1vmin" }}>Rank awards</div>
            <div>
              {data.payouts.map((p, i) => (
                <div key={`${p.rank}-${i}`} className="vpc-payout-row" style={{ fontSize: "clamp(16px, 2.1vmin, 36px)" }}>
                  <span>{p.rank}</span>
                  <span>{p.amount}</span>
                </div>
              ))}
            </div>
            {data.payouts.length > 0 && <p className="text-muted-foreground" style={{ fontSize: "clamp(12px, 1.5vmin, 26px)", marginTop: "1vmin" }}>
              Additional entitlements, if any, are reconciled separately in Cashier.
            </p>}
          </div>

          <div className="vpc-panel text-center" style={{ padding: "1.8vmin 2.2vmin" }}>
            <div className="vpc-label" style={labelUpper}>Next Level</div>
            <div className="vpc-value" style={midValue}>{data.nextLevel}</div>
          </div>
        </aside>

        {/* Footer */}
        <footer
          className="vpc-footer vpc-footer-cell self-end grid items-center text-center"
          style={{ gridTemplateColumns: "auto 1fr auto", padding: "1.4vmin 3vmin", minHeight: "8vmin", fontSize: "clamp(13px, 1.9vmin, 30px)", gap: "2vmin" }}
        >
          <div className="vpc-footer-icon" style={{ fontSize: "clamp(20px, 3vmin, 45px)" }}>♣</div>
          <div className="vpc-footer-note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.footerNote}</div>
          <div className="vpc-footer-icon" style={{ fontSize: "clamp(20px, 3vmin, 45px)" }}>♦</div>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div className={"text-center" + (divider ? " vpc-divider-x" : "")}>
      <div className="vpc-label" style={{ fontSize: "clamp(13px, 1.5vmin, 27px)" }}>{label}</div>
      <div className="vpc-value" style={{ fontSize: "clamp(22px, 2.9vmin, 54px)" }}>{value}</div>
    </div>
  );
}
