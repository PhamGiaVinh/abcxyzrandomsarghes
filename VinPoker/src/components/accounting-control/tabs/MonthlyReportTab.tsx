import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { MOCK_MONTHLY } from "../mock/mockData";
import { SpecNotice } from "../shared/Notices";
import { TabShell } from "../shared/TabShell";

export function MonthlyReportTab({ report = MOCK_MONTHLY }: { report?: typeof MOCK_MONTHLY }) {
  return (
    <TabShell
      title="Báo cáo tháng cho chủ CLB"
      question="Cả tháng cộng lại: giữ được bao nhiêu, nợ bao nhiêu, rủi ro gì?"
      doctrine={[
        "Báo cáo tháng chỉ được xây từ ngày/giải ĐÃ CHỐT sổ; tháng còn ngày chưa chốt phải nói ngay ở đầu — như tiêu đề trên.",
      ]}
    >
      <SpecNotice note="Chưa có trình tạo báo cáo — cấu trúc dưới đây là hợp đồng nội dung." />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5">
        <span className="text-[13px] font-semibold text-amber-300">{report.monthLabel}</span>
        <span className="text-[12px] font-semibold text-amber-200">Dữ liệu mẫu</span>
      </div>

      <Card className="p-3 md:p-4 gradient-card">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Các mục cố định của báo cáo
          </span>
          <span className="text-xs text-amber-200">Dữ liệu mẫu</span>
        </div>
        <div>
          {report.sections.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 border-b border-border/60 last:border-b-0"
            >
              <span className="text-[13px] text-muted-foreground">{s.label}</span>
              <span
                className={`text-[13px] tabular-nums ${s.amount < 0 ? "text-red-400/70" : "text-muted-foreground"}`}
              >
                {formatVND(s.amount)} (số mẫu)
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 md:p-4">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Rủi ro của tháng
        </span>
        <ul className="mt-2 space-y-1.5">
          {report.risks.map((r) => (
            <li key={r} className="flex gap-2 text-[12px] leading-relaxed text-foreground/85">
              <span className="shrink-0 text-amber-400">•</span>
              {r}
            </li>
          ))}
        </ul>
      </Card>

      {/* Chỗ DUY NHẤT được phép nói phủ định này — đúng nguyên văn. */}
      <p className="rounded-lg border border-border bg-card/60 px-3 py-2.5 text-[12px] leading-relaxed text-foreground/85">
        Biên đóng góp chưa trừ chi phí vận hành chung (mặt bằng, điện nước, quản lý) —{" "}
        <span className="font-semibold">chưa phải lãi ròng cuối cùng</span>.
      </p>
    </TabShell>
  );
}
