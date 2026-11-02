import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const html=readFileSync('index.html','utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(value=>value.includes('Boot watchdog'));
if(!script)throw new Error('Actual index boot watchdog missing');
function start(){
 const events=new EventTarget();
 runInNewContext(script!,{window:{setTimeout,addEventListener:events.addEventListener.bind(events)},
  document,navigator:{},sessionStorage,Promise,URL,Date,location:{href:'http://127.0.0.1:5188/',replace:vi.fn()}});
 return events;
}
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();document.body.innerHTML='<div id="boot-splash"></div><div id="root"></div>';});
afterEach(()=>{vi.useRealTimers();document.body.innerHTML='';});
describe('actual HTML boot watchdog',()=>{
 it('describes a slow mount without asserting that loading failed',async()=>{
  start();await vi.advanceTimersByTimeAsync(8000);
  expect(document.getElementById('boot-splash')?.textContent).toContain('đang tải lâu hơn dự kiến');
  expect(document.body.textContent).not.toContain('Không thể tải ứng dụng');
  expect(document.getElementById('boot-retry')?.textContent).toBe('Tải lại / Reload');
 });
 it('does not show recovery controls when React mounted before the deadline',async()=>{
  const events=start();events.dispatchEvent(new Event('vp:react-mounted'));
  await vi.advanceTimersByTimeAsync(8000);expect(document.getElementById('boot-retry')).toBeNull();
 });
 it('does nothing after React already removed the splash',async()=>{
  start();document.getElementById('boot-splash')?.remove();
  await vi.advanceTimersByTimeAsync(8000);expect(document.getElementById('boot-retry')).toBeNull();
 });
});
