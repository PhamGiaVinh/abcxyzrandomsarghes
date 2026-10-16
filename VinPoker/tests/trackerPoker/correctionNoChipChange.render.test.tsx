import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{trackerAtomicResettle:true},isTrackerAtomicResettleAvailable:()=>true}));
import { ResettlePreview } from '@/components/cashier/tournament-live/HandHistoryWorkspace';
const result={ok:true as const,safeToWrite:true as const,targetWinnerIds:['BB'],changes:[],finalStacks:[{player_id:'SB',chip_count:19900},{player_id:'BB',chip_count:20100}],changedPlayerIds:[],summary:'board-only TEST'};
const proof={sourceRevision:9,sourceChainHash:'a'.repeat(64),outcomeHash:'b'.repeat(64),requestHash:'c'.repeat(64),actorId:'81100000-0000-4000-8000-000000000001',scope:'latest_completed_hand_only'};
const players=[{player_id:'SB',display_name:'TEST SB',ending_stack:19900},{player_id:'BB',display_name:'TEST BB',ending_stack:20100}];
afterEach(cleanup);
describe('board/card correction without chip delta',()=>{
 it('allows atomic confirmation only with a server preview despite no chip change',()=>{
  const confirm=vi.fn();render(<ResettlePreview view={{result,targetHandId:'hand',serverPreview:proof}} busy={false} players={players} onConfirm={confirm} onClose={vi.fn()}/>);
  const button=screen.getByRole('button',{name:/Xác nhận/});expect(button).toBeEnabled();fireEvent.click(button);expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/dùng “Chỉ lưu hiển thị”/)).not.toBeInTheDocument();
 });
 it('does not revive a display-only legacy write when server proof is absent',()=>{
  render(<ResettlePreview view={{result,targetHandId:'hand'}} busy={false} players={players} onConfirm={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole('button',{name:/Xác nhận/})).toBeDisabled();
 });
 it('does not confirm while a commit is in flight',()=>{
  render(<ResettlePreview view={{result,targetHandId:'hand',serverPreview:proof}} busy players={players} onConfirm={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Đang áp dụng…'})).toBeDisabled();
 });
 it('keeps unknown commit blocked while receipt recovery remains available in the parent',()=>{
  render(<ResettlePreview view={{result,targetHandId:'hand',serverPreview:proof}} confirmationBlocked busy={false} players={players} onConfirm={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Xác nhận sửa hand'})).toBeDisabled();
 });
 it.each([{sourceRevision:0},{requestHash:''},{sourceChainHash:'invalid'},{outcomeHash:''},{actorId:'unbound'}])('does not accept malformed preview metadata %j',patch=>{
  render(<ResettlePreview view={{result,targetHandId:'hand',serverPreview:{...proof,...patch}}} busy={false} players={players} onConfirm={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole('button',{name:/Xác nhận/})).toBeDisabled();
 });
 it('retains observed-stack mismatch blocking even with a valid server preview',()=>{
  render(<ResettlePreview view={{result,targetHandId:'hand',serverPreview:proof,expectedEndingStacks:[{player_id:'SB',entry_number:1,ending_stack:19000},{player_id:'BB',entry_number:1,ending_stack:21000}]}} busy={false} players={players} onConfirm={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole('button',{name:/Xác nhận/})).toBeDisabled();
 });
});
