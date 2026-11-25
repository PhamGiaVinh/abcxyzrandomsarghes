import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ClubBankAccountManager} from './ClubBankAccountManager';
type Reply={data:unknown;error:unknown};
type QueryMock={select:(...args:unknown[])=>QueryMock;eq:(key:string,value:string)=>QueryMock;
 order:(...args:unknown[])=>QueryMock;limit:(...args:unknown[])=>QueryMock;
 update:(payload:Record<string,unknown>)=>QueryMock;insert:(payload:Record<string,unknown>)=>QueryMock;
 maybeSingle:()=>Promise<Reply>;then:Promise<Reply>['then']};
const state=vi.hoisted(()=>({
 auth:{user:{id:'synthetic-owner'},session:{access_token:'synthetic-one'},loading:false},
 reads:[] as Array<Promise<Reply>>,writes:[] as Array<{mode:string;payload:Record<string,unknown>;where:Record<string,string>}>,nextWrite:null as Promise<Reply>|null,
 success:vi.fn(),error:vi.fn(),compress:vi.fn(),upload:vi.fn(),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>state.auth}));
vi.mock('sonner',()=>({toast:{success:(...a:unknown[])=>state.success(...a),error:(...a:unknown[])=>state.error(...a)}}));
vi.mock('@/lib/compressImage',()=>({compressImage:(...a:unknown[])=>state.compress(...a)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:()=>{
  let mode='read',payload:Record<string,unknown>={};const where:Record<string,string>={};
  const perform=()=>{
   if(mode==='read')return state.reads.shift()??Promise.resolve({data:null,error:null});
   state.writes.push({mode,payload,where:{...where}});
   return state.nextWrite??Promise.resolve({data:{id:where.id??payload.id??'18000000-0000-4000-8000-000000000099',club_id:where.club_id??payload.club_id,account_type:'escrow'},error:null});
  };
  const builder:QueryMock={select:()=>builder,eq:(k:string,v:string)=>{where[k]=v;return builder;},order:()=>builder,limit:()=>builder,
   update:(p:Record<string,unknown>)=>{mode='update';payload=p;return builder;},insert:(p:Record<string,unknown>)=>{mode='insert';payload=p;return builder;},
   maybeSingle:()=>perform(),then:(resolve,reject)=>perform().then(resolve,reject)};
  return builder;
 },storage:{from:()=>({upload:(...a:unknown[])=>state.upload(...a),getPublicUrl:()=>({data:{publicUrl:'https://example.test/old-qr.png'}})})},
}}));
const a='18000000-0000-4000-8000-000000000001',b='18000000-0000-4000-8000-000000000002';
const row=(club=a,number='111111111')=>({id:club===a?'18000000-0000-4000-8000-000000000051':'18000000-0000-4000-8000-000000000052',club_id:club,
 bank_name:'TEST Bank',bank_bin:'970436',account_number:number,account_holder:'TEST owner',qr_code_url:null,notes:null,is_active:true,account_type:'escrow'});
