import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({from:vi.fn(),upload:vi.fn(),signed:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:h.from,storage:{from:()=>({upload:h.upload,createSignedUrl:h.signed})}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'e5230000-0000-4000-8000-000000000001'}})}));
vi.mock('@/lib/compressImage',()=>({compressImage:async(file:File)=>file}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
import {TransferInstructions} from './TransferInstructions';
const props={purchaseId:'e5230000-0000-4000-8000-000000000002',dealId:'e5230000-0000-4000-8000-000000000003',amount:100000,reference:'LOCAL_ONLY',
 escrowAccount:{bank_name:'TEST',account_number:'LOCAL_ONLY',account_holder:'TEST',qr_code_url:null,notes:null}};
beforeEach(()=>{vi.clearAllMocks();h.upload.mockResolvedValue({error:null});h.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/proof'},error:null});
 h.from.mockImplementation(()=>{const q={update:()=>q,eq:()=>q,select:()=>q,then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(fn)};return q;});});
async function choose(){const view=render(<TransferInstructions {...props}/>);const input=view.container.querySelector('input[type=file]')!;
 fireEvent.change(input,{target:{files:[new File(['LOCAL TEST'],'proof.png',{type:'image/png'})]}});
 await waitFor(()=>expect(h.upload).toHaveBeenCalled());return view;}
it('does not enable proof submission when purchase attachment matched zero rows',async()=>{await choose();
 await waitFor(()=>expect(h.from).toHaveBeenCalled());expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'transferInstructions.needProof'})).toBeDisabled();expect(h.error).toHaveBeenCalled();});
it('does not store a raw storage path as a URL after signing fails',async()=>{h.signed.mockResolvedValue({data:null,error:{message:'LOCAL signing failed'}});await choose();
 await waitFor(()=>expect(h.signed).toHaveBeenCalled());expect(h.from).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'transferInstructions.needProof'})).toBeDisabled();});
it('enables proof submission only after exact scoped attachment is acknowledged',async()=>{
 const filters:unknown[]=[];
 h.from.mockImplementation(()=>{const q={update:()=>q,eq:(key:string,value:string)=>{filters.push([key,value]);return q;},select:()=>q,
 then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:props.purchaseId,status:'committed',transfer_proof_url:'https://example.invalid/proof'}],error:null}).then(fn)};return q;});
 await choose();await waitFor(()=>expect(h.success).toHaveBeenCalledWith('transferInstructions.proofUploaded'));
 expect(filters).toEqual([['id',props.purchaseId],['deal_id',props.dealId],['backer_id','e5230000-0000-4000-8000-000000000001'],['status','committed']]);
 expect(screen.getByRole('button',{name:'transferInstructions.transferred'})).toBeEnabled();
});
it('does not attach a late upload after switching purchases',async()=>{
 let resolve!:(v:unknown)=>void;h.upload.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=await choose();view.rerender(<TransferInstructions {...props} purchaseId="e5230000-0000-4000-8000-000000000004"/>);
 await act(async()=>resolve({error:null}));
 expect(h.signed).not.toHaveBeenCalled();expect(h.from).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'transferInstructions.needProof'})).toBeDisabled();
});
