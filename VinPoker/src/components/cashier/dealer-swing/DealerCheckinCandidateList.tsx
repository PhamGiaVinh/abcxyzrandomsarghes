import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { CheckinCandidate, CheckinCandidateStatus } from "@/lib/dealerCheckinCandidates";

const groups: { status: CheckinCandidateStatus; title: string; selectable: boolean }[] = [
  { status: "already_checked_in", title: "Đã có ca đang mở", selectable: false },
  { status: "ambiguous", title: "Dữ liệu ca cần đối soát", selectable: false },
  { status: "previously_checked_out", title: "Check-in lại · ca trước đã đóng", selectable: true },
  { status: "new", title: "Check-in mới", selectable: true },
];

export function DealerCheckinCandidateList({ candidates, selectedIds, onSelection, loading, error, busy, onRetry }: {
  candidates: CheckinCandidate[];
  selectedIds: string[];
  onSelection: (ids: string[]) => void;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onRetry: () => void;
}) {
  const selectableIds = candidates.filter((d) => d.checkinStatus === "new" || d.checkinStatus === "previously_checked_out").map((d) => d.id);
  const blocked = loading || !!error || busy;
  return <>
    {error && <div role="alert" className="text-sm text-warning">
      {error}
      <Button variant="outline" size="sm" disabled={loading || busy} onClick={onRetry}>Tải lại trạng thái ca</Button>
    </div>}
    <div aria-busy={loading} className="max-h-72 overflow-y-auto space-y-2 border border-border p-2 rounded">
      {loading || error ? <p role="status" className="text-xs text-muted-foreground py-4">
        {loading ? "Đang xác minh trạng thái ca…" : "Chưa xác minh được danh sách."}
      </p> : candidates.length === 0 ? <p role="status" className="text-xs text-muted-foreground py-4">
        Không có dealer phù hợp trong CLB đã chọn.
      </p> : groups.map((group) => {
        const rows = candidates.filter((d) => d.checkinStatus === group.status);
        if (!rows.length) return null;
        return <section key={group.status} aria-label={group.title}>
          <h3 className="text-xs font-semibold text-muted-foreground">{group.title} · {rows.length}</h3>
          {rows.map((d) => <label key={d.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs">
            <Checkbox aria-label={d.full_name} disabled={blocked || !group.selectable}
              checked={group.selectable && selectedIds.includes(d.id)}
              onCheckedChange={(checked) => {
                if (blocked || !group.selectable) return;
                onSelection(checked ? [...new Set([...selectedIds, d.id])] : selectedIds.filter((id) => id !== d.id));
              }} />
            <span className="font-semibold">{d.full_name}</span><span className="text-muted-foreground">{d.tier}</span>
          </label>)}
        </section>;
      })}
    </div>
    <p className="text-xs text-muted-foreground">Trạng thái chỉ để đối chiếu; máy chủ kiểm tra lại ca và ngày vận hành khi gửi.</p>
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">Đã chọn: {selectedIds.length}</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={blocked || selectableIds.length === 0} onClick={() => onSelection(selectableIds)}>Chọn tất cả</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSelection([])}>Bỏ chọn</Button>
      </div>
    </div>
  </>;
}
