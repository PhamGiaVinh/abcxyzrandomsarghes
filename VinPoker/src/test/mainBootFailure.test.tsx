import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import {ErrorBoundary} from 'react-error-boundary';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import ts from 'typescript';

afterEach(cleanup);
function bootWithRecoveryStorage(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>) {
 const listeners=new Map<string,(event:{message?:string;preventDefault?:()=>void})=>void>();
 const frames:Array<()=>void>=[],reload=vi.fn(),replace=vi.fn();
 const source=readFileSync('src/main.tsx','utf8').replace(/^import ["']\.\/index\.css["'];?\s*$/m,'').split('import.meta.env').join('({PROD:false})');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports:{},require:(name:string)=>{
   if(name==='react-dom/client')return {createRoot:()=>({render:vi.fn()})};
   if(name==='react-error-boundary')return {ErrorBoundary};
   if(name==='react/jsx-runtime')return jsxRuntime;
   throw Error('TEST_CORE_MODULE_MISSING');
  },document:{getElementById:()=>null},sessionStorage:storage,
  window:{location:{pathname:'/tracker',reload},addEventListener:(name:string,callback:typeof listeners extends Map<string,infer T>?T:never)=>listeners.set(name,callback),dispatchEvent:vi.fn()},
  location:{href:'http://127.0.0.1:5188/tracker',replace},console:{error:vi.fn(),warn:vi.fn()},Event,URL,
  requestAnimationFrame:(callback:()=>void)=>frames.push(callback),
 });
 return {listeners,frames,reload,replace};
}

