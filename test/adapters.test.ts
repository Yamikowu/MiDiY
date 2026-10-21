import test from 'node:test';
import assert from 'node:assert/strict';
import { WebHidAdapter } from '../src/adapters/web-hid.ts';
import { WebMidiAdapter } from '../src/adapters/web-midi.ts';

function hidFixture() {
  const api = new EventTarget() as any;
  const device = new EventTarget() as any;
  Object.assign(device, { opened: false, vendorId: 0x17cc, productId: 0x1700,
    collections: [{ outputReports: [{ reportId: 0x80, items: [{ reportSize: 8, reportCount: 80 }] }], children: [] }],
    async open() { device.opened = true; }, async close() { device.opened = false; } });
  api.requestDevice = async () => [device];
  api.getDevices = async () => [];
  return { api, device };
}
test('WebHID adapter separates ID, validates descriptor length, and never writes on connect', async () => {
  const { api, device } = hidFixture(); const sent: any[] = [];
  device.sendReport = async (id: number, bytes: Uint8Array) => sent.push([id, Array.from(bytes)]);
  const hid = new WebHidAdapter(() => {}, () => {}, api);
  await hid.connect(); assert.equal(sent.length, 0);
  await assert.rejects(hid.send({ reportId: 0x80, data: new Uint8Array(81) }));
  await assert.rejects(hid.send({ reportId: 0xe0, data: new Uint8Array(80) }));
  await hid.send({ reportId: 0x80, data: new Uint8Array(80) });
  assert.equal(sent[0][0], 0x80); assert.equal(sent[0][1].length, 80);
  await hid.disconnect(); assert.equal(device.opened, false);
});
test('WebHID queued writes cannot cross a disconnected device generation', async () => {
  const { api, device } = hidFixture();
  let finish!: () => void; let calls = 0;
  device.sendReport = async () => { calls++; await new Promise<void>(r => { finish = r; }); };
  const hid = new WebHidAdapter(() => {}, () => {}, api); await hid.connect();
  const first = hid.send({ reportId: 0x80, data: new Uint8Array(80) });
  await new Promise(r => setImmediate(r));
  const second = hid.send({ reportId: 0x80, data: new Uint8Array(80) });
  const rejected = assert.rejects(second, /取消舊輸出/);
  const close = hid.disconnect(); finish(); await first; await rejected; await close;
  assert.equal(calls, 1);
});
function midiFixture() {
  const access = new EventTarget() as any; const sent: any[] = [];
  const make = (id: string) => ({ id, name: id, state: 'connected', async open() {}, async close() {}, send(message: number[]) { sent.push([id, message]); } });
  const a = make('a'), b = make('b'); access.outputs = new Map([['a', a], ['b', b]]);
  return { access, sent, a, b };
}
test('Web MIDI output switch flushes notes to old endpoint and disconnect attempts final offs', async () => {
  const { access, sent, b } = midiFixture(); let lost = 0;
  const midi = new WebMidiAdapter(() => {}, () => { lost++; return [[0x80, 37, 0]]; }, async () => access);
  await midi.enable(); await midi.select('a', []); midi.send([[0x90, 36, 100]]);
  await midi.select('b', [[0x80, 36, 0]]);
  midi.send([[0x90, 37, 100]]); b.state = 'disconnected'; access.dispatchEvent(new Event('statechange'));
  assert.deepEqual(sent, [['a', [0x90, 36, 100]], ['a', [0x80, 36, 0]], ['b', [0x90, 37, 100]], ['b', [0x80, 37, 0]]]);
  assert.equal(lost, 1); assert.equal(midi.output, null);
});
test('rapid MIDI port selection cannot install a stale pending port', async () => {
  const { access, a } = midiFixture(); let resolve!: () => void;
  a.open = () => new Promise<void>(r => { resolve = r; });
  const midi = new WebMidiAdapter(() => {}, () => [], async () => access); await midi.enable();
  const old = midi.select('a', []); await new Promise(r => setImmediate(r));
  const next = midi.select('b', []); resolve(); await old; await next;
  assert.equal(midi.output?.id, 'b');
});
test('already granted Mikro reconnects without prompting and ignores unrelated devices', async () => {
  const { api, device } = hidFixture(); let prompts = 0;
  api.getDevices = async () => [{ vendorId: 1, productId: 2 }, device];
  api.requestDevice = async () => { prompts++; return []; };
  const hid = new WebHidAdapter(() => {}, () => {}, api);
  assert.equal(await hid.connect(), device); assert.equal(prompts, 0);
});
test('MIDI send errors clear endpoint once and discard engine state through callback', async () => {
  const { access, a } = midiFixture(); let lost = 0;
  a.send = () => { throw new Error('gone'); };
  const midi = new WebMidiAdapter(() => {}, () => { lost++; return []; }, async () => access);
  await midi.enable(); await midi.select('a', []);
  assert.throws(() => midi.send([[0x90, 36, 100]]), /gone/);
  assert.equal(lost, 1); assert.equal(midi.output, null);
});

test('shutdown cancels queued lights, serializes all-off after in-flight output, and shares close', async () => {
  const { api, device } = hidFixture();
  let finish!: () => void; const sent: number[][] = []; let closes = 0;
  device.close = async () => { closes++; device.opened = false; };
  device.sendReport = async (_id: number, bytes: Uint8Array) => {
    sent.push(Array.from(bytes));
    if (sent.length === 1) await new Promise<void>(r => { finish = r; });
  };
  const hid = new WebHidAdapter(() => {}, () => {}, api); await hid.connect();
  const first = hid.send({ reportId: 0x80, data: new Uint8Array(80).fill(1) });
  await new Promise(r => setImmediate(r));
  const stale = assert.rejects(hid.send({ reportId: 0x80, data: new Uint8Array(80).fill(2) }), /取消舊輸出/);
  const closing = hid.disconnect({ reportId: 0x80, data: new Uint8Array(80) });
  assert.equal(hid.disconnect(), closing);
  await assert.rejects(hid.send({ reportId: 0x80, data: new Uint8Array(80).fill(3) }), /正在關閉/);
  assert.equal(closes, 0);
  finish(); await first; await stale; await closing;
  assert.deepEqual(sent, [Array(80).fill(1), Array(80).fill(0)]);
  assert.equal(closes, 1);
});

test('shutdown attempts close even when all-off fails and can reconnect afterwards', async () => {
  const { api, device } = hidFixture();
  device.sendReport = async () => { throw new Error('write failed'); };
  const hid = new WebHidAdapter(() => {}, () => {}, api); await hid.connect();
  await assert.rejects(hid.disconnect({ reportId: 0x80, data: new Uint8Array(80) }), /write failed/);
  assert.equal(device.opened, false); assert.equal(hid.device, null);
  await hid.connect(); assert.equal(hid.device, device);
});
