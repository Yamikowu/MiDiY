import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_IDS, createDefaultProfile } from '@midiy/mikro-core';
import { TranslatorUI } from '../src/mapping/translator-ui.ts';
import { ProfileLibrary } from '../src/mapping/profile-library.ts';
import { TranslatorRuntime } from '../src/runtime/translator-runtime.ts';
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

test('physical buttons, Encoder rotation and Strip touch select Mapping controls once per interaction', async t => {
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
    selectControl(id: string) { this.selectedFromHardware.push(id); this.selected = id; return Promise.resolve(); }
    addEvent() {}
  }
  const ui = new SelectionUI(fixture().runtime, new ProfileLibrary({ getItem: () => null, setItem() {} }), { toast() {} });
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
  mappingPage.hidden = true;
  ui.handleEvent({ kind: 'button', controlId: 'STOP', pressed: true });
  ui.handleEvent({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: 10, delta: 1 });
  assert.deepEqual(ui.selectedFromHardware, ['PLAY', 'ENCODER_ROTATE', 'SMART_STRIP']);
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
