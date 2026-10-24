import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProfile } from '@midiy/mikro-core';
import { fixture, tick } from './runtime-fixture.ts';
import { CaptureSession, MAX_REPORTS } from '../src/research/capture-session.js';

const hit = [12, 24, 0], release = [12, 48, 0];
test('runtime translates raw reports without browser globals or Mapping UI; subscribers are isolated', async () => {
  assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
  assert.equal(typeof localStorage, 'undefined');
  const { runtime, input, midi } = fixture(); const research = new CaptureSession();
  runtime.subscribe(() => { throw new Error('research unavailable'); });
  runtime.subscribe(async () => { throw new Error('async research unavailable'); });
  runtime.subscribe(e => { if (e.type === 'raw') e.report.data.fill(255); });
  const unsubscribe = runtime.subscribe(e => { if (e.type === 'raw') research.receive(e.report); });
  await runtime.connect(); await runtime.enableMidi(); await runtime.selectOutput('a');
  input.report(2, hit); input.report(2, release);
  assert.deepEqual(midi.sent.map(s => s.message), [[0x90, 36, 64], [0x80, 36, 0]]);
  assert.deepEqual(research.session.reports[0].bytes, hit);
  unsubscribe(); input.report(2, hit); assert.equal(research.session.reports.length, 2);
  const snapshot = runtime.snapshot; snapshot.activePads.length = 0; snapshot.device!.outputReportIds.length = 0;
  assert.deepEqual(runtime.snapshot.activePads, ['PAD_1']);
  assert.deepEqual(runtime.snapshot.device!.outputReportIds, [0x80]);
});
test('port switch sends releases to old sink; Panic, unplug and reconnect clear state', async () => {
  const { runtime, input, midi } = fixture();
  await runtime.connect(); await runtime.selectOutput('a'); input.report(2, hit);
  await runtime.selectOutput('b');
  assert.deepEqual(midi.sent[1], { port: 'a', message: [0x80, 36, 0] });
  input.report(2, release); input.report(2, hit); runtime.panic();
  assert.deepEqual(midi.sent.at(-1), { port: 'b', message: [0x80, 36, 0] });
  input.report(2, hit); input.unplug(); assert.equal(runtime.snapshot.device, null);
  assert.equal(runtime.snapshot.ledEnabled, false); assert.deepEqual(runtime.snapshot.activePads, []);
  await runtime.connect(); input.report(2, hit); assert.deepEqual(midi.sent.at(-1)!.message, [0x90, 36, 64]);
});
test('profile reconfiguration and mode changes release notes without retriggering held pads', async () => {
  const profile = createDefaultProfile(); const second = structuredClone(profile.modes[0]);
  second.id = 'second'; second.selectorPad = null; profile.modes.push(second);
  const { runtime, input, midi } = fixture(profile);
  await runtime.connect(); await runtime.selectOutput('a'); input.report(2, hit);
  runtime.switchMode('second'); assert.equal(runtime.snapshot.activeModeId, 'second');
  assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
  const before = midi.sent.length; input.report(2, hit); assert.equal(midi.sent.length, before);
  input.report(2, release); input.report(2, hit); runtime.applyProfile(profile);
  assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
});
test('velocity and feedback updates preserve held notes; only future hits use new curve', async () => {
  const { runtime, input, midi } = fixture();
  await runtime.connect(); await runtime.selectOutput('a'); input.report(2, hit);
  runtime.setVelocityCurve('soft-3'); const profile = createDefaultProfile();
  profile.modes[0].padOnBrightness = 'dim'; runtime.updateFeedback(profile);
  assert.equal(midi.sent.length, 1); input.report(2, release);
  assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
  input.report(2, hit); assert.ok(midi.sent.at(-1)!.message[2] > 64);
});
test('LED takeover defaults off and cannot resume after disable or disconnect', async () => {
  const { runtime, input } = fixture(); await runtime.connect(); input.report(2, hit);
  assert.equal(input.sent.length, 0);
  runtime.setLedEnabled(true); await tick(); assert.equal(input.sent.length, 1);
  runtime.setLedEnabled(false); await tick(); const count = input.sent.length;
  assert.deepEqual([...input.sent.at(-1)!.data], Array(80).fill(0));
  input.report(2, release); runtime.panic(); await tick(); assert.equal(input.sent.length, count);
  const close = runtime.disconnect(); assert.equal(runtime.disconnect(), close); await close;
  assert.equal(input.closes, 1); await runtime.connect(); input.report(2, hit); await tick();
  assert.equal(input.sent.length, count); assert.equal(runtime.snapshot.ledEnabled, false);
});
test('LED write failure disables takeover and is exposed in state', async () => {
  const { runtime, input } = fixture(); await runtime.connect();
  input.send = async () => { throw new Error('write failed'); };
  runtime.setLedEnabled(true); await tick();
  assert.equal(runtime.snapshot.ledEnabled, false); assert.match(runtime.snapshot.ledStatus, /write failed/);
  assert.equal(runtime.snapshot.ledIssue?.code, 'led_send_failed');
});
test('capture limits, display clearing, stop, reset and session imports stay separate from MIDI', async () => {
  const { runtime, input, midi } = fixture(); const research = new CaptureSession();
  runtime.subscribe(e => { if (e.type === 'raw') research.receive(e.report); });
  await runtime.connect(); await runtime.selectOutput('a'); research.start('PAD_1');
  input.report(2, hit); const finished = research.stop('test')!;
  assert.equal(finished.samples.length, 1); assert.equal(finished.note, 'test');
  input.report(2, release); assert.equal(finished.samples.length, 1);
  for (let i = 0; i < 110; i++) research.receive({ reportId: 2, data: new Uint8Array(hit) });
  assert.equal(research.displayRows.length, 100); research.displayRows = [];
  assert.equal(research.session.reports.length, 112);
  // Reach the cap without allocating 100k unique payloads.
  research.session.reports = Array(MAX_REPORTS).fill(research.session.reports[0]);
  input.report(2, hit); assert.equal(research.recordingFull, true);
  assert.deepEqual(midi.sent.at(-1)!.message, [0x90, 36, 64]);
  research.reset(); assert.equal(research.recordingFull, false); assert.equal(research.session.reports.length, 0);
  research.import({ schema: 'midiy-session-v1', reports: [], captures: [] });
  assert.equal(research.session.schema, 'midiy-session-v1');
});
test('disconnect during connection finishes closing before a reconnect can run', async () => {
  const { runtime, input } = fixture();
  const connect = input.connect.bind(input); let open!: () => void;
  input.connect = async () => { await new Promise<void>(resolve => { open = resolve; }); return connect(); };
  const connecting = runtime.connect(), closing = runtime.disconnect();
  assert.equal(runtime.disconnect(), closing);
  open(); await connecting; await closing;
  assert.equal(runtime.snapshot.device, null); assert.equal(input.closes, 1);
  input.connect = connect; await runtime.connect(); assert.ok(runtime.snapshot.device);
});
test('unsupported LED interface never receives takeover or all-off output', async () => {
  const { runtime, input } = fixture(); await runtime.connect(); input.info!.outputReportIds = [];
  runtime.setLedEnabled(true); runtime.setLedEnabled(false); await runtime.disconnect();
  assert.equal(input.sent.length, 0);
});
test('continuous pad pressure does not resend unchanged LED frames', async () => {
  const { runtime, input } = fixture(); await runtime.connect(); runtime.setLedEnabled(true); await tick();
  input.report(2, hit); await tick(); const before = input.sent.length;
  input.report(2, [12, 72, 0]); input.report(2, [12, 74, 0]); await tick();
  assert.equal(input.sent.length, before);
});

