import { act,fireEvent,render, screen,waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyinReceiptSnapshot } from "@/components/tournament/seat/buyinReceipt";

const registration = vi.hoisted(() => ({
  bank_name: null as string | null,
  account_number: null as string | null,
  account_holder: null as string | null,
  transfer_proof_url: null as string | null,
}));
const cancel=vi.hoisted(()=>({update:vi.fn(),success:vi.fn(),error:vi.fn()}));
const storage=vi.hoisted(()=>({upload:vi.fn(),signed:vi.fn()}));
const auth=vi.hoisted(()=>({user:{id:'player-test'} as {id:string}|null,session:undefined as {access_token:string}|undefined}));
vi.mock('@/lib/compressImage',()=>({compressImage:vi.fn(async(file:File)=>file)}));
vi.mock('sonner',()=>({toast:{success:cancel.success,error:cancel.error}}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {storage:{from:()=>({upload:storage.upload,createSignedUrl:storage.signed})},from:()=>{const q={update:()=>q,eq:()=>q,select:()=>q,maybeSingle:()=>q,then:(resolve:(v:unknown)=>unknown,reject:(v:unknown)=>unknown)=>Promise.resolve(cancel.update()).then(resolve,reject)};return q;}, functions: { invoke: vi.fn(async () => ({
    data: {
      registration_id: "registration-test", reference_code: "VINREGTEST", total_pay: 6_600_000,
      breakdown: { buy_in: 6_000_000, club_fee: 600_000 }, status: "pending",
      bank_name: registration.bank_name, account_number: registration.account_number,
      account_holder: registration.account_holder, qr_code_url: null,
      transfer_proof_url: registration.transfer_proof_url,
    },
    error: null,
  })) } },
}));
vi.mock("@/components/tournament/seat/buyinReceipt", () => ({
  fetchBuyinReceipt: vi.fn(async () => null), toSeatReceiptData: vi.fn((receipt) => receipt),
}));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({
  SeatReceiptDialog: ({ receipt }: { receipt: BuyinReceiptSnapshot }) =>
    <div data-testid="confirmed-buyin-receipt">{receipt.receipt_code}</div>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/kokonutui/liquid-glass-card", () => ({
  LiquidGlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LiquidButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import { TournamentRegisterModal } from "./TournamentRegisterModal";
import { fetchBuyinReceipt } from "@/components/tournament/seat/buyinReceipt";
import { supabase } from "@/integrations/supabase/client";

describe("TournamentRegisterModal payment options", () => {
  afterEach(()=>{vi.useRealTimers();});
  it('shows an unknown bootstrap result rather than spinning forever after a thrown transport',async()=>{
    vi.mocked(supabase.functions.invoke).mockRejectedValueOnce(new Error('network failed'));
    const onClose=vi.fn();render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={onClose}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa xác minh được đăng ký/);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();
  });
  it.each([null,{}, {error:{message:'malformed'}}, {registration_id:'test',total_pay:-1}, {registration_id:'test',total_pay:NaN}])('does not render an unvalidated registration %j',async data=>{
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data,error:null});
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa xác minh được đăng ký/);
    expect(screen.queryByText('tournamentRegister.totalPay')).toBeNull();
  });
  it('bounds bootstrap without retry and ignores its late result',async()=>{
    vi.useFakeTimers();let finish!:(value:unknown)=>void;
    vi.mocked(supabase.functions.invoke).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}) as never);
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);});
    expect(screen.getByRole('alert')).toHaveTextContent(/Chưa xác minh được đăng ký/);
    await act(async()=>{finish({data:{},error:null});});
    expect(screen.getByRole('alert')).toHaveTextContent(/Chưa xác minh được đăng ký/);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{total_pay:-1},{total_pay:Infinity},{breakdown:{buy_in:NaN}},{bank_name:12},{reference_code:''}])('rejects malformed fields in an otherwise populated response %j',async patch=>{
    const data={registration_id:'registration-test',reference_code:'VINREGTEST',total_pay:115000,breakdown:{buy_in:100000,club_fee:10000,service_fee:5000},
      bank_name:null,account_number:null,account_holder:null,...patch};
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data,error:null});
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa xác minh được đăng ký/);
  });
  it('retains the supported historical unknown fee contract without inventing its breakdown',async()=>{
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:{registration_id:'registration-test',reference_code:'VINREGTEST',total_pay:115000,
      breakdown:{buy_in:100000,club_fee:null,service_fee:null,platform_fee:15000},bank_name:null,account_number:null,account_holder:null,
      savings:null,price_detail_available:false},error:null});
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    expect(await screen.findByText('tournamentRegister.historicPriceDetail')).toBeInTheDocument();
    expect(screen.getByText('115.000 ₫')).toBeInTheDocument();
  });
  it('does not let an old error-body read close a different tournament dialog',async()=>{
    let finish!:(value:unknown)=>void;const json=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:null,error:{message:'old error',context:{json}}} as never);
    const onClose=vi.fn();const view=render(<TournamentRegisterModal tournamentId="tour-a" tournamentName="Tour A" open onClose={onClose}/>);
    await waitFor(()=>expect(json).toHaveBeenCalledOnce());
    view.rerender(<TournamentRegisterModal tournamentId="tour-b" tournamentName="Tour B" open onClose={onClose}/>);
    await screen.findByText('tournamentRegister.totalPay');
    await act(async()=>{finish({error:'late old error'});});
    expect(onClose).not.toHaveBeenCalled();expect(cancel.error).not.toHaveBeenCalled();
    expect(screen.getByText('Tour B')).toBeInTheDocument();
  });
  it('invalidates a replaced session without automatically creating another registration',async()=>{
    let finish!:(value:unknown)=>void;auth.session={access_token:'LOCAL_TEST_A'};
    vi.mocked(supabase.functions.invoke).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}) as never);
    const props={tournamentId:'tour-test',tournamentName:'Tour A',open:true,onClose:vi.fn()};
    const view=render(<TournamentRegisterModal {...props}/>);
    auth.session={access_token:'LOCAL_TEST_B'};view.rerender(<TournamentRegisterModal {...props}/>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Phiên đăng nhập đã thay đổi/);
    await act(async()=>{finish({data:{},error:null});});
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/Phiên đăng nhập đã thay đổi/);
  });
  it('removes prior account payment details on logout without registering again',async()=>{
    const props={tournamentId:'tour-test',tournamentName:'Tour A',open:true,onClose:vi.fn()};
    const view=render(<TournamentRegisterModal {...props}/>);await screen.findByText('tournamentRegister.totalPay');
    auth.user=null;view.rerender(<TournamentRegisterModal {...props}/>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Chưa xác minh tài khoản/);
    expect(screen.queryByText('tournamentRegister.totalPay')).toBeNull();expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not render a stray zero for an undiscounted registration',async()=>{
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:{
      registration_id:'registration-test',reference_code:'VINREGTEST',total_pay:115000,
      breakdown:{buy_in:100000,club_fee:10000,service_fee:5000},status:'pending',
      bank_name:null,account_number:null,account_holder:null,savings:0,free_rake_applied:false,
    },error:null});
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    await screen.findByText('tournamentRegister.totalPay');
    expect(screen.queryByText('0',{exact:true})).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user={id:'player-test'};auth.session=undefined;
    registration.bank_name = null;
    registration.account_number = null;
    registration.account_holder = null;
    registration.transfer_proof_url = null;
    storage.upload.mockResolvedValue({error:null});storage.signed.mockResolvedValue({data:{signedUrl:'https://example.test/new-proof.jpg'},error:null});
    cancel.update.mockResolvedValue({data:null,error:null});vi.spyOn(window,'confirm').mockReturnValue(true);
  });

  it('does not claim uploaded proof is linked when the registration update returns no row',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    cancel.update.mockResolvedValue({data:null,error:null});
    const view=render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    await screen.findByRole('button',{name:'tournamentRegister.uploadProof'});
    const input=view.container.querySelector('input[type="file"]')!;
    fireEvent.change(input,{target:{files:[new File(['test'],'proof.jpg',{type:'image/jpeg'})]}});
    await waitFor(()=>expect(cancel.error).toHaveBeenCalledWith('tournamentRegister.proofUnverified'));
    expect(cancel.success).not.toHaveBeenCalled();expect(screen.queryByAltText('Tx')).not.toBeInTheDocument();
  });
  it('accepts only the exact linked proof and gates duplicate uploads',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    cancel.update.mockResolvedValue({data:{id:'registration-test',transfer_proof_image_url:'https://example.test/new-proof.jpg'},error:null});
    const view=render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    await screen.findByRole('button',{name:'tournamentRegister.uploadProof'});
    const input=view.container.querySelector('input[type="file"]')!,files=[new File(['test'],'proof.jpg',{type:'image/jpeg'})];
    await act(async()=>{fireEvent.change(input,{target:{files}});fireEvent.change(input,{target:{files}});});
    await waitFor(()=>expect(cancel.success).toHaveBeenCalledWith('tournamentRegister.proofUploaded'));
    expect(storage.upload).toHaveBeenCalledTimes(1);expect(cancel.update).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Tx')).toHaveAttribute('src','https://example.test/new-proof.jpg');
  });
  it('does not link or display a finished upload from a closed dialog',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    let finish!:(value:unknown)=>void;storage.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    await screen.findByRole('button',{name:'tournamentRegister.uploadProof'});
    fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['test'],'proof.jpg',{type:'image/jpeg'})]}});
    await waitFor(()=>expect(storage.upload).toHaveBeenCalledTimes(1));
    view.rerender(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open={false} onClose={vi.fn()}/>);
    await act(async()=>finish({error:null}));
    expect(storage.signed).not.toHaveBeenCalled();expect(cancel.update).not.toHaveBeenCalled();
    expect(cancel.success).not.toHaveBeenCalled();expect(cancel.error).not.toHaveBeenCalled();
  });

  it('does not acknowledge a transfer proof submission when no row was updated',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    registration.transfer_proof_url='https://example.test/proof.jpg';
    cancel.update.mockResolvedValue({data:null,error:null});const onCompleted=vi.fn();
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} onCompleted={onCompleted}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.transferred'}));
    await waitFor(()=>expect(cancel.error).toHaveBeenCalled());
    expect(cancel.success).not.toHaveBeenCalled();expect(onCompleted).not.toHaveBeenCalled();
  });
  it('acknowledges the exact submitted proof row once',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    registration.transfer_proof_url='https://example.test/proof.jpg';
    cancel.update.mockResolvedValue({data:{id:'registration-test',transfer_proof_submitted:true},error:null});const onCompleted=vi.fn();
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} onCompleted={onCompleted}/>);
    const button=await screen.findByRole('button',{name:'tournamentRegister.transferred'});
    await act(async()=>{fireEvent.click(button);fireEvent.click(button);});
    await waitFor(()=>expect(onCompleted).toHaveBeenCalledTimes(1));expect(cancel.update).toHaveBeenCalledTimes(1);
    expect(cancel.success).toHaveBeenCalledWith('tournamentRegister.markedToast');
  });
  it('contains a rejected proof submission without success',async()=>{
    registration.bank_name='TEST BANK';registration.account_number='999000001';registration.account_holder='TEST CLUB';
    registration.transfer_proof_url='https://example.test/proof.jpg';cancel.update.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.transferred'}));
    await waitFor(()=>expect(cancel.error).toHaveBeenCalledWith('tournamentRegister.proofUnverified'));expect(cancel.success).not.toHaveBeenCalled();
  });

  it.each([null,[],{id:'other',status:'cancelled'},{id:'registration-test',status:'confirmed'}])('does not claim cancellation from an unconfirmed update receipt (%j)',async data=>{
    cancel.update.mockResolvedValue({data,error:null});const onClose=vi.fn();
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={onClose}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.cancelReg'}));
    await waitFor(()=>expect(cancel.error).toHaveBeenCalled());
    expect(cancel.success).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
  });
  it('acknowledges only the exact cancelled registration returned by the update',async()=>{
    cancel.update.mockResolvedValue({data:{id:'registration-test',status:'cancelled'},error:null});const onClose=vi.fn();
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={onClose}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.cancelReg'}));
    await waitFor(()=>expect(cancel.success).toHaveBeenCalledWith('tournamentRegister.cancelled'));expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('synchronously gates two cancel clicks before the first update response',async()=>{
    let finish!:(value:unknown)=>void;cancel.update.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()}/>);
    const button=await screen.findByRole('button',{name:'tournamentRegister.cancelReg'});
    await act(async()=>{fireEvent.click(button);fireEvent.click(button);});expect(cancel.update).toHaveBeenCalledTimes(1);
    await act(async()=>finish({data:{id:'registration-test',status:'cancelled'},error:null}));
    expect(cancel.success).toHaveBeenCalledTimes(1);
  });
  it('contains a rejected cancellation response without claiming rollback or closing',async()=>{
    cancel.update.mockRejectedValue(new TypeError('Failed to fetch'));const onClose=vi.fn();
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={onClose}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.cancelReg'}));
    await waitFor(()=>expect(cancel.error).toHaveBeenCalledWith('tournamentRegister.cancelUnverified'));
    expect(onClose).not.toHaveBeenCalled();expect(cancel.success).not.toHaveBeenCalled();
  });
  it('ignores an old dialog cancellation completion after it closed',async()=>{
    let finish!:(value:unknown)=>void;cancel.update.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const onClose=vi.fn();
    const view=render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={onClose}/>);
    fireEvent.click(await screen.findByRole('button',{name:'tournamentRegister.cancelReg'}));await act(async()=>{});
    view.rerender(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open={false} onClose={onClose}/>);
    await act(async()=>finish({data:{id:'registration-test',status:'cancelled'},error:null}));
    expect(cancel.success).not.toHaveBeenCalled();expect(cancel.error).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
  });

  it("shows counter payment without inventing a bank transfer or QR", async () => {
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} />);
    expect(await screen.findByText("tournamentRegister.counterCashOnly")).toBeInTheDocument();
    expect(screen.getByText("VINREGTEST")).toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.transferInfo")).not.toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.proofTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.autoVerifyHint")).not.toBeInTheDocument();
  });

  it("keeps verified-bank instructions when the server supplies an account", async () => {
    registration.bank_name = "TEST BANK";
    registration.account_number = "999000001";
    registration.account_holder = "TEST CLUB";
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A" open onClose={vi.fn()} />);
    expect(await screen.findByText("tournamentRegister.transferInfo")).toBeInTheDocument();
    expect(screen.getByText("999000001")).toBeInTheDocument();
    expect(screen.getByText("tournamentRegister.autoVerifyHint")).toBeInTheDocument();
    expect(screen.queryByText("tournamentRegister.counterCashOnly")).not.toBeInTheDocument();
  });

  it("shows the server-confirmed receipt without registering or notifying twice", async () => {
    const onCompleted = vi.fn();
    vi.mocked(fetchBuyinReceipt).mockResolvedValueOnce({
      registration_id: "registration-test", receipt_code: "RECEIPT-TEST", qr_value: "RECEIPT-TEST",
      reference_code: "VINREGTEST", status: "confirmed", payment_state: "confirmed",
      club: { name: "CLB TEST", address: null, logo_url: null },
      player_name: "Người chơi TEST", tournament_name: "Tour A", total_pay: 6_600_000,
      completed_at: "2026-09-17T03:05:00Z", completed_at_source: "confirmed_at",
      table_number: 1, seat_number: 2, starting_stack: null,
    });
    render(<TournamentRegisterModal tournamentId="tour-test" tournamentName="Tour A"
      open onClose={vi.fn()} onCompleted={onCompleted} />);
    expect(await screen.findByTestId("confirmed-buyin-receipt")).toHaveTextContent("RECEIPT-TEST");
    expect(fetchBuyinReceipt).toHaveBeenCalledWith({ registrationId: "registration-test" });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
