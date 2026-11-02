import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mention, sendTelegramNotification, formatCloseTableMessage, formatMassAssignMessage, formatEmergencyPreAssignMessage, notifyIncomingDealer } from "../../supabase/functions/_shared/telegram";
import { TelegramNotifier } from "../../supabase/functions/_shared/telegramNotifier";
import { sendPreAssignTelegramWithFallback, type PreAssignNotificationPayload } from "../../supabase/functions/_shared/preAssignTelegram";

// No credential/env lookup, external HTTP or native DB writes. Every fetch is
// replaced before a helper runs; these are local transport/fallback proofs.
const fakeToken = "LOCAL_TEST_ONLY_INVALID_TOKEN", fakeChat = "LOCAL_TEST_ONLY_CHAT";
const payload: PreAssignNotificationPayload = {
  clubId: "local-club", tableId: "local-table", assignmentId: "local-assignment",
  attendanceId: "local-incoming", outAttendanceId: "local-outgoing", tableName: "Bàn TEST",
  zone: "TEST", tournamentName: "Tour TEST", outName: "Dealer A", outUsername: null,
  inName: "Dealer B", inUsername: null, swingAt: new Date("2026-10-29T07:29:00Z"),
  minutesLeft: 3, chatId: fakeChat,
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function admin(error: { code?: string; message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn((table: string) => { expect(table).toBe("pre_announce_jobs"); return { insert }; });
  return { client: { from } as unknown as Parameters<typeof sendPreAssignTelegramWithFallback>[0], from, insert };
}
async function settle<T>(promise: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return promise; }

describe("Telegram local transport without real delivery", () => {
  it.each([["", fakeChat], [fakeToken, ""]])("does not fetch with a missing destination or token", async (token, chat) => {
    expect(await sendTelegramNotification(token, chat, "TEST")).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps full names and escapes markup in dealer mentions", () => {
    expect(mention({ full_name: "A <B> & C", telegram_username: "local_test" })).toBe("A &lt;B&gt; &amp; C @local_test");
    expect(mention({ full_name: "A <B>", telegram_user_id: 123 })).toBe('<a href="tg://user?id=123">A &lt;B&gt;</a>');
  });
  it("escapes table names in close-table HTML without breaking the dealer tag", () => {
    expect(formatCloseTableMessage({ tableName: "Bàn <Final> & VIP", dealer: { full_name: "Dealer <A>", telegram_user_id: 123 } }))
      .toBe('Đóng bàn : Bàn &lt;Final&gt; &amp; VIP - Dealer <a href="tg://user?id=123">Dealer &lt;A&gt;</a> được nghỉ.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("escapes table names in opening assignments while retaining full-name mentions", () => {
    expect(formatMassAssignMessage([{ tableName: "Bàn <Final> & VIP", dealer: { full_name: "Dealer <A>", telegram_username: "local_test" } }]))
      .toBe("Mở Bàn (1 bàn)\n1.Bàn &lt;Final&gt; &amp; VIP → Dealer &lt;A&gt; @local_test");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("escapes emergency incoming table names without altering dealer links", () => {
    const text = formatEmergencyPreAssignMessage({ tableName: "Bàn <Final> & VIP",
      outDealer: { full_name: "Dealer A", telegram_username: "local_test" },
      inDealer: { full_name: "Dealer B", telegram_user_id: 123 }, swingAt: payload.swingAt, minutesLeft: 3 });
    expect(text).toContain("Tiếp theo Bàn &lt;Final&gt; &amp; VIP:");
    expect(text).toContain('Dealer A @local_test ra, <a href="tg://user?id=123">Dealer B</a> vào');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("escapes incoming DM table text while preserving intended HTML bold markup", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await notifyIncomingDealer(fakeToken, { full_name: "Dealer TEST", telegram_user_id: 123 }, "Bàn <Final> & VIP", 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chat_id: "123",
      text: "🔔 Chuẩn bị: <b>Bàn &lt;Final&gt; &amp; VIP</b> sau ~3 phút.", parse_mode: "HTML" });
  });
  it("uses the intended chat and one HTML message on acknowledgement", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    expect(await sendTelegramNotification(fakeToken, fakeChat, "Local TEST")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${fakeToken}/sendMessage`);
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ chat_id: fakeChat, text: "Local TEST", parse_mode: "HTML", disable_web_page_preview: true });
  });
  it("bounds retry after transient failure and stops after acknowledgement", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    expect(await settle(sendTelegramNotification(fakeToken, fakeChat, "TEST"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("reports exhausted delivery without throwing or unbounded retries", async () => {
    fetchMock.mockImplementation(async () => new Response("local failure", { status: 503 }));
    const logError = vi.fn();
    expect(await settle(sendTelegramNotification(fakeToken, fakeChat, "TEST", { logError }))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(logError).toHaveBeenCalledExactlyOnceWith("HTTP 503: local failure");
  });
  it("batches rest and pre-assignment separately and does not resend an empty flush", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const notifier = new TelegramNotifier(fakeToken, fakeChat);
    notifier.enqueue({ type: "break_start", dealerName: "Dealer A", username: null, telegramUserId: null, durationMin: 15 });
    notifier.enqueue({ type: "break_start", dealerName: "Dealer B", username: null, telegramUserId: null, durationMin: 15 });
    notifier.enqueue({ type: "pre_assign", tableName: "Bàn TEST", zone: "TEST", outName: "Dealer A", outUsername: null, outTelegramUserId: null, inName: "Dealer C", inUsername: null, inTelegramUserId: null, swingAt: payload.swingAt, minutesLeft: 3 });
    await vi.advanceTimersByTimeAsync(799); expect(fetchMock).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); expect(fetchMock).toHaveBeenCalledTimes(2);
    const texts = fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body).text);
    expect(texts[0]).toContain("Có 2 cập nhật"); expect(texts[0].match(/15 phút/g)).toHaveLength(2);
    expect(texts[1]).toContain("Tiếp theo Bàn TEST"); expect(texts[1]).toContain("14:29");
    await notifier.flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("escapes batched table and zone labels without escaping intentional mention links", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const notifier = new TelegramNotifier(fakeToken, fakeChat);
    notifier.enqueue({ type: "pre_assign", tableName: "Bàn <Final> & VIP", zone: "Tầng <2> & A",
      outName: "Dealer A", outUsername: "local_test", outTelegramUserId: null,
      inName: "Dealer B", inUsername: null, inTelegramUserId: 123, swingAt: payload.swingAt, minutesLeft: 3 });
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("Có 1 cập nhật - Tầng &lt;2&gt; &amp; A:");
    expect(body.text).toContain("Tiếp theo Bàn &lt;Final&gt; &amp; VIP:");
    expect(body.text).toContain('<a href="tg://user?id=123">Dealer B</a>');
  });
});

describe("pre-assignment delivery versus queued fallback", () => {
  it("queues exact scope on a missing token without claiming delivery", async () => {
    const db = admin(); const result = await sendPreAssignTelegramWithFallback(db.client, payload, null);
    expect(result).toMatchObject({ delivered: false, queued: true, directError: "missing_bot_token" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert.mock.calls[0][0]).toMatchObject({ club_id: payload.clubId, table_id: payload.tableId, assignment_id: payload.assignmentId, attendance_id: payload.attendanceId, out_attendance_id: payload.outAttendanceId, chat_id: fakeChat, status: "pending", max_attempts: 3 });
  });
  it("does not duplicate a queued fallback or call it delivered", async () => {
    const db = admin({ code: "23505", message: "already queued" });
    expect(await sendPreAssignTelegramWithFallback(db.client, payload, null)).toMatchObject({ delivered: false, queued: true });
    expect(db.insert).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("queues once after three failed direct attempts", async () => {
    fetchMock.mockImplementation(async () => new Response("local unavailable", { status: 503 }));
    const db = admin(); const result = await settle(sendPreAssignTelegramWithFallback(db.client, payload, fakeToken));
    expect(result).toMatchObject({ delivered: false, queued: true }); expect(fetchMock).toHaveBeenCalledTimes(3); expect(db.insert).toHaveBeenCalledTimes(1);
  });
  it("reports fallback failure instead of silently claiming a queued message", async () => {
    const db = admin({ code: "local", message: "local queue unavailable" });
    expect(await sendPreAssignTelegramWithFallback(db.client, payload, null)).toMatchObject({ delivered: false, queued: false, fallbackError: "local queue unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not queue an undeliverable message with a missing chat", async () => {
    const db = admin();
    expect(await sendPreAssignTelegramWithFallback(db.client, { ...payload, chatId: "" }, fakeToken)).toEqual({ delivered: false, queued: false, directError: "missing_chat_id" });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
  });
});
