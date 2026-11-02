// Operator-facing Vietnamese messages for the Tracker server validation codes.
//
// The Edge function `tournament-live-update` returns these codes (from
// supabase/functions/_shared/trackerEngine/types.ts → ValidationCode) with a 422
// when TRACKER_VALIDATION_MODE=enforce, or as an advisory `validation` field in
// warn mode. This map keeps the operator wording consistent and friendly on the
// client; the raw code is still shown as a small detail for debugging.
//
// Frontend-only. No secrets, no payloads.

export const VALIDATION_MESSAGES: Record<string, string> = {
  HAND_NOT_ACTIVE: "Hand không ở trạng thái đang diễn ra.",
  PLAYER_NOT_IN_HAND: "Người chơi không thuộc hand này.",
  PLAYER_FOLDED: "Người chơi đã fold — không thể hành động tiếp.",
  PLAYER_ALL_IN: "Người chơi đã all-in — không thể hành động thêm.",
  OUT_OF_TURN: "Chưa tới lượt người chơi này.",
  ILLEGAL_ACTION_TYPE: "Loại hành động không hợp lệ.",
  CHECK_FACING_BET: "Không thể check khi đang có cược phải theo — hãy Call, Raise hoặc Fold.",
  CALL_WITH_NOTHING_TO_CALL: "Không có cược nào để call — hãy Check hoặc Bet.",
  BET_WHEN_FACING_BET: "Đang có cược trên vòng này — hãy Raise thay vì Bet.",
  RAISE_WITHOUT_BET: "Chưa có cược nào để raise — hãy Bet.",
  ACTION_NOT_REOPENED: "Action chưa được mở lại để người chơi này raise.",
  AMOUNT_EXCEEDS_STACK: "Số chip vượt quá stack của người chơi.",
  tracker_action_stack_exceeded: "Số chip vượt quá stack còn lại trên server. Hãy tải lại hand trước khi nhập lại.",
  tracker_action_negative_amount: "Số chip không được âm. Hãy kiểm tra lại hành động.",
  tracker_action_stack_evidence_missing: "Chưa xác minh được stack của hand. Gọi Floor kiểm tra dữ liệu trước khi tiếp tục.",
  BELOW_MIN_RAISE: "Mức raise thấp hơn raise tối thiểu cho phép.",
  NON_POSITIVE_AMOUNT: "Số chip phải lớn hơn 0.",
  STREET_ACTION_PENDING: "Chưa thể sang vòng mới — vẫn còn người chưa hành động.",
  SIDE_POTS_TAMPERED: "Side pot không khớp với chuỗi hành động trên server.",
};

/** True when `code` is a known tracker validation reject code. */
export function isValidationCode(code?: string | null): boolean {
  return !!code && Object.prototype.hasOwnProperty.call(VALIDATION_MESSAGES, code);
}

/** Friendly Vietnamese message for a validation code, falling back to the raw
 * server message (or a generic line) when the code is unknown. */
export function friendlyValidationError(code?: string | null, fallback?: string): string {
  if (code && VALIDATION_MESSAGES[code]) return VALIDATION_MESSAGES[code];
  return fallback || "Hành động không hợp lệ theo luật.";
}
