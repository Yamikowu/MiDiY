import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile } from '@midiy/mikro-core';
import { ProfileLibrary } from '../src/mapping/profile-library';

const storage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('named profiles save, reload, select and copy independently in one library', () => {
  const store = storage(), library = new ProfileLibrary(store);
  assert.equal(library.persisted, false);
  assert.equal(store.getItem('midiy-profile-library-v2'), null);
  const original = library.current, originalId = library.activeId;
  const changed = library.current; changed.name = 'Koala';
  changed.modes[0].bindings.PAD_1 = { type: 'note', channel: 2, note: 60, velocity: 'pad' };
  library.save(changed, true);
  const copyId = library.activeId;
  assert.equal(library.entries.length, 2);
  assert.deepEqual(new ProfileLibrary(store).current, changed);
  assert.deepEqual(library.select(originalId), original);
  assert.deepEqual(library.select(copyId), changed);
  assert.equal(JSON.parse(store.getItem('midiy-profile-library-v2')!).schema, 'midiy-profile-library-v2');
  assert.equal(store.getItem('midiy-profile-v2'), null);
  assert.equal('activeId' in library.current, false);
});

test('old storage is ignored; invalid current library uses defaults without overwriting data', () => {
  const store = storage();
  for (const key of ['mpa-profile-v1', 'mpa-profile-library-v1', 'midiy-profile-v1', 'midiy-profile-library-v1']) {
    store.setItem(key, 'old data');
  }
  const clean = new ProfileLibrary(store);
  assert.equal(clean.persisted, false);
  assert.equal(clean.warning, '');
  assert.deepEqual(clean.current, createDefaultProfile());
  store.setItem('midiy-profile-library-v2', '{broken');
  const recovered = new ProfileLibrary(store);
  assert.deepEqual(recovered.current, createDefaultProfile());
  assert.ok(recovered.warning);
  assert.equal(store.getItem('midiy-profile-library-v2'), '{broken');
});

test('deleting the selected profile loads another and keeps at least one profile', () => {
  const store = storage(), library = new ProfileLibrary(store);
  const copy = library.current; copy.name = 'Studio'; library.save(copy, true);
  assert.equal(library.deleteActive().name, 'Mikro MIDI');
  assert.equal(library.entries.length, 1);
  assert.equal(new ProfileLibrary(store).current.name, 'Mikro MIDI');
  assert.throws(() => library.deleteActive(), /至少保留/);
});

test('unavailable storage leaves factory mapping usable and failed save preserves the current library', () => {
  const library = new ProfileLibrary({ getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); } });
  assert.equal(library.persisted, false);
  assert.equal(library.current.modes[0].bindings.PAD_1?.type, 'note');
  assert.throws(() => library.save(createDefaultProfile(), true));
  assert.equal(library.entries.length, 1);
  assert.equal(library.activeId, 'default');
});
