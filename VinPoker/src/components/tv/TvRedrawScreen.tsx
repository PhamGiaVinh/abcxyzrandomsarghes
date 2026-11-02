import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import {
  buildTournamentRedrawTvPages,
  getTournamentRedrawPageIndex,
  type TournamentRedrawTvBatch,
} from "@/hooks/useTournamentRedrawTv";

const TV_REDRAW_PAGE_MS = 12_000;

export function TvRedrawScreen({ tournamentName, batch }: { tournamentName: string; batch: TournamentRedrawTvBatch }) {
  const pages = useMemo(() => buildTournamentRedrawTvPages(batch), [batch]);
  const [now, setNow] = useState(() => Date.now());
  const pageIndex = getTournamentRedrawPageIndex(batch.appliedAt, pages.length, now, TV_REDRAW_PAGE_MS);
  const page = pages[pageIndex];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="flex h-full min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#14372f_0%,#07110f_48%,#030706_100%)] px-[4vmin] py-[3vmin] text-[#f7f2e8]">
      <header className="flex items-end justify-between gap-[3vmin] border-b border-emerald-300/20 pb-[2vmin]">
        <div className="min-w-0">
          <div className="text-[1.7vmin] font-semibold uppercase tracking-[0.26em] text-emerald-300">VinPoker · Tournament redraw</div>
          <h1 className="mt-[0.7vmin] truncate text-[4.5vmin] font-black tracking-[-0.03em]">{tournamentName}</h1>
        </div>
        <div className="shrink-0 rounded-full border border-[#c9a86a]/40 bg-[#c9a86a]/12 px-[2vmin] py-[0.8vmin] text-[2vmin] font-bold text-[#f0d69a]">{batch.targetMaxSeats}-MAX</div>
      </header>

      <section className="mt-[2vmin] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2vmin] border border-white/10 bg-black/25">
        {page ? (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-white/[0.035] px-[3vmin] py-[2vmin]">
              <div>
                <div className="text-[1.8vmin] font-semibold uppercase tracking-[0.22em] text-white/50">Please move to your new seats</div>
                <h2 className="mt-1 text-[5vmin] font-black text-emerald-200">Table {page.tableNumber}</h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-[2vmin] py-[1vmin] text-[2vmin] font-bold text-emerald-100">
                <Users className="h-[2.2vmin] w-[2.2vmin]" /> {page.moves.length} players
              </div>
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-px overflow-hidden bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {page.moves.map((move) => (
                <article key={move.ordinal} className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[1.5vmin] bg-[#07100e] px-[2vmin] py-[1.4vmin]">
                  <div className="min-w-0">
                    <div className="truncate text-[2.7vmin] font-bold">{move.playerName}</div>
                    <div className="mt-[0.6vmin] flex items-center gap-[0.8vmin] text-[1.9vmin]">
                      <span className="text-white/45">{batch.kind === 'initial_d2' ? 'D2 · Initial seating' : <>Table {move.fromTableNumber} · Seat {move.fromSeatNumber}</>}</span>
                      <ArrowRight className="h-[2vmin] w-[2vmin] shrink-0 text-[#c9a86a]" />
                      <span className="font-black text-emerald-300">Seat {move.toSeatNumber}</span>
                    </div>
                  </div>
                  <div className="grid h-[6vmin] w-[6vmin] place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-[2.8vmin] font-black text-emerald-200">{move.toSeatNumber}</div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-[3vmin] font-semibold text-white/70">No player movements in this redraw.</div>
        )}
      </section>
      <footer className="flex items-center justify-between gap-[2vmin] pt-[1.4vmin] text-[1.65vmin] text-white/55">
        <span>This display follows the saved Floor snapshot. The tournament clock is paused during redraw.</span>
        {pages.length > 1 && <span className="shrink-0 font-mono text-[#f0d69a]">Table {pageIndex + 1} of {pages.length}</span>}
      </footer>
    </main>
  );
}
