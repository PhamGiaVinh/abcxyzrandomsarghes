export type DealerSwingUiOutcome =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | { kind: "unknown"; message: string };

export function classifyManualSwingOutcome(result: unknown): DealerSwingUiOutcome {
  const row = typeof result === "object" && result !== null
    ? result as { outcome?: unknown; message?: unknown; detail?: unknown }
    : {};
  const outcome = typeof row.outcome === "string" ? row.outcome : "";
  const serverMessage = typeof row.message === "string" && row.message.trim() ? row.message.trim() : null;

  if (["swung", "swung_to_break", "swung_to_pool"].includes(outcome)) {
    return { kind: "success", message: "Swing thành công!" };
  }
  if (["race_lost", "version_conflict", "already_in_transition"].includes(outcome)) {
    return { kind: "warning", message: "Bàn này vừa được xử lý bởi người khác. Đang cập nhật..." };
  }
  if (["no_dealer", "no_dealer_available"].includes(outcome)) {
    return { kind: "warning", message: "Không đủ dealer khả dụng để thay thế." };
  }
  if (["not_found", "state_mismatch"].includes(outcome)) {
    return { kind: "warning", message: "Assignment không còn hiệu lực. Đang cập nhật..." };
  }
  if (outcome === "enforce_next_swing") {
    return { kind: "info", message: serverMessage ?? "Dealer tiếp theo cần nghỉ sớm, sẽ swing tiếp." };
  }
  if (outcome === "error") {
    if(serverMessage)return {kind:"error",message:`Lỗi: ${serverMessage}`};
    if(row.detail==='DEALER_REST_REQUIRED')return {kind:"error",message:"Dealer chưa đủ thời gian nghỉ. Chờ đủ lịch nghỉ rồi tải lại trạng thái bàn."};
    if(row.detail==='DEALER_ACQUISITION_ATTENDANCE_STALE')return {kind:"error",message:"Ca check-in của dealer không còn thuộc ngày vận hành hiện tại. Kiểm tra ca và tải lại trạng thái bàn."};
    return { kind: "error", message: "Chưa thực hiện được Swing. Hãy tải lại trạng thái bàn để kiểm tra." };
  }
  return {
    kind: "unknown",
    message: "Chưa xác định được kết quả swing. Đang tải lại trạng thái từ máy chủ...",
  };
}

export function classifyProcessSwingResult(result: unknown): DealerSwingUiOutcome {
  const row = typeof result === "object" && result !== null
    ? result as { ok?: unknown; status?: unknown; error_code?: unknown; processed_count?: unknown; metrics?: unknown; dry_run?: unknown }
    : {};
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "completed" && row.ok !== false && row.error_code == null) {
    // The current Edge response has per-club mixed operation metrics, not a
    // processed_count of dealer changes. Never infer a zero or sum those metrics.
    if (row.ok === true && row.metrics !== null && typeof row.metrics === 'object' && !Array.isArray(row.metrics) && typeof row.dry_run === 'boolean') {
      return row.dry_run
        ? { kind: 'info', message: 'Đã hoàn tất mô phỏng Swing; đây không phải xác nhận đổi dealer.' }
        : { kind: 'success', message: 'Đợt xử lý Swing đã hoàn tất. Đang cập nhật trạng thái bàn.' };
    }
    // Retain the older explicit-count contract only when that count is verified.
    if (typeof row.processed_count === 'number' && Number.isSafeInteger(row.processed_count) && row.processed_count >= 0 && row.dry_run !== true) {
      return { kind: "success", message: `Đã xử lý ${row.processed_count} swing` };
    }
  }
  if (["partial", "locked", "dependency_unavailable", "business_failed"].includes(status)) {
    return {
      kind: status === "locked" ? "warning" : "error",
      message: "Đợt swing chưa hoàn tất. Đã tải lại trạng thái để kiểm tra.",
    };
  }
  return {
    kind: "unknown",
    message: "Chưa xác định được kết quả xử lý. Đã tải lại trạng thái từ máy chủ.",
  };
}
