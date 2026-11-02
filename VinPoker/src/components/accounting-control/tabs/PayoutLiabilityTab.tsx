import { Card } from "@/components/ui/card";
import { AlertTriangle, PlugZap } from "lucide-react";
import { formatVND } from "@/lib/format";
import { MOCK_PAYOUT } from "../mock/mockData";
import type { PayoutRow } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { LiabilityCard } from "../shared/LiabilityCard";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

/** Số thật (read-only) từ get_club_payout_liability. */
export interface LivePayoutData {
  periodLabel: string;
  owedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  perTournament: {
    tournamentId: string;
    name: string;
    closeDate: string | null;
    isClosed: boolean;
    hasFinishedPlace: boolean;
    owed: number | null; // null = chưa chốt
    paid: number;
    outstanding: number | null;
    finishersCount: number;
    liabilityScope?: 'ORDINARY'|'INDIVIDUAL'|'GLOBAL';
    isPartial?: boolean;
  }[];
  aging: { d0_1: number; d2_7: number; d8p: number };
}

export interface LivePayoutState {
  active: boolean;
  loading: boolean;
  error: string | null;
  notApplied: boolean;
  data: LivePayoutData | null;
}

const DOCTRINE = [
  "Tiền giải là tiền của người chơi — club chỉ giữ hộ cho đến khi trả xong.",
  "Giải thưởng chưa nhận vẫn là khoản phải trả, dù đã qua bao nhiêu ngày.",
];

const dm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

