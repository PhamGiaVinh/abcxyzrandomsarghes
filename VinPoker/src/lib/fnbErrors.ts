// Central F&B error → Vietnamese toast mapper. Shared by EVERY F&B surface so error handling lives
// in one place (the defense line for the whole module).
//
// F&B RPCs fail in TWO shapes (see plan Part 2 "contract rules") — this helper handles both:
//   (a) BUSINESS failure: the RPC returns jsonb `{ error:'CODE', detail? }`. The Supabase call's
//       `error` is null and `data.error` holds the code. Caller passes the code string here.
//   (b) THROWN exception: the RPC does `RAISE EXCEPTION ...` (notably `INSUFFICIENT_STOCK` in
//       fnb_mark_paid, raised with `USING DETAIL = <shortages json>`). PostgREST returns a non-2xx,
//       so the Supabase `error` OBJECT is populated (message + details/detail) and `data` is null.
//       Caller passes the error object here.
//
// Canonical call site:  if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
//   → on (a) we pass the string `res.error`; on (b) we pass the `error` object. mapFnbError accepts both.
//
// Vietnamese is hard-coded here (vi-first app); a later pass can route these through i18n keys.

const VI: Record<string, string> = {
  FNB_GUEST_LOOKUP_INVALID: "Chưa xác minh được thực đơn. Vui lòng tải lại; chưa thể gửi đơn.",
  FNB_MUTATION_UNKNOWN: "Chưa xác nhận được kết quả. Hãy tải lại trạng thái đơn trước khi thao tác lại; không tạo đơn mới để thay thế.",
  REQUEST_ID_CONFLICT: "Mã yêu cầu đã gắn với đơn hoặc nội dung khác. Tải lại đơn đã ghi để kiểm tra; không tạo đơn thay thế khi chưa xác minh.",
  Unauthorized:        "Bạn cần đăng nhập lại.",
  Forbidden:           "Bạn không có quyền thực hiện thao tác này.",
  INVALID_INPUT:       "Dữ liệu nhập không hợp lệ.",
  INVALID_QTY:         "Số lượng phải lớn hơn 0.",
  MENU_ITEM_NOT_FOUND: "Không tìm thấy món.",
  MENU_ITEM_INACTIVE:  "Món đang tắt bán.",
  ORDER_NOT_FOUND:     "Không tìm thấy đơn.",
  LINE_NOT_FOUND:      "Không tìm thấy dòng món trong đơn này. Tải lại đơn trước khi đánh dấu hoàn tất.",
  BAD_STATE:           "Đơn không ở trạng thái phù hợp để thao tác.",
  PARTIAL_RETURN_SNAPSHOT_UNAVAILABLE: "Đơn cũ đã giao một phần nhưng thiếu dữ liệu nguyên liệu lúc thu tiền. Cần đối soát hàng trả trước khi huỷ; đơn chưa bị thay đổi.",
  INGREDIENT_NOT_FOUND:"Không tìm thấy nguyên liệu.",
  STOCKTAKE_NOT_FOUND: "Không tìm thấy phiên kiểm kho.",
  DUPLICATE_NAME:      "Tên này đã tồn tại.",
  NOT_FOUND:           "Không tìm thấy bản ghi.",
  INSUFFICIENT_STOCK:  "Không đủ nguyên liệu để bán.",
  RECIPE_REQUIRED:     "Có món chưa khai báo công thức — không thể thu tiền.",
  INVALID_TABLE_REF:   "Bàn đã chọn không hợp lệ — chọn lại hoặc dùng gõ tay.",
  INVALID_PLAYER_REF:  "Người chơi đã chọn không hợp lệ — chọn lại hoặc bỏ chọn.",
  SHIFT_NOT_FOUND:     "Không tìm thấy ca làm việc.",
  TOKEN_INVALID:       "Mã QR không hợp lệ hoặc đã hết hạn — vui lòng quét lại mã trên bàn.",
  GUEST_ORDER_DISABLED:"Câu lạc bộ chưa mở gọi món qua QR.",
  BANK_UNAVAILABLE:    "Chưa hỗ trợ chuyển khoản — vui lòng chọn tiền mặt.",
  TABLE_PENDING_LIMIT: "Bàn đang có quá nhiều đơn chờ — vui lòng đợi phục vụ xử lý.",
  RATE_LIMITED:        "Bạn thao tác quá nhanh — vui lòng thử lại sau ít phút.",
};

type SupaErr = { message?: string; details?: string; detail?: string; hint?: string; code?: string } | null | undefined;
type Shortage = { ingredient_id?: string; name?: string; need?: number; on_hand?: number };

const fmtQty = (n: number | undefined): string =>
  n == null ? "?" : (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

// The `INSUFFICIENT_STOCK` exception carries the shortage array in pg's DETAIL → PostgREST `details`.
function parseShortages(detail: string | undefined): Shortage[] {
  if (!detail) return [];
  try {
    const arr = JSON.parse(detail);
    return Array.isArray(arr) ? (arr as Shortage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Map an F&B failure to a Vietnamese message.
 * @param input either a business code string (from `res.error`) OR a Supabase/Postgrest error object.
 */
export function mapFnbError(input: string | SupaErr): string {
  if (!input) return "Có lỗi xảy ra, vui lòng thử lại.";

  // (b) thrown-exception shape — Supabase error object.
  if (typeof input !== "string") {
    const msg = input.message ?? "";
    const detail = input.details ?? input.detail; // pg RAISE ... USING DETAIL surfaces as `details`
    // RECIPE_REQUIRED (fnb_mark_paid, …0010): DETAIL = [{menu_item_id,name,qty}] of items that track
    // inventory but have no recipe → block PAID. Same thrown-exception shape as INSUFFICIENT_STOCK.
    if (msg.includes("RECIPE_REQUIRED")) {
      const items = parseShortages(detail);
      const list = items.map((s) => s.name).filter(Boolean).join(", ");
      return list
        ? `Chưa có công thức cho: ${list}. Thêm công thức hoặc đánh dấu “không trừ kho”.`
        : VI.RECIPE_REQUIRED;
    }
    if (msg.includes("INSUFFICIENT_STOCK")) {
      const short = parseShortages(detail);
      if (short.length) {
        const list = short
          .map((s) => `${s.name ?? "?"} (cần ${fmtQty(s.need)}, còn ${fmtQty(s.on_hand)})`)
          .join(", ");
        return `Không đủ nguyên liệu: ${list}`;
      }
      return VI.INSUFFICIENT_STOCK;
    }
    // a known code may be embedded in the exception message
    for (const code of Object.keys(VI)) {
      if (msg.includes(code)) return VI[code];
    }
    return msg || "Có lỗi xảy ra, vui lòng thử lại.";
  }

  // (a) business code string (e.g. 'Forbidden', 'DUPLICATE_NAME').
  return VI[input] ?? input;
}
