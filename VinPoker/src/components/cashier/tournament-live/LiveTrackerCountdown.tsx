import {memo,useEffect,useRef,useState} from 'react';

export const LiveTrackerCountdown=memo(function LiveTrackerCountdown({remaining,running,receivedAt,onZero}:{remaining:number;running:boolean;receivedAt:number;onZero:()=>void}){
  const [seconds,setSeconds]=useState(remaining);
  const callback=useRef(onZero);callback.current=onZero;
  useEffect(()=>{
    let notified=false;
    const tick=()=>{
      const next=Math.max(0,Math.ceil(remaining-(running?(Date.now()-receivedAt)/1000:0)));
      setSeconds(next);
      if(running&&next===0&&!notified){notified=true;callback.current();}
    };
    tick();if(!running)return;
    const timer=setInterval(tick,1_000);return()=>clearInterval(timer);
  },[remaining,running,receivedAt]);
  return <>{`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}</>;
});
