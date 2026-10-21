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
  second.id = 'second'; profile.modes.push(second);
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
});
test('capture limits, display clearing, stop, reset and legacy imports stay separate from MIDI', async () => {
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
  research.import({ schema: 'mpa-session-v1', reports: [], captures: [] });
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
