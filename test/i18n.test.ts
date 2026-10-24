import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../src/i18n/en.ts';
import { zhTW } from '../src/i18n/zh-TW.ts';
import { initializeLocale, resolveLocale, setLocale, getLocale, onLocaleChange,
  t, l, attribute, formatError, LANGUAGE_KEY } from '../src/i18n/index.ts';
import { fixture } from './runtime-fixture.ts';
import { AppError } from '../src/runtime/issues.ts';

test('locale resolution honors saved preference, then browser languages, then Traditional Chinese', () => {
  assert.equal(resolveLocale('en', ['zh-TW']), 'en');
  assert.equal(resolveLocale('zh-TW', ['en-US']), 'zh-TW');
  assert.equal(resolveLocale(null, ['ja', 'en-GB', 'zh-TW']), 'en');
  assert.equal(resolveLocale('invalid', ['zh-HK']), 'zh-TW');
  assert.equal(resolveLocale(null, ['ja']), 'zh-TW');
});
test('both dictionaries cover identical keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zhTW).sort());
  for (const key of Object.keys(zhTW) as (keyof typeof zhTW)[]) {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(placeholders(en[key]), placeholders(zhTW[key]), key);
    assert.doesNotMatch(en[key], /[\p{Script=Han}]/u, key);
  }
});
test('locale persistence uses a separate key and never touches a Profile or runtime', async () => {
  const saved = new Map([['midiy-profile-v1', '{"name":"工作區"}']]);
  initializeLocale({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } }, ['zh-TW']);
  const { runtime, input, midi } = fixture(); await runtime.connect(); await runtime.selectOutput('a');
  input.report(2, [12, 24, 0]); const before = runtime.snapshot;
  let changes = 0; const unsubscribe = onLocaleChange(() => changes++);
  setLocale('en'); setLocale('en');
  assert.equal(getLocale(), 'en'); assert.equal(changes, 1);
  assert.equal(saved.get(LANGUAGE_KEY), 'en'); assert.equal(saved.get('midiy-profile-v1'), '{"name":"工作區"}');
  assert.deepEqual(runtime.snapshot, before); assert.equal(midi.sent.length, 1); assert.equal(input.sent.length, 0);
  unsubscribe(); setLocale('zh-TW'); assert.equal(changes, 1);
});
test('localization bindings escape user parameters while messages and errors remain readable', () => {
  initializeLocale(undefined, ['en']);
  assert.equal(t('delete_profile_and_all_its_modes', { p0: '工作區' }), 'Delete profile “工作區” and all its modes?');
  assert.match(l('action_notes_2', { p0: '<img src=x onerror="bad">' }), /&lt;img/);
  assert.doesNotMatch(l('action_notes_2', { p0: '<img src=x>' }), /<img/);
  assert.doesNotMatch(attribute('title', 'select', { p0: '" onmouseover="bad' }), /title="Select " onmouseover/);
  assert.equal(formatError(new AppError('hid_output_unavailable', 'legacy', { p0: '80' })), 'Device does not declare Output Report 0x80');
  assert.equal(formatError({ code: 'led_send_failed', message: 'legacy', detail: { code: 'hid_disconnected', message: 'legacy' } }), 'LED send failed: No HID device connected');
  assert.equal(formatError(new Error('無效的 MiDiY v2 設定檔')), 'Invalid MiDiY v2 profile');
  assert.equal(formatError({ code: '__proto__', message: 'Unknown error' }), 'Unknown error');
});
test('blocked language storage still permits switching', () => {
  initializeLocale({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, ['en']);
  assert.equal(getLocale(), 'en'); assert.doesNotThrow(() => setLocale('zh-TW'));
  assert.equal(getLocale(), 'zh-TW');
});
