import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReviewAction = {
  id?: string;
  action_order: number;
  street: string;
  seat_number: number;
  display_name: string;
  action_type: string;
  action_amount: number;
};

type Props = {
  handNumber: number;
  tableName: string;
  potSize: number | null;
  buttonSeat?: number;
  seats: { seat_number: number; display_name: string }[];
  actions: ReviewAction[];
  initialActionId?: string | null;
  canEdit: boolean;
  isVoided: boolean;
  onEditAction: (order: number) => void;
};

const streetNames: Record<string, string> = {
  preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown",
};

const seatPositions: Record<number, { left: string; top: string }> = {
  1: { left: "35%", top: "91%" },
  2: { left: "13%", top: "73%" },
  3: { left: "9%", top: "46%" },
  4: { left: "25%", top: "18%" },
  5: { left: "50%", top: "9%" },
  6: { left: "75%", top: "18%" },
  7: { left: "91%", top: "46%" },
  8: { left: "87%", top: "73%" },
  9: { left: "65%", top: "91%" },
};

function actionText(action: ReviewAction): string {
  const type = ({
    post_sb: "Small blind", post_bb: "Big blind", post_ante: "Ante",
    all_in: "All-in", fold: "Fold", check: "Check", call: "Call", bet: "Bet", raise: "Raise",
  } as Record<string, string>)[action.action_type] ?? action.action_type;
  return action.action_amount > 0 ? `${type} ${action.action_amount.toLocaleString("vi-VN")}` : type;
}

