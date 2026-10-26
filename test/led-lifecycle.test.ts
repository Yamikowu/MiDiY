import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_IDS, createDefaultProfile } from '@midiy/mikro-core';
import { TranslatorUI } from '../src/devices/mikro-mk3/mapping/translator-ui.ts';
import { ProfileLibrary } from '../src/devices/mikro-mk3/mapping/profile-library.ts';
import { TranslatorRuntime } from '../src/devices/mikro-mk3/runtime.ts';
import { MikroDriver } from '../src/devices/mikro-mk3/driver.ts';
import { WebHidAdapter } from '../src/adapters/input/web-hid.ts';
import { fixture, FakeMidi, tick } from './runtime-fixture.ts';

test('unmapped button LEDs stay off even when shared idle brightness is on', async () => {
  const profile = createDefaultProfile();
  profile.modes[0].buttonLight = { off: 'bright', on: 'dim' };
  profile.modes[0].bindings.PLAY = { type: 'note', channel: 1, note: 60, velocity: 100 };
  const { runtime } = fixture(profile);
  const play = BUTTON_IDS.indexOf('PLAY'), stop = BUTTON_IDS.indexOf('STOP');
  assert.equal(runtime.snapshot.lightReport.data[play], 0x7f);
  assert.equal(runtime.snapshot.lightReport.data[stop], 0);
  const driver = new MikroDriver();
  const report = driver.lights(profile.modes[0], { activePads: new Set(), pressedButtons: new Set(['PLAY', 'STOP']), stripRaw: 0 });
  assert.equal(report.data[play], 0x7c); assert.equal(report.data[stop], 0);
});

