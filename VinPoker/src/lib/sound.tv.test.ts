import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const parameter = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
class TestContext {
  static current: TestContext;
  state = 'running';
  currentTime = 12;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  createBuffer = vi.fn(() => ({}));
  createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn() }));
  createOscillator = vi.fn(() => ({ type: 'sine', frequency: parameter(), connect: vi.fn((node) => node), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as null | (() => void) }));
  createGain = vi.fn(() => ({ gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }));
  constructor() { TestContext.current = this; }
}
beforeEach(() => { vi.resetModules(); vi.stubGlobal('AudioContext', TestContext); });
afterEach(() => vi.unstubAllGlobals());

it('renders distinct short and long notes to the device destination and cleans their nodes', async () => {
  const audio = await import('./sound');
  expect(await audio.playTvCountdownTone(false)).toBe(true);
  expect(await audio.playTvCountdownTone(true, 0.4)).toBe(true);
  const context = TestContext.current;
  const [short, long] = context.createOscillator.mock.results.map(x => x.value);
  expect(short.frequency.setValueAtTime).toHaveBeenCalledWith(1320, 12);
  expect(long.frequency.setValueAtTime).toHaveBeenCalledWith(660, 12.4);
  expect(short.start).toHaveBeenCalledWith(12);
  expect(long.start).toHaveBeenCalledWith(12.4);
  expect(long.stop.mock.calls[0][0] - 12.4).toBeGreaterThan(0.7);
  for (const { value: gain } of context.createGain.mock.results) {
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(gain.gain.linearRampToValueAtTime.mock.calls[0][0]).toBeLessThan(1);
    expect(gain.gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBeGreaterThan(0);
  }
  short.onended?.(); long.onended?.();
  expect(short.disconnect).toHaveBeenCalled();
  expect(long.disconnect).toHaveBeenCalled();
});

it('resumes an interrupted browser context and stops scheduled test tones on mute', async () => {
  const audio = await import('./sound');
  await audio.enableTvLevelAudio();
  const context = TestContext.current;
  context.state = 'interrupted';
  expect(await audio.playTvCountdownTone(true, 0.4)).toBe(true);
  expect(context.resume).toHaveBeenCalled();
  const oscillator = context.createOscillator.mock.results[0].value;
  audio.stopTvLevelAudio();
  expect(oscillator.stop).toHaveBeenLastCalledWith();
});

it('does not schedule a late tone if muted while the browser is resuming', async () => {
  const audio = await import('./sound');
  await audio.enableTvLevelAudio();
  const context = TestContext.current;
  context.state = 'suspended';
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = () => { context.state = 'running'; resolve(); }; });
  context.resume.mockImplementation(() => wait);
  const pending = audio.playTvCountdownTone(false);
  audio.stopTvLevelAudio();
  release();
  expect(await pending).toBe(false);
  expect(context.createOscillator).not.toHaveBeenCalled();
});