const buttonReport = (...ids: string[]) => {
  // Mikro 0x01 physical button bits: FAVORITES = 1, BROWSER = 2, SHIFT = 25.
  const bytes = Array(13).fill(0);
  for (const id of ids) { const bit = id === 'SHIFT' ? 25 : id === 'BROWSER' ? 2 : 1; bytes[bit >> 3] |= 1 << (bit % 8); }
  return bytes;
};
test('SHIFT + FAVORITES toggles LED takeover once per press without MIDI, held-note loss or UI ownership', async () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.FAVORITES = { type: 'note', channel: 1, note: 60, velocity: 100 };
  const { runtime, input, midi } = fixture(profile);
  const handled: string[] = [], raw: number[] = [];
  runtime.subscribe(event => {
    if (event.type === 'decoded' && event.handled) handled.push(`${event.event.controlId}:${event.event.kind === 'button' && event.event.pressed}`);
    if (event.type === 'raw') raw.push(event.report.reportId);
  });
  await runtime.connect(); await runtime.selectOutput('a');
  input.report(2, hit);
  input.report(1, buttonReport('SHIFT'));
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, true); assert.ok(input.sent.length);
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, true);
  // Releasing SHIFT first must not expose the shortcut's FAVORITES release to the engine.
  input.report(1, buttonReport('FAVORITES')); input.report(1, buttonReport());
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, false);
  assert.deepEqual([...input.sent.at(-1)!.data], Array(80).fill(0));
  assert.deepEqual(midi.sent.map(entry => entry.message), [[0x90, 36, 64]]);
  assert.deepEqual(handled, ['FAVORITES:true', 'FAVORITES:false', 'FAVORITES:true']);
  assert.ok(raw.length >= 6);
  input.report(2, release); assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
});