describe('entrypoint automatic recovery is bounded across failed boots',()=>{
 it('does not let the inline HTML chunk guard auto navigate without a persistent fence',()=>{
  const script=[...readFileSync('index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(value=>value.includes('// Chunk guard:'));
  expect(script).toBeDefined();
  let onError!:(event:{message:string})=>void;const replace=vi.fn();
  runInNewContext(script!,{
   document:{querySelector:()=>null},localStorage:{getItem:()=>null},
   sessionStorage:{getItem:()=>{throw Error('TEST_STORAGE_DENIED');}},
   window:{addEventListener:(_name:string,callback:typeof onError)=>{onError=callback;}},
   location:{href:'http://127.0.0.1:5188/tracker',replace},URL,
  });
  onError({message:'TEST is not defined'});expect(replace).not.toHaveBeenCalled();
 });
 it('retains the one-attempt preload fence even when the retry only renders the boot error',async()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
  const first=bootWithRecoveryStorage(storage);await new Promise(resolve=>setTimeout(resolve,0));first.frames.forEach(frame=>frame());
  first.listeners.get('vite:preloadError')!({preventDefault:vi.fn()});expect(first.reload).toHaveBeenCalledOnce();
  const second=bootWithRecoveryStorage(storage);await new Promise(resolve=>setTimeout(resolve,0));second.frames.forEach(frame=>frame());
  second.listeners.get('vite:preloadError')!({preventDefault:vi.fn()});expect(second.reload).not.toHaveBeenCalled();
 });
 it.each(['vite:preloadError','error'])('does not auto navigate on %s when a persistent retry fence cannot be stored',(event)=>{
  const storage={getItem:()=>{throw Error('TEST_STORAGE_DENIED');},setItem:vi.fn(),removeItem:vi.fn()};
  const runtime=bootWithRecoveryStorage(storage);
  runtime.listeners.get(event)!({message:'TEST is not defined',preventDefault:vi.fn()});
  expect(runtime.reload).not.toHaveBeenCalled();expect(runtime.replace).not.toHaveBeenCalled();
 });
 it.each(['vite:preloadError','error'])('retains one automatic recovery for %s when storage works',(event)=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:vi.fn()};
  const runtime=bootWithRecoveryStorage(storage);
  const failure={message:'TEST is not defined',preventDefault:vi.fn()};
  runtime.listeners.get(event)!(failure);runtime.listeners.get(event)!(failure);
  expect(runtime.reload.mock.calls.length+runtime.replace.mock.calls.length).toBe(1);
 });
 it.each(['vite:preloadError','error'])('does not auto navigate on %s if storing the fence fails',(event)=>{
  const runtime=bootWithRecoveryStorage({getItem:()=>null,setItem:()=>{throw Error('TEST_STORAGE_FULL');},removeItem:vi.fn()});
  runtime.listeners.get(event)!({message:'TEST is not defined',preventDefault:vi.fn()});
  expect(runtime.reload).not.toHaveBeenCalled();expect(runtime.replace).not.toHaveBeenCalled();
 });
});
describe('actual entrypoint async boot failure recovery',()=>{
 it.each(['./lib/sound','./lib/registerSW','./lib/onesignal','./lib/webVitals'].flatMap(name=>
  ['import failure','initializer failure','hung import'].map(mode=>[name,mode])))('renders the app when optional startup module %s has %s',async(failedModule,mode)=>{
  const accepted=vi.fn(),logs=vi.fn();
  const source=readFileSync('src/main.tsx','utf8').replace(/^import ["']\.\/index\.css["'];?\s*$/m,'').split('import.meta.env').join('({PROD:false})');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports:{},require:(name:string)=>{
    if(name===failedModule){
     if(mode==='import failure')throw Error('SYNTHETIC_PRIVATE_OPTIONAL_FAILURE');
     if(mode==='hung import')return new Promise(()=>{});
     const fail=()=>{throw Error('SYNTHETIC_PRIVATE_OPTIONAL_FAILURE');};
     return {initButtonSounds:fail,registerServiceWorker:fail,initOneSignal:fail,initWebVitals:fail};
    }
    if(name==='react-dom/client')return {createRoot:()=>({render:accepted})};
    if(name==='react-error-boundary')return {ErrorBoundary};
    if(name==='react/jsx-runtime')return jsxRuntime;
    if(name==='./PlayerApp')return {default:()=> <main>TEST app ready</main>};
    if(name==='./components/RootErrorFallback')return {RootErrorFallback:()=> <div>Core failed</div>};
    return {initButtonSounds:vi.fn(),registerServiceWorker:vi.fn(),initOneSignal:vi.fn(),initWebVitals:vi.fn()};
   },document:{getElementById:()=>({})},
   window:{location:{pathname:'/__dev/payout-native',reload:vi.fn()},addEventListener:vi.fn(),dispatchEvent:vi.fn()},
   console:{error:logs,warn:logs},Event,requestAnimationFrame:vi.fn(),
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(accepted).toHaveBeenCalledOnce();render(accepted.mock.calls[0][0]);
  expect(screen.getByText('TEST app ready')).toBeVisible();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(JSON.stringify(logs.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_OPTIONAL_FAILURE');
 });
 it.each(['/__dev/payout-native','/center-point-poker-masters'])('shows explicit retry when startup import fails at %s',async(pathname)=>{
  const accepted=vi.fn(),reload=vi.fn(),logs=vi.fn();
  const source=readFileSync('src/main.tsx','utf8').replace(/^import ["']\.\/index\.css["'];?\s*$/m,'')
   .split('import.meta.env').join('({PROD:false})');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports:{},require:(name:string)=>{
    if(name==='react-dom/client')return {createRoot:()=>({render:accepted})};
    if(name==='react-error-boundary')return {ErrorBoundary};
    if(name==='react/jsx-runtime')return jsxRuntime;
    throw Error('SYNTHETIC_PRIVATE_MODULE_FAILURE');
   },document:{getElementById:()=>({})},
   window:{location:{pathname,reload},addEventListener:vi.fn(),dispatchEvent:vi.fn()},console:{error:logs},
   Event,requestAnimationFrame:vi.fn(),
  });
  // Actual transpiled dynamic imports reject on a microtask; let the catch render.
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(accepted).toHaveBeenCalledOnce();
  render(accepted.mock.calls[0][0]);
  expect(screen.getByRole('alert')).toHaveTextContent('Không tải được ứng dụng');
  expect(screen.queryByText(/SYNTHETIC_PRIVATE_MODULE_FAILURE/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Tải lại ứng dụng'}));
  expect(reload).toHaveBeenCalledOnce();
 });
});

it.each(([
 ['./PlayerApp','/__dev/payout-native','player-app'],
 ['./components/RootErrorFallback','/__dev/payout-native','root-fallback'],
 ['./i18n','/__dev/payout-native','i18n'],
 ['./pages/CenterPointPokerMastersApp','/center-point-poker-masters','event-app'],
] as const).flatMap(([module,path,stage])=>[true,false].map(dev=>[module,path,stage,dev] as const)))('identifies required import failure stage without displaying raw error: %s %s %s DEV=%s',async(failedModule,pathname,stage,dev)=>{
 const accepted=vi.fn(),logs=vi.fn();
 const source=readFileSync('src/main.tsx','utf8').replace(/^import ["']\.\/index\.css["'];?\s*$/m,'').split('import.meta.env').join(JSON.stringify({PROD:!dev,DEV:dev}));
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports:{},require:(name:string)=>{
   if(name===failedModule)throw new TypeError('Failed to fetch dynamically imported module: SYNTHETIC_PRIVATE_TEST_DETAIL');
   if(name==='react-dom/client')return {createRoot:()=>({render:accepted})};
   if(name==='react-error-boundary')return {ErrorBoundary};
   if(name==='react/jsx-runtime')return jsxRuntime;
   if(name==='./PlayerApp'||name==='./pages/CenterPointPokerMastersApp')return {default:()=> <main>Ready</main>};
   if(name==='./components/RootErrorFallback')return {RootErrorFallback:()=>null};
   return {};
  },document:{getElementById:()=>({})},window:{location:{pathname,reload:vi.fn()},addEventListener:vi.fn(),dispatchEvent:vi.fn()},
  console:{error:logs,warn:logs},Event,requestAnimationFrame:vi.fn(),
 });
 await new Promise(resolve=>setTimeout(resolve,0));render(accepted.mock.calls[0][0]);
 if(dev){expect(screen.getByRole('alert')).toHaveAttribute('data-boot-stage',stage);expect(screen.getByRole('alert')).toHaveAttribute('data-boot-kind','module-fetch');}
 else{expect(screen.getByRole('alert')).not.toHaveAttribute('data-boot-stage');expect(screen.getByRole('alert')).not.toHaveAttribute('data-boot-kind');}
 expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_TEST_DETAIL');expect(JSON.stringify(logs.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_TEST_DETAIL');
});
