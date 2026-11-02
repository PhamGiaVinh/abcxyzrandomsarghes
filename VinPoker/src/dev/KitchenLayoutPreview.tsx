import {KitchenTicket} from '@/components/fnb/KitchenTicket';
import type {FnbOrder} from '@/hooks/useFnbOrders';

// Visual-only fixture: never reopens a saved order or invokes a writer.
// The disabled native fieldset blocks mouse and keyboard mutation controls.
const sample:FnbOrder={id:'layout-only-order',club_id:'layout-only-club',status:'paid',source:'counter',
 table_label:'Bàn 7 · TEST bố cục màn hình bếp',customer_name:'Khách TEST giao diện',note:null,
 subtotal_vnd:0,cogs_vnd:0,created_at:'2026-10-21T00:00:00Z',paid_at:new Date(Date.now()-14*60_000).toISOString(),
 items:[{id:'layout-only-line-1',order_id:'layout-only-order',menu_item_id:'layout-only-menu-1',name_snapshot:'Nước ép trái cây TEST với tên món dài để kiểm tra xuống dòng trên màn hình nhỏ',qty:2,unit_price_snapshot:0,line_status:'paid'},
 {id:'layout-only-line-2',order_id:'layout-only-order',menu_item_id:'layout-only-menu-2',name_snapshot:'Món TEST đã hoàn tất',qty:1,unit_price_snapshot:0,line_status:'shipped'}]};
export default function KitchenLayoutPreview(){
 return <main className="mx-auto max-w-5xl space-y-4 p-3 text-foreground">
  <h1 className="text-lg font-bold">Bếp · TEST bố cục chỉ đọc</h1>
  <p className="text-sm text-muted-foreground">Fixture giao diện, không phải trạng thái đơn trong DB. Các nút bị vô hiệu hóa; không ghi đơn, tiền hay kho.</p>
  <fieldset disabled className="m-0 min-w-0 border-0 p-0"><KitchenTicket order={sample} onChanged={()=>{throw new Error('Read-only layout must never ship');}}/></fieldset>
 </main>;
}
