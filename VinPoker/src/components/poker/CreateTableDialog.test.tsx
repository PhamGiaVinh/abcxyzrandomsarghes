import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CreateTableDialog} from './CreateTableDialog';
afterEach(cleanup);
it('dispatches only once for two create intents in one render turn',async()=>{
 let finish!:()=>void;
 const create=vi.fn(()=>new Promise<void>(r=>{finish=r;}));
 render(<CreateTableDialog open onOpenChange={vi.fn()} onCreate={create}/>);
 const button=screen.getByRole('button',{name:'Tạo & ngồi vào'});
 act(()=>{fireEvent.click(button);fireEvent.click(button);});
 expect(create).toHaveBeenCalledTimes(1);
 await act(async()=>finish());
 fireEvent.click(screen.getByRole('button',{name:'Tạo & ngồi vào'}));
 expect(create).toHaveBeenCalledTimes(2);
 await act(async()=>finish());
});
