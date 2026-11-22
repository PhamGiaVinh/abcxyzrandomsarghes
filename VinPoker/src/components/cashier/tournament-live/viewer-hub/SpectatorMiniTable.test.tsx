import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SpectatorMiniTable} from './SpectatorMiniTable';
import type {PublicTableSnapshot} from './publicSnapshotTypes';

const table:PublicTableSnapshot={tableId:'table',tableSessionId:'session',name:'TEST',handId:null,handNumber:null,
 buttonSeat:null,street:null,board:null,pot:null,smallBlind:100,bigBlind:200,players:[],trackerState:'waiting'};

describe('public mini table verified empty-state copy',()=>{
 it('does not infer that no hand has ever been played from a waiting projection',()=>{
  const html=renderToStaticMarkup(<SpectatorMiniTable table={table}/>);
  expect(html).toContain('Đang chờ ván bài');
  expect(html).not.toContain('Đang chờ ván đầu');
 });
 it.each([{state:'inactive',label:'Bàn chưa hoạt động'},{state:'closed',label:'Phiên bàn đã đóng'}] as const)(
  'keeps $state distinct from waiting',({state,label})=>{
   const html=renderToStaticMarkup(<SpectatorMiniTable table={{...table,trackerState:state}}/>);
   expect(html).toContain(label);expect(html).not.toContain('Đang chờ ván bài');
  });
});

it('uses Cát khói for standard tables and keeps explicit tournament colors', () => {
  expect(renderToStaticMarkup(<SpectatorMiniTable table={table} />)).toContain('data-cat-khoi="true"');
  const custom = renderToStaticMarkup(<SpectatorMiniTable table={table}
    appearance={{ feltColor: '#521b23', railColor: '#a68b4c', logoUrl: null }} />);
  expect(custom).toContain('spectator-mini-surface');
  expect(custom).not.toContain('data-cat-khoi');
});
