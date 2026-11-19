import type { ReactNode } from "react";
import { FlaskConical, Hammer, PlugZap } from "lucide-react";

/**
 * Nhãn nguồn dữ liệu của tab hiện tại.
 */
export function MockNotice({ partialLive = false }: { partialLive?: boolean }) {
  if (partialLive) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
        <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
        <p className="text-[12px] leading-relaxed text-amber-200/90">
          <span className="font-semibold">SỐ THẬT một phần.</span> Tab này đọc dữ liệu CLB khi máy chủ xác minh được quyền và nguồn. Xem nhãn trên từng khối để biết trạng thái của số liệu.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
      <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
      <p className="text-[12px] leading-relaxed text-amber-200/90">
        <span className="font-semibold">DỮ LIỆU MẪU (mock).</span> Số liệu và cảnh báo trên tab này dùng để xem thiết kế.
      </p>
    </div>
  );
}

/** Banner cho tab mô tả hợp đồng nghiệp vụ chưa được xây dựng (Chốt sổ, Báo cáo tháng). */
export function SpecNotice({ note }: { note: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#378ADD]/30 bg-[#378ADD]/[0.06] px-3 py-2.5">
      <Hammer className="w-4 h-4 mt-0.5 shrink-0 text-[#378ADD]" />
      <p className="text-[12px] leading-relaxed text-foreground/85">
        <span className="font-semibold text-[#378ADD]">SPEC / CHƯA XÂY DỰNG.</span> Màn hình này
        mô tả hợp đồng nghiệp vụ để duyệt — chưa có bảng/RPC nào phía sau. {note}
      </p>
    </div>
  );
}

/**
 * Trạng thái "chưa nối dữ liệu" cho module đã vận hành nhưng CHƯA có rollup tài chính
 * trong Accounting Control — không bao giờ render số 0 như thể là kết quả thật.
 */
export function NotWiredState({
  title,
  detail,
  willShow,
  children,
}: {
  title: string;
  detail: string;
  willShow: readonly string[];
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-6 md:py-8 text-center">
      <PlugZap className="w-8 h-8 mx-auto text-muted-foreground/60" />
      <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 mx-auto max-w-xl text-[12px] leading-relaxed text-muted-foreground">{detail}</p>
      <div className="mt-4 mx-auto max-w-md text-left">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Khi nối xong, ở đây sẽ hiển thị
        </p>
        <ul className="space-y-1">
          {willShow.map((w) => (
            <li key={w} className="text-[12px] text-foreground/80 flex gap-2">
              <span className="text-muted-foreground">·</span>
              {w}
            </li>
          ))}
        </ul>
      </div>
      {children}
    </div>
  );
}
