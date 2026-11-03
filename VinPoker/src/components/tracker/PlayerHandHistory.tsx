import type {PublicPlayerHand} from '@/lib/publicPlayerHud';
import {toCanonicalReplayTarget} from '@/components/cashier/tournament-live/viewer-hub/replayTarget';
import {formatChips} from '@/lib/tv/format';

function publicHandReplayHref(tournamentId:string,hand:PublicPlayerHand) {
  const query=toCanonicalReplayTarget({handId:hand.handId,tableId:hand.tableId,handNumber:null});
  query.set('tab','hands');
  return `/live/${encodeURIComponent(tournamentId)}?${query}`;
}
export function PlayerHandHistory({tournamentId,hands}:{tournamentId:string;hands:PublicPlayerHand[]}) {
  if(!hands.length) return <section className="rounded-lg border border-border p-4"><h3 className="font-semibold">Lịch sử hand & stack</h3><p className="mt-2 text-sm text-muted-foreground">Chưa có hand hoàn tất được công khai của người chơi trong giải này.</p></section>;
  const width=Math.max(480,hands.length*48+80);
  const maximum=Math.max(1,...hands.map(h=>h.endingStack??0));
  const x=(i:number)=>64+i*48;
  const y=(value:number)=>180-value/maximum*150;
  const toneAt=(i:number)=>{
    const previous=hands[i-1]?.endingStack,current=hands[i].endingStack;
    if(previous==null||current==null||previous===current)return 'text-yellow-400';
    return current>previous?'text-emerald-400':'text-red-400';
  };
  let connected=false;
  const path=hands.map((h,i)=>{if(h.endingStack===null){connected=false;return '';}const command=connected?'L':'M';connected=true;return `${command}${x(i)},${y(h.endingStack)}`;}).join(' ');
  return <section className="rounded-lg border border-border p-4" aria-label="Lịch sử hand của người chơi">
    <h3 className="font-semibold">Lịch sử hand & stack</h3>
    <p className="mt-2 text-xs text-muted-foreground">Bấm chấm trên đường stack hoặc một hand để mở replay. Mỗi chấm là stack cuối hand đã được xác minh; chỗ thiếu dữ liệu để trống. Chip không đổi tạo đoạn ngang; fold vẫn có thể mất chip đã đóng blind, ante hoặc cược.</p>
    <div className="mt-3 overflow-x-auto rounded-lg bg-background/50" tabIndex={0} aria-label="Cuộn biểu đồ stack theo hand">
      <div className="relative h-60" style={{width}}>
        <svg width={width} height="240" role="img" aria-label="Đường stack theo thứ tự các hand đã tham gia">
          {[0,maximum/2,maximum].map((v,i)=><g key={i}><line x1="56" x2={width-16} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border"/><text x="4" y={y(v)-5} fill="currentColor" className="text-muted-foreground" fontSize="11">{formatChips(v)}</text></g>)}
          <path d={path} fill="none" stroke="currentColor" className="text-border" strokeWidth="2"/>
          {hands.map((hand,i)=>hand.endingStack==null?null:<g key={hand.handId}>{i>0&&hands[i-1].endingStack!=null&&<line x1={x(i-1)} y1={y(hands[i-1].endingStack!)} x2={x(i)} y2={y(hand.endingStack)} stroke="currentColor" strokeWidth="2" className={toneAt(i)}/>}<text x={x(i)} y="215" textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize="11">#{hand.handNumber}</text></g>)}
        </svg>
        {hands.map((hand,i)=>{
          if(hand.endingStack===null) return null;
          const href=publicHandReplayHref(tournamentId,hand);
          const dot=<span aria-hidden="true" className={`h-3 w-3 rounded-full border-2 border-background bg-current group-hover:scale-125 group-focus-visible:scale-125 ${toneAt(i)}`}/>;
          return <a key={hand.handId} href={href} aria-label={`Replay hand #${hand.handNumber}, stack ${formatChips(hand.endingStack)}`} title={`Hand #${hand.handNumber} · ${formatChips(hand.endingStack)} chip`} className="group absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" style={{left:x(i),top:y(hand.endingStack)}}>{dot}</a>;
        })}
      </div>
    </div>
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Chú giải biến động stack"><span className="text-emerald-400">↗ Tăng chip</span><span className="text-red-400">↘ Giảm chip</span><span className="text-yellow-400">→ Không đổi / điểm đầu</span></p>
    <ol className="mt-3 max-h-64 divide-y divide-border overflow-y-auto">{[...hands].reverse().map(hand=>{
      const href=publicHandReplayHref(tournamentId,hand);
      const content=<><span><span className="font-semibold">Hand #{hand.handNumber}</span><span className="mt-1 block text-xs text-muted-foreground">{hand.playedAt ? new Date(hand.playedAt).toLocaleString('vi-VN') : 'Chưa có thời điểm'}</span></span><span className="text-right font-mono text-xs"><span className={hand.netDelta===null?'text-muted-foreground':hand.netDelta<0?'text-red-400':hand.netDelta>0?'text-emerald-400':'text-yellow-400'}>{hand.netDelta===null?'—':`${hand.netDelta>0?'+':''}${formatChips(hand.netDelta)}`}</span><span className="mt-1 block text-muted-foreground">{hand.endingStack===null?'Stack chưa xác minh':`${formatChips(hand.endingStack)} chip`}</span></span></>;
      return <li key={hand.handId}><a href={href} aria-label={`Mở replay hand #${hand.handNumber}`} className="flex min-h-14 items-center justify-between gap-3 rounded px-1 py-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{content}</a></li>;
    })}</ol>
  </section>;
}
