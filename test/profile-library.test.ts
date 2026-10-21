import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile } from '@midiy/mikro-core';
import { ProfileLibrary } from '../src/mapping/profile-library';

const storage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('existing single profile migrates without overwriting it on load; copies stay independent', () => {
  const store = storage(), old = createDefaultProfile(); old.name = 'Existing';
  (old as { schema: string }).schema = 'mpa-profile-v1';
  store.setItem('mpa-profile-v1', JSON.stringify(old));
  const library = new ProfileLibrary(store);
  assert.equal(library.current.name, 'Existing');
  assert.equal(library.current.schema, 'midiy-profile-v1');
  assert.equal(store.getItem('midiy-profile-library-v1'), null);
  const changed = library.current; changed.name = 'Koala';
  changed.modes[0].bindings.PAD_1 = { type: 'note', channel: 2, note: 60, velocity: 'pad' };
  library.save(changed, true);
  const copyId = library.activeId;
  assert.equal(library.entries.length, 2);
  assert.deepEqual(new ProfileLibrary(store).current, changed);
  assert.deepEqual(library.select('legacy'), { ...old, schema: 'midiy-profile-v1' });
  assert.deepEqual(library.select(copyId), changed);
  assert.equal(JSON.parse(store.getItem('midiy-profile-v1')!).schema, 'midiy-profile-v1');
  assert.equal(JSON.parse(store.getItem('midiy-profile-library-v1')!).schema, 'midiy-profile-library-v1');
  assert.equal(JSON.parse(store.getItem('mpa-profile-v1')!).schema, 'mpa-profile-v1');
  assert.equal('activeId' in library.current, false);
});

test('legacy named library keeps all profiles and active selection until next save', () => {
  const store = storage();
  const first = createDefaultProfile(); first.name = 'First';
  const second = createDefaultProfile(); second.name = 'Second';
  store.setItem('mpa-profile-library-v1', JSON.stringify({
    schema: 'mpa-profile-library-v1', activeId: 'second', entries: [
      { id: 'first', profile: { ...first, schema: 'mpa-profile-v1' } },
      { id: 'second', profile: { ...second, schema: 'mpa-profile-v1' } }
    ]
  }));
  const library = new ProfileLibrary(store);
  assert.equal(library.current.name, 'Second');
  assert.equal(library.entries.length, 2);
  assert.equal(store.getItem('midiy-profile-library-v1'), null);
  library.save(library.current);
  assert.equal(new ProfileLibrary(store).current.name, 'Second');
  assert.equal(JSON.parse(store.getItem('midiy-profile-library-v1')!).entries.length, 2);
});

test('invalid library falls back to valid legacy profile without deleting stored data', () => {
  const store = storage(), old = createDefaultProfile(); old.name = 'Keep me';
  store.setItem('mpa-profile-v1', JSON.stringify({ ...old, schema: 'mpa-profile-v1' }));
  store.setItem('midiy-profile-library-v1', '{broken');
  const library = new ProfileLibrary(store);
  assert.equal(library.current.name, 'Keep me');
  assert.ok(library.warning);
  assert.equal(store.getItem('midiy-profile-library-v1'), '{broken');
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
  assert.equal(library.activeId, 'legacy');
});
