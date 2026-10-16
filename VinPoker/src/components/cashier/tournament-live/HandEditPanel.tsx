// F2 — DISPLAY-ONLY editor for a completed hand. Prop-driven (no supabase) so it stays
// testable; the parent (HandHistoryPanel) runs the edit_completed_hand RPC on save.
// v1 action scope: edit type/amount + delete a row. NO add-row, NO reorder — a deleted
// row's action_order gap is kept (never renumbered).
import { useState, useEffect, useRef, useId } from "react";
import { TrackerInputCardProvider } from "@/components/tracker/TrackerCardStyle";
import { CardSlotPicker, type Card } from "@/components/shared/CardSlotPicker";
import {
  buildHandEditPatch,
  buildHandEditSummary,
  hasHandEdit,
  type EditableHand,
  type EditAction,
  type EditHolePlayer,
  type HandEditPatch,
} from "./handEditDiff";
import { buildEditedTarget, type ExpectedHandEndStack } from "./resettleApply";
import type { EditedTargetHand } from "@/lib/tracker-poker/resettleForward";
import { validateHandEditActions } from "./handEditValidation";

export interface HandEditPanelPlayer {
  player_id: string;
  entry_number: number;
  display_name: string;
  seat_number: number;
  starting_stack: number;
  ending_stack: number;
  hole_cards: string[];
}
export interface HandEditPanelProps {
  board: string[];
  potSize?: number | null;
  players: HandEditPanelPlayer[];
  actions: EditAction[];
  initialActionOrder?: number | null;
  buttonSeat: number;
  saving?: boolean;
  writesEnabled?: boolean;
  onCancel: () => void;
  onSave: (patch: HandEditPatch, reason: string, summary: string[]) => void;
  /** Đợt G3: when true, also offer "Sửa & tính lại chip" (runs the resettle engine). */
  resettleEnabled?: boolean;
  /** Đợt G3: emit the engine-ready edited target + the display patch for the parent to
   *  run resettle-forward and (on confirm) commit chips. */
  onResettle?: (
    editedTarget: EditedTargetHand,
    patch: HandEditPatch,
    reason: string,
    summary: string[],
    expectedEndingStacks: ExpectedHandEndStack[],
  ) => void;
  /** Đợt G3: called when the edited board/holes/actions change, so the parent invalidates a
   *  stale resettle preview and forces a re-run before confirming. */
  onEditChange?: () => void;
}

const toSlots = (cards: string[], n: number): (Card | null)[] =>
  Array.from({ length: n }, (_, i) => (cards[i] as Card) ?? null);
const fromSlots = (slots: (Card | null)[]): string[] => slots.filter((c): c is Card => !!c);

const ACTION_TYPES = ["fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"];

export function HandEditPanel(props: HandEditPanelProps) {
  return <TrackerInputCardProvider><HandEditPanelContent {...props} /></TrackerInputCardProvider>;
}

