import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandFeedItem } from './handFeedDerive';
const h=vi.hoisted(()=>({rpt:true,items:[] as HandFeedItem[],hasMore:true,loading:false,error:null as string|null,more:vi.fn(),reload:vi.fn()}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{get liveViewerRPTShell(){return h.rpt;},liveSpotlightPosts:true}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(_key:string,fallback:string)=>fallback})}));
vi.mock('./useCompletedHandsFeed',()=>({useCompletedHandsFeed:()=>({items:h.items,hasMore:h.hasMore,loading:h.loading,error:h.error,loadMore:h.more,reload:h.reload})}));
vi.mock('./HandFeedCard',()=>({HandFeedCard:({item}:{item:HandFeedItem})=><article>Hand #{item.handNumber}</article>}));
vi.mock('./TournamentPostCard',()=>({TournamentPostCard:()=>null}));
import { LiveHandFeed } from './LiveHandFeed';
beforeEach(()=>{
 vi.clearAllMocks();h.rpt=true;h.hasMore=true;h.loading=false;h.error=null;
 h.items=[{handId:'newest',handNumber:13,tableId:'table',createdAt:'2026-10-20T16:39:00Z',board:[],potChips:200,potBB:2,sidePotCount:0,bigBlind:100,tags:[],players:[],highHand:null}];
});
describe.each([true,false])('feed pagination with shell=%s',rpt=>{
 it('keeps the next page reachable when the search matches no loaded hand',()=>{
  h.rpt=rpt;render(<LiveHandFeed tournamentId="tour"/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'#2'}});
  expect(screen.queryByText('Chưa có ván nào hoàn tất')).not.toBeInTheDocument();
  const more=screen.getByRole('button',{name:'Xem thêm'});
  fireEvent.click(more);expect(h.more).toHaveBeenCalledOnce();
 });
 it('allows pagination when tag filtering removes every loaded item',()=>{
  h.rpt=rpt;h.items=[];render(<LiveHandFeed tournamentId="tour"/>);
  fireEvent.click(screen.getByRole('button',{name:'HIGH HAND'}));
  expect(screen.queryByText('Chưa có ván nào hoàn tất')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Xem thêm'})).toBeEnabled();
 });
 it('does not allow another load while loading or after a read error',()=>{
  h.rpt=rpt;h.loading=true;const view=render(<LiveHandFeed tournamentId="tour"/>);
  expect(screen.getByRole('button',{name:'Xem thêm'})).toBeDisabled();
  h.loading=false;h.error='unavailable';view.rerender(<LiveHandFeed tournamentId="tour"/>);
  expect(screen.queryByRole('button',{name:'Xem thêm'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Thử tải lại lịch sử'})).toBeEnabled();
 });
 it('keeps a genuine unfiltered empty history distinct',()=>{
  h.rpt=rpt;h.items=[];h.hasMore=false;render(<LiveHandFeed tournamentId="tour"/>);
  expect(screen.getByText('Chưa có ván nào hoàn tất')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Xem thêm'})).not.toBeInTheDocument();
 });
});
it('does not paginate hands when only news is selected',()=>{
 render(<LiveHandFeed tournamentId="tour"/>);
 fireEvent.click(screen.getByRole('button',{name:'Tin tức'}));
 expect(screen.queryByRole('button',{name:'Xem thêm'})).not.toBeInTheDocument();
});
