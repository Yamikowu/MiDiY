import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_IDS, type OutputReport } from '@mpa/mikro-core';
import { TranslatorUI } from '../src/translator.ts';

// Keep the real constructor, lifecycle listener, release and HID queue; replace DOM rendering.
class LifecycleUI extends (TranslatorUI as any) {
  mount() {}
  renderPressed() {}
  renderDevice() {}
  renderLightPreview() {}
  dispatch() {}
}

test('unmapped button LEDs stay off even when shared idle brightness is on', t => {
  for (const [key, value] of Object.entries({
    window: new EventTarget(), navigator: { hid: new EventTarget() },
    localStorage: { getItem: () => null },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  class PreviewUI extends LifecycleUI {
    lastReport!: OutputReport;
    renderLightPreview(report: OutputReport) { this.lastReport = report; }
  }
  const ui = new PreviewUI({ receive() {}, toast() {}, disconnected() {} });
  ui.profile.modes[0].buttonLight = { off: 'bright', on: 'dim' };
  ui.profile.modes[0].bindings.PLAY = { type: 'note', channel: 1, note: 60, velocity: 100 };
  ui.queueModeLights();
  const play = BUTTON_IDS.indexOf('PLAY'), stop = BUTTON_IDS.indexOf('STOP');
  assert.equal(ui.lastReport.data[play], 0x7f);
  assert.equal(ui.lastReport.data[stop], 0);
  ui.pressedButtons.add('PLAY'); ui.pressedButtons.add('STOP');
  ui.queueModeLights();
  assert.equal(ui.lastReport.data[play], 0x7c);
  assert.equal(ui.lastReport.data[stop], 0);
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
  class PhysicalSelectionUI extends LifecycleUI {
    selectedFromHardware: string[] = [];
    selectControl(id: string) { this.selectedFromHardware.push(id); this.selected = id; return Promise.resolve(); }
    addEvent() {}
  }
  const ui = new PhysicalSelectionUI({ receive() {}, toast() {}, disconnected() {} });
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
  test(`pagehide stops LED producers and shares manual disconnect (takeover ${takeover})`, async t => {
    const page = new EventTarget();
    const api = new EventTarget() as any;
    const device = new EventTarget() as any;
    let finish!: () => void; let closes = 0;
    const sent: number[][] = [];
    Object.assign(device, {
      opened: false, vendorId: 0x17cc, productId: 0x1700,
      collections: [{ outputReports: [{ reportId: 0x80, items: [{ reportSize: 8, reportCount: 80 }] }] }],
      async open() { device.opened = true; },
      async close() { closes++; device.opened = false; },
      async sendReport(_id: number, bytes: Uint8Array) {
        sent.push(Array.from(bytes));
        if (sent.length === 1) await new Promise<void>(resolve => { finish = resolve; });
      },
    });
    api.getDevices = async () => [device];
    for (const [key, value] of Object.entries({
      window: page, navigator: { hid: api },
      localStorage: { getItem: () => null },
      document: { querySelectorAll: () => [] },
    })) {
      const original = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, value });
      t.after(() => {
        if (original) Object.defineProperty(globalThis, key, original);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    const ui = new LifecycleUI({ receive() {}, toast() {}, disconnected() {} });
    await ui.hid.connect();
    ui.ledEnabled = takeover;
    if (takeover) {
      ui.queueModeLights();
      await new Promise(resolve => setImmediate(resolve));
      ui.queueModeLights(); // A coalesced UI update must never follow the reset.
    }
    page.dispatchEvent(new Event('pagehide'));
    assert.equal(ui.ledEnabled, false);
    assert.equal(ui.pendingLed, null);
    const closing = ui.disconnect(); // Manual disconnect overlapping pagehide.
    page.dispatchEvent(new Event('pagehide'));
    if (takeover) finish();
    await closing;
    assert.equal(closes, 1);
    assert.equal(device.opened, false);
    assert.equal(sent.length, takeover ? 2 : 0);
    if (takeover) assert.deepEqual(sent.at(-1), Array(80).fill(0));
  });
}