function HandEditPanelContent({ board, potSize = null, players, actions, initialActionOrder, buttonSeat, saving, writesEnabled = false, onCancel, onSave, resettleEnabled, onResettle, onEditChange }: HandEditPanelProps) {
  const reasonId = useId();
  const [boardSlots, setBoardSlots] = useState<(Card | null)[]>(toSlots(board, 5));
  const [holes, setHoles] = useState<Record<string, (Card | null)[]>>(() => {
    const m: Record<string, (Card | null)[]> = {};
    players.forEach((p) => (m[`${p.player_id}:${p.entry_number}`] = toSlots(p.hole_cards, 2)));
    return m;
  });
  const [rows, setRows] = useState<EditAction[]>(actions.map((a) => ({ ...a })));
  const [expectedEndStacks, setExpectedEndStacks] = useState<Record<string, number>>(() =>
    Object.fromEntries(players.map((player) => [`${player.player_id}:${player.entry_number}`, player.ending_stack])),
  );
  const [reason, setReason] = useState("");
  const selectedActionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedActionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [initialActionOrder]);

  // Đợt G3: whenever the edited cards/actions change, tell the parent so it drops any stale
  // resettle preview (a preview computed before this edit must not be confirmed).
  const editSignature = JSON.stringify([boardSlots, holes, rows, expectedEndStacks, reason]);
  const firstEditRun = useRef(true);
  useEffect(() => {
    if (firstEditRun.current) {
      firstEditRun.current = false;
      return;
    }
    onEditChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignature]);

  const usedCards = new Set<Card>([
    ...boardSlots.filter((c): c is Card => !!c),
    ...Object.values(holes).flat().filter((c): c is Card => !!c),
  ]);

  const original: EditableHand = {
    community_cards: board,
    pot_size: potSize,
    holes: players.map((p) => ({ player_id: p.player_id, entry_number: p.entry_number, hole_cards: p.hole_cards })),
    actions,
  };
  const edited: EditableHand = {
    community_cards: fromSlots(boardSlots),
    pot_size: potSize,
    holes: players.map<EditHolePlayer>((p) => ({
      player_id: p.player_id,
      entry_number: p.entry_number,
      hole_cards: fromSlots(holes[`${p.player_id}:${p.entry_number}`] ?? []),
    })),
    actions: rows,
  };
  const patch = buildHandEditPatch(original, edited);
  const dirty = hasHandEdit(patch);
  const actionValidation = validateHandEditActions(players, rows, buttonSeat);
  const validationByOrder = new Map(actionValidation.assessments.map((item) => [item.action_order, item]));
  const expectedEndingStackRows: ExpectedHandEndStack[] = players.map((player) => ({
    player_id: player.player_id,
    entry_number: player.entry_number,
    ending_stack: expectedEndStacks[`${player.player_id}:${player.entry_number}`] ?? Number.NaN,
  }));
  const expectedEndingTotal = expectedEndingStackRows.reduce((sum, player) => sum + player.ending_stack, 0);
  const startingStackTotal = players.reduce((sum, player) => sum + player.starting_stack, 0);
  const expectedStacksValid = expectedEndingStackRows.every((player) =>
    Number.isSafeInteger(player.ending_stack) && player.ending_stack >= 0,
  ) && expectedEndingTotal === startingStackTotal;
  // Board/holes-only corrections keep the existing correction contract. Any action edit
  // must pass the shared reducer's advisory check before it can be sent to the server.
  const actionsValid = patch.p_actions === null || actionValidation.ok;
  const validReason = reason.trim().length >= 8 && reason.trim().length <= 500;
  const canSave = writesEnabled && dirty && actionsValid && validReason && !saving;
  const effectiveStatus = actionValidation.status === "INCOMPLETE"
    && actionValidation.nextAction === null && fromSlots(boardSlots).length === 5
    ? "READY_TO_APPLY"
    : actionValidation.status;
  const canResettle = !!resettleEnabled && !!onResettle && dirty && actionsValid
    && effectiveStatus === "READY_TO_APPLY" && expectedStacksValid && validReason && !saving;
  const nextActionPlayer = actionValidation.nextAction
    ? players.find((player) => player.player_id === actionValidation.nextAction?.player_id)
    : null;

  const submit = () => {
    if (!canSave) return;
    const summary = buildHandEditSummary(original, edited);
    if (!window.confirm(["Xác nhận sửa hand?", "", ...summary].join("\n"))) return;
    onSave(patch, reason.trim(), summary);
  };

  // Đợt G3 — hand the edited state to the parent, which runs the resettle engine and
  // shows a chip-change preview before committing. Holes are keyed by player_id here
  // (a player_id is unique within one hand).
  const resettle = () => {
    if (!canResettle) return;
    const holeCardsByPlayer: Record<string, (string | null)[]> = {};
    players.forEach((p) => {
      holeCardsByPlayer[p.player_id] = holes[`${p.player_id}:${p.entry_number}`] ?? [null, null];
    });
    const editedTarget = buildEditedTarget({
      board: fromSlots(boardSlots),
      holeCardsByPlayer,
      actions: rows.map((r) => ({
        player_id: r.player_id,
        street: r.street,
        action_type: r.action_type,
        action_amount: r.action_amount,
        action_order: r.action_order,
      })),
    });
    onResettle!(editedTarget, patch, reason.trim(), buildHandEditSummary(original, edited), expectedEndingStackRows);
  };

  const nameOf = (a: EditAction) =>
    players.find((p) => p.player_id === a.player_id && p.entry_number === a.entry_number)?.display_name ??
    a.player_id.slice(0, 6);

  return (
    <div className="space-y-3">
      {!writesEnabled && (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          {resettleEnabled
            ? "Đường lưu hiển thị riêng đang tắt. Bạn có thể sửa bản nháp và xem trước; chỉ lưu sau khi máy chủ xác nhận đường sửa nguyên tử."
            : "Bản nháp để đối chiếu. Chức năng ghi sửa hand đang tạm khóa; hãy liên hệ Floor trước khi tiếp tục."}
        </div>
      )}
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Bài chung (0/3/4/5 lá)</div>
        <div className="flex gap-2">
          {boardSlots.map((c, i) => (
            <CardSlotPicker
              key={i}
              value={c}
              used={new Set([...usedCards].filter((x) => x !== c) as Card[])}
              onChange={(nc) => setBoardSlots((prev) => prev.map((p, pi) => (pi === i ? nc : p)))}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Bài tẩy</div>
        <div className="space-y-1.5">
          {players.map((p) => {
            const key = `${p.player_id}:${p.entry_number}`;
            const slots = holes[key] ?? [null, null];
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs min-w-[96px] truncate">{p.display_name}</span>
                {slots.map((c, i) => (
                  <CardSlotPicker
                    key={i}
                    value={c}
                    used={new Set([...usedCards].filter((x) => x !== c) as Card[])}
                    onChange={(nc) => setHoles((prev) => ({ ...prev, [key]: (prev[key] ?? [null, null]).map((s, si) => (si === i ? nc : s)) }))}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">
          Hành động (sửa loại/số chip thêm vào, hoặc xoá dòng)
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">Pot đã lưu: <strong className="font-mono text-foreground">{potSize === null ? "Chưa có dữ liệu" : potSize.toLocaleString("vi-VN")}</strong></span>
          <span className="text-muted-foreground">Pot từ action nháp: <strong className="font-mono text-foreground">{actionValidation.potSize.toLocaleString("vi-VN")}</strong></span>
          <span className={effectiveStatus === "READY_TO_APPLY" ? "font-medium text-emerald-300" : effectiveStatus === "INCOMPLETE" ? "font-medium text-amber-300" : "font-medium text-rose-300"}>
            {effectiveStatus === "READY_TO_APPLY" ? "READY_TO_APPLY · đủ diễn biến"
              : effectiveStatus === "INCOMPLETE" ? "INCOMPLETE · cần nhập tiếp diễn biến"
              : "INVALID · có action cần kiểm tra"}
          </span>
        </div>
        {actionValidation.status === "INCOMPLETE" && actionValidation.nextAction && nextActionPlayer && (
          <button
            type="button"
            className="mb-2 min-h-11 w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 text-left text-sm font-semibold text-amber-100"
            onClick={() => setRows((current) => [...current, {
              player_id: actionValidation.nextAction!.player_id,
              entry_number: nextActionPlayer.entry_number,
              street: actionValidation.nextAction!.street,
              action_type: actionValidation.nextAction!.action_type,
              action_amount: actionValidation.nextAction!.action_amount,
              action_order: actionValidation.nextAction!.action_order,
            }])}
          >
            + Nhập lượt Ghế {nextActionPlayer.seat_number} · {nextActionPlayer.display_name}
            <span className="ml-2 font-normal text-amber-200/80">
              gợi ý {actionValidation.nextAction.action_type} {actionValidation.nextAction.action_amount > 0 ? actionValidation.nextAction.action_amount.toLocaleString("vi-VN") : ""}
            </span>
          </button>
        )}
        <p className="mb-2 text-[11px] text-muted-foreground">
          Call, bet và raise dùng số chip thêm vào ở action đó, không phải tổng mức raise-to. Engine hiển thị mức cần theo và mức raise tối thiểu cho từng dòng.
        </p>
        <div className="space-y-1 pr-1 lg:max-h-[360px] lg:overflow-y-auto">
          {rows.map((a, i) => {
            const check = validationByOrder.get(a.action_order);
            return (
              <div
                key={a.action_order}
                ref={a.action_order === initialActionOrder ? selectedActionRef : undefined}
                className={`rounded-lg border p-2 ${a.action_order === initialActionOrder ? "border-amber-400 bg-amber-400/10" : check?.legal ? "border-emerald-500/20 bg-emerald-950/10" : "border-rose-500/35 bg-rose-950/10"}`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground tabular-nums">#{a.action_order}</span>
                  <span className="min-w-0 flex-1 truncate">{nameOf(a)} · {a.street}</span>
                  <button
                    type="button"
                    aria-label={`Xoá action ${a.action_order}`}
                    className="min-h-11 min-w-11 text-red-400 hover:text-red-300"
                    onClick={() => setRows((prev) => prev.filter((_, ri) => ri !== i))}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    aria-label={`Loại action ${a.action_order}`}
                    className="h-11 min-w-0 rounded border border-border bg-background px-1 text-base sm:text-sm"
                    value={a.action_type}
                    onChange={(e) => setRows((prev) => prev.map((r, ri) => (ri === i ? { ...r, action_type: e.target.value } : r)))}
                  >
                    {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="number"
                    min={0}
                    aria-label={`Số chip action ${a.action_order}`}
                    className="h-11 min-w-0 rounded border border-border bg-background px-1 text-base sm:text-sm"
                    value={a.action_amount}
                    onChange={(e) => setRows((prev) => prev.map((r, ri) => (ri === i ? { ...r, action_amount: Math.max(0, parseInt(e.target.value) || 0) } : r)))}
                  />
                </div>
                <p className={`mt-1 text-[10px] leading-snug ${check?.legal ? "text-emerald-200" : "text-rose-200"}`}>
                  {check?.message ?? "Đang kiểm tra action..."}
                  {check?.stackBefore != null && ` Stack trước: ${check.stackBefore.toLocaleString("vi-VN")}.`}
                  {check?.requiredAmount != null && ` Cần theo: ${check.requiredAmount.toLocaleString("vi-VN")}.`}
                  {check?.minimumAmount != null && ` Tối thiểu: ${check.minimumAmount.toLocaleString("vi-VN")}.`}
                </p>
              </div>
            );
          })}
        </div>
        {!actionsValid && (
          <p role="alert" className="mt-2 text-[11px] leading-snug text-rose-300">
            Chưa gửi chỉnh sửa action. Hãy sửa các dòng đỏ; máy chủ vẫn sẽ kiểm tra lại trước khi ghi.
          </p>
        )}
      </div>

      {resettleEnabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-foreground">Stack cuối thực tế để đối chiếu</span>
            <span className={expectedStacksValid ? "text-emerald-300" : "text-rose-300"}>
              {expectedStacksValid ? "Tổng stack khớp đầu hand" : "Tổng stack phải bằng đầu hand"}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Nhập stack Floor quan sát được sau hand. Các số này không ghi chip trực tiếp: engine phải dựng lại đúng từng ghế trước khi cho xác nhận.
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {players.map((player) => {
              const key = `${player.player_id}:${player.entry_number}`;
              return (
                <label key={key} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1.5 text-[11px]">
                  <span className="min-w-0 truncate text-muted-foreground">Ghế {player.seat_number} · {player.display_name}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Stack cuối Ghế ${player.seat_number}`}
                    className="h-11 w-28 shrink-0 rounded border border-border bg-background px-1.5 text-right font-mono text-base sm:text-sm"
                    value={expectedEndStacks[key] ?? ""}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setExpectedEndStacks((current) => ({ ...current, [key]: Number.isSafeInteger(next) ? Math.max(0, next) : Number.NaN }));
                    }}
                  />
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Tổng đầu hand: {startingStackTotal.toLocaleString("vi-VN")} · Stack thực tế: {Number.isFinite(expectedEndingTotal) ? expectedEndingTotal.toLocaleString("vi-VN") : "không hợp lệ"}
          </p>
        </div>
      )}

      <div>
        <label htmlFor={reasonId} className="mb-1 block text-[11px] font-semibold text-muted-foreground">Lý do sửa — bắt buộc</label>
        <textarea
          id={reasonId}
          className="w-full min-h-[48px] rounded border border-border bg-background p-2 text-base sm:text-sm"
          placeholder="Ví dụ: nhập nhầm lá K♦ — thực tế là K♣"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">Lý do cần 8–500 ký tự; đổi lý do hoặc stack sẽ làm xem trước cũ hết hiệu lực.</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-2 flex-wrap">
          {writesEnabled && <button
            type="button"
            disabled={!canSave}
            onClick={submit}
            className="text-xs font-medium text-emerald-300 border border-emerald-500/50 rounded-lg px-3 py-1.5 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            {saving ? "Đang lưu…" : resettleEnabled ? "Chỉ lưu hiển thị" : "Xem lại & lưu"}
          </button>}
          {resettleEnabled && (
            <button
              type="button"
              disabled={!canResettle}
              onClick={resettle}
              className="min-h-11 text-sm font-semibold text-amber-200 border border-amber-500/60 bg-amber-500/10 rounded-lg px-3 py-1.5 hover:bg-amber-500/20 disabled:opacity-40"
            >
              Xem trước tính chip
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 text-sm font-medium text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-foreground"
          >
            Huỷ
          </button>
        </div>
        {resettleEnabled && (
          <p className="text-xs text-muted-foreground leading-snug">
            Xem trước chỉ để đối chiếu. Không thay đổi action, chip hay kết quả đã lưu.
          </p>
        )}
      </div>
    </div>
  );
}
