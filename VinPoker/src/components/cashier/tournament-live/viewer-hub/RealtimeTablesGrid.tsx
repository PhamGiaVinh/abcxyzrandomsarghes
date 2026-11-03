import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, Radio, Search, Users } from "lucide-react";
import { SpectatorMiniTable } from "./SpectatorMiniTable";
import type { TableAppearance } from "@/components/tracker/tableAppearance";
import "./realtimeTablesGrid.css";
import type { PublicFreshness, PublicTableCatalogItem, PublicTableSnapshot } from "./publicSnapshotTypes";
import { lazy, Suspense } from 'react';

const PublicPlayerHud = lazy(() => import('@/components/tracker/PublicPlayerHud').then(module => ({default: module.PublicPlayerHud})));

const PAGE_SIZE = 6;
export function RealtimeTablesGrid({ tournamentId, catalog, tables, freshness, loading, appearance, onVisibleTableIds, onView, onHistory }: { tournamentId?: string; appearance?: TableAppearance; catalog: PublicTableCatalogItem[]; tables: PublicTableSnapshot[]; freshness?: PublicFreshness; loading?: boolean; onVisibleTableIds: (ids: string[]) => void; onView: (id: string) => void; onHistory: (id: string) => void }) {
  const [hudPlayerId,setHudPlayerId] = useState<string | null>(null);
  useEffect(() => setHudPlayerId(null),[tournamentId]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!needle) return catalog;
    return catalog.filter((table) => table.name.toLocaleLowerCase("vi").includes(needle) || table.searchPlayers.some((name) => name.toLocaleLowerCase("vi").includes(needle)));
  }, [catalog, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleCatalog = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const tableById = useMemo(() => new Map(tables.map((table) => [table.tableId, table])), [tables]);
  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const visibleKey = visibleCatalog.map((table) => table.tableId).join(":");
  useEffect(() => {
    onVisibleTableIds(visibleKey ? visibleKey.split(":") : []);
  }, [onVisibleTableIds, visibleKey]);
  return <section className="min-w-0 space-y-3" aria-label="Bàn trực tiếp">
    {tournamentId && hudPlayerId && <Suspense fallback={<p role="status">Đang mở hồ sơ người chơi…</p>}><PublicPlayerHud tournamentId={tournamentId} playerId={hudPlayerId} onClose={() => setHudPlayerId(null)} /></Suspense>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--viewer-neon))]">Tables live</p><h2 className="text-xl font-black">Bàn trực tiếp</h2></div>
      <label className="flex min-h-11 min-w-[15rem] flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/55 px-3 sm:max-w-sm"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Tìm bàn hoặc người chơi</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bàn hoặc người chơi" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label>
    </div>
    {freshness && freshness.state !== "current" && <p className="text-xs text-amber-400">Dữ liệu bàn đang cập nhật{freshness.oldestPendingAt ? ` từ ${new Date(freshness.oldestPendingAt).toLocaleTimeString("vi-VN")}` : ""}.</p>}
    {filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-border/55 py-14 text-center text-sm text-muted-foreground">{loading && catalog.length === 0 ? "Đang tải danh sách bàn…" : query.trim() ? "Không tìm thấy bàn phù hợp" : "Chưa có bàn để theo dõi"}</div> : <div className="grid gap-4 min-[1200px]:grid-cols-2">
      {visibleCatalog.map((summary) => {
        const table = tableById.get(summary.tableId);
        return <article key={summary.tableId} className="min-w-0 rounded-2xl border border-border/55 bg-card/55 p-3 sm:p-4 [container-type:inline-size]" aria-label={summary.name}>
        <header className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-lg font-black">{summary.name}</h3><p className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{summary.playerCount} người chơi {table?.trackerState === "live" && <span className="inline-flex items-center gap-1 text-emerald-400"><Radio className="h-3 w-3" /> LIVE</span>}</p></div><button type="button" onClick={() => onHistory(summary.tableId)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border/60 px-3 text-xs font-bold"><History className="h-4 w-4" /> Lịch sử</button></header>
        {table ? <div className="w-full"><SpectatorMiniTable table={table} appearance={appearance} onPlayerSelect={tournamentId ? setHudPlayerId : undefined} /><button type="button" onClick={() => onView(table.tableId)} className="mt-2 min-h-11 w-full rounded-xl border border-border/60 text-sm font-semibold" aria-label={`Xem ${table.name}`}>Xem toàn bàn</button></div> : <div className="flex aspect-[1.9/1] items-center justify-center rounded-[46%] border border-dashed border-border/60 text-xs text-muted-foreground">Đang tải dữ liệu bàn…</div>}
      </article>;
      })}
    </div>}
    {pageCount > 1 && <div className="flex items-center justify-center gap-3"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/60 disabled:opacity-40" aria-label="Trang bàn trước"><ChevronLeft className="h-4 w-4" /></button><span className="tracker-num text-xs text-muted-foreground">{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/60 disabled:opacity-40" aria-label="Trang bàn tiếp theo"><ChevronRight className="h-4 w-4" /></button></div>}
  </section>;
}
