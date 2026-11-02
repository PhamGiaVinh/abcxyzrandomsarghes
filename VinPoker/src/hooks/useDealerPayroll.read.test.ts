import {beforeEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook} from '@testing-library/react';
import {execFileSync} from 'node:child_process';
const state=vi.hoisted(()=>({period:vi.fn(),records:vi.fn(),tables:vi.fn(),rpc:vi.fn(),select:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:state.rpc,from:(table:string)=>{
  state.tables(table);const q={select:(columns:string)=>{state.select(columns);return q;},eq:()=>q,maybeSingle:state.period,then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(state.records()).then(resolve,reject)};return q;
}}}));
import {getSavedPayroll,useDealerPayroll,loadPayrollAdjustments,getPaymentRecord,savePayroll,submitPayroll,approvePayroll,lockPayroll,rejectPayroll,resubmitPayroll,markPaid,reconcilePayment,preparePayment} from './useDealerPayroll';
beforeEach(()=>{vi.clearAllMocks();state.period.mockResolvedValue({data:null,error:null});state.records.mockResolvedValue({data:[],error:null});});
describe('saved payroll read integrity',()=>{
  it.skipIf(process.env.VINPOKER_NATIVE_DB_TEST!=='1')('accepts actual authenticated Main167 calculation rows without replacing their amounts',async()=>{
    const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
    const sql=(input:string)=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
    expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();")).toBe('vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
    const packet=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
      SELECT public.calculate_club_payroll('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','2026-10-01','2026-10-31');ROLLBACK;`));
    state.rpc.mockResolvedValue({data:packet,error:null});
    const view=renderHook(()=>useDealerPayroll(['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760']));
    await act(async()=>{await view.result.current.fetchPayroll('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','2026-10-01','2026-10-31');});
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.data).toHaveLength(5);
    for(const row of view.result.current.data)expect(row).toEqual(packet.dealers[row.dealer_id]);
    view.unmount();
  });
  const savedRow={id:'saved',dealer_id:'dealer',club_id:'club',period_id:'period',employment_type:'part_time',status:'pending',calculated_at:null,
   monthly_salary_vnd:0,hourly_rate_vnd:0,ot_multiplier:1.5,total_shifts:0,total_hours:0,regular_hours:0,ot_hours:0,
   base_salary_vnd:0,regular_pay_vnd:0,ot_pay_vnd:0,gross_pay_vnd:0,total_adjustments_vnd:0,tips_amount_vnd:0,
   bhxh_deduction_vnd:0,bhyt_deduction_vnd:0,bhtn_deduction_vnd:0,pit_deduction_vnd:0,net_pay_vnd:0,net_pay_after_tax_vnd:0};
  const calculatedRow={...savedRow,full_name:'TEST dealer',standard_hours_per_shift:8,standard_shifts_per_month:26,shifts:[]};
  it('accepts the native saved-period calculation variant without inventing a monthly shift denominator',async()=>{
    const {standard_shifts_per_month:omitted,...snapshot}=calculatedRow;
    state.rpc.mockResolvedValue({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',dealers:{dealer:snapshot}},error:null});
    const view=renderHook(()=>useDealerPayroll(['club']));
    await act(async()=>{await view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
    expect(view.result.current.error).toBeNull();expect(view.result.current.data).toEqual([snapshot]);
    expect(view.result.current.data[0].standard_shifts_per_month).toBeUndefined();view.unmount();
  });
  it.each([null,NaN,Infinity,'0'])('rejects invalid calculated dealer money instead of publishing a payable row: %s',async(value)=>{
    state.rpc.mockResolvedValue({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',
      dealers:{dealer:{...calculatedRow,net_pay_vnd:value}}},error:null});
    const view=renderHook(()=>useDealerPayroll(['club']));
    await act(async()=>{await view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
    expect(view.result.current.error).not.toBeNull();expect(view.result.current.data).toEqual([]);view.unmount();
  });
  it.each([
    {dealer:{error:'unexpected backend failure'}},
    {dealer:{...calculatedRow,dealer_id:'different-dealer'}},
    {dealer:{...calculatedRow,standard_hours_per_shift:null}},
  ])('rejects unverified calculated dealer identities or partial failures',async(dealers)=>{
    state.rpc.mockResolvedValue({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',dealers},error:null});
    const view=renderHook(()=>useDealerPayroll(['club']));
    await act(async()=>{await view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
    expect(view.result.current.error).not.toBeNull();expect(view.result.current.data).toEqual([]);view.unmount();
  });
  it('preserves explicit zero calculated pay and the canonical inactive-dealer omission',async()=>{
    state.rpc.mockResolvedValue({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',
      dealers:{dealer:calculatedRow,inactive:{error:'dealer not found or inactive'}}},error:null});
    const view=renderHook(()=>useDealerPayroll(['club']));
    await act(async()=>{await view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
    expect(view.result.current.error).toBeNull();expect(view.result.current.data).toEqual([calculatedRow]);view.unmount();
  });
  it.each([null,{},[null]])('rejects unavailable/malformed saved rows rather than converting them to an empty snapshot',async(data)=>{
   state.period.mockResolvedValue({data:{id:'period',status:'approved'},error:null});state.records.mockResolvedValue({data,error:null});
   await expect(getSavedPayroll('club',2026,10)).rejects.toThrow();
  });
  it.each([null,NaN,Infinity,'0'])('rejects unknown or invalid saved money instead of treating it as zero',async(value)=>{
   state.period.mockResolvedValue({data:{id:'period',status:'approved'},error:null});
   state.records.mockResolvedValue({data:[{...savedRow,net_pay_vnd:value}],error:null});
   await expect(getSavedPayroll('club',2026,10)).rejects.toThrow();
  });
  it('retains a verified explicit zero-valued saved row',async()=>{
   state.period.mockResolvedValue({data:{id:'period',status:'approved'},error:null});state.records.mockResolvedValue({data:[savedRow],error:null});
   expect((await getSavedPayroll('club',2026,10)).records).toEqual([savedRow]);
  });
  it.each([
    [{...savedRow,club_id:'other'}],
    [{...savedRow,period_id:'other'}],
    [{...savedRow,id:''}],
    [{...savedRow,dealer_id:''}],
    [savedRow,{...savedRow,dealer_id:'second'}],
    [savedRow,{...savedRow,id:'second'}],
  ])('rejects cross-scope or duplicate saved snapshot identities',async(...rows)=>{
   state.period.mockResolvedValue({data:{id:'period',status:'approved'},error:null});state.records.mockResolvedValue({data:rows,error:null});
   await expect(getSavedPayroll('club',2026,10)).rejects.toThrow();
  });
  it.each([null,{},'',true,'not-a-payment-id'])('rejects a malformed payment preparation receipt',async(data)=>{
    state.rpc.mockResolvedValue({data,error:null});
    await expect(preparePayment('period','bank_transfer')).rejects.toThrow('Chưa xác minh');
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts the canonical payment UUID without another mutation',async()=>{
    const payment='2236ec97-2f12-402f-8912-025d238d5618';
    state.rpc.mockResolvedValue({data:payment,error:null});
    expect(await preparePayment('period','bank_transfer')).toBe(payment);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts explicit true as the canonical transition confirmation',async()=>{
    state.rpc.mockResolvedValue({data:true,error:null});expect(await submitPayroll('period')).toBe(true);
  });
  it.each([null,{},'true',1])('rejects non-boolean transition confirmations',async(data)=>{
    state.rpc.mockResolvedValue({data,error:null});await expect(submitPayroll('period')).rejects.toThrow('Trạng thái kỳ lương');
  });
  it.each([
    ['submit',()=>submitPayroll('period')],['approve',()=>approvePayroll('period')],['lock',()=>lockPayroll('period')],
    ['reject',()=>rejectPayroll('period','TEST reason')],['resubmit',()=>resubmitPayroll('period')],
    ['mark paid',()=>markPaid('period','LOCAL_TEST_REFERENCE')],['reconcile',()=>reconcilePayment('period')],
  ] as const)('does not report %s success when the server rejects its compare-and-swap',async(_label,call)=>{
    state.rpc.mockResolvedValue({data:false,error:null});
    await expect(call()).rejects.toThrow('Trạng thái kỳ lương');expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts the canonical UUID save result without retrying',async()=>{
    const period='2236ec97-2f12-402f-8912-025d238d5618';state.rpc.mockResolvedValue({data:period,error:null});
    expect(await savePayroll('club',2026,10,[])).toEqual({periodId:period,savedCount:0});
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null,{},'',true])('does not accept a malformed save receipt as success',async(data)=>{
    state.rpc.mockResolvedValue({data,error:null});
    await expect(savePayroll('club',2026,10,[])).rejects.toThrow('Chưa xác minh');
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['period','payment','adjustments'])('bounds a hung %s read without returning a false empty result',async(kind)=>{
    vi.useFakeTimers();let resolve!:(value:unknown)=>void;let failure:unknown;
    const source=kind==='adjustments'?state.records:state.period;
    source.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const pending=(kind==='period'?getSavedPayroll('club',2026,10):kind==='payment'?getPaymentRecord('period'):loadPayrollAdjustments('period'))
      .catch(error=>{failure=error;});
    try {
      await vi.advanceTimersByTimeAsync(20001);
      expect(failure).toBeInstanceOf(Error);expect((failure as Error).message).toContain('Quá thời gian');
    } finally {resolve({data:null,error:null});await pending;vi.useRealTimers();}
  });
  it('bounds a hung calculation and ignores its late success',async()=>{
    vi.useFakeTimers();let resolve!:(value:unknown)=>void;let pending!:Promise<void>;
    state.rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const view=renderHook(()=>useDealerPayroll(['club']));
    try {
      act(()=>{pending=view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
      await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
      expect(view.result.current.loading).toBe(false);expect(view.result.current.error).not.toBeNull();
      await act(async()=>{resolve({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',dealers:{}},error:null});await pending;});
      expect(view.result.current.period).toEqual({start:'',end:''});
    } finally {
      await act(async()=>{resolve({data:{club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',dealers:{}},error:null});await pending;});
      view.unmount();vi.useRealTimers();
    }
  });
  it.each([
    {club_id:'other',period_start:'2026-10-01',period_end:'2026-10-31',dealers:{}},
    {club_id:'club',period_start:'2026-09-01',period_end:'2026-09-30',dealers:{}},
    {club_id:'club',period_start:'2026-10-01',period_end:'2026-10-31',dealers:[]},
  ])('rejects an invalid calculation scope/shape instead of accepting an empty payroll',async(data)=>{
    state.rpc.mockResolvedValue({data,error:null});const view=renderHook(()=>useDealerPayroll(['club']));
    await act(async()=>{await view.result.current.fetchPayroll('club','2026-10-01','2026-10-31');});
    expect(view.result.current.error).not.toBeNull();expect(view.result.current.data).toEqual([]);view.unmount();
  });
  it('selects adjustments through the verified payroll foreign key',async()=>{
    state.records.mockResolvedValue({data:[{dealer_id:'dealer',payroll_adjustments:[{id:'adj',amount_vnd:100}]}],error:null});
    expect(await loadPayrollAdjustments('period')).toEqual({dealer:[{id:'adj',amount_vnd:100}]});
    expect(state.select).toHaveBeenCalledWith('id, dealer_id, payroll_adjustments!payroll_adjustments_payroll_id_fkey(*)');
  });
  it('does not let a late old-club calculation overwrite a newer period',async()=>{
    let resolveOld!:(value:unknown)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise(done=>{resolveOld=done;}));
    state.rpc.mockResolvedValueOnce({data:{club_id:'b',period_start:'2026-10-01',period_end:'2026-10-31',dealers:{}},error:null});
    const view=renderHook(()=>useDealerPayroll(['a','b']));let old!:Promise<void>;
    act(()=>{old=view.result.current.fetchPayroll('a','2026-09-01','2026-09-30');});
    await act(async()=>{await view.result.current.fetchPayroll('b','2026-10-01','2026-10-31');});
    await act(async()=>{resolveOld({data:{club_id:'a',period_start:'2026-09-01',period_end:'2026-09-30',dealers:{}},error:null});await old;});
    expect(view.result.current.period).toEqual({start:'2026-10-01',end:'2026-10-31'});
    expect(view.result.current.error).toBeNull();view.unmount();
  });
  it('does not turn a failed period read into a new editable payroll period',async()=>{
    state.period.mockResolvedValue({data:null,error:{message:'LOCAL 503'}});
    await expect(getSavedPayroll('club',2026,10)).rejects.toMatchObject({message:'LOCAL 503'});
    expect(state.tables.mock.calls).toEqual([['payroll_periods']]);
  });
  it('returns absent only when the period lookup successfully confirms absence',async()=>{
    expect(await getSavedPayroll('club',2026,10)).toMatchObject({periodId:null,status:null,records:[]});
  });
  it('preserves the finalized state instead of synthesizing draft',async()=>{
    state.period.mockResolvedValue({data:{id:'period',status:'paid'},error:null});
    expect(await getSavedPayroll('club',2026,10)).toMatchObject({periodId:'period',status:'paid',records:[]});
  });
});
