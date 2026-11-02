import {expect,it,vi} from 'vitest';
import {createChipSetupWriteGate} from './chipSetupWriteGate';

it('grants one synchronous owner and ignores repeated release from an earlier owner',()=>{
  const busy=vi.fn(),acquire=createChipSetupWriteGate(busy);
  const releaseA=acquire()!;
  expect(acquire()).toBeNull();expect(busy.mock.calls).toEqual([[true]]);
  releaseA();const releaseB=acquire()!;
  releaseA();expect(acquire()).toBeNull();
  expect(busy.mock.calls).toEqual([[true],[false],[true]]);
  releaseB();expect(busy.mock.calls).toEqual([[true],[false],[true],[false]]);
});

it('keeps independently scoped workspaces independent',()=>{
  const acquireA=createChipSetupWriteGate(vi.fn()),acquireB=createChipSetupWriteGate(vi.fn());
  expect(acquireA()).toBeTypeOf('function');expect(acquireB()).toBeTypeOf('function');
  expect(acquireA()).toBeNull();expect(acquireB()).toBeNull();
});
