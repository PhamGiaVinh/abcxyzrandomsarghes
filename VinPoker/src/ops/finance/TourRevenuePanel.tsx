import { useEffect, useId, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Button } from "@/components/ui/button";
import { finalTourRevenueCsv, loadFinalTourRevenue, loadLiveTourRevenue, type FinalTourRevenue, type LiveTourRevenue } from "./tourRevenueRead";

const money = (n: number | null) => n === null ? "Chưa đủ dữ liệu" : `${new Intl.NumberFormat("vi-VN").format(n)} đ`;

export default function TourRevenuePanel({ clubId }: { clubId: string }) {
  const client = useSupabaseClient();
  const selectId = useId();
  const [live, setLive] = useState<LiveTourRevenue | null>(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [final, setFinal] = useState<{ id: string; report: FinalTourRevenue | null; error: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [download, setDownload] = useState<{ tourId: string; url: string } | null>(null);
  const exportRequest = useRef(0);
  const current = live?.clubId === clubId ? live : null;
  const tour = current?.tours.find(t => t.tournamentId === selectedId)
    ?? current?.tours.find(t => t.paidBuys > 0) ?? current?.tours[0];
  const tourId = tour?.tournamentId;
  useEffect(() => () => { exportRequest.current += 1; }, [clubId]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);

  useEffect(() => {
    let active = true, busy = false;
    setLive(null); setError(false);
    const load = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const result = await loadLiveTourRevenue(client, clubId);
        if (active) { setLive(result); setError(false); }
      } catch { if (active) { setLive(null); setError(true); } }
      finally { busy = false; }
    };
    void load();
    const channel = client.channel(`owner-tour-revenue:${clubId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_registrations", filter: `club_id=eq.${clubId}` }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `club_id=eq.${clubId}` }, () => { void load(); })
      .subscribe();
    const refresh = () => { if (document.visibilityState !== "hidden") void load(); };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); void client.removeChannel(channel); };
  }, [client, clubId, revision]);

  useEffect(() => {
    let active = true;
    setFinal(null); setExportError(false); setDownload(null);
    if (tourId) void loadFinalTourRevenue(client, tourId).then(report => {
      if (active) setFinal({ id: tourId, report, error: false });
    }).catch(() => { if (active) setFinal({ id: tourId, report: null, error: true }); });
    return () => { active = false; };
  }, [client, clubId, tourId, tour?.registrationClosedAt, revision]);

  const official = final?.id === tourId ? final : null;
  const exportReport = async () => {
    if (!tourId || exporting) return;
    const request = ++exportRequest.current;
    setExporting(true); setExportError(false); setDownload(null);
    try {
      // Always re-read the immutable server snapshot at click time.
      const report = await loadFinalTourRevenue(client, tourId);
      if (request !== exportRequest.current) return;
      const csv = finalTourRevenueCsv(report);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      setDownload({ tourId, url });
      const link = document.createElement("a"); link.href = url; link.download = `rake-${tourId}.csv`;
      document.body.append(link); link.click(); link.remove();
    } catch { if (request === exportRequest.current) setExportError(true); }
    finally { if (request === exportRequest.current) setExporting(false); }
  };

  return <section aria-labelledby={`${selectId}-heading`} className="mt-5 min-w-0 rounded-2xl border border-white/10 bg-[#07100c] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={`${selectId}-heading`} className="text-balance font-semibold text-white">Rake theo giải</h2>
        <p className="mt-1 text-pretty text-sm text-[#9fb1a6]">Tạm thu theo buy đã thanh toán, gồm buy đang chờ xếp chỗ. Chốt báo cáo khi đóng buy; tổng hợp ngày theo ngày giải diễn ra.</p></div>
      <Button variant="outline" className="min-h-11" onClick={() => setRevision(v => v + 1)}>Làm mới rake</Button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-amber-200">Không tải được rake. Hãy làm mới để kiểm tra lại.</p>
      : !current ? <p role="status" className="mt-3 text-sm text-[#9fb1a6]">Đang tải rake…</p>
        : !tour ? <p className="mt-3 text-sm text-[#9fb1a6]">CLB chưa có giải. Làm mới sau khi tạo giải.</p> : <>
          <label htmlFor={selectId} className="mt-4 block text-sm text-[#9fb1a6]">Giải cần xem</label>
          <select id={selectId} value={tour.tournamentId} disabled={exporting} onChange={e => setSelectedId(e.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#07100c] px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
            {current.tours.map(t => <option key={t.tournamentId} value={t.tournamentId}>{t.name}</option>)}
          </select>
          <p className="mt-2 break-words text-sm text-white">{tour.name}</p>
          <p className="mt-1 text-xs text-[#9fb1a6]">Ngày giải: {tour.eventDay ?? "Chưa xác định"}</p>
          <p className="mt-2 text-xs text-[#9fb1a6]">Tự cập nhật · kiểm tra lại mỗi 5 giây · {new Date(current.asOf).toLocaleTimeString("vi-VN")}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[ ["Rake tạm thu", money(tour.rake)], ["Phí dịch vụ tạm thu", money(tour.serviceFee)],
              ["Buy đã thu", String(tour.paidBuys)], ["Người chơi duy nhất", String(tour.uniquePlayers)] ].map(([label, value]) =>
              <div key={label} className="min-w-0 rounded-xl border border-white/10 p-3"><dt className="text-xs text-[#9fb1a6]">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums text-white">{value}</dd></div>)}
          </dl>
          {tour.waitingSeatBuys > 0 && <p className="mt-3 text-sm text-amber-200">{tour.waitingSeatBuys} buy đã thu đang chờ xếp chỗ.</p>}
          {tour.unavailableBuys > 0 && <p role="alert" className="mt-3 text-sm text-amber-200">{tour.unavailableBuys} buy chưa đủ dữ liệu để phân bổ phí. Chưa thể chốt số rake.</p>}
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-sm text-[#9fb1a6]">{tour.buyState === "open" ? "Đang mở buy · số tạm thu có thể thay đổi."
              : tour.buyState === "terminal" ? "Giải đã kết thúc hoặc bị hủy; chưa có snapshot đóng buy để xuất báo cáo chốt."
              : official?.report?.canExport ? `Đã chốt khi đóng buy · rake ${money(official.report.snapshot?.rake ?? null)} · phí dịch vụ ${money(official.report.snapshot?.serviceFee ?? null)}.`
                : official?.error ? "Chưa tải được báo cáo chốt. Hãy làm mới."
                  : !official ? "Đang kiểm tra báo cáo chốt…" : "Đã đóng buy nhưng chưa có báo cáo chốt đủ dữ liệu để xuất."}</p>
            <Button variant="outline" className="mt-3 min-h-11 max-w-full whitespace-normal" disabled={tour.buyState !== "closed" || !official?.report?.canExport || exporting} onClick={() => { void exportReport(); }}>
              {exporting ? "Đang tải báo cáo…" : "Xuất báo cáo rake đã chốt"}
            </Button>
            {download?.tourId === tourId && <a className="mt-3 block w-fit max-w-full break-words text-sm text-emerald-200 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              href={download.url} download={`rake-${tourId}.csv`}>Tải lại file CSV đã chuẩn bị</a>}
            {exportError && <p role="alert" className="mt-2 text-sm text-amber-200">Chưa xuất được báo cáo đã chốt. Hãy làm mới và thử lại.</p>}
          </div>
        </>}
  </section>;
}
