import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBuyinReceiptWithClient, toSeatReceiptData, type BuyinReceiptSnapshot } from "./buyinReceiptCore";

const snapshot: BuyinReceiptSnapshot = {
  registration_id: "registration-1",
  receipt_code: "SEAT-QR-1",
  qr_value: "SEAT-QR-1",
  reference_code: "VINREG-REF-1",
  status: "confirmed",
  club: { name: "CLB A", address: "1 Đường A", logo_url: "https://example.test/logo.png" },
  player_name: "Nguyễn Văn A",
  tournament_name: "Deepstack tên rất dài",
  total_pay: 2_300_000,
  completed_at: "2026-08-15T13:24:00.000Z",
  completed_at_source: "confirmed_at",
  table_number: 3,
  seat_number: 8,
  starting_stack: 30_000,
};
afterEach(()=>vi.useRealTimers());

describe("toSeatReceiptData", () => {
  it("keeps the backend seat QR distinct from the player-facing confirmation code", () => {
    const receipt = toSeatReceiptData(snapshot);

    expect(receipt.qrValue).toBe("SEAT-QR-1");
    expect(receipt.receiptCode).toBe("SEAT-QR-1");
    expect(receipt.confirmationCode).toBe("VINREG-REF-1");
    expect(receipt.totalPay).toBe(2_300_000);
  });

  it("uses legacy values only for fields the read-only snapshot does not provide", () => {
    const receipt = toSeatReceiptData(
      { ...snapshot, club: { name: null, address: null, logo_url: null }, table_number: null, seat_number: null },
      {
        tournamentName: "Legacy tournament",
        playerName: "Legacy player",
        tableNumber: 2,
        seatNumber: 5,
        receiptCode: "legacy-code",
        qrValue: "legacy-code",
        clubName: "Legacy club",
      },
    );

    expect(receipt.clubName).toBe("Legacy club");
    expect(receipt.tableNumber).toBe(2);
    expect(receipt.seatNumber).toBe(5);
    expect(receipt.playerName).toBe("Nguyễn Văn A");
  });
});

describe("fetchBuyinReceiptWithClient", () => {
  it.each([
    "registration_id", "receipt_code", "qr_value", "reference_code", "status", "club",
    "player_name", "tournament_name", "total_pay", "completed_at", "completed_at_source",
    "table_number", "seat_number", "starting_stack",
  ] as const)("rejects a packet missing required %s before returning a typed snapshot", async field => {
    const receipt: Partial<BuyinReceiptSnapshot> = { ...snapshot };
    delete receipt[field];
    const invoke = vi.fn().mockResolvedValue({ data: { receipt }, error: null });
    expect(await fetchBuyinReceiptWithClient({ functions: { invoke } } as never,
      { receiptCode: "SEAT-QR-1" })).toBeNull();
  });
  it.each(["name", "address", "logo_url"] as const)("rejects a packet missing required club.%s", async field => {
    const club: Partial<BuyinReceiptSnapshot["club"]> = { ...snapshot.club };
    delete club[field];
    const invoke = vi.fn().mockResolvedValue({ data: { receipt: { ...snapshot, club } }, error: null });
    expect(await fetchBuyinReceiptWithClient({ functions: { invoke } } as never,
      { receiptCode: "SEAT-QR-1" })).toBeNull();
  });
  it("preserves explicit nulls rather than confusing nullable fields with missing fields", async () => {
    const receipt: BuyinReceiptSnapshot = { ...snapshot, registration_id: null, reference_code: null,
      club: { name: null, address: null, logo_url: null }, player_name: null, tournament_name: null,
      total_pay: null, completed_at: null, completed_at_source: null, table_number: null,
      seat_number: null, starting_stack: null };
    const invoke = vi.fn().mockResolvedValue({ data: { receipt }, error: null });
    expect(await fetchBuyinReceiptWithClient({ functions: { invoke } } as never,
      { receiptCode: "SEAT-QR-1" })).toStrictEqual(receipt);
  });
  it('bounds a hung read and aborts its transport without retrying',async()=>{
    vi.useFakeTimers();let settled=false;
    const invoke=vi.fn(()=>new Promise(()=>{}));
    void fetchBuyinReceiptWithClient({functions:{invoke}} as never,{receiptCode:snapshot.receipt_code!}).then(()=>{settled=true;});
    await vi.advanceTimersByTimeAsync(10001);
    expect(settled).toBe(true);expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0] as unknown as [string,{signal:AbortSignal}])[1].signal.aborted).toBe(true);
  });
  it.each([
    {...snapshot,club:null},
    {...snapshot,total_pay:'2300000'},
    {...snapshot,player_name:42},
    {...snapshot,seat_number:0},
    {...snapshot,registration_id:'another-registration'},
    {...snapshot,status:'surprise'},
    {...snapshot,qr_value:'ANOTHER-QR'},
  ])('rejects an unverified or wrong-scope receipt packet (%j)',async receipt=>{
    const invoke=vi.fn().mockResolvedValue({data:{receipt},error:null});
    expect(await fetchBuyinReceiptWithClient({functions:{invoke}} as never,{registrationId:snapshot.registration_id!})).toBeNull();
  });
  it('rejects a QR response for a different lookup',async()=>{
    const invoke=vi.fn().mockResolvedValue({data:{receipt:snapshot},error:null});
    expect(await fetchBuyinReceiptWithClient({functions:{invoke}} as never,{receiptCode:'ANOTHER-QR'})).toBeNull();
  });
  it('contains a rejected read so consumers can stop loading without an unhandled rejection',async()=>{
    const invoke=vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchBuyinReceiptWithClient({functions:{invoke}} as never,{receiptCode:snapshot.receipt_code!})).resolves.toBeNull();
  });
  it("keeps the Edge receipt request server-authorized through the injected client", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { receipt: snapshot }, error: null });
    const result = await fetchBuyinReceiptWithClient({ functions: { invoke } } as never, { receiptCode: "SEAT-QR-1" });

    expect(invoke).toHaveBeenCalledWith("get-buyin-receipt", { body: { receipt_code: "SEAT-QR-1" },signal:expect.any(AbortSignal) });
    expect(result).toEqual(snapshot);
  });
});