const response=(data:unknown):Reply=>({data,error:null});
function deferred<T=Reply>(){let resolve!:(r:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>{sessionStorage.clear();state.auth={user:{id:'synthetic-owner'},session:{access_token:'synthetic-one'},loading:false};state.reads=[];state.writes=[];state.nextWrite=null;vi.clearAllMocks();});
afterEach(cleanup);
describe('CLB-scoped receiving bank configuration',()=>{
 it('ignores a late account from the previous club',async()=>{
  const old=deferred();state.reads=[old.promise,Promise.resolve(response(row(b,'222222222')))];
  const view=render(<ClubBankAccountManager clubId={a}/>);view.rerender(<ClubBankAccountManager clubId={b}/>);
  await screen.findByDisplayValue('222222222');await act(async()=>old.resolve(response(row())));
  expect(screen.queryByDisplayValue('111111111')).toBeNull();expect(screen.getByDisplayValue('222222222')).toBeTruthy();
 });
 it('fails closed on read errors instead of offering to create another account',async()=>{
  state.reads=[Promise.resolve({data:null,error:{message:'denied'}})];render(<ClubBankAccountManager clubId={a}/>);
  await screen.findByRole('alert');expect(screen.queryByRole('button',{name:/^Lưu$/})).toBeNull();
 });
 it('rejects an account packet belonging to another club',async()=>{
  state.reads=[Promise.resolve(response(row(a)))];render(<ClubBankAccountManager clubId={b}/>);
  await screen.findByRole('alert');expect(screen.queryByDisplayValue('111111111')).toBeNull();
 });
 it('updates the verified account in its club, atomically including its bank BIN',async()=>{
  state.reads=[Promise.resolve(response(row())),Promise.resolve(response(row()))];render(<ClubBankAccountManager clubId={a}/>);
  await screen.findByDisplayValue('111111111');fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));
  await waitFor(()=>expect(state.success).toHaveBeenCalled());expect(state.writes).toHaveLength(1);
  expect(state.writes[0].where).toEqual({id:row().id,club_id:a,account_type:'escrow'});
  expect(state.writes[0].payload).not.toHaveProperty('club_id');expect(state.writes[0].payload.bank_bin).toBe('970436');
 });
 it('does not report success when the update returns no verified row',async()=>{
  state.reads=[Promise.resolve(response(row()))];state.nextWrite=Promise.resolve(response(null));render(<ClubBankAccountManager clubId={a}/>);
  await screen.findByDisplayValue('111111111');fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));
  await waitFor(()=>expect(state.error).toHaveBeenCalled());expect(state.success).not.toHaveBeenCalled();
 });
 it('does not publish an old save acknowledgement into the new club',async()=>{
  const pending=deferred();state.nextWrite=pending.promise;state.reads=[Promise.resolve(response(row())),Promise.resolve(response(row(b,'222222222')))];
  const view=render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('111111111');fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));
  view.rerender(<ClubBankAccountManager clubId={b}/>);await screen.findByDisplayValue('222222222');
  await act(async()=>pending.resolve(response({id:row().id,club_id:a,account_type:'escrow'})));
  expect(state.success).not.toHaveBeenCalled();expect(screen.getByDisplayValue('222222222')).toBeTruthy();expect(state.writes).toHaveLength(1);
 });
 it('fences old reads after the authenticated session changes',async()=>{
  const old=deferred();state.reads=[old.promise,Promise.resolve(response(row(a,'333333333')))];
  const view=render(<ClubBankAccountManager clubId={a}/>);state.auth={...state.auth,session:{access_token:'synthetic-two'}};
  view.rerender(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('333333333');await act(async()=>old.resolve(response(row())));
  expect(screen.queryByDisplayValue('111111111')).toBeNull();
 });
 it('stops an old QR compression before uploading after a club switch',async()=>{
  const compressed=deferred<File>();state.compress.mockReturnValue(compressed.promise);state.upload.mockResolvedValue({error:null});
  state.reads=[Promise.resolve(response(row())),Promise.resolve(response(row(b,'222222222')))];
  const view=render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('111111111');
  const input=view.container.querySelector('input[type=file]')!;fireEvent.change(input,{target:{files:[new File(['test'],'qr.png',{type:'image/png'})]}});
  view.rerender(<ClubBankAccountManager clubId={b}/>);await screen.findByDisplayValue('222222222');
  await act(async()=>compressed.resolve(new File(['compressed'],'qr.png',{type:'image/png'})));
  expect(state.upload).not.toHaveBeenCalled();
 });
});

