import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({from:vi.fn(),success:vi.fn(),error:vi.fn(),session:{access_token:'LOCAL_A'}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:h.from}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'e5220000-0000-4000-8000-000000000001'},session:h.session})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(s:string)=>s})}));
vi.mock('sonner',()=>({toast:{success:h.success,error:h.error}}));
import {TransferInstructions} from './TransferInstructions';
const props={purchaseId:'e5220000-0000-4000-8000-000000000002',dealId:'e5220000-0000-4000-8000-000000000003',
 amount:100000,reference:'LOCAL_ONLY',committedAt:new Date().toISOString(),initialProofUrl:'https://example.invalid/local-proof',
 escrowAccount:{bank_name:'TEST',account_number:'LOCAL_ONLY',account_holder:'TEST',qr_code_url:null,notes:null}};
beforeEach(()=>{
 vi.clearAllMocks();h.session={access_token:'LOCAL_A'};vi.spyOn(window,'confirm').mockReturnValue(true);
 h.from.mockImplementation(()=>{const q={update:()=>q,eq:()=>q,select:()=>q,
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;});
});
it('does not claim proof submission when the update matched no purchase',async()=>{
 const done=vi.fn();render(<TransferInstructions {...props} onMarkedTransferred={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'transferInstructions.transferred'}));
 await waitFor(()=>expect(h.from).toHaveBeenCalled());
 expect(done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(h.error).toHaveBeenCalled();
});
it('does not claim cancellation when the update matched no purchase',async()=>{
 const done=vi.fn();render(<TransferInstructions {...props} onCancel={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'transferInstructions.cancelTransaction'}));
 await waitFor(()=>expect(h.from).toHaveBeenCalled());
 expect(done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(h.error).toHaveBeenCalled();
});
it('accepts only the matching proof acknowledgement and fences double clicks',async()=>{
 const done=vi.fn();let resolve!:(v:unknown)=>void;
 h.from.mockImplementation(()=>{const q={update:()=>q,eq:()=>q,select:()=>q,
 then:(next:(v:unknown)=>unknown)=>new Promise(r=>{resolve=r;}).then(next)};return q;});
 render(<TransferInstructions {...props} onMarkedTransferred={done}/>);
 const button=screen.getByRole('button',{name:'transferInstructions.transferred'});
 fireEvent.click(button);fireEvent.click(button);expect(h.from).toHaveBeenCalledTimes(1);
 await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 resolve({data:[{id:props.purchaseId,status:'committed',transfer_proof_submitted:true}],error:null});
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));expect(h.success).toHaveBeenCalledTimes(1);
});
it('does not treat a different purchase acknowledgement as success',async()=>{
 const done=vi.fn();h.from.mockImplementation(()=>{const q={update:()=>q,eq:()=>q,select:()=>q,
 then:(next:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:props.dealId,status:'cancelled'}],error:null}).then(next)};return q;});
 render(<TransferInstructions {...props} onCancel={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'transferInstructions.cancelTransaction'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it('recovers its busy state after a transport exception without claiming success',async()=>{
 h.from.mockImplementation(()=>{throw new Error('LOCAL network unavailable');});
 render(<TransferInstructions {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'transferInstructions.transferred'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());
 expect(screen.getByRole('button',{name:'transferInstructions.transferred'})).toBeEnabled();expect(h.success).not.toHaveBeenCalled();
});
it('discards an old proof acknowledgement after session replacement',async()=>{
 const done=vi.fn();let resolve!:(v:unknown)=>void;
 h.from.mockImplementation(()=>{const q={update:()=>q,eq:()=>q,select:()=>q,
 then:(next:(v:unknown)=>unknown)=>new Promise(r=>{resolve=r;}).then(next)};return q;});
 const view=render(<TransferInstructions {...props} onMarkedTransferred={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'transferInstructions.transferred'}));
 await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 h.session={access_token:'LOCAL_B'};view.rerender(<TransferInstructions {...props} onMarkedTransferred={done}/>);
 await act(async()=>resolve({data:[{id:props.purchaseId,status:'committed',transfer_proof_submitted:true}],error:null}));
 expect(done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'transferInstructions.transferred'})).toBeEnabled();
});
it('does not carry an existing proof into another purchase',()=>{
 const view=render(<TransferInstructions {...props}/>);
 view.rerender(<TransferInstructions {...props} purchaseId="e5220000-0000-4000-8000-000000000004" initialProofUrl={null}/>);
 expect(screen.getByRole('button',{name:'transferInstructions.needProof'})).toBeDisabled();
});
