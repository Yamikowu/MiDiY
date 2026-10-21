import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPadVelocityCurve, PAD_VELOCITY_CURVES, MappingEngine, createDefaultProfile, parseProfile,
  type InputEvent
} from '@mpa/mikro-core';
import { ProfileLibrary } from '../src/profile-library.ts';

const hit = (velocity: number): InputEvent => ({ kind: 'pad', controlId: 'PAD_1', padIndex: 12,
  event: 'note-on', raw: velocity * 32, velocity });
const release: InputEvent = { ...hit(0), event: 'note-off' };

test('curves are monotonic, preserve endpoints and increase Soft / Hard strength progressively', () => {
  for (const curve of PAD_VELOCITY_CURVES) {
    assert.equal(applyPadVelocityCurve(0, curve), 0);
    assert.equal(applyPadVelocityCurve(1, curve) >= 1, true);
    assert.equal(applyPadVelocityCurve(127, curve), 127);
    let previous = 0;
    for (let input = 1; input <= 127; input++) {
      const output = applyPadVelocityCurve(input, curve);
      assert.ok(output >= previous && output <= 127);
      previous = output;
      if (curve === 'linear') assert.equal(output, input);
    }
  }
  const values = PAD_VELOCITY_CURVES.map(curve => applyPadVelocityCurve(64, curve));
  assert.deepEqual(values, [...values].sort((a, b) => b - a));
  assert.equal(new Set(values).size, 7);
});

test('legacy profiles stay Linear; selected curves survive validation, storage and reload', () => {
  const legacy = createDefaultProfile();
  assert.equal(new MappingEngine(legacy).process(hit(64)).messages[0][2], 64);
  assert.throws(() => parseProfile({ ...legacy, padVelocityCurve: 'unknown' }));
  assert.throws(() => parseProfile({ ...legacy, padVelocityCurve: null }));
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const library = new ProfileLibrary(storage);
  for (const curve of PAD_VELOCITY_CURVES) {
    library.save({ ...legacy, padVelocityCurve: curve });
    assert.equal(new ProfileLibrary(storage).current.padVelocityCurve, curve);
    assert.equal(parseProfile(JSON.parse(JSON.stringify(library.current))).padVelocityCurve, curve);
  }
});

test('gate and toggle hits use curves while release, fixed velocity and Press keep their values', () => {
  for (const mode of ['gate', 'toggle'] as const) {
    const profile = createDefaultProfile();
    profile.padVelocityCurve = 'soft-3';
    profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 'pad', mode };
    const engine = new MappingEngine(profile);
    assert.deepEqual(engine.process(hit(64)).messages, [[0x90, 36, applyPadVelocityCurve(64, 'soft-3')]]);
    if (mode === 'toggle') { assert.deepEqual(engine.process(release).messages, []); }
    assert.deepEqual(engine.process(mode === 'toggle' ? hit(64) : release).messages, [[0x80, 36, 0]]);
  }
  const profile = createDefaultProfile();
  profile.padVelocityCurve = 'hard-3';
  profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 100 };
  profile.modes[0].pressureBindings = { PAD_1: { type: 'note', channel: 1, note: 60, velocity: 90, onThreshold: 50, offThreshold: 25 } };
  const engine = new MappingEngine(profile);
  assert.deepEqual(engine.process(hit(64)).messages, [[0x90, 36, 100]]);
  assert.deepEqual(engine.process({ ...hit(100), event: 'aftertouch' }).messages, [[0x90, 60, 90]]);
  assert.deepEqual(engine.process(release).messages, [[0x80, 60, 0], [0x80, 36, 0]]);
});

test('Pad velocity range follows the curve for Gate and Toggle, including fixed ranges', () => {
  for (const mode of ['gate', 'toggle'] as const) {
    for (const curve of PAD_VELOCITY_CURVES) {
      const profile = createDefaultProfile();
      profile.padVelocityCurve = curve;
      profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 'pad', velocityMin: 20, velocityMax: 100, mode };
      for (const input of [1, 32, 64, 127]) {
        const engine = new MappingEngine(profile);
        assert.deepEqual(engine.process(hit(input)).messages, [[0x90, 36, Math.round(20 + applyPadVelocityCurve(input, curve) / 127 * 80)]]);
        assert.deepEqual(engine.flush(), [[0x80, 36, 0]]);
      }
      for (const fixed of [0, 75, 127]) {
        profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 'pad', velocityMin: fixed, velocityMax: fixed, mode };
        assert.deepEqual(new MappingEngine(profile).process(hit(64)).messages, [[0x90, 36, Math.max(1, fixed)]]);
      }
    }
  }
});

test('velocity ranges validate bounds and survive Profile storage', () => {
  const profile = createDefaultProfile();
  for (const [min, max] of [[-1, 127], [0, 128], [100, 20], [1.5, 127], [0, null]]) {
    profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 'pad', velocityMin: min, velocityMax: max } as any;
    assert.throws(() => parseProfile(profile));
  }
  profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 36, velocity: 'pad', velocityMin: 25, velocityMax: 90 };
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  new ProfileLibrary(storage).save(profile);
  assert.deepEqual(new ProfileLibrary(storage).current.modes[0].bindings.PAD_1, profile.modes[0].bindings.PAD_1);
});

test('general button Note velocity is 127 for Gate and Toggle, preserving Action on', () => {
  for (const mode of ['gate', 'toggle'] as const) {
    for (const actionOn of ['down', 'up'] as const) {
      const profile = createDefaultProfile();
      profile.modes[0].bindings.PLAY = { type: 'note', channel: 1, note: 60, velocity: 70, mode,
        ...(mode === 'toggle' ? { actionOn } : {}) };
      const parsed = parseProfile(profile);
      assert.equal((parsed.modes[0].bindings.PLAY as any).velocity, 127);
      const engine = new MappingEngine(profile);
      const down: InputEvent = { kind: 'button', controlId: 'PLAY', pressed: true };
      const messages = [...engine.process(down).messages, ...engine.process({ ...down, pressed: false }).messages];
      assert.deepEqual(messages[0], [0x90, 60, 127]);
      assert.ok(messages.slice(1).every(message => message[0] === 0x80));
    }
  }
});
