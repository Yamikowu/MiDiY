import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  InputDecoder, MappingEngine, BUTTON_IDS, PAD_IDS, padIndexToNumber, padNumberToIndex,
  createDefaultProfile, createMode, parseProfile, encodePadLights, type InputEvent
} from '@mpa/mikro-core';
import { normalizeImport, summarizeCapture } from '../src/analysis.js';

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
  assert.deepEqual(decoder.decode(1, bytes).events, [{ kind: 'strip', controlId: 'SMART_STRIP', raw: 200 }]);
  bytes[6] = 0; bytes[9] = 0;
  assert.deepEqual(decoder.decode(1, bytes).events, [{ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 0, delta: -15 }, { kind: 'strip', controlId: 'SMART_STRIP', raw: 0 }]);
  decoder.reset(); assert.equal(decoder.decode(1, bytes).events.length, 1);
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
test('profile round-trip is detached and rejects values that could generate invalid MIDI', () => {
  const profile = createDefaultProfile(), parsed = parseProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(parsed, profile); parsed.name = 'other'; assert.notEqual(parsed.name, profile.name);
  for (const binding of [ { type: 'note', channel: 0, note: 36, velocity: 100 }, { type: 'note', channel: 1, note: 128, velocity: 100 }, { type: 'mode', modeId: 'missing' }, { type: 'arbitrary' } ]) {
    const p = createDefaultProfile(); p.modes[0].bindings.PLAY = binding as any; assert.throws(() => parseProfile(p));
  }
  const p = createDefaultProfile(); p.modes[0].bindings.SMART_STRIP = { type: 'note', channel: 1, note: 36, velocity: 100 }; assert.throws(() => parseProfile(p));
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
test('recorded v1 session remains importable; each pad capture confirms Rust physical mapping', () => {
  const session = normalizeImport(JSON.parse(readFileSync(new URL('../docs/mpa-session-2026-10-19T08-55-28-274Z.json', import.meta.url), 'utf8')));
  assert.equal(session.reports.length, 3188);
  for (const id of PAD_IDS) {
    const capture = session.captures.find((c: any) => c.controlId === id);
    assert.ok(capture);
    const decoder = new InputDecoder();
    const events = capture.samples.flatMap((r: any) => decoder.decode(r.reportId, r.bytes).events).filter((e: any) => e.kind === 'pad' && e.event === 'note-on');
    assert.ok(events.length); assert.ok(events.every((e: any) => e.controlId === id));
    assert.deepEqual(summarizeCapture(capture), capture.candidates);
  }
});