function OwedRow({ row }: { row: PayoutRow }) {
  return (
    <div className="py-2 border-b border-border/60 last:border-b-0 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[11px] w-12 text-muted-foreground">Hạng {row.rank}</span>
      <span className="text-sm text-foreground/90 flex-1 min-w-[90px]">{row.playerMasked}</span>
      <span className="text-sm font-semibold tabular-nums text-[#d4b46a]">{formatVND(row.amount)}</span>
      {row.agingDays !== undefined && (
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
            row.agingDays >= 2
              ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
              : "border-border text-muted-foreground bg-transparent"
          }`}
        >
          {row.agingDays} ngày
        </span>
      )}
    </div>
  );
}

/** Card "chênh lệch" đổi hình theo dấu: >0 còn nợ · =0 đủ · <0 trả vượt (cảnh báo). */
function OutstandingCard({ outstanding, incomplete, empty }: { outstanding: number; incomplete: boolean; empty: boolean }) {
  if (outstanding === 0 && (incomplete || empty)) {
    return <Card className="p-3 md:p-4 h-full space-y-1.5">
      <span className="text-sm font-semibold">{empty ? "Chưa có giải trong kỳ" : "Chưa xác định đầy đủ"}</span>
      <p className="text-[11px] text-muted-foreground">{empty ? "Không có giải thuộc kỳ báo cáo này." : "Chưa có đủ kết quả đã chốt để xác nhận mọi khoản phải trả trong kỳ."}</p>
    </Card>;
  }
  if (outstanding > 0) {
    return <LiabilityCard label="Còn phải trả (thực)" amount={outstanding} state="provisional" note="owed − đã trả" />;
  }
  if (outstanding === 0) {
    return (
      <Card className="p-3 md:p-4 h-full flex flex-col gap-1.5 border-primary/25 bg-primary/[0.05]">
        <span className="text-[11px] uppercase tracking-wider text-primary/80">Đã ghi nhận trả đủ</span>
        <div className="text-lg md:text-xl font-semibold tabular-nums text-primary">{formatVND(0)}</div>
        <p className="text-[11px] text-muted-foreground">Không còn khoản phải trả cho các giải trong kỳ.</p>
      </Card>
    );
  }
  return (
    <Card className="p-3 md:p-4 h-full flex flex-col gap-1.5 border-amber-500/40 bg-amber-500/10">
      <span className="text-[11px] uppercase tracking-wider text-amber-400 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Chênh lệch trả vượt
      </span>
      <div className="text-lg md:text-xl font-semibold tabular-nums text-amber-400">{formatVND(Math.abs(outstanding))}</div>
      <p className="text-[11px] text-amber-200/80">Đã trả nhiều hơn nghĩa vụ — cần kiểm tra lại.</p>
    </Card>
  );
}

function LivePayoutBody({ d }: { d: LivePayoutData }) {
  const hasPartial=d.perTournament.some(t=>t.isPartial===true);
  return (
    <>
      <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
        <PlugZap className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <p className="text-[12px] leading-relaxed text-foreground/85">
          <span className="font-semibold text-primary">Số thật</span> — còn phải trả cho các nghĩa vụ thưởng đã chốt
          trong kỳ, theo trạng thái trả hiện tại. Tiền giải là tiền của người chơi (pass-through),
          không phải doanh thu. <span className="text-muted-foreground">{d.periodLabel}</span>
        </p>
      </div>

      {hasPartial&&<p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-foreground/85">Báo cáo gồm các nghĩa vụ đã chốt từng người; phần còn lại của giải chưa được chốt.</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <LiabilityCard label="Tổng nghĩa vụ thưởng" amount={d.owedTotal} state="provisional" note="Tổng thưởng đã chốt, gồm cả phần đã trả" />
        <MoneyCard
          label="Đã trả"
          amount={d.paidTotal}
          state="provisional"
          kind="neutral"
          sub={d.paidTotal === 0 ? "Chưa ghi nhận trả (bật ghi nhận trả ở Cashier)" : "Đã ghi nhận trả tới hôm nay"}
        />
        <OutstandingCard outstanding={d.outstandingTotal} empty={d.perTournament.length === 0} incomplete={hasPartial||d.perTournament.some((tour) => !tour.hasFinishedPlace)} />
      </div>

      <Card className="p-0 gradient-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border/50 text-[12px] font-semibold flex items-center justify-between">
          <span>Theo giải</span>
          <DataStateBadge state="provisional" />
        </div>
        <div className="divide-y divide-border/50">
          {d.perTournament.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">Chưa có giải nào chốt trong kỳ.</p>
          )}
          {d.perTournament.map((t) => (
            <div key={t.tournamentId} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm text-foreground/90 flex-1 min-w-[120px]">{t.name}</span>
                <span className="text-[11px] text-muted-foreground">{dm(t.closeDate)}</span>
                {t.isPartial===true ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10">Chốt từng người — chưa chốt toàn giải</span> : !t.hasFinishedPlace ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10">
                    chưa chốt kết quả
                  </span>
                ) : !t.isClosed ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                    đang mở — Tạm tính
                  </span>
                ) : null}
              </div>
              {t.hasFinishedPlace && (
                <div className="mt-1 grid grid-cols-3 gap-2 text-[12px] tabular-nums text-muted-foreground">
                  <span>Nghĩa vụ <span className="text-[#d4b46a]">{formatVND(t.owed ?? 0)}</span></span>
                  <span>Đã trả <span className="text-foreground/80">{formatVND(t.paid)}</span></span>
                  <span>
                    Còn lại{" "}
                    <span className={(t.outstanding ?? 0) > 0 ? "text-[#d4b46a]" : (t.outstanding ?? 0) < 0 ? "text-amber-400" : "text-primary"}>
                      {formatVND(t.outstanding ?? 0)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 md:p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Tuổi nợ (khoản còn phải trả)</p>
        <div className="grid grid-cols-3 gap-2 text-[12px] tabular-nums">
          <span>≤1 ngày: <span className="text-foreground/80">{formatVND(d.aging.d0_1)}</span></span>
          <span className={d.aging.d2_7 > 0 ? "text-amber-400" : ""}>2–7 ngày: {formatVND(d.aging.d2_7)}</span>
          <span className={d.aging.d8p > 0 ? "text-red-400" : ""}>≥8 ngày: {formatVND(d.aging.d8p)}</span>
        </div>
      </Card>
    </>
  );
}

function MockBody({ payout }: { payout: typeof MOCK_PAYOUT }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <LiabilityCard label="Còn phải trả" amount={payout.owedTotal} state="provisional" />
        <MoneyCard label="Đã trả" amount={payout.paidTotal} state="reconciled" kind="neutral" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tổng giải thưởng {formatVND(payout.totalPrizes)} = pool người chơi 440.000.000 ₫ + Bù đắp GTD
        60.000.000 ₫ — GTD giữ đúng cam kết.
      </p>
      <Card className="p-3 md:p-4 gradient-card">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Còn nợ người chơi</p>
        {payout.owedRows.map((r) => (
          <OwedRow key={r.rank} row={r} />
        ))}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Giải thưởng chưa nhận vẫn là khoản phải trả — không bao giờ tự biến thành tiền club.
        </p>
      </Card>
      <Card className="p-3 md:p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Đã trả (3 dòng gần nhất)</p>
        {payout.paidRowsSample.map((r) => (
          <div key={r.rank} className="py-1.5 border-b border-border/40 last:border-b-0 flex items-center gap-3 text-muted-foreground">
            <span className="text-[11px] w-12">Hạng {r.rank}</span>
            <span className="text-[12px] flex-1">{r.playerMasked}</span>
            <span className="text-[12px] tabular-nums">{formatVND(r.amount)}</span>
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground/60 pt-1">…</p>
      </Card>
      <Card className="p-3 border-amber-500/30 bg-amber-500/[0.06]">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-dashed border-amber-500/50 text-amber-400">
              Cảnh báo mẫu
            </span>
            <p className="text-[12px] leading-relaxed text-amber-200/90">
              Payout Edge v1 → v1.1: sửa lỗi đã merge (#656 R1), chờ deploy — số liability coi là Tạm
              tính, xác minh thủ công trước khi trả. Trạng thái thật xác minh qua MODULE_STATUS.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

export function PayoutLiabilityTab({
  payout = MOCK_PAYOUT,
  live,
}: {
  payout?: typeof MOCK_PAYOUT;
  live?: LivePayoutState;
}) {
  const isLive = !!live?.active;
  return (
    <TabShell title="Phải trả giải (Payout liability)" question="Club còn nợ người chơi bao nhiêu tiền thưởng?" doctrine={DOCTRINE}>
      {isLive && live?.notApplied && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[12px] leading-relaxed text-amber-200/90">
            <span className="font-semibold">Chưa áp dụng.</span> Bảng phải-trả-thật chưa được bật trên
            máy chủ — đang hiển thị số liệu mẫu. Sẽ có số thật sau khi áp dụng.
          </p>
        </div>
      )}

      {isLive && live?.loading ? (
        <p role="status" className="text-sm text-muted-foreground">Đang tải phải-trả giải…</p>
      ) : isLive && live?.error ? (
        <p role="alert" className="text-sm text-destructive">Không tải được phải-trả giải: {live.error}</p>
      ) : isLive && live?.data ? (
        <LivePayoutBody d={live.data} />
      ) : isLive && !live?.notApplied ? (
        <p role="status" className="text-sm text-muted-foreground">Chưa có dữ liệu phải-trả giải đã xác minh.</p>
      ) : (
        <MockBody payout={payout} />
      )}

      {/* Doctrine (both modes): bảng thưởng dự kiến vs đóng băng */}
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">
          <span className="text-foreground/80 font-medium">Đang mở đăng ký:</span> bảng thưởng là dự
          kiến (Tạm tính) — thay đổi theo số người vào thêm.
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="text-foreground/80 font-medium">Đóng đăng ký:</span> bảng thưởng ĐÓNG BĂNG
          theo snapshot — dữ liệu về sau không xáo lại giải.
        </p>
      </div>
    </TabShell>
  );
}
