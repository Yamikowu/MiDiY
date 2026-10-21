import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  InputDecoder, MappingEngine, BUTTON_IDS, PAD_IDS, padIndexToNumber, padNumberToIndex,
  createDefaultProfile, createMode, parseProfile, encodePadLights, encodeLights, type InputEvent
} from '@mpa/mikro-core';

const pad = (event: 'note-on' | 'note-off' | 'press-on' | 'press-off' | 'aftertouch', raw = 2048, number = 1): InputEvent => ({
  kind: 'pad', controlId: `PAD_${number}`, padIndex: padNumberToIndex(number), event, raw, velocity: raw >> 5
});
const button = (controlId: 'PLAY' | 'SHIFT' | 'STOP', pressed = true): InputEvent => ({ kind: 'button', controlId, pressed });
test('language independent firmware vectors agree with the TypeScript implementation', () => {
  const vectors = JSON.parse(readFileSync(new URL('./fixtures/mikro-vectors.json', import.meta.url), 'utf8'));
  for (const vector of vectors.padInputs) {
    const [event] = new InputDecoder().decode(vector.reportId, vector.payload).events;
    assert.equal(event.controlId, vector.controlId);
    assert.equal((event as any).event, vector.event);
    assert.equal((event as any).raw, vector.raw);
    assert.equal((event as any).velocity, vector.velocity);
  }
});