test('physical buttons, Pad hits, Encoder rotation and Strip touch select Mapping controls once per interaction', async t => {
  const mappingPage = { hidden: false };
  for (const [key, value] of Object.entries({
    window: new EventTarget(), navigator: { hid: new EventTarget() },
    localStorage: { getItem: () => null },
    document: { querySelectorAll: () => [], getElementById: () => mappingPage },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  class PhysicalSelectionUI extends (TranslatorUI as any) {
    mount() {}
    renderPressed() {}
    renderDevice() {}
    renderPorts() {}
    queueModeLights() {}
    renderModes() {}
    renderBinding() {}
    renderMap() {}
  }
  class SelectionUI extends PhysicalSelectionUI {
    selectedFromHardware: string[] = [];
    selectControl(id: string) { this.selectedFromHardware.push(id); this.session.selected = id; return Promise.resolve(); }
    addEvent() {}
  }
  const { runtime, input, midi } = fixture();
  const ui = new SelectionUI(runtime, new ProfileLibrary({ getItem: () => null, setItem() {} }), { toast() {} });
  ui.handleEvent({ kind: 'button', controlId: 'PLAY', pressed: true });
  ui.handleEvent({ kind: 'pad', controlId: 'PAD_2', padIndex: 13, event: 'note-on', raw: 1000, velocity: 60 });
  assert.equal(ui.session.followHardwareSelection, false);
  assert.deepEqual(ui.selectedFromHardware, []);
  ui.session.followHardwareSelection = true;
  ui.handleEvent({ kind: 'button', controlId: 'PLAY', pressed: true });
  ui.handleEvent({ kind: 'button', controlId: 'PLAY', pressed: false });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY']);
  await new Promise(resolve => setImmediate(resolve));
  ui.handleEvent({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 8, delta: 1 });
  ui.handleEvent({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 9, delta: 1 });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE']);
  await new Promise(resolve => setImmediate(resolve));
  ui.handleEvent({ kind: 'button', controlId: 'SMART_STRIP_TOUCH', pressed: true });
  ui.handleEvent({ kind: 'strip', controlId: 'SMART_STRIP', raw: 72 });
  ui.handleEvent({ kind: 'strip', controlId: 'SMART_STRIP', raw: 0 });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP']);
  await new Promise(resolve => setImmediate(resolve));
  const pad = { kind: 'pad', controlId: 'PAD_2', padIndex: 13, raw: 1000, velocity: 60 };
  ui.handleEvent({ ...pad, event: 'press-on', raw: 0 });
  ui.handleEvent({ ...pad, event: 'aftertouch' });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP']);
  ui.handleEvent({ ...pad, event: 'press-on' });
  ui.handleEvent({ ...pad, event: 'note-on' });
  await new Promise(resolve => setImmediate(resolve));
  ui.handleEvent({ ...pad, event: 'aftertouch' });
  ui.handleEvent({ ...pad, event: 'note-off' });
  ui.handleEvent({ ...pad, event: 'press-off' });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP', 'PAD_2']);
  ui.handleEvent({ ...pad, controlId: 'PAD_3', event: 'note-on' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.selectedFromHardware.at(-1), 'PAD_3');
  ui.session.selection = new Set(['PAD_2', 'PAD_3']);
  ui.handleEvent({ ...pad, controlId: 'PAD_4', event: 'note-on' });
  assert.equal(ui.selectedFromHardware.at(-1), 'PAD_3');
  ui.session.selection = new Set(['PAD_3']);
  mappingPage.hidden = true;
  ui.handleEvent({ kind: 'button', controlId: 'STOP', pressed: true });
  ui.handleEvent({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 10, delta: 1 });
  ui.handleEvent({ ...pad, controlId: 'PAD_4', event: 'note-on' });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP', 'PAD_2', 'PAD_3']);
  mappingPage.hidden = false; ui.session.followHardwareSelection = false;
  await runtime.connect(); await runtime.selectOutput('a');
  input.report(2, [12, 24, 0]); input.report(2, [12, 48, 0]);
  assert.deepEqual(midi.sent.map(entry => entry.message), [[0x90, 36, 64], [0x80, 36, 0]]);
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP', 'PAD_2', 'PAD_3']);
});

for (const takeover of [true, false]) {
  test(`shutdown stops LED producers and shares manual disconnect (takeover ${takeover})`, async () => {
    const api = new EventTarget() as any, device = new EventTarget() as any;
    let finish!: () => void; let closes = 0; const sent: number[][] = [];
    Object.assign(device, { opened: false, vendorId: 0x17cc, productId: 0x1700,
      collections: [{ outputReports: [{ reportId: 0x80, items: [{ reportSize: 8, reportCount: 80 }] }] }],
      async open() { device.opened = true; }, async close() { closes++; device.opened = false; },
      async sendReport(_id: number, bytes: Uint8Array) {
        sent.push(Array.from(bytes));
        if (sent.length === 1) await new Promise<void>(resolve => { finish = resolve; });
      } });
    api.getDevices = async () => [device];
    const driver = new MikroDriver();
    const runtime = new TranslatorRuntime(new WebHidAdapter(driver.definition.input, api), new FakeMidi(), driver);
    await runtime.connect();
    if (takeover) {
      runtime.setLedEnabled(true); await tick(); runtime.panic();
    }
    const closing = runtime.disconnect();
    assert.equal(runtime.snapshot.ledEnabled, false);
    assert.equal(runtime.disconnect(), closing);
    if (takeover) finish(); await closing;
    assert.equal(closes, 1); assert.equal(device.opened, false);
    assert.equal(sent.length, takeover ? 2 : 0);
    if (takeover) assert.deepEqual(sent.at(-1), Array(80).fill(0));
  });
}

for (const actionOn of ['down', 'up'] as const) {
  for (const type of ['note', 'cc', 'button-value'] as const) {
    test(`${type} Toggle LED follows mapping state on ${actionOn}, independently of physical press`, async () => {
      const profile = createDefaultProfile();
      profile.modes[0].toggleButtonLight = { off: 'dim', on: 'bright' };
      profile.modes[0].bindings.PLAY = type === 'note'
        ? { type, channel: 1, note: 60, velocity: 100, mode: 'toggle', actionOn }
        : type === 'cc' ? { type, channel: 1, controller: 20, style: 'toggle', on: 12, off: 100, actionOn }
        : { type, channel: 1, output: 'pitchbend', mode: 'toggle', on: 100, off: 8000, actionOn };
      const { runtime, input } = fixture(profile);
      await runtime.connect(); runtime.setLedEnabled(true); await tick();
      const index = BUTTON_IDS.indexOf('PLAY');
      const send = (pressed: boolean) => {
        const bytes = Array(13).fill(0); if (pressed) bytes[index >> 3] = 1 << (index % 8);
        input.report(1, bytes);
      };
      const light = () => runtime.snapshot.lightReport.data[index];
      assert.equal(light(), 0x7c);
      send(true); assert.equal(light(), actionOn === 'down' ? 0x7f : 0x7c);
      send(false); assert.equal(light(), 0x7f);
      assert.deepEqual(runtime.snapshot.pressedButtons, []);
      await tick(); assert.equal(input.sent.at(-1)!.data[index], 0x7f);
      runtime.updateFeedback(profile); assert.equal(light(), 0x7f);
      send(true); assert.equal(light(), actionOn === 'down' ? 0x7c : 0x7f);
      send(false); assert.equal(light(), 0x7c);
      send(true); send(false);
      runtime.applyProfile(profile); assert.equal(light(), 0x7c);
    });
  }
}

for (const style of ['momentary', 'trigger'] as const) {
  test(`${style} LED follows hold even when Trigger sends on release`, async () => {
    const profile = createDefaultProfile();
    profile.modes[0].buttonLight = { off: 'dim', on: 'bright' };
    profile.modes[0].bindings.PROJECT = style === 'momentary'
      ? { type: 'cc', channel: 1, controller: 20, style, on: 127, off: 0 }
      : { type: 'cc', channel: 1, controller: 20, style, value: 127, actionOn: 'up' };
    const { runtime, input } = fixture(profile); await runtime.connect();
    input.report(1, [1, ...Array(12).fill(0)]); assert.equal(runtime.snapshot.lightReport.data[0], 0x7f);
    input.report(1, Array(13).fill(0)); assert.equal(runtime.snapshot.lightReport.data[0], 0x7c);
  });
}

test('Note Toggle LED clears on output switch, Panic and unplug with actual note ownership', async () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.PROJECT = { type: 'note', channel: 1, note: 60, velocity: 100, mode: 'toggle' };
  const { runtime, input } = fixture(profile); await runtime.connect(); runtime.setLedEnabled(true);
  const toggle = () => { input.report(1, [1, ...Array(12).fill(0)]); input.report(1, Array(13).fill(0)); };
  toggle(); assert.ok(runtime.snapshot.lightReport.data[0]);
  await runtime.selectOutput('a'); await tick(); assert.equal(input.sent.at(-1)!.data[0], 0);
  toggle(); runtime.panic(); assert.equal(runtime.snapshot.lightReport.data[0], 0);
  toggle(); input.unplug(); assert.equal(runtime.snapshot.lightReport.data[0], 0);
});

test('Toggle brightness is independent, validates and round-trips', async () => {
  const profile = createDefaultProfile();
  const mode = profile.modes[0];
  mode.buttonLight = { off: 'dim', on: 'normal' };
  mode.bindings.PROJECT = { type: 'cc', channel: 1, controller: 1, style: 'toggle', on: 127, off: 0 };
  mode.bindings.FAVORITES = { type: 'cc', channel: 1, controller: 2, style: 'trigger', value: 127 };
  const { parseProfile } = await import('@midiy/mikro-core');
  const { runtime, input } = fixture(profile); await runtime.connect();
  assert.equal(runtime.snapshot.lightReport.data[0], 0);
  mode.toggleButtonLight = { off: 'off', on: 'bright' };
  const restored = parseProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(restored.modes[0].toggleButtonLight, mode.toggleButtonLight);
  runtime.updateFeedback(restored);
  assert.deepEqual([...runtime.snapshot.lightReport.data.slice(0, 2)], [0, 0x7c]);
  input.report(1, [3, ...Array(12).fill(0)]);
  assert.deepEqual([...runtime.snapshot.lightReport.data.slice(0, 2)], [0x7f, 0x7e]);
  input.report(1, Array(13).fill(0));
  assert.deepEqual([...runtime.snapshot.lightReport.data.slice(0, 2)], [0x7f, 0x7c]);
  assert.throws(() => parseProfile({ ...profile, modes: [{ ...mode, toggleButtonLight: { off: 'invalid', on: 'bright' } }] }));
});

test('FIXED VEL uses Toggle brightness and does not change MIDI until a Pad hit', async () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.FIXED_VEL = { type: 'fixed-velocity', velocity: 88 };
  profile.modes[0].buttonLight = { off: 'bright', on: 'dim' };
  profile.modes[0].toggleButtonLight = { off: 'off', on: 'normal' };
  const { runtime, input, midi } = fixture(profile); await runtime.connect(); await runtime.selectOutput('a');
  const index = BUTTON_IDS.indexOf('FIXED_VEL'), bytes = Array(13).fill(0);
  bytes[index >> 3] = 1 << (index % 8);
  assert.equal(runtime.snapshot.lightReport.data[index], 0);
  input.report(1, bytes); input.report(1, Array(13).fill(0));
  assert.equal(runtime.snapshot.lightReport.data[index], 0x7e); assert.equal(midi.sent.length, 0);
  input.report(2, [12, 24, 0]); assert.equal(midi.sent[0].message[2], 88);
  runtime.panic(); assert.equal(runtime.snapshot.lightReport.data[index], 0);
});

test('shared Pad idle brightness overrides all pads, preserves colors and held-note ownership', async () => {
  const { parseProfile, padNumberToIndex } = await import('@midiy/mikro-core');
  const profile = createDefaultProfile();
  profile.modes[0].pads[1] = { color: 3, onColor: 5, brightness: 'bright' };
  const { runtime, input, midi } = fixture(profile); await runtime.connect(); await runtime.selectOutput('a');
  profile.modes[0].padOffBrightness = 'normal'; runtime.updateFeedback(profile);
  let report = runtime.snapshot.lightReport.data;
  for (let number = 1; number <= 16; number++) {
    const pad = profile.modes[0].pads[number - 1];
    assert.equal(report[39 + padNumberToIndex(number)], (pad.color << 2) + 2);
  }
  input.report(2, [12, 24, 0]); const count = midi.sent.length;
  profile.modes[0].padOffBrightness = 'off'; runtime.updateFeedback(profile);
  assert.equal(midi.sent.length, count);
  report = runtime.snapshot.lightReport.data;
  assert.notEqual(report[39 + padNumberToIndex(1)], 0);
  assert.equal(report[39 + padNumberToIndex(2)], 0);
  input.report(2, [12, 48, 0]); assert.equal(runtime.snapshot.lightReport.data[39 + padNumberToIndex(1)], 0);
  assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
  assert.equal(parseProfile(JSON.parse(JSON.stringify(profile))).modes[0].padOffBrightness, 'off');
  assert.throws(() => parseProfile({ ...profile, modes: [{ ...profile.modes[0], padOffBrightness: 'bad' }] }));
});
