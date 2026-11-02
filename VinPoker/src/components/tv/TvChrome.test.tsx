import {act,cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
vi.mock('@/hooks/useWakeLock',()=>({useWakeLock:()=>{}}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
import {TvChrome} from './TvChrome';
let request:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 request=vi.fn();
 Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
 Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});
 Object.defineProperty(document.documentElement,'requestFullscreen',{configurable:true,value:request});
});
afterEach(()=>{cleanup();delete (document as unknown as Record<string,unknown>).fullscreenEnabled;delete (document as unknown as Record<string,unknown>).fullscreenElement;delete (document.documentElement as unknown as Record<string,unknown>).requestFullscreen;});
it('keeps a retry action and explains a rejected fullscreen request',async()=>{
 request.mockRejectedValueOnce(new Error('browser policy')).mockImplementationOnce(async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:document.documentElement});document.dispatchEvent(new Event('fullscreenchange'));});
 render(<TvChrome><p>Native TV content</p></TvChrome>);
 fireEvent.click(screen.getByRole('button',{name:'tv.fullscreenPrompt'}));
 await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'tv.fullscreenPrompt'})).toBeEnabled();
 expect(screen.getByText('Native TV content')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'tv.fullscreenPrompt'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'tv.fullscreenPrompt'})).toBeNull());
 expect(request).toHaveBeenCalledTimes(2);
 act(()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new Event('fullscreenchange'));});
 expect(screen.getByRole('button',{name:'tv.fullscreenPrompt'})).toBeEnabled();
});
it('allows explicit skip after rejection without another fullscreen request',async()=>{
 request.mockRejectedValue(new Error('browser policy'));
 render(<TvChrome>TV</TvChrome>);
 fireEvent.click(screen.getByRole('button',{name:'tv.fullscreenPrompt'}));
 await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'tv.fullscreenSkip'}));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.queryByRole('button',{name:'tv.fullscreenPrompt'})).toBeNull();
 expect(request).toHaveBeenCalledTimes(1);
});

it('does not dismiss the retry prompt when the browser resolves without entering fullscreen',async()=>{
 request.mockResolvedValue(undefined);
 render(<TvChrome>TV</TvChrome>);
 fireEvent.click(screen.getByRole('button',{name:'tv.fullscreenPrompt'}));
 await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'tv.fullscreenPrompt'})).toBeEnabled();
});