test('all 41 Rust button bits map to stable IDs and only emit transitions', () => {
  for (let bit = 0; bit < BUTTON_IDS.length; bit++) {
    const decoder = new InputDecoder(), bytes = new Uint8Array(13);
    decoder.decode(1, bytes);
    bytes[bit >> 3] = 1 << (bit % 8);
    assert.deepEqual(decoder.decode(1, bytes).events, [{ kind: 'button', controlId: BUTTON_IDS[bit], pressed: true }]);
    assert.deepEqual(decoder.decode(1, bytes).events, []);
    bytes.fill(0);
    assert.deepEqual(decoder.decode(1, bytes).events, [{ kind: 'button', controlId: BUTTON_IDS[bit], pressed: false }]);
  }
});
test('encoder first report is baseline; raw differences and strip zero remain explicit', () => {
  const decoder = new InputDecoder(), bytes = new Uint8Array(13);
  bytes[6] = 15; bytes[9] = 200;
  assert.deepEqual(decoder.decode(1, bytes).events, [
    { kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: true },
    { kind: 'strip', controlId: 'SMART_STRIP', raw: 200 }
  ]);
  bytes[6] = 0; bytes[9] = 0;
  assert.deepEqual(decoder.decode(1, bytes).events, [
    { kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 0, delta: -15 },
    { kind: 'strip', controlId: 'SMART_STRIP', raw: 0 },
    { kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: false }
  ]);
  decoder.reset(); assert.equal(decoder.decode(1, bytes).events.length, 1);
});
test('stationary Strip touch creates one down and one up, movement does not retrigger touch', () => {
  const decoder = new InputDecoder(), bytes = new Uint8Array(13);
  decoder.decode(1, bytes);
  bytes[9] = 72;
  assert.deepEqual(decoder.decode(1, bytes).events, [
    { kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: true },
    { kind: 'strip', controlId: 'SMART_STRIP', raw: 72 }
  ]);
  assert.deepEqual(decoder.decode(1, bytes).events, []);
  bytes[9] = 200;
  assert.deepEqual(decoder.decode(1, bytes).events, [{ kind: 'strip', controlId: 'SMART_STRIP', raw: 200 }]);
  bytes[9] = 0;
  assert.deepEqual(decoder.decode(1, bytes).events, [
    { kind: 'strip', controlId: 'SMART_STRIP', raw: 0 },
    { kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: false }
  ]);
});
test('pad triplets handle all event types, 12-bit values, pad zero and padding', () => {
  const decoder = new InputDecoder();
  const events = decoder.decode(2, [0, 0, 0, 15, 0x1f, 0xff, 1, 0x20, 0, 2, 0x30, 0, 3, 0x40, 1, 0, 0, 0, 4, 0x10, 5]).events;
  assert.equal(events.length, 5);
  assert.deepEqual(events[0], { kind: 'pad', controlId: 'PAD_13', padIndex: 0, event: 'press-on', raw: 0, velocity: 0 });
  assert.deepEqual(events[1], { kind: 'pad', controlId: 'PAD_4', padIndex: 15, event: 'note-on', raw: 4095, velocity: 127 });
  assert.equal((events[4] as any).velocity, 1);
  for (let i = 0; i < 16; i++) assert.equal(padNumberToIndex(padIndexToNumber(i)), i);
});
test('truncated/unknown reports stay diagnosable and retain raw bytes', () => {
  const decoder = new InputDecoder();
  assert.equal(decoder.decode(1, [1, 2]).events.length, 0);
  assert.ok(decoder.decode(1, [1, 2]).diagnostics.length);
  assert.ok(decoder.decode(2, [12, 0x10]).diagnostics.length);
  const unknown = decoder.decode(2, [16, 0x10, 1, 1, 0x50, 2]);
  assert.equal(unknown.events.length, 0); assert.equal(unknown.diagnostics.length, 2);
  assert.deepEqual(decoder.decode(0xfe, [1, 2]).raw, [1, 2]);
});
test('default profile produces one note pair despite PressOn/NoteOn and pressure', () => {
  const engine = new MappingEngine(createDefaultProfile());
  assert.deepEqual(engine.process(pad('press-on', 0)).messages, []);
  assert.deepEqual(engine.process(pad('note-on')).messages, [[0x90, 36, 64]]);
  assert.deepEqual(engine.process(pad('press-on')).messages, []);
  assert.deepEqual(engine.process(pad('aftertouch')).messages, []);
  assert.deepEqual(engine.process(pad('press-off', 0)).messages, [[0x80, 36, 0]]);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, []);
});
test('Pad Hit and Press are independent; poly pressure deduplicates and releases', () => {
  const profile = createDefaultProfile();
  profile.modes[0].pressureBindings = { PAD_1: { type: 'poly-pressure', channel: 2, note: 60, from: 0, to: 127 } };
  const engine = new MappingEngine(parseProfile(profile));
  assert.deepEqual(engine.process(pad('aftertouch')).messages, []);
  assert.deepEqual(engine.process(pad('note-on')).messages, [[0x90, 36, 64]]);
  assert.deepEqual(engine.process(pad('aftertouch')).messages, [[0xa1, 60, 64]]);
  assert.deepEqual(engine.process(pad('aftertouch')).messages, []);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, [[0xa1, 60, 0], [0x80, 36, 0]]);
  assert.deepEqual(engine.flush(), []);
});
test('Press Note thresholds have hysteresis and share note ownership with Hit', () => {
  const profile = createDefaultProfile();
  profile.modes[0].pressureBindings = { PAD_1: { type: 'note', channel: 1, note: 36, velocity: 100, onThreshold: 20, offThreshold: 10 } };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on'));
  assert.deepEqual(engine.process(pad('aftertouch', 500)).messages, []);
  assert.deepEqual(engine.process(pad('aftertouch', 900)).messages, []);
  assert.deepEqual(engine.process(pad('aftertouch', 700)).messages, []);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, [[0x80, 36, 0]]);
  engine.process(pad('note-on'));
  engine.process(pad('aftertouch', 900));
  assert.deepEqual(engine.process(pad('aftertouch', 400)).messages, []);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, [[0x80, 36, 0]]);
  profile.modes[0].bindings.PAD_2 = { type: 'none' };
  profile.modes[0].pressureBindings.PAD_2 = { type: 'note', channel: 2, note: 99, velocity: 70, onThreshold: 20, offThreshold: 10 };
  const pressureOnly = new MappingEngine(profile);
  assert.deepEqual(pressureOnly.process(pad('note-on', 1000, 2)).messages, []);
  assert.deepEqual(pressureOnly.process(pad('aftertouch', 900, 2)).messages, [[0x91, 99, 70]]);
  assert.deepEqual(pressureOnly.process(pad('aftertouch', 600, 2)).messages, []);
  assert.deepEqual(pressureOnly.process(pad('aftertouch', 400, 2)).messages, [[0x81, 99, 0]]);
});
test('mode changes suppress held Pad pressure until physical release', () => {
  const profile = createDefaultProfile(); profile.modes.push(createMode('b', 'Second'));
  profile.modes[1].pressureBindings = { PAD_1: { type: 'poly-pressure', channel: 1, note: 36, from: 0, to: 127 } };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on'));
  assert.deepEqual(engine.switchMode('b').messages, [[0x80, 36, 0]]);
  assert.deepEqual(engine.process(pad('aftertouch')).messages, []);
  engine.process(pad('note-off', 0));
  engine.process(pad('note-on'));
  assert.deepEqual(engine.process(pad('aftertouch')).messages, [[0xa0, 36, 64]]);
});
test('continuous Press outputs reset on release or mode switch', () => {
  const profile = createDefaultProfile(); profile.modes.push(createMode('b', 'Second'));
  profile.modes[0].pressureBindings = {
    PAD_1: { type: 'cc', channel: 1, controller: 74, from: 10, to: 100 },
    PAD_2: { type: 'channel-pressure', channel: 2, from: 0, to: 127 },
    PAD_3: { type: 'pitchbend', channel: 3, from: 0, to: 100 }
  };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on', 1000, 1));
  assert.deepEqual(engine.process(pad('aftertouch', 4095, 1)).messages, [[0xb0, 74, 100]]);
  assert.deepEqual(engine.process(pad('press-off', 0, 1)).messages, [[0xb0, 74, 0], [0x80, 36, 0]]);
  engine.process(pad('note-on', 1000, 2));
  assert.deepEqual(engine.process(pad('aftertouch', 2048, 2)).messages, [[0xd1, 64]]);
  engine.process(pad('note-on', 1000, 3));
  assert.deepEqual(engine.process(pad('aftertouch', 4095, 3)).messages, [[0xe2, 127, 127]]);
  assert.deepEqual(engine.switchMode('b').messages, [[0x80, 37, 0], [0x80, 38, 0], [0xd1, 0], [0xe2, 0, 64]]);
});
test('one released Pad does not reset another Pad controlling the same pressure target', () => {
  const profile = createDefaultProfile();
  profile.modes[0].pressureBindings = {
    PAD_1: { type: 'cc', channel: 1, controller: 74, from: 0, to: 127 },
    PAD_2: { type: 'cc', channel: 1, controller: 74, from: 0, to: 127 }
  };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on', 1000, 1)); engine.process(pad('note-on', 1000, 2));
  engine.process(pad('aftertouch', 4095, 1)); engine.process(pad('aftertouch', 2048, 2));
  assert.deepEqual(engine.process(pad('note-off', 0, 2)).messages, [[0xb0, 74, 127], [0x80, 37, 0]]);
  assert.deepEqual(engine.process(pad('note-off', 0, 1)).messages, [[0xb0, 74, 0], [0x80, 36, 0]]);
});
test('note ownership survives profile changes and mode switches until release', () => {
  const profile = createDefaultProfile(); profile.modes.push(createMode('b', 'Second'));
  profile.modes[0].bindings.SHIFT = { type: 'mode', modeId: 'b' };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on'));
  assert.deepEqual(engine.process(button('SHIFT')).messages, [[0x80, 36, 0]]);
  assert.equal(engine.activeModeId, 'b');
  assert.deepEqual(engine.process(pad('press-on')).messages, []);
  engine.process(pad('note-off', 0));
  engine.switchMode('default'); engine.process(pad('note-on'));
  profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 2, note: 99, velocity: 100 };
  assert.deepEqual(engine.reconfigure(profile), [[0x80, 36, 0]]);
  assert.deepEqual(engine.process(pad('press-on')).messages, []);
  engine.process(pad('note-off', 0));
  assert.deepEqual(engine.process(pad('note-on')).messages, [[0x91, 99, 100]]);
  assert.deepEqual(engine.reset(), [[0x81, 99, 0]]);
});
test('overlapping mappings to one MIDI note release only after last control', () => {
  const profile = createDefaultProfile(); profile.modes[0].bindings.PAD_2 = { type: 'note', channel: 1, note: 36, velocity: 'pad' };
  const engine = new MappingEngine(profile);
  engine.process(pad('note-on')); assert.deepEqual(engine.process(pad('note-on', 3000, 2)).messages, []);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, []);
  assert.deepEqual(engine.process(pad('note-off', 0, 2)).messages, [[0x80, 36, 0]]);
});
test('button CC momentary/toggle, program change and flush use correct channels', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PLAY = { type: 'cc', channel: 16, controller: 7, style: 'momentary', on: 127, off: 0 };
  profile.modes[0].bindings.STOP = { type: 'cc', channel: 2, controller: 8, style: 'toggle', on: 100, off: 0 };
  profile.modes[0].bindings.SHIFT = { type: 'program', channel: 3, program: 127 };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(button('PLAY')).messages, [[0xbf, 7, 127]]);
  assert.deepEqual(engine.flush(), [[0xbf, 7, 0]]);
  engine.process(button('PLAY', false));
  assert.deepEqual(engine.process(button('STOP')).messages, [[0xb1, 8, 100]]);
  engine.process(button('STOP', false));
  assert.deepEqual(engine.process(button('STOP')).messages, [[0xb1, 8, 0]]);
  assert.deepEqual(engine.process(button('SHIFT')).messages, [[0xc2, 127]]);
});
test('button CC Trigger and Inc handle action edges, bounds, wrap and repeated values', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PLAY = { type: 'cc', channel: 1, controller: 20, style: 'trigger', value: 64, actionOn: 'up' };
  profile.modes[0].bindings.STOP = { type: 'cc', channel: 2, controller: 21, style: 'inc', from: 1, to: 5, step: 2, wrap: false };
  profile.modes[0].bindings.SHIFT = { type: 'cc', channel: 3, controller: 22, style: 'inc', from: 1, to: 5, step: -2, wrap: true };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(button('PLAY')).messages, []);
  assert.deepEqual(engine.process(button('PLAY', false)).messages, [[0xb0, 20, 64]]);
  assert.deepEqual(engine.process(button('PLAY')).messages, []);
  assert.deepEqual(engine.process(button('PLAY', false)).messages, [[0xb0, 20, 64]]);
  for (const value of [1, 3, 5, 5]) {
    assert.deepEqual(engine.process(button('STOP')).messages, [[0xb1, 21, value]]);
    engine.process(button('STOP', false));
  }
  for (const value of [5, 3, 1, 5]) {
    assert.deepEqual(engine.process(button('SHIFT')).messages, [[0xb2, 22, value]]);
    engine.process(button('SHIFT', false));
  }
});
test('Pad Note Toggle holds across release and flushes', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 2, note: 60, velocity: 100, mode: 'toggle' };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(pad('note-on')).messages, [[0x91, 60, 100]]);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, []);
  assert.deepEqual(engine.process(pad('note-on')).messages, [[0x81, 60, 0]]);
  assert.deepEqual(engine.process(pad('note-off', 0)).messages, []);
  engine.process(pad('note-on')); engine.process(pad('note-off', 0));
  assert.deepEqual(engine.flush(), [[0x81, 60, 0]]);
});
test('Pad value Types encode Gate, Toggle, Trigger and Inc in channel messages', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PAD_1 = { type: 'button-value', channel: 2, output: 'poly-pressure', note: 60, mode: 'gate', on: 100, off: 0 };
  profile.modes[0].bindings.PAD_2 = { type: 'button-value', channel: 3, output: 'channel-pressure', mode: 'toggle', on: 90, off: 10 };
  profile.modes[0].bindings.PAD_3 = { type: 'button-value', channel: 4, output: 'program', mode: 'trigger', value: 42 };
  profile.modes[0].bindings.PAD_4 = { type: 'button-value', channel: 5, output: 'pitchbend', mode: 'inc', from: 8192, to: 8194, step: 1, wrap: true };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(pad('note-on', 2048, 1)).messages, [[0xa1, 60, 100]]);
  assert.deepEqual(engine.process(pad('note-off', 0, 1)).messages, [[0xa1, 60, 0]]);
  assert.deepEqual(engine.process(pad('note-on', 2048, 2)).messages, [[0xd2, 90]]);
  engine.process(pad('note-off', 0, 2));
  assert.deepEqual(engine.process(pad('note-on', 2048, 2)).messages, [[0xd2, 10]]);
  assert.deepEqual(engine.process(pad('note-on', 2048, 3)).messages, [[0xc3, 42]]);
  assert.deepEqual(engine.process(pad('note-off', 0, 3)).messages, []);
  for (const value of [8192, 8193, 8194, 8192]) {
    assert.deepEqual(engine.process(pad('note-on', 2048, 4)).messages, [[0xe4, value & 0x7f, value >> 7]]);
    engine.process(pad('note-off', 0, 4));
  }
});
test('general buttons support Action on for Note and value types', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PLAY = { type: 'note', channel: 1, note: 64, velocity: 90, mode: 'toggle', actionOn: 'up' };
  profile.modes[0].bindings.STOP = { type: 'button-value', channel: 2, output: 'program', mode: 'trigger', value: 42, actionOn: 'up' };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(button('PLAY')).messages, []);
  assert.deepEqual(engine.process(button('PLAY', false)).messages, [[0x90, 64, 127]]);
  assert.deepEqual(engine.process(button('PLAY')).messages, []);
  assert.deepEqual(engine.process(button('PLAY', false)).messages, [[0x80, 64, 0]]);
  assert.deepEqual(engine.process(button('STOP')).messages, []);
  assert.deepEqual(engine.process(button('STOP', false)).messages, [[0xc1, 42]]);
  profile.modes[0].bindings.SHIFT = { type: 'system', command: 'start' };
  assert.throws(() => parseProfile(profile));
  profile.modes[0].bindings.SHIFT = { type: 'mcu-button', number: 12, mode: 'gate' } as any;
  assert.throws(() => parseProfile(profile));
});
test('legacy Pad Action on is removed when loading without rejecting saved profiles', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PAD_1 = { type: 'cc', channel: 1, controller: 1, style: 'toggle', on: 127, off: 0, actionOn: 'up' };
  assert.equal('actionOn' in parseProfile(profile).modes[0].bindings.PAD_1!, false);
  profile.modes[0].bindings.PAD_1 = { type: 'button-value', channel: 1, output: 'channel-pressure', mode: 'trigger', value: 100, actionOn: 'up' };
  assert.equal('actionOn' in parseProfile(profile).modes[0].bindings.PAD_1!, false);
  profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 60, velocity: 100, mode: 'toggle', actionOn: 'up' };
  assert.equal('actionOn' in parseProfile(profile).modes[0].bindings.PAD_1!, false);
});
test('Strip Position and Touch map independently and flush releases held touch', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.SMART_STRIP = { type: 'strip-position', channel: 2, output: 'pitchbend', from: 0, to: 16383 };
  profile.modes[0].bindings.SMART_STRIP_TOUCH = { type: 'note', channel: 3, note: 60, velocity: 100 };
  const engine = new MappingEngine(profile);
  const touch = (pressed: boolean): InputEvent => ({ kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed });
  const position = (raw: number): InputEvent => ({ kind: 'strip', controlId: 'SMART_STRIP', raw });
  assert.deepEqual(engine.process(touch(true)).messages, [[0x92, 60, 127]]);
  assert.deepEqual(engine.process(position(1)).messages, [[0xe1, 0, 0]]);
  assert.deepEqual(engine.process(position(200)).messages, [[0xe1, 127, 127]]);
  assert.deepEqual(engine.process(position(0)).messages, []);
  assert.deepEqual(engine.process(touch(false)).messages, [[0x82, 60, 0]]);
  engine.process(touch(true));
  assert.deepEqual(engine.flush(), [[0x82, 60, 0]]);
  assert.deepEqual(engine.process(touch(false)).messages, []);
});
test('Strip Touch sends pressure, CC Gate and transport without leaking on release', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.SMART_STRIP_TOUCH = { type: 'value', channel: 2, output: 'channel-pressure', on: 100, off: 0 };
  const down: InputEvent = { kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: true };
  const up: InputEvent = { ...down, pressed: false };
  let engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(down).messages, [[0xd1, 100]]);
  assert.deepEqual(engine.process(up).messages, [[0xd1, 0]]);
  profile.modes[0].bindings.SMART_STRIP_TOUCH = { type: 'cc', channel: 1, controller: 74, style: 'momentary', on: 127, off: 0 };
  engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(down).messages, [[0xb0, 74, 127]]);
  assert.deepEqual(engine.process(up).messages, [[0xb0, 74, 0]]);
  profile.modes[0].bindings.SMART_STRIP_TOUCH = { type: 'system', command: 'song-position', position: 300 };
  engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(down).messages, [[0xf2, 44, 2]]);
  assert.deepEqual(engine.process(up).messages, []);
});
test('continuous CC applies configured wrap, clamps and ignores strip zero', () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.ENCODER_ROTATE = { type: 'cc', channel: 1, controller: 1, style: 'encoder', step: 2, initial: 64, modulus: 16 };
  profile.modes[0].bindings.SMART_STRIP = { type: 'cc', channel: 1, controller: 2, style: 'strip', rawMin: 1, rawMax: 200 };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 0, delta: -15 }).messages, [[0xb0, 1, 66]]);
  assert.deepEqual(engine.process({ kind: 'strip', controlId: 'SMART_STRIP', raw: 200 }).messages, [[0xb0, 2, 127]]);
  assert.deepEqual(engine.process({ kind: 'strip', controlId: 'SMART_STRIP', raw: 255 }).messages, []);
  assert.deepEqual(engine.process({ kind: 'strip', controlId: 'SMART_STRIP', raw: 0 }).messages, []);
});
test('Strip Position CC supports Absolute, Relative and Relative (Offset)', () => {
  const profile = createDefaultProfile();
  const position = (raw: number): InputEvent => ({ kind: 'strip', controlId: 'SMART_STRIP', raw });
  profile.modes[0].bindings.SMART_STRIP = { type: 'cc', channel: 2, controller: 74, style: 'strip', rawMin: 1, rawMax: 200,
    mode: 'absolute', from: 20, to: 100 };
  let engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(position(1)).messages, [[0xb1, 74, 20]]);
  assert.deepEqual(engine.process(position(200)).messages, [[0xb1, 74, 100]]);
  assert.deepEqual(engine.process(position(0)).messages, []);
  profile.modes[0].bindings.SMART_STRIP = { type: 'cc', channel: 2, controller: 74, style: 'strip', rawMin: 1, rawMax: 200,
    mode: 'relative', step: 1, resolution: 25 };
  engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(position(10)).messages, []);
  assert.deepEqual(engine.process(position(18)).messages, [[0xb1, 74, 1]]);
  assert.deepEqual(engine.process(position(26)).messages, [[0xb1, 74, 1]]);
  assert.deepEqual(engine.process(position(18)).messages, [[0xb1, 74, 127]]);
  assert.deepEqual(engine.process(position(0)).messages, []);
  assert.deepEqual(engine.process(position(100)).messages, []);
  assert.deepEqual(engine.process(position(92)).messages, [[0xb1, 74, 127]]);
  profile.modes[0].bindings.SMART_STRIP = { type: 'cc', channel: 2, controller: 74, style: 'strip', rawMin: 1, rawMax: 200,
    mode: 'relative-offset', step: -1, resolution: 25 };
  engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(position(10)).messages, []);
  assert.deepEqual(engine.process(position(18)).messages, [[0xb1, 74, 63]]);
  assert.deepEqual(engine.process(position(10)).messages, [[0xb1, 74, 65]]);
});
test('profile round-trip is detached and rejects values that could generate invalid MIDI', () => {
  const profile = createDefaultProfile(), parsed = parseProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(parsed, profile); parsed.name = 'other'; assert.notEqual(parsed.name, profile.name);
  for (const binding of [ { type: 'note', channel: 0, note: 36, velocity: 100 }, { type: 'note', channel: 1, note: 128, velocity: 100 }, { type: 'mode', modeId: 'missing' }, { type: 'arbitrary' } ]) {
    const p = createDefaultProfile(); p.modes[0].bindings.PLAY = binding as any; assert.throws(() => parseProfile(p));
  }
  const p = createDefaultProfile(); p.modes[0].bindings.SMART_STRIP = { type: 'note', channel: 1, note: 36, velocity: 100 }; assert.throws(() => parseProfile(p));
  for (const invalid of [{ mode: 'unknown' }, { mode: 'relative', step: 0 }, { mode: 'relative-offset', resolution: 0 }]) {
    const strip = createDefaultProfile();
    strip.modes[0].bindings.SMART_STRIP = { type: 'cc', channel: 1, controller: 74, style: 'strip', rawMin: 1, rawMax: 200, ...invalid } as any;
    assert.throws(() => parseProfile(strip));
  }
  const bad = createDefaultProfile(); bad.modes[0].pressureBindings = { PAD_1: { type: 'note', channel: 1, note: 36, velocity: 100, onThreshold: 10, offThreshold: 20 } };
  assert.throws(() => parseProfile(bad));
});
test('LED report matches Rust color/brightness slots; report ID is separate', () => {
  const pads = PAD_IDS.map(() => ({ color: 0, brightness: 'off' as const }));
  const lights: any[] = pads; lights[0] = { color: 1, brightness: 'normal' }; lights[12] = { color: 11, brightness: 'bright' };
  const report = encodePadLights(lights);
  assert.equal(report.reportId, 0x80); assert.equal(report.data.length, 80);
  assert.equal(report.data[51], 6); assert.equal(report.data[39], 47);
  assert.equal(report.data.filter(Boolean).length, 2);
  assert.throws(() => encodePadLights([]));
  lights[0].color = 18; assert.throws(() => encodePadLights(lights));
});
test('button and Strip lights share the full 0x80 report with Pad dual colors', () => {
  const profile = createDefaultProfile();
  profile.modes[0].pads.forEach(pad => { pad.color = 0; pad.brightness = 'off'; });
  profile.modes[0].pads[0] = { color: 2, onColor: 1, brightness: 'dim' };
  profile.modes[0].buttonLights = { PLAY: { off: 'dim', on: 'bright' } };
  profile.modes[0].stripLight = { mode: 'dot', brightness: 'normal' };
  const mode = parseProfile(profile).modes[0];
  const state = { pads: mode.pads, buttons: mode.buttonLights, pressedPads: new Set(['PAD_1']),
    pressedButtons: new Set(['PLAY']), strip: { raw: 1, mode: 'dot' as const, brightness: 'normal' as const } };
  const report = encodeLights(state);
  assert.equal(report.reportId, 0x80); assert.equal(report.data.length, 80);
  assert.equal(report.data[22], 0x7f); assert.equal(report.data[51], 7); assert.equal(report.data[55], 70);
  assert.equal(report.data.filter(Boolean).length, 3);
  state.pressedButtons.clear(); state.pressedPads.clear(); state.strip.raw = 0;
  const idle = encodeLights(state);
  assert.equal(idle.data[22], 0x7c); assert.equal(idle.data[51], 8); assert.equal(idle.data.slice(55).filter(Boolean).length, 0);
});
test('shared Pad pressed brightness changes the LED value without changing idle brightness', () => {
  const pads = createDefaultProfile().modes[0].pads;
  pads[0] = { color: 2, onColor: 1, brightness: 'dim' };
  const state = { pads, pressedPads: new Set(['PAD_1']), padOnBrightness: 'normal' as const };
  assert.equal(encodeLights(state).data[51], 6);
  state.pressedPads.clear();
  assert.equal(encodeLights(state).data[51], 8);
  assert.equal(encodeLights({ ...state, pressedPads: new Set(['PAD_1']), padOnBrightness: 'off' }).data[51], 0);
  assert.throws(() => encodeLights({ ...state, padOnBrightness: 'invalid' as any }));
});
test('Strip Dot, Bar and Pan map raw 1–200 from left to right', () => {
  const pads = createDefaultProfile().modes[0].pads;
  const slots = (raw: number, mode: 'dot' | 'bar' | 'pan') =>
    Array.from(encodeLights({ pads, strip: { raw, mode, brightness: 'normal' } }).data.slice(55))
      .flatMap((value, index) => value ? [index] : []);
  assert.deepEqual(slots(1, 'dot'), [0]); assert.deepEqual(slots(200, 'dot'), [24]);
  assert.deepEqual(slots(1, 'bar'), [0]); assert.deepEqual(slots(200, 'bar'), Array.from({ length: 25 }, (_, i) => i));
  assert.deepEqual(slots(1, 'pan'), Array.from({ length: 13 }, (_, i) => i));
  assert.deepEqual(slots(100, 'pan'), [12]);
  assert.deepEqual(slots(200, 'pan'), Array.from({ length: 13 }, (_, i) => i + 12));
  assert.deepEqual(slots(0, 'pan'), []);
  assert.throws(() => encodeLights({ pads, strip: { raw: 201, mode: 'dot', brightness: 'normal' } }));
  const blue = encodeLights({ pads, strip: { raw: 200, mode: 'dot', brightness: 'bright', color: 11 } });
  assert.equal(blue.data[79], 47);
  assert.equal(blue.data[78], 0);
  const red = encodeLights({ pads, strip: { raw: 1, mode: 'bar', brightness: 'dim', color: 1 } });
  assert.equal(red.data[55], 5);
  assert.equal(encodeLights({ pads, strip: { raw: 1, mode: 'dot', brightness: 'normal' } }).data[55], 70);
  assert.throws(() => encodeLights({ pads, strip: { raw: 1, mode: 'dot', brightness: 'normal', color: 18 } }));
});
test('light settings reject invalid button slots, color and Strip mode', () => {
  const profile = createDefaultProfile();
  profile.modes[0].buttonLights = { ENCODER_TOUCH: { off: 'off', on: 'bright' } };
  assert.throws(() => parseProfile(profile));
  delete profile.modes[0].buttonLights;
  profile.modes[0].buttonLight = { off: 'dim', on: 'bright' };
  profile.modes[0].padOnBrightness = 'normal';
  assert.equal(parseProfile(profile).modes[0].buttonLight?.off, 'dim');
  profile.modes[0].buttonLight.on = 'invalid' as any;
  assert.throws(() => parseProfile(profile));
  profile.modes[0].buttonLight.on = 'bright';
  profile.modes[0].padOnBrightness = 'invalid' as any;
  assert.throws(() => parseProfile(profile));
  profile.modes[0].padOnBrightness = 'normal';
  profile.modes[0].pads[0].onColor = 18;
  assert.throws(() => parseProfile(profile));
  profile.modes[0].pads[0].onColor = 1;
  profile.modes[0].stripLight = { mode: 'bar', brightness: 'dim' };
  assert.doesNotThrow(() => parseProfile(profile));
  profile.modes[0].stripLight.color = 11;
  assert.equal(parseProfile(profile).modes[0].stripLight?.color, 11);
  profile.modes[0].stripLight.color = 18;
  assert.throws(() => parseProfile(profile));
});
test('recorded NoteOn triplets confirm all physical Pad numbers', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/recorded-pad-hits.json', import.meta.url), 'utf8'));
  assert.equal(fixture.hits.length, 16);
  fixture.hits.forEach((payload: number[], i: number) => {
    const events = new InputDecoder().decode(2, payload).events;
    assert.equal(events.length, 1);
    assert.equal(events[0].controlId, PAD_IDS[i]);
    assert.equal((events[0] as any).event, 'note-on');
  });
});
