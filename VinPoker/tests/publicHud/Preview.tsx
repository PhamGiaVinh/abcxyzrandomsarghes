// Local-only browser harness, served explicitly by localServer.mjs; no app route.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '@/index.css';
import {PublicPlayerHud} from '@/components/tracker/PublicPlayerHud';
import {TvBroadcastBoard} from '@/components/tv/TvBroadcastBoard';
import {useMockTvData} from '@/lib/tv/mockTvData';
const query=new URLSearchParams(location.search);
function Preview(){
  const data=useMockTvData(true);
  const [player,setPlayer]=React.useState(query.get('p') ?? '24fe3ccd-fbe8-4311-9a83-cf12e596c5a1');
  if(query.get('scene')==='tv')return <><div className="fixed bottom-0 left-0 z-50 bg-black p-2 text-xs text-amber-300">LOCAL UI · DỮ LIỆU MINH HỌA</div><TvBroadcastBoard data={{...data,largestStack:423102,smallestStack:5850}}/></>;
  return <main className="min-h-screen bg-background p-6 text-foreground"><h1>Bản local · thử HUD công khai</h1><p className="mt-3">Dữ liệu được đọc bằng quyền anon; không thao tác tiền/chip.</p><button className="mt-4 rounded border p-3" onClick={()=>setPlayer('24fe3ccd-fbe8-4311-9a83-cf12e596c5a1')}>Mở TEST UAT 01</button><PublicPlayerHud tournamentId={query.get('t')??'12ea401a-9790-4c3f-8aed-818cd1d5eddd'} playerId={player} onClose={()=>setPlayer(null)}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
