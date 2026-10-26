import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceViewKey } from '../src/devices/mikro-mk3/mapping/performance-view';
import { fixture } from './runtime-fixture';

test('MIDI counters and delivery acknowledgements do not repaint identical hardware visuals', () => {
  const state = fixture().runtime.snapshot, key = performanceViewKey(state);
  state.midiCount++; state.ledStatus = 'acknowledged'; state.ledIssue = { code: 'led_sent', message: 'acknowledged' };
  assert.equal(performanceViewKey(state), key);
});
test('Pad and button release, mode selection, mode switches and light bytes always invalidate visuals', () => {
  const original = fixture().runtime.snapshot, key = performanceViewKey(original);
  const mutations = [
    (s: typeof original) => { s.activePads.push('PAD_1'); },
    (s: typeof original) => { s.pressedButtons.push('PLAY'); },
    (s: typeof original) => { s.selectingMode = true; },
    (s: typeof original) => { s.activeModeId = 'other'; },
    (s: typeof original) => { s.lightReport.data[39] ^= 1; },
    (s: typeof original) => { s.lightReport.reportId++; },
  ];
  for (const mutate of mutations) { const next = structuredClone(original); mutate(next); assert.notEqual(performanceViewKey(next), key); }
  const held = structuredClone(original); held.activePads.push('PAD_1'); const pressed = performanceViewKey(held);
  held.activePads = []; assert.notEqual(performanceViewKey(held), pressed);
});
