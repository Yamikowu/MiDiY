import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile } from '@midiy/mikro-core';
import { EditorSession } from '../src/devices/mikro-mk3/mapping/editor-session';
import { ProfileLibrary } from '../src/devices/mikro-mk3/mapping/profile-library';
import { TranslatorUI } from '../src/devices/mikro-mk3/mapping/translator-ui';
import { fixture } from './runtime-fixture';

test('editor owns a detached profile; browsing and unconfirmed selection preserve the draft', () => {
  const original = createDefaultProfile(), session = new EditorSession(original);
  session.editorModeId = session.profile.modes[1].id;
  session.bindingDirty = true; session.batchChanges = { 'hit.note': 61 };
  const values = { note: '6', 'press-type': 'off' }; session.setSingleDraft('note', values); values.note = 'outside';
  assert.equal(session.singleDraft!.values.note, '6');
  assert.doesNotThrow(() => JSON.stringify(session.singleDraft));
  assert.equal(session.select(['PAD_2'], false), false);
  assert.deepEqual([...session.selection], ['PAD_1']);
  assert.deepEqual(session.batchChanges, { 'hit.note': 61 });
  assert.equal(session.select(['PAD_2'], true), true);
  assert.equal(session.bindingDirty, false); assert.equal(session.singleDraft, null);
  assert.deepEqual(session.batchChanges, {});
  session.profile.name = 'draft';
  assert.equal(original.name, 'Mikro MIDI');
});

test('multi-control and paste drafts only change the profile on apply, with independent history copies', () => {
  const session = new EditorSession(createDefaultProfile());
  session.select(['PAD_1', 'PAD_2'], true);
  session.batchChanges = { 'hit.note': 64 }; session.bindingDirty = true;
  const draft = session.batchDraft();
  assert.notDeepEqual(draft, session.profile);
  assert.equal(session.profile.modes[0].bindings.PAD_1?.type === 'note' && session.profile.modes[0].bindings.PAD_1.note, 36);
  session.applyDraft(draft); session.history.record(session.profile); session.copy();
  session.select(['PAD_3', 'PAD_4'], true);
  session.pendingPaste = session.pasteDraft(); session.bindingDirty = true;
  assert.equal(session.profile.modes[0].bindings.PAD_3?.type === 'note' && session.profile.modes[0].bindings.PAD_3.note, 38);
  session.applyDraft(session.batchDraft()); session.history.record(session.profile);
  const undo = session.history.peek(false)!; session.history.move(false); session.profile = undo;
  assert.equal(session.profile.modes[0].bindings.PAD_3?.type === 'note' && session.profile.modes[0].bindings.PAD_3.note, 38);
  const redo = session.history.peek(true)!;
  assert.equal(redo.modes[0].bindings.PAD_3?.type === 'note' && redo.modes[0].bindings.PAD_3.note, 64);
  undo.name = 'outside mutation';
  assert.notEqual(session.history.peek(true)!.name, 'outside mutation');
});

test('loading a profile resets drafts and history while preserving the copied controls', () => {
  const session = new EditorSession(createDefaultProfile()); session.copy();
  session.bindingDirty = true; session.batchChanges = { 'hit.note': 67 }; session.pendingPaste = session.pasteDraft();
  session.editingProfile = true; session.editingMode = true;
  const next = createDefaultProfile(); next.name = 'another';
  session.load(next, false); next.name = 'mutated outside';
  assert.equal(session.profile.name, 'another'); assert.equal(session.bindingDirty, false);
  assert.equal(session.pendingPaste, null); assert.deepEqual(session.batchChanges, {});
  assert.equal(session.editingProfile, false); assert.equal(session.editingMode, false);
  assert.equal(session.history.canUndo, false); assert.equal(session.copied.length, 1);
});

test('failed storage keeps applied Runtime changes dirty, and failed undo does not advance history', async () => {
  class UI extends (TranslatorUI as any) {
    mount() {} renderPressed() {} renderDevice() {} renderPorts() {} queueModeLights() {}
    renderModes() {} renderBinding() {} renderMap() {} renderSaveState() {} renderLibrary() {}
    renderEditStates() {} renderPlayingMode() {} renderEditActions() {}
    el() { return { value: '', textContent: '' }; }
  }
  const errors: string[] = [];
  let fail = false;
  const library = new ProfileLibrary({ getItem: () => null, setItem() { if (fail) throw Error('disk full'); } });
  const { runtime, midi, input } = fixture();
  const ui = new UI(runtime, library, { toast: (text: string) => errors.push(text) });
  await runtime.connect(); await runtime.enableMidi(); await runtime.selectOutput('a');
  ui.session.profile.modes[0].bindings.PAD_1 = { type: 'note', channel: 1, note: 70, velocity: 'pad' };
  fail = true;
  assert.equal(ui.commit(), false); assert.equal(ui.session.profileDirty, true);
  assert.equal(library.current.modes[0].bindings.PAD_1?.type === 'note' && library.current.modes[0].bindings.PAD_1.note, 36);
  input.report(2, [12, 24, 0]);
  assert.ok(midi.sent.some(entry => entry.message[0] === 0x90 && entry.message[1] === 70));
  const profile = structuredClone(ui.session.profile), undo = ui.session.history.peek(false);
  await ui.restoreEdit(false);
  assert.deepEqual(ui.session.profile, profile); assert.deepEqual(ui.session.history.peek(false), undo);
  assert.equal(ui.session.profileDirty, true); assert.equal(errors.length, 2);
  await runtime.disconnect();
});
