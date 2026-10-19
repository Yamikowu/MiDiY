import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile } from '@mpa/mikro-core';
import { ProfileLibrary } from '../src/profile-library';

const storage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('existing single profile migrates without overwriting it on load; copies stay independent', () => {
  const store = storage(), old = createDefaultProfile(); old.name = 'Existing';
  store.setItem('mpa-profile-v1', JSON.stringify(old));
  const library = new ProfileLibrary(store);
  assert.equal(library.current.name, 'Existing');
  assert.equal(store.getItem('mpa-profile-library-v1'), null);
  const changed = library.current; changed.name = 'Koala';
  changed.modes[0].bindings.PAD_1 = { type: 'note', channel: 2, note: 60, velocity: 'pad' };
  library.save(changed, true);
  const copyId = library.activeId;
  assert.equal(library.entries.length, 2);
  assert.deepEqual(new ProfileLibrary(store).current, changed);
  assert.deepEqual(library.select('legacy'), old);
  assert.deepEqual(library.select(copyId), changed);
  assert.equal(JSON.parse(store.getItem('mpa-profile-v1')!).schema, 'mpa-profile-v1');
  assert.equal('activeId' in library.current, false);
});

test('invalid library falls back to valid legacy profile without deleting stored data', () => {
  const store = storage(), old = createDefaultProfile(); old.name = 'Keep me';
  store.setItem('mpa-profile-v1', JSON.stringify(old));
  store.setItem('mpa-profile-library-v1', '{broken');
  const library = new ProfileLibrary(store);
  assert.equal(library.current.name, 'Keep me');
  assert.ok(library.warning);
  assert.equal(store.getItem('mpa-profile-library-v1'), '{broken');
});

test('unavailable storage leaves factory mapping usable and failed save preserves the current library', () => {
  const library = new ProfileLibrary({ getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('quota'); } });
  assert.equal(library.persisted, false);
  assert.equal(library.current.modes[0].bindings.PAD_1?.type, 'note');
  assert.throws(() => library.save(createDefaultProfile(), true));
  assert.equal(library.entries.length, 1);
  assert.equal(library.activeId, 'legacy');
});
