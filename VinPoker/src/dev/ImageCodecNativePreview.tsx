import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {compressImage} from '@/lib/compressImage';

type Result={sourceBytes:number;outputBytes:number;type:string;width:number;height:number;url:string};

// Actual browser codec, without SDK/provider mocks or database/storage writes.
export default function ImageCodecNativePreview(){
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<Result|null>(null);
 const alive=useRef(true),flight=useRef(false),preview=useRef<string|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(preview.current)URL.revokeObjectURL(preview.current);};},[]);
 const run=async()=>{
  if(flight.current)return;
  flight.current=true;setBusy(true);setError(null);
  try{
   const source=document.createElement('canvas');source.width=3200;source.height=1600;
   const context=source.getContext('2d');if(!context)throw Error('Browser không cấp canvas context.');
   context.fillStyle='#153047';context.fillRect(0,0,3200,1600);
   context.fillStyle='#f0d48a';context.fillRect(120,120,2960,1360);
   context.fillStyle='#153047';context.font='bold 160px sans-serif';context.fillText('LOCAL CODEC TEST',220,850);
   const blob=await new Promise<Blob>((resolve,reject)=>source.toBlob(value=>value?resolve(value):reject(Error('Không tạo được PNG TEST.')),'image/png'));
   source.width=0;source.height=0;
   const file=new File([blob],'codec257-generated-test.png',{type:'image/png'});
   const output=await compressImage(file,{maxEdge:1600,quality:0.8});
   const bitmap=await createImageBitmap(output);
   let width:number,height:number;
   try{width=bitmap.width;height=bitmap.height;}finally{bitmap.close();}
   if(width!==1600||height!==800||output.type!=='image/png')throw Error('Codec output không khớp kích thước/định dạng TEST.');
   if(!alive.current)return;
   const url=URL.createObjectURL(output);if(preview.current)URL.revokeObjectURL(preview.current);preview.current=url;
   setResult({sourceBytes:file.size,outputBytes:output.size,type:output.type,width,height,url});
  }catch(caught){if(alive.current)setError(caught instanceof Error?caught.message:'Không xử lý được ảnh TEST.');}
  finally{flight.current=false;if(alive.current)setBusy(false);}
 };
 return <main className="mx-auto max-w-2xl space-y-4 p-4 text-foreground">
  <h1>Image codec · actual local browser</h1>
  <p>PNG TEST 3200×1600 → product compressImage. Client-only: không upload, không publish, không ghi DB và không chứng minh Storage đã hoạt động.</p>
  <Button disabled={busy} onClick={()=>void run()}>{busy?'Đang xử lý PNG TEST…':'Chạy codec PNG TEST'}</Button>
  {error&&<p role="alert">{error}</p>}
  {result&&<section aria-label="Kết quả codec TEST" className="space-y-2">
   <p role="status">{result.width}×{result.height} · {result.type} · {result.sourceBytes} → {result.outputBytes} bytes</p>
   <img src={result.url} alt="LOCAL CODEC TEST đã xử lý" className="max-h-64 w-full border border-border object-contain"/>
  </section>}
 </main>;
}
