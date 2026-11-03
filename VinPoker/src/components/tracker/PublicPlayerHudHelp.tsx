import type {TrackerAnalyticsMetric} from '@/lib/trackerVoice/analytics';
import {PUBLIC_HUD_METRIC_INFO,type PublicHudMetricKey} from '@/lib/publicPlayerHudMetrics';

export function PublicPlayerHudHelp({selected,metrics,hands,onSelect}:{selected:PublicHudMetricKey;metrics:Record<string,TrackerAnalyticsMetric>;hands:number;onSelect:(key:PublicHudMetricKey)=>void}) {
  const info=PUBLIC_HUD_METRIC_INFO[selected],metric=metrics[selected];
  return <>
    <nav className="flex flex-wrap gap-2" aria-label="Chọn chỉ số cần giải thích">{(Object.keys(PUBLIC_HUD_METRIC_INFO) as PublicHudMetricKey[]).map(key=><button key={key} type="button" aria-pressed={selected===key} onClick={()=>onSelect(key)} className={`min-h-11 rounded-md border px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected===key?'border-primary bg-primary/10':'border-border bg-muted/40 hover:bg-muted'}`}>{PUBLIC_HUD_METRIC_INFO[key].label}</button>)}</nav>
    <section className="space-y-4 rounded-lg border border-border bg-background/60 p-4" aria-live="polite" aria-atomic="true">
      <h3 className={`border-l-2 border-current pl-3 font-semibold ${info.color}`}>{info.title}</h3>
      <p className="text-sm leading-relaxed">{info.description}</p>
      {selected==='hands'?<p className="text-sm">Mẫu hiện tại: <strong className="font-mono">{hands.toLocaleString('vi-VN')} hand</strong>.</p>:<>
        <dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">Tử số · số lần thực hiện</dt><dd>{info.numerator}</dd></div><div><dt className="text-xs text-muted-foreground">Mẫu số · số cơ hội phù hợp</dt><dd>{info.denominator}</dd></div></dl>
        <p className="rounded-md bg-muted p-3 text-sm">{metric?.percentage!=null?<><span className="block text-xs text-muted-foreground">Số liệu người chơi hiện tại</span><strong className="font-mono">{metric.numerator.toLocaleString('vi-VN')} / {metric.denominator.toLocaleString('vi-VN')} × 100 = {metric.percentage.toLocaleString('vi-VN',{maximumFractionDigits:2})}%</strong></>:<span>Chưa có đủ cơ hội hoặc bằng chứng đã xác minh. Dấu — không có nghĩa là 0%.</span>}</p>
      </>}
    </section>
    <p className="text-xs leading-relaxed text-muted-foreground">Chỉ số cộng dồn toàn bộ hand đủ điều kiện qua tất cả tour công khai. Mỗi chỉ số có mẫu số riêng; không lấy trung bình các tỷ lệ. Màu phân biệt hành vi, không phải đánh giá chơi tốt hay xấu. Mẫu ít hand chưa đủ đại diện phong cách chơi.</p>
  </>;
}