export function FloorHandActionReview({ handNumber, tableName, potSize, buttonSeat, seats, actions, initialActionId, canEdit, isVoided, onEditAction }: Props) {
  const scope=JSON.stringify([handNumber,tableName,initialActionId??null]);
  const [selection,setSelection]=useState<{scope:string;key:string}|null>(null);
  // Orders may be reused after correction. Canonical IDs survive reordering;
  // legacy rows without IDs retain selection only for the exact read snapshot.
  const actionKey=(action:ReviewAction)=>action.id?`id:${action.id}`:`legacy:${JSON.stringify(action)}`;
  const selectedKey=selection?.scope===scope?selection.key:initialActionId?`id:${initialActionId}`:null;
  const ordered = [...actions].sort((a, b) => a.action_order - b.action_order);
  const selectedIndex = ordered.findIndex((action) => actionKey(action) === selectedKey);
  const selected = selectedIndex >= 0 ? ordered[selectedIndex] : null;
  const original=initialActionId?ordered.find(action=>action.id===initialActionId):null;
  const recordedPot = potSize === null ? "Chưa có dữ liệu" : potSize.toLocaleString("vi-VN");

  return (
    <section className="space-y-3 rounded-xl border border-emerald-500/30 bg-[#0e1715] p-3 text-zinc-100 sm:p-4" aria-label="Xem toàn bộ action của hand">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">Floor · kiểm tra hand</p>
          <h3 className="text-lg font-semibold">{tableName} · Hand #{handNumber}</h3>
        </div>
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-right">
          <span className="block text-[10px] uppercase text-amber-200/70">Pot đã ghi</span>
          <strong className="font-mono text-amber-300">{recordedPot}</strong>
        </div>
      </div>

      {seats.length > 0 && (
        <div className="grid grid-cols-3 gap-2 min-[420px]:hidden" aria-label="Ghế trong hand">
          {[...seats].sort((a, b) => a.seat_number - b.seat_number).map((seat) => (
            <div key={seat.seat_number} className="min-w-0 rounded-lg border border-white/20 bg-[#101715] p-2 text-center text-xs">
              <strong className="block text-amber-200">Ghế {seat.seat_number}{buttonSeat === seat.seat_number ? " · BTN" : ""}</strong>
              <span className="block truncate" title={seat.display_name}>{seat.display_name}</span>
            </div>
          ))}
        </div>
      )}
      {seats.length > 0 && (
        <div className="relative mx-auto hidden h-52 w-full max-w-lg rounded-[50%] border border-amber-400/60 bg-[radial-gradient(ellipse_at_center,#153d31_0%,#0a2720_65%,#091713_100%)] shadow-[inset_0_0_0_5px_#0b1815] min-[420px]:block" aria-label="Sơ đồ ghế trong hand">
          <span className="absolute left-1/2 top-[50%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/45 px-3 py-1 text-center text-[10px] uppercase tracking-widest text-amber-200">
            Pot<br /><strong className="font-mono text-sm tracking-normal">{recordedPot}</strong>
          </span>
          {[...seats].sort((a, b) => a.seat_number - b.seat_number).map((seat) => (
            <span
              key={seat.seat_number}
              style={seatPositions[seat.seat_number] ?? { left: "50%", top: "50%" }}
              className="absolute min-w-16 max-w-20 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/30 bg-[#101715] px-1 py-1 text-center text-[10px] leading-tight shadow-lg"
              title={seat.display_name}
            >
              <strong className="block text-amber-200">Ghế {seat.seat_number}{buttonSeat === seat.seat_number ? " · BTN" : ""}</strong>
              <span className="block truncate text-zinc-200">{seat.display_name}</span>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
        <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
        {initialActionId
          ? !original ? "Action gốc không còn trong hand hiện tại. Xem dấu vết trên cảnh báo; không chọn action mới cùng số thứ tự."
            : selected?.id===initialActionId ? "Action gốc đã được chọn theo ID. Kiểm tra trước khi sửa."
              : "Bạn đang đối chiếu action khác với action gốc trên cảnh báo. Kiểm tra ID trước khi sửa."
          : "Cảnh báo chưa chỉ rõ action sai. Chạm dòng nghi sai để đối chiếu, không tự động kết luận lỗi."}
      </div>
      {selection?.scope===scope&&!selected&&<p role="status" className="text-xs text-amber-100">Action đã chọn không còn trong nhật ký hiện tại. Hãy chọn lại theo dữ liệu mới trước khi xem bản nháp.</p>}

      <div className="space-y-1" aria-label="Nhật ký action theo thứ tự">
        {ordered.length === 0 && <p className="py-4 text-center text-sm text-zinc-400">Hand chưa có action được ghi.</p>}
        {ordered.map((action, index) => {
          const active = selectedKey === actionKey(action);
          const streetChanged = index === 0 || ordered[index - 1].street !== action.street;
          return (
            <div key={action.action_order}>
              {streetChanged && <h4 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-widest text-emerald-300">{streetNames[action.street] ?? action.street}</h4>}
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSelection({scope,key:actionKey(action)})}
                className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${active ? "border-amber-400 bg-amber-400/10" : "border-white/10 bg-white/[0.035] hover:border-emerald-400/50"}`}
              >
                <span className="w-8 shrink-0 font-mono text-xs text-amber-300">#{action.action_order}</span>
                <span className="min-w-0 flex-1 truncate">Ghế {action.seat_number} · {action.display_name}</span>
                <strong className="shrink-0 text-xs text-emerald-100">{actionText(action)}</strong>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
              </button>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-emerald-400/35 bg-black/25 p-3" aria-label={`Chi tiết action ${selected.action_order}`}>
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-300">Action #{selected.action_order} · Ghế {selected.seat_number}</p>
            <p className="text-lg font-semibold">{selected.display_name} · {actionText(selected)}</p>
          </div>
          <div className="grid gap-1 text-xs text-zinc-300 sm:grid-cols-2">
            <p>Trước: {selectedIndex > 0 ? `#${ordered[selectedIndex - 1].action_order} · Ghế ${ordered[selectedIndex - 1].seat_number} · ${actionText(ordered[selectedIndex - 1])}` : "Bắt đầu hand"}</p>
            <p>Sau: {selectedIndex < ordered.length - 1 ? `#${ordered[selectedIndex + 1].action_order} · Ghế ${ordered[selectedIndex + 1].seat_number} · ${actionText(ordered[selectedIndex + 1])}` : "Không còn action"}</p>
          </div>
          {canEdit ? (
            <Button type="button" onClick={() => onEditAction(selected.action_order)} className="min-h-11 w-full bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300">
              Xem bản nháp action #{selected.action_order}
            </Button>
          ) : (
            <p className="text-xs text-amber-100">{isVoided ? "Hand đã void: chỉ đối chiếu, không sửa lịch sử." : "Hand đang chạy hoặc chưa đủ quyền sửa: chỉ đối chiếu tại đây."}</p>
          )}
        </div>
      )}
    </section>
  );
}
