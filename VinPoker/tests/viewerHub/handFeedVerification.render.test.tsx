import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import { HandFeedCard } from '@/components/cashier/tournament-live/viewer-hub/HandFeedCard';
import type { HandFeedItem } from '@/components/cashier/tournament-live/viewer-hub/handFeedDerive';

const item: HandFeedItem = {
 handId:'h',handNumber:32,tableId:'t',createdAt:'2026-10-21T00:00:00Z',board:[],
 potChips:400,potBB:2,sidePotCount:0,bigBlind:200,tags:[],players:[],highHand:null,
};
for(const rpt of [false,true])it(`shows distinct proof read states without claiming pending/attention (rpt=${rpt})`,()=>{
 const unverified=renderToStaticMarkup(<HandFeedCard item={{...item,verificationStatus:'unverified'}} rpt={rpt}/>);
 const unavailable=renderToStaticMarkup(<HandFeedCard item={{...item,verificationStatus:'unavailable'}} rpt={rpt}/>);
 const verified=renderToStaticMarkup(<HandFeedCard item={{...item,verificationStatus:'verified'}} rpt={rpt}/>);
 expect(unverified).toContain('Chưa xác minh kết quả');
 expect(unavailable).toContain('Không tải được xác minh');
 expect(verified).toContain('Đã xác minh kết quả');
 expect(unavailable).not.toContain('Chưa xác minh kết quả');
 expect(unverified).not.toContain('Đang xử lý');
 expect(unverified).not.toContain('Cần xử lý');
});
