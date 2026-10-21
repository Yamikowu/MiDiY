import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile, type ControlId } from '@midiy/mikro-core';
import { commonActions, commonFields, controlsInRect, selectControls, patchControls, copyControls, pasteControls, EditHistory } from '../src/mapping/editor-model.ts';

const setup = () => { const profile = createDefaultProfile(); return { profile, modeId: profile.initialModeId }; };
test('selection toggles with Shift; reversed marquee intersects real control bounds', () => {
  assert.deepEqual(selectControls(['PAD_1'], ['PAD_2'], true), ['PAD_1', 'PAD_2']);
  assert.deepEqual(selectControls(['PAD_1', 'PAD_2'], ['PAD_1'], true), ['PAD_2']);
  assert.deepEqual(selectControls(['PAD_1'], ['PLAY'], false), ['PLAY']);
  assert.deepEqual(controlsInRect([{ id: 'PLAY', left: 10, top: 20, right: 30, bottom: 40 }, { id: 'STOP', left: 40, top: 20, right: 60, bottom: 40 }], { x: 35, y: 45 }, { x: 5, y: 15 }), ['PLAY']);
});
test('batch patches preserve mixed notes, unmapped controls, legacy Pad brightness and Press', () => {
  const { profile, modeId } = setup(); const mode = profile.modes[0];
  mode.pressureBindings = { PAD_1: { type: 'cc', channel: 2, controller: 7, from: 10, to: 100 } };
  mode.pads[0].brightness = 'bright';
  const fields = commonFields(profile, modeId, ['PAD_1', 'PAD_2']);
  assert.deepEqual(fields.find(f => f.key === 'hit.note')!.values, [36, 37]);
  const next = patchControls(profile, modeId, ['PAD_1', 'PAD_2'], { 'hit.channel': 5, 'pad.color': 3 });
  assert.equal((next.modes[0].bindings.PAD_1 as any).note, 36);
  assert.equal((next.modes[0].bindings.PAD_2 as any).note, 37);
  assert.equal((next.modes[0].bindings.PAD_1 as any).channel, 5);
  assert.equal((next.modes[0].bindings.PAD_2 as any).channel, 5);
  assert.deepEqual(next.modes[0].pressureBindings, mode.pressureBindings);
  assert.equal(next.modes[0].pads[0].brightness, 'bright');
  assert.equal(next.modes[0].pads[1].color, 3);
  assert.equal(mode.pads[0].color, 11);
});
test('mixed control capabilities expose shared fields and reject invalid atomic patches', () => {
  const { profile, modeId } = setup();
  assert.deepEqual(commonActions(['ENCODER_ROTATE', 'PAD_1']), ['none']);
  assert.ok(!commonActions(['PLAY', 'PAD_1']).includes('fixed-velocity'));
  assert.ok(!commonFields(profile, modeId, ['PLAY', 'PAD_1']).some(f => f.key.startsWith('pad.')));
  const before = structuredClone(profile);
  assert.throws(() => patchControls(profile, modeId, ['PAD_1', 'PAD_2'], { 'hit.channel': 17 }));
  assert.deepEqual(profile, before);
});
test('explicit action and Gate/Toggle/Trigger/Inc changes produce valid bindings', () => {
  const { profile, modeId } = setup();
  let next = patchControls(profile, modeId, ['PLAY', 'REC'], { action: 'cc' });
  for (const style of ['toggle', 'trigger', 'inc', 'momentary']) {
    next = patchControls(next, modeId, ['PLAY', 'REC'], { 'hit.style': style });
    assert.equal((next.modes[0].bindings.PLAY as any).style, style);
    assert.equal((next.modes[0].bindings.REC as any).style, style);
  }
  next = patchControls(next, modeId, ['PAD_1', 'PAD_2'], { pressAction: 'note', 'press.velocity': 45 });
  assert.equal((next.modes[0].pressureBindings!.PAD_1 as any).velocity, 45);
  assert.equal((next.modes[0].pressureBindings!.PAD_2 as any).velocity, 45);
});
test('copy one to many and ordered one-to-one paste are detached and preserve target brightness', () => {
  const { profile, modeId } = setup();
  profile.modes[0].pads[0].onColor = 3;
  profile.modes[0].pads[1].brightness = 'bright';
  profile.modes[0].pressureBindings = { PAD_1: { type: 'channel-pressure', channel: 3, from: 0, to: 90 } };
  const copies = copyControls(profile, modeId, ['PAD_1']);
  const next = pasteControls(profile, modeId, ['PAD_2', 'PAD_3'], copies);
  assert.equal((next.modes[0].bindings.PAD_2 as any).note, 36);
  assert.equal(next.modes[0].pads[1].brightness, 'bright');
  assert.equal(next.modes[0].pads[2].onColor, 3);
  assert.deepEqual(next.modes[0].pressureBindings!.PAD_3, profile.modes[0].pressureBindings.PAD_1);
  next.modes[0].pads[2].onColor = 7; assert.equal(copies[0].pad!.onColor, 3);
  const ordered = pasteControls(profile, modeId, ['PAD_4', 'PAD_3'], copyControls(profile, modeId, ['PAD_2', 'PAD_1']));
  assert.equal((ordered.modes[0].bindings.PAD_3 as any).note, 36);
  assert.equal((ordered.modes[0].bindings.PAD_4 as any).note, 37);
});
test('incompatible, count-mismatched, Fixed Vel and missing-mode pastes leave input untouched', () => {
  const { profile, modeId } = setup();
  const before = structuredClone(profile);
  assert.throws(() => pasteControls(profile, modeId, ['PLAY'], copyControls(profile, modeId, ['PAD_1'])), /paste_incompatible/);
  assert.throws(() => pasteControls(profile, modeId, ['PAD_3'], copyControls(profile, modeId, ['PAD_1', 'PAD_2'])), /paste_count_mismatch/);
  assert.deepEqual(profile, before);
  profile.modes[0].bindings.FIXED_VEL = { type: 'fixed-velocity', velocity: 90 };
  assert.throws(() => pasteControls(profile, modeId, ['PLAY'], copyControls(profile, modeId, ['FIXED_VEL'])), /paste_incompatible/);
  const other = structuredClone(profile); other.modes.push({ ...structuredClone(other.modes[0]), id: 'other' });
  other.modes[0].bindings.PLAY = { type: 'mode', modeId: 'other' };
  assert.throws(() => pasteControls(profile, modeId, ['PLAY'], copyControls(other, modeId, ['PLAY'])));
});
test('Strip copy includes independent Touch and lights', () => {
  const { profile, modeId } = setup();
  profile.modes[0].bindings.SMART_STRIP_TOUCH = { type: 'program', channel: 2, program: 7 };
  profile.modes[0].stripLight = { mode: 'pan', brightness: 'dim', color: 3 };
  const copy = copyControls(profile, modeId, ['SMART_STRIP']);
  delete profile.modes[0].bindings.SMART_STRIP_TOUCH;
  const next = pasteControls(profile, modeId, ['SMART_STRIP'], copy);
  assert.equal((next.modes[0].bindings.SMART_STRIP_TOUCH as any).program, 7);
  assert.equal(next.modes[0].stripLight!.mode, 'pan');
});
test('history treats batch as one step, supports redo branching, isolation and a 100-step limit', () => {
  const { profile, modeId } = setup(); const history = new EditHistory(profile);
  history.record(profile); assert.equal(history.canUndo, false);
  const next = patchControls(profile, modeId, ['PAD_1', 'PAD_2'], { 'hit.channel': 4 });
  history.record(next); assert.equal(history.canUndo, true);
  const peek = history.peek()!; peek.name = 'mutated'; assert.equal(history.peek()!.name, profile.name);
  assert.deepEqual(history.move(), profile); assert.deepEqual(history.move(true), next);
  history.move(); history.record({ ...profile, name: 'branch' }); assert.equal(history.canRedo, false);
  for (let i = 0; i < 105; i++) history.record({ ...profile, name: String(i) });
  let count = 0; while (history.move()) count++; assert.equal(count, 100);
});

test('shortcuts resolve both platforms and preserve native text undo/copy/paste', async () => {
  const { mappingShortcut } = await import('../src/mapping/editor-model.ts');
  const event = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false };
  assert.equal(mappingShortcut(event, false), 'undo');
  assert.equal(mappingShortcut({ ...event, ctrlKey: false, metaKey: true, shiftKey: true }, false), 'redo');
  assert.equal(mappingShortcut({ ...event, key: 'y' }, false), 'redo');
  assert.equal(mappingShortcut({ ...event, key: 'c' }, false), 'copy');
  assert.equal(mappingShortcut({ ...event, key: 'v' }, false), 'paste');
  for (const key of ['z', 'y', 'c', 'v']) assert.equal(mappingShortcut({ ...event, key }, true), undefined);
  assert.equal(mappingShortcut({ ...event, isComposing: true }, false), undefined);
  assert.equal(mappingShortcut({ ...event, repeat: true }, false), undefined);
});