for (const actionOn of ['down', 'up'] as const) {
  test(`standalone FAVORITES retains ${actionOn} mapping; shortcut consumes both edges`, async () => {
    const profile = createDefaultProfile();
    profile.modes[0].bindings.FAVORITES = { type: 'cc', channel: 1, controller: 8, style: 'trigger', value: 55, actionOn };
    const { runtime, input, midi } = fixture(profile); await runtime.connect(); await runtime.selectOutput('a');
    // FAVORITES first, then SHIFT: this is the original FAVORITES interaction, not a shortcut.
    input.report(1, buttonReport('FAVORITES')); input.report(1, buttonReport('FAVORITES', 'SHIFT'));
    assert.equal(runtime.snapshot.ledEnabled, false);
    input.report(1, buttonReport());
    assert.deepEqual(midi.sent.map(entry => entry.message), [[0xb0, 8, 55]]);
    input.report(1, buttonReport('SHIFT', 'FAVORITES'));
    input.report(1, buttonReport('FAVORITES')); input.report(1, buttonReport());
    assert.equal(runtime.snapshot.ledEnabled, true);
    assert.equal(midi.sent.length, 1);
  });
}

test('shortcut uses existing report support and reconnect lifecycle without requiring a MIDI port', async () => {
  const { runtime, input } = fixture(); await runtime.connect(); input.info!.outputReportIds = [];
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, false); assert.equal(input.sent.length, 0);
  input.report(1, buttonReport()); input.info!.outputReportIds = [0x80];
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, true);
  input.unplug(); await runtime.connect();
  assert.equal(runtime.snapshot.ledEnabled, false);
  input.report(1, buttonReport('SHIFT', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.ledEnabled, true);
  await runtime.disconnect(); assert.deepEqual([...input.sent.at(-1)!.data], Array(80).fill(0));
});

for (const simultaneous of [false, true]) {
  test(`SHIFT + BROWSER clears notes, LEDs and closes once (simultaneous ${simultaneous})`, async () => {
    const profile = createDefaultProfile();
    profile.modes[0].bindings.BROWSER = { type: 'note', channel: 1, note: 60, velocity: 100 };
    const { runtime, input, midi } = fixture(profile);
    const events: string[] = []; runtime.subscribe(event => events.push(event.type));
    await runtime.connect(); await runtime.selectOutput('a'); runtime.setLedEnabled(true); await tick();
    input.report(2, hit);
    if (!simultaneous) input.report(1, buttonReport('SHIFT'));
    input.report(1, buttonReport('SHIFT', 'BROWSER'));
    const closing = runtime.disconnect(); assert.equal(runtime.disconnect(), closing);
    input.report(1, buttonReport('SHIFT', 'BROWSER')); await closing; await tick();
    assert.equal(input.closes, 1); assert.equal(runtime.snapshot.device, null);
    assert.equal(runtime.snapshot.ledEnabled, false);
    assert.deepEqual([...input.sent.at(-1)!.data], Array(80).fill(0));
    assert.deepEqual(midi.sent.map(entry => entry.message), [[0x90, 36, 64], [0x80, 36, 0]]);
    assert.equal(events.filter(type => type === 'disconnected').length, 1);
    await runtime.connect(); assert.equal(runtime.snapshot.ledEnabled, false);
    input.report(1, buttonReport('BROWSER')); input.report(1, buttonReport());
    assert.deepEqual(midi.sent.slice(-2).map(entry => entry.message), [[0x90, 60, 127], [0x80, 60, 0]]);
  });
}

test('BROWSER first retains original release action; disconnect wins over other same-report actions', async () => {
  const profile = createDefaultProfile();
  profile.modes[0].bindings.BROWSER = { type: 'cc', channel: 1, controller: 10, style: 'trigger', value: 70, actionOn: 'up' };
  profile.modes[0].bindings.SHIFT = { type: 'note', channel: 1, note: 61, velocity: 100 };
  const { runtime, input, midi } = fixture(profile); await runtime.connect(); await runtime.selectOutput('a');
  input.report(1, buttonReport('BROWSER')); input.report(1, buttonReport('BROWSER', 'SHIFT'));
  assert.ok(runtime.snapshot.device); input.report(1, buttonReport());
  assert.ok(midi.sent.some(entry => entry.message.join() === '176,10,70'));
  midi.sent.length = 0;
  input.report(1, buttonReport('SHIFT', 'BROWSER', 'FAVORITES')); await tick();
  assert.equal(runtime.snapshot.device, null); assert.equal(input.sent.length, 0); assert.equal(midi.sent.length, 0);
});

test('hardware disconnect errors are reported, with MIDI state cleared and no rejected background promise', async () => {
  const { runtime, input, midi } = fixture(); const errors: string[] = [];
  runtime.subscribe(event => { if (event.type === 'error') errors.push(event.code); });
  await runtime.connect(); await runtime.selectOutput('a'); input.report(2, hit);
  input.disconnect = async () => { input.info = null; throw new Error('close failed'); };
  input.report(1, buttonReport('SHIFT', 'BROWSER')); await tick();
  assert.deepEqual(errors, ['hid_disconnect_failed']);
  assert.deepEqual(midi.sent.at(-1)!.message, [0x80, 36, 0]);
  assert.equal(runtime.snapshot.ledEnabled, false);
});
