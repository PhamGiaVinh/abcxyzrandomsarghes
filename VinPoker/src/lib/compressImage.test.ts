// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {compressImage} from './compressImage';

const close=vi.fn(),draw=vi.fn(),decode=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubGlobal('createImageBitmap',decode);
 decode.mockResolvedValue({width:3200,height:1600,close});
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this:HTMLCanvasElement,callback,type){
  expect(close).toHaveBeenCalledOnce();
  callback(new Blob(['compressed'],{type}));
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const input=(type='image/png')=>new File([new Uint8Array(1024)],'TEST.png',{type});

describe('compressImage native resource ownership',()=>{
 it('closes a decoded bitmap when no canvas context is available',async()=>{
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  const file=input();expect(await compressImage(file)).toBe(file);
  expect(close).toHaveBeenCalledOnce();
 });
 it('closes a decoded bitmap if drawing fails, while retaining the original',async()=>{
  draw.mockImplementationOnce(()=>{throw Error('LOCAL draw failure');});
  const file=input();expect(await compressImage(file)).toBe(file);
  expect(close).toHaveBeenCalledOnce();
 });
 it('closes a decoded bitmap if canvas allocation throws',async()=>{
  vi.spyOn(document,'createElement').mockImplementationOnce(()=>{throw Error('LOCAL canvas unavailable');});
  const file=input();expect(await compressImage(file)).toBe(file);
  expect(close).toHaveBeenCalledOnce();
 });
 it('scales without upscaling and releases the bitmap before encoding',async()=>{
  const result=await compressImage(input(),{maxEdge:1600,quality:0.8});
  expect(draw).toHaveBeenCalledWith(expect.anything(),0,0,1600,800);
  expect(result.type).toBe('image/png');expect(result.size).toBe(10);
  expect(close).toHaveBeenCalledOnce();
 });
 it('keeps small dimensions and converts non-PNG input to real JPEG output',async()=>{
  decode.mockResolvedValueOnce({width:120,height:80,close});
  const result=await compressImage(input('image/webp'));
  expect(draw).toHaveBeenCalledWith(expect.anything(),0,0,120,80);
  expect(result.type).toBe('image/jpeg');expect(result.name).toBe('TEST.jpg');
  expect(close).toHaveBeenCalledOnce();
 });
 it.each(['no-benefit','null-blob','encode-error'])('retains original on %s after releasing the bitmap',async(kind)=>{
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback=>{
   if(kind==='encode-error')throw Error('LOCAL encoder unavailable');
   callback(kind==='null-blob'?null:new Blob([new Uint8Array(2048)]));
  });
  const file=input();expect(await compressImage(file)).toBe(file);expect(close).toHaveBeenCalledOnce();
 });
 it('retains the original on decoder rejection without inventing a bitmap',async()=>{
  decode.mockRejectedValueOnce(Error('LOCAL invalid image'));
  const file=input();expect(await compressImage(file)).toBe(file);expect(close).not.toHaveBeenCalled();
 });
 it.each(['image/gif','image/svg+xml','application/pdf'])('does not decode excluded %s',async(type)=>{
  const file=input(type);expect(await compressImage(file)).toBe(file);
  expect(decode).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 });
});
