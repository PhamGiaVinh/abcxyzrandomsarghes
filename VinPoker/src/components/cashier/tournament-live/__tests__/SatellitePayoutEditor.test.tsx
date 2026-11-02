import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {StrictMode} from 'react';

afterEach(()=>{cleanup();vi.useRealTimers();});

// Save honesty (zero-row RLS filter ≠ success) + load lifecycle (error/retry/stale-guard) của
// SatellitePayoutEditor. UPDATE tournaments bị RLS USING lọc trả data=[] KHÔNG error — trước fix
// editor toast success giả rồi load() xoá sạch dữ liệu operator vừa gõ.
const h = vi.hoisted(() => ({
  loadResult: { data: { satellite_payout: null }, error: null } as any,
  // Khi set: mỗi lần load() lấy 1 promise theo thứ tự (điều khiển thủ công cho test stale).
  loadQueue: null as null | Array<() => Promise<any>>,
  updateQueue:null as null|Array<()=>Promise<unknown>>,
  updateRows: [{ id: "t1" }] as { id: string }[],
  updateError: null as { message: string } | null,
  updateCalls: 0,
  lastUpdatePayload: null as any,
  readSignals:[] as AbortSignal[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeChain = () => {
    const chain: any = {};
    let isUpdate = false;
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.abortSignal=vi.fn((signal:AbortSignal)=>{h.readSignals.push(signal);return chain;});
    chain.update = vi.fn((p: any) => { isUpdate = true; h.updateCalls++; h.lastUpdatePayload = p; return chain; });
    chain.maybeSingle = vi.fn(() => {
      if (h.loadQueue && h.loadQueue.length > 0) return h.loadQueue.shift()!();
      return Promise.resolve(h.loadResult);
    });
    // update path được await trực tiếp (thenable): .update().eq().select("id")
    chain.then = (resolve: (value:unknown)=>unknown,reject:(error:unknown)=>unknown) =>
      (isUpdate&&h.updateQueue?.length?h.updateQueue.shift()!():Promise.resolve(
        isUpdate ? { data: h.updateError ? null : h.updateRows, error: h.updateError } : { data: null, error: null },
      )).then(resolve,reject);
    return chain;
  };
  return { supabase: { from: vi.fn(() => makeChain()) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SatellitePayoutEditor } from "../SatellitePayoutEditor";
import { toast } from "sonner";

beforeEach(() => {
  h.loadResult = { data: { satellite_payout: null }, error: null };
  h.loadQueue = null;
  h.updateQueue=null;
  h.updateRows = [{ id: "t1" }];
  h.updateError = null;
  h.updateCalls = 0;
  h.lastUpdatePayload = null;
  h.readSignals=[];
  (toast.success as any).mockClear();
  (toast.error as any).mockClear();
});

/** Gõ 1 dòng để nút Lưu bật (dirty). */
async function typeRow(label: string, prize: string) {
  await screen.findByLabelText("Khoảng hạng dòng 1");
  fireEvent.change(screen.getByLabelText("Khoảng hạng dòng 1"), { target: { value: label } });
  fireEvent.change(screen.getByLabelText("Phần thưởng dòng 1"), { target: { value: prize } });
}

describe("SatellitePayoutEditor — save honesty", () => {
  it('retains draft and reports unknown outcome when save transport rejects',async()=>{
    h.updateQueue=[()=>Promise.reject(new Error('LOCAL414 response lost'))];
    render(<SatellitePayoutEditor tournamentId="t1"/>);
    await typeRow('1–12','1 vé');
    fireEvent.click(screen.getByRole('button',{name:/Lưu/}));
    await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Chưa xác minh/)));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Phần thưởng dòng 1')).toHaveValue('1 vé');
    expect(h.updateCalls).toBe(1);
    expect(screen.getByRole('button',{name:/Lưu/})).toBeEnabled();
  });
  for (const result of [[{id:'other-tour'}], [{id:'t1'},{id:'other-tour'}], {status:'ok'}, null]) {
    it(`preserves draft on unverified RETURNING ${JSON.stringify(result)}`, async () => {
      h.updateQueue=[()=>Promise.resolve({data:result,error:null})];
      render(<SatellitePayoutEditor tournamentId="t1" />);
      await typeRow('1–12','1 vé');
      fireEvent.click(screen.getByRole('button',{name:/Lưu/}));
      await waitFor(()=>expect(toast.error).toHaveBeenCalled());
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Chưa xác minh/));
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Phần thưởng dòng 1')).toHaveValue('1 vé');
      expect(h.updateCalls).toBe(1);
    });
  }
  it("authorized save (RETURNING 1 row) → success toast + đúng payload", async () => {
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await typeRow("1–12", "1 vé");
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(h.lastUpdatePayload).toEqual({ satellite_payout: { rows: [{ label: "1–12", prize: "1 vé" }] } });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("zero-row RLS-filtered save (data=[], no error) → error toast, KHÔNG success giả", async () => {
    h.updateRows = [];
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await typeRow("1–12", "1 vé");
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/Không có quyền lưu/);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("network/PostgREST error → error toast", async () => {
    h.updateError = { message: "fetch failed" };
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await typeRow("1", "1 vé");
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/fetch failed/);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("missing-column khi lưu → nhánh tương thích CSDL (banner + toast riêng), không phải lỗi chung", async () => {
    h.updateError = { message: "Could not find the 'satellite_payout' column of 'tournaments' in the schema cache" };
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await typeRow("1", "1 vé");
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/cập nhật CSDL satellite/);
    expect(await screen.findByText(/CSDL chưa có cột/)).toBeTruthy();
  });

  it("double-click Lưu → chỉ 1 lần update (saving disable)", async () => {
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await typeRow("1–12", "1 vé");
    const btn = screen.getByRole("button", { name: /Lưu/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(h.updateCalls).toBe(1);
  });
});

describe("SatellitePayoutEditor — load lifecycle", () => {
  it('old tournament save completion cannot reload its payout into a new tournament',async()=>{
    let finishSave!:(value:unknown)=>void;
    h.updateQueue=[()=>new Promise(resolve=>{finishSave=resolve;})];
    h.loadQueue=[
      ()=>Promise.resolve({data:{satellite_payout:null},error:null}),
      ()=>Promise.resolve({data:{satellite_payout:{rows:[{label:'B',prize:'B PRIZE'}]}},error:null}),
      ()=>Promise.resolve({data:{satellite_payout:{rows:[{label:'A',prize:'STALE A'}]}},error:null}),
    ];
    const view=render(<SatellitePayoutEditor tournamentId="t1"/>);
    await typeRow('A','A PRIZE');
    fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
    await act(async()=>{});
    view.rerender(<SatellitePayoutEditor tournamentId="t2"/>);
    await screen.findByDisplayValue('B PRIZE');
    await act(async()=>{finishSave({data:[{id:'t1'}],error:null});});
    expect(screen.queryByDisplayValue('STALE A')).toBeNull();
    expect(screen.getByDisplayValue('B PRIZE')).toBeTruthy();
    expect(h.updateCalls).toBe(1);
  });
  it('hung read times out, aborts HTTP signal and recovers only on manual read retry',async()=>{
    vi.useFakeTimers();
    h.loadQueue=[()=>new Promise(()=>{})];
    render(<SatellitePayoutEditor tournamentId="t1"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
    expect(screen.queryByText(/Hết thời gian tải cơ cấu satellite/)).not.toBeNull();
    expect(screen.queryByLabelText('Khoảng hạng dòng 1')).toBeNull();
    expect(h.readSignals[0]?.aborted).toBe(true);
    expect(h.updateCalls).toBe(0);
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));});
    expect(screen.getByLabelText('Khoảng hạng dòng 1')).toBeTruthy();
    expect(h.readSignals).toHaveLength(2);
    expect(h.readSignals[1].aborted).toBe(false);
  });

  it('unmount aborts the current read rather than leave it observing',()=>{
    h.loadQueue=[()=>new Promise(()=>{})];
    const view=render(<SatellitePayoutEditor tournamentId="t1"/>);
    const signal=h.readSignals[0];view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('a rejected read is surfaced and manual retry can recover',async()=>{
    h.loadQueue=[()=>Promise.reject(new Error('transport rejected'))];
    render(<SatellitePayoutEditor tournamentId="t1"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('transport rejected');
    expect(screen.queryByLabelText('Khoảng hạng dòng 1')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    await screen.findByLabelText('Khoảng hạng dòng 1');
    expect(h.updateCalls).toBe(0);
  });

  it('a missing tournament row is not an empty editable payout',async()=>{
    h.loadResult={data:null,error:null};
    render(<SatellitePayoutEditor tournamentId="t1"/>);
    await waitFor(()=>expect(screen.queryByText('Đang tải…')).toBeNull());
    expect(screen.queryByLabelText('Khoảng hạng dòng 1')).toBeNull();
    expect(screen.getByRole('button',{name:'Thử lại'})).toBeTruthy();
    expect(h.updateCalls).toBe(0);
  });

  it('StrictMode aborts the first read and rejects its late payload',async()=>{
    let first!:(value:unknown)=>void;
    h.loadQueue=[()=>new Promise(resolve=>{first=resolve;}),()=>Promise.resolve({data:{satellite_payout:{rows:[{label:'1–8',prize:'1 vé'}]}},error:null})];
    render(<StrictMode><SatellitePayoutEditor tournamentId="t1"/></StrictMode>);
    await screen.findByDisplayValue('1–8');
    expect(h.readSignals).toHaveLength(2);
    expect(h.readSignals[0].aborted).toBe(true);expect(h.readSignals[1].aborted).toBe(false);
    await act(async()=>{first({data:{satellite_payout:{rows:[{label:'99',prize:'STALE'}]}},error:null});});
    expect(screen.queryByDisplayValue('STALE')).toBeNull();
    expect(screen.getByDisplayValue('1–8')).toBeTruthy();
  });
  it("lỗi tải thật → ẨN editor, hiện Thử lại; retry thành công → dữ liệu thật hiện", async () => {
    h.loadResult = { data: null, error: { message: "boom network" } };
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await screen.findByText("boom network");
    // editor bị chặn: không có nút Lưu / input — tránh Lưu đè dữ liệu thật bằng bảng trống
    expect(screen.queryByRole("button", { name: /Lưu/ })).toBeNull();
    expect(screen.queryByLabelText("Khoảng hạng dòng 1")).toBeNull();
    // retry với dữ liệu thật
    h.loadResult = { data: { satellite_payout: { rows: [{ label: "1–5", prize: "1 vé" }] } }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByDisplayValue("1–5");
    expect(screen.queryByText("boom network")).toBeNull();
  });

  it("missing-column khi tải → banner tương thích, editor VẪN hiện (không phải lỗi chung)", async () => {
    h.loadResult = { data: null, error: { message: "column tournaments.satellite_payout does not exist" } };
    render(<SatellitePayoutEditor tournamentId="t1" />);
    await screen.findByText(/CSDL chưa có cột/);
    expect(screen.getByRole("button", { name: /Lưu/ })).toBeTruthy(); // editor mở (compat path)
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  it("stale response: request cũ về muộn KHÔNG ghi đè request mới (đổi giải)", async () => {
    let resolve1!: (v: any) => void;
    let resolve2!: (v: any) => void;
    h.loadQueue = [
      () => new Promise((res) => { resolve1 = res; }),
      () => new Promise((res) => { resolve2 = res; }),
    ];
    const { rerender } = render(<SatellitePayoutEditor tournamentId="t1" />);
    rerender(<SatellitePayoutEditor tournamentId="t2" />);
    // request MỚI (t2) về trước với dữ liệu đúng
    resolve2({ data: { satellite_payout: { rows: [{ label: "1–8", prize: "1 vé" }] } }, error: null });
    await screen.findByDisplayValue("1–8");
    // request CŨ (t1) về muộn — phải bị bỏ qua nhờ loadSeqRef
    resolve1({ data: { satellite_payout: { rows: [{ label: "99", prize: "STALE" }] } }, error: null });
    await waitFor(() => expect(screen.queryByDisplayValue("STALE")).toBeNull());
    expect(screen.getByDisplayValue("1–8")).toBeTruthy();
  });
});
