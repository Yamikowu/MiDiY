import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile, type ControlId } from '@midiy/mikro-core';
import { readBindingDraft } from '../src/devices/mikro-mk3/mapping/bindings/binding-draft';
import type { BindingFields } from '../src/devices/mikro-mk3/mapping/bindings/binding-fields';

const fields = (values: Record<string, string | number | boolean>): BindingFields => ({
  val: id => String(values[id] ?? ''), num: id => Number(values[id] ?? ''), checked: id => values[id] === true,
});
function read(id: ControlId, action: string, values: Record<string, string | number | boolean>) {
  const source = createDefaultProfile(), original = structuredClone(source);
  const next = readBindingDraft(source, source.initialModeId, id, action, fields(values));
  assert.deepEqual(source, original); return next.modes[0];
}

test('Pad Hit, independent Press and dual lights reconstruct the current v2 representation', () => {
  const mode = read('PAD_1', 'note', { channel: 2, note: 60, 'note-mode': 'toggle', 'velocity-min': 20, 'velocity-max': 100,
    'press-type': 'cc', 'press-channel': 3, 'press-controller': 74, 'press-from': 10, 'press-to': 110,
    color: 7, 'color-mode': 'dual', 'on-color': 11 });
  assert.deepEqual(mode.bindings.PAD_1, { type: 'note', channel: 2, note: 60, velocity: 'pad', velocityMin: 20, velocityMax: 100, mode: 'toggle' });
  assert.deepEqual(mode.pressureBindings?.PAD_1, { type: 'cc', channel: 3, controller: 74, from: 10, to: 110 });
  assert.deepEqual(mode.pads[0], { color: 7, brightness: 'dim', onColor: 11 });
});

test('Button action-on and Encoder counters preserve their distinct fields', () => {
  assert.deepEqual(read('PLAY', 'cc', { channel: 1, controller: 4, style: 'inc', from: 10, to: 90, step: 3, wrap: true, 'action-on': 'up' }).bindings.PLAY,
    { type: 'cc', channel: 1, controller: 4, style: 'inc', from: 10, to: 90, step: 3, wrap: true, actionOn: 'up' });
  assert.deepEqual(read('ENCODER_ROTATE', 'cc', { channel: 2, controller: 10, step: 2, initial: 64, modulus: 16 }).bindings.ENCODER_ROTATE,
    { type: 'cc', channel: 2, controller: 10, style: 'encoder', step: 2, initial: 64, modulus: 16 });
});

test('Strip Position, Touch and held light reconstruct together without sharing Pad rules', () => {
  const mode = read('SMART_STRIP', 'cc', { channel: 1, controller: 9, 'strip-mode': 'relative-offset', 'raw-min': 1, 'raw-max': 200,
    'strip-step': -2, 'strip-resolution': 25, 'touch-type': 'note', 'touch-channel': 4, 'touch-note': 55,
    'strip-led-mode': 'pan', 'strip-led-brightness': 'bright', 'strip-led-color': 8, 'strip-led-hold': true });
  assert.deepEqual(mode.bindings.SMART_STRIP, { type: 'cc', channel: 1, controller: 9, style: 'strip', mode: 'relative-offset', rawMin: 1, rawMax: 200, step: -2, resolution: 25 });
  assert.deepEqual(mode.bindings.SMART_STRIP_TOUCH, { type: 'note', channel: 4, note: 55, velocity: 127 });
  assert.deepEqual(mode.stripLight, { mode: 'pan', brightness: 'bright', color: 8, hold: true });
});

test('invalid compound Pad draft fails atomically; selector bindings remain protected', () => {
  const source = createDefaultProfile(), original = structuredClone(source);
  assert.throws(() => readBindingDraft(source, source.initialModeId, 'PAD_1', 'note', fields({ channel: 1, note: 60,
    'note-mode': 'gate', 'velocity-min': 90, 'velocity-max': 20, 'press-type': 'off', color: 1, 'color-mode': 'single' })));
  assert.deepEqual(source, original);
  assert.deepEqual(readBindingDraft(source, source.initialModeId, source.modeSelector, 'note', fields({})), original);
});