async function fillNewAccount(){
 await screen.findByLabelText('Số tài khoản *');
 fireEvent.change(screen.getByLabelText('Tên ngân hàng'),{target:{value:'TEST new bank'}});
 fireEvent.change(screen.getByLabelText('Số tài khoản *'),{target:{value:'123456789'}});
 fireEvent.change(screen.getByLabelText('Chủ tài khoản *'),{target:{value:'TEST new owner'}});
}
it('restores the same create intent after an unknown outcome and remount, rather than making another account',async()=>{
 state.nextWrite=Promise.resolve({data:null,error:Error('lost acknowledgement')});
 const view=render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await screen.findByRole('alert');
 expect(state.writes).toHaveLength(1);expect(state.writes[0].payload.id).toMatch(/^[a-f0-9-]{36}$/);
 const originalId=state.writes[0].payload.id;view.unmount();
 render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('123456789');
 expect((screen.getByLabelText('Số tài khoản *') as HTMLInputElement).matches(':disabled')).toBe(true);
 state.nextWrite=Promise.resolve(response({id:originalId,club_id:a,account_type:'escrow'}));
 fireEvent.click(screen.getByRole('button',{name:'Thử lại cùng yêu cầu'}));await waitFor(()=>expect(state.writes).toHaveLength(2));
 expect(state.writes[1].payload).toEqual(state.writes[0].payload);
});
it('does not create when durable request storage is unavailable',async()=>{
 render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage unavailable');});
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await waitFor(()=>expect(state.error).toHaveBeenCalled());
 expect(state.writes).toHaveLength(0);vi.restoreAllMocks();
});
it('does not confirm a different returned account id for a create',async()=>{
 state.nextWrite=Promise.resolve(response({id:row().id,club_id:a,account_type:'escrow'}));
 render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await screen.findByRole('alert');expect(state.success).not.toHaveBeenCalled();
});

it('recovers only the exact committed create and clears its journal after remount',async()=>{
 state.nextWrite=Promise.resolve({data:null,error:Error('lost')});const view=render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await screen.findByRole('alert');
 const created=state.writes[0].payload;view.unmount();state.reads=[Promise.resolve(response(created))];
 render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('123456789');
 expect(sessionStorage.getItem('vinpoker:bank-create:v1:synthetic-owner:'+a)).toBeNull();expect(state.writes).toHaveLength(1);
});
it('refuses an id collision with different bank details instead of overwriting it',async()=>{
 state.nextWrite=Promise.resolve({data:null,error:Error('lost')});const view=render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await screen.findByRole('alert');
 const created=state.writes[0].payload;view.unmount();render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('123456789');
 state.nextWrite=Promise.resolve({data:null,error:{code:'23505'}});state.reads=[Promise.resolve(response({...created,account_number:'DIFFERENT'}))];
 fireEvent.click(screen.getByRole('button',{name:'Thử lại cùng yêu cầu'}));await screen.findByRole('alert');
 expect(state.success).not.toHaveBeenCalled();expect(state.writes.every(w=>w.mode==='insert')).toBe(true);
 expect(sessionStorage.getItem('vinpoker:bank-create:v1:synthetic-owner:'+a)).not.toBeNull();
});
it('recovers an exact duplicate-id INSERT without overwriting the committed row',async()=>{
 state.nextWrite=Promise.resolve({data:null,error:Error('lost')});const view=render(<ClubBankAccountManager clubId={a}/>);await fillNewAccount();
 fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));await screen.findByRole('alert');const created=state.writes[0].payload;
 view.unmount();render(<ClubBankAccountManager clubId={a}/>);await screen.findByDisplayValue('123456789');
 state.nextWrite=Promise.resolve({data:null,error:{code:'23505'}});state.reads=[Promise.resolve(response(created)),Promise.resolve(response(created))];
 fireEvent.click(screen.getByRole('button',{name:'Thử lại cùng yêu cầu'}));await waitFor(()=>expect(state.success).toHaveBeenCalledTimes(1));
 expect(state.writes).toHaveLength(2);expect(state.writes.every(w=>w.mode==='insert')).toBe(true);
 expect(sessionStorage.getItem('vinpoker:bank-create:v1:synthetic-owner:'+a)).toBeNull();
});
it('fails closed on a corrupt create journal without discarding its recovery identity',async()=>{
 const key='vinpoker:bank-create:v1:synthetic-owner:'+a;sessionStorage.setItem(key,'corrupt');
 render(<ClubBankAccountManager clubId={a}/>);await screen.findByRole('alert');
 expect(state.writes).toHaveLength(0);expect(sessionStorage.getItem(key)).toBe('corrupt');
});
