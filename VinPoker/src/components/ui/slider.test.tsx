import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';
import {Slider} from './slider';

describe('Slider accessible control',()=>{
 beforeAll(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
 afterAll(()=>vi.unstubAllGlobals());
 it('names the actual keyboard-operable thumb and preserves intent callbacks',()=>{
  const change=vi.fn();
  render(<Slider aria-label="Tua lại ván" defaultValue={[0]} min={0} max={5} step={1} onValueChange={change}/>);
  const thumb=screen.getByRole('slider',{name:'Tua lại ván'});
  expect(thumb).toHaveAttribute('aria-valuemax','5');
  fireEvent.keyDown(thumb,{key:'ArrowRight'});
  expect(change).toHaveBeenLastCalledWith([1]);
  expect(thumb).toHaveAttribute('aria-valuenow','1');
 });
 it('associates visible labels and explanatory text with the thumb',()=>{
  render(<><span id="speed-label">Tốc độ</span><p id="speed-help">Tốc độ phát lại</p><Slider aria-labelledby="speed-label" aria-describedby="speed-help" defaultValue={[1]} min={1} max={4}/></>);
  const thumb=screen.getByRole('slider',{name:'Tốc độ'});
  expect(thumb).toHaveAccessibleDescription('Tốc độ phát lại');
 });
});
