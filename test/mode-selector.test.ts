import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON_IDS, MappingEngine, createDefaultProfile, createMode, parseProfile, padNumberToIndex, type InputEvent } from '@midiy/mikro-core';
import { fixture, tick } from './runtime-fixture';
const button = (controlId = 'GROUP', pressed = true): InputEvent => ({ kind: 'button', controlId: controlId as any, pressed });
const pad = (n: number, event = 'note-on', raw = 2048): InputEvent => ({ kind: 'pad', controlId: `PAD_${n}`, padIndex: padNumberToIndex(n), event: event as any, raw, velocity: raw >> 5 });
const report = (key: string, pressed = true) => { const data = Array(13).fill(0), i = BUTTON_IDS.indexOf(key as any); if (pressed) data[i >> 3] |= 1 << (i % 8); return data; };

test('factory groups have independent names, pads, colors and default Fixed Vel mappings', () => {
  const p = createDefaultProfile();
  assert.equal(p.modeSelector, 'GROUP');
  assert.deepEqual(p.modes.map(m => [m.name, m.selectorPad]), [['A','PAD_13'],['B','PAD_14'],['C','PAD_15'],['D','PAD_16'],['E','PAD_9'],['F','PAD_10'],['G','PAD_11'],['H','PAD_12']]);
  assert.equal(p.initialModeId, p.modes[0].id);
  assert.ok(p.modes.every(m => m.bindings.FIXED_VEL?.type === 'fixed-velocity'));
  const custom = createMode('custom','Drums'); custom.selectorPad = 'PAD_1'; custom.color = 7; p.modes.push(custom);
  p.modes[0].name = 'Renamed';
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))), p);
});

test('selector contract rejects duplicate pads, invalid colors, reserved selectors and selector MIDI mappings', () => {
  for (const change of [
    (p: any) => p.modes[1].selectorPad = p.modes[0].selectorPad,
    (p: any) => p.modes[0].selectorPad = 'PAD_17',
    (p: any) => p.modes[0].color = 18,
    (p: any) => p.modeSelector = 'SHIFT',
    (p: any) => p.modes[0].bindings.GROUP = {type:'note',channel:1,note:60,velocity:127}
  ]) { const p = createDefaultProfile(); change(p); assert.throws(() => parseProfile(p)); }
});

test('hold selector switches modes once per Pad hit and consumes Hit, Press and release after selector release', () => {
  const p = createDefaultProfile(); p.modes[1].pressureBindings = {PAD_14:{type:'cc',channel:1,controller:74,from:0,to:127}};
  const e = new MappingEngine(p);
  assert.equal(e.process(button()).handled, true); assert.equal(e.selectingMode, true);
  assert.equal(e.process(pad(14,'press-on')).modeChanged, true);
  assert.equal(e.activeModeId, p.modes[1].id);
  assert.deepEqual(e.process(pad(14)).messages, []);
  e.process(button('GROUP', false)); assert.equal(e.selectingMode, false);
  assert.deepEqual(e.process(pad(14,'aftertouch')).messages, []);
  assert.deepEqual(e.process(pad(14,'press-off',0)).messages, []);
  assert.deepEqual(e.process(pad(14,'note-off',0)).messages, []);
  assert.deepEqual(e.process(pad(14)).messages, [[0x90,49,64]]);
  assert.deepEqual(e.process(pad(14,'aftertouch')).messages, [[0xb0,74,64]]);
});

test('empty pads stay silent; an already sounding Pad still releases while selector is held', () => {
  const e = new MappingEngine(createDefaultProfile());
  e.process(pad(1)); e.process(button());
  assert.deepEqual(e.process(pad(1,'note-off',0)).messages, [[0x80,36,0]]);
  const mode = e.activeModeId;
  assert.deepEqual(e.process(pad(2)).messages, []); assert.equal(e.activeModeId, mode);
  e.process(button('GROUP',false));
  assert.deepEqual(e.process(pad(2,'note-off',0)).messages, []);
  assert.deepEqual(e.process(pad(2)).messages, [[0x90,37,64]]);
});

test('changing modes releases held notes and pressure without retriggering until release', () => {
  const e = new MappingEngine(createDefaultProfile());
  e.process(pad(1)); e.process(button());
  assert.deepEqual(e.process(pad(14)).messages, [[0x80,36,0]]);
  e.process(button('GROUP',false));
  assert.deepEqual(e.process(pad(1,'aftertouch')).messages, []);
  assert.deepEqual(e.process(pad(1)).messages, []);
  e.process(pad(1,'note-off',0));
  assert.deepEqual(e.process(pad(1)).messages, [[0x90,36,64]]);
});

test('mode selector and Fixed Vel can move to ordinary buttons independently', () => {
  const p = createDefaultProfile(); p.modeSelector = 'PROJECT';
  const mode = p.modes[0]; delete mode.bindings.FIXED_VEL;
  mode.bindings.PLAY = {type:'fixed-velocity',velocity:89};
  const e = new MappingEngine(p);
  e.process(button('PLAY')); e.process(button('PLAY',false));
  assert.equal(e.process(pad(1)).messages[0][2],89); e.process(pad(1,'note-off',0));
  e.process(button('GROUP')); assert.equal(e.selectingMode,false); e.process(button('GROUP',false));
  e.process(button('PROJECT')); assert.equal(e.selectingMode,true);
  e.process(pad(14)); assert.equal(e.activeModeId,p.modes[1].id);
  e.process(button('PROJECT',false)); assert.equal(e.selectingMode,false);
});

test('runtime produces selection palette only during hold, emits handled events and respects LED opt-in', async () => {
  const p = createDefaultProfile(), {runtime,input,midi} = fixture(p);
  const handled: boolean[] = []; runtime.subscribe(e => {if(e.type==='decoded' && e.event.kind==='pad') handled.push(Boolean(e.handled));});
  await runtime.connect(); await runtime.selectOutput('a');
  const normal = [...runtime.snapshot.lightReport.data];
  input.report(1,report('GROUP'));
  assert.equal(runtime.snapshot.selectingMode,true);
  assert.equal(input.sent.length,0);
  const lights = runtime.snapshot.lightReport.data;
  assert.equal(lights[39+padNumberToIndex(13)],(p.modes[0].color<<2)+3);
  assert.equal(lights[39+padNumberToIndex(14)],(p.modes[1].color<<2));
  assert.equal(lights[39+padNumberToIndex(1)],0);
  runtime.setLedEnabled(true); await tick(); assert.deepEqual(input.sent.at(-1)!.data,lights);
  input.report(2,[padNumberToIndex(14),0x18,0]);
  assert.equal(runtime.activeModeId,p.modes[1].id); assert.equal(midi.sent.length,0);
  input.report(1,report('GROUP',false)); await tick();
  assert.equal(runtime.snapshot.selectingMode,false); assert.deepEqual([...runtime.snapshot.lightReport.data],normal);
  input.report(2,[padNumberToIndex(14),0x30,0]);
  assert.ok(handled.every(Boolean)); assert.equal(midi.sent.length,0);
  input.report(1,report('GROUP')); runtime.panic(); assert.equal(runtime.snapshot.selectingMode,false);
  input.report(1,report('GROUP')); input.unplug(); assert.equal(runtime.snapshot.selectingMode,false);
});

test('an unassigned mode remains reachable through an ordinary switch-mode binding', () => {
  const profile = createDefaultProfile();
  const target = profile.modes[1]; target.selectorPad = null;
  profile.modes[0].bindings.PLAY = { type: 'mode', modeId: target.id };
  const engine = new MappingEngine(profile);
  assert.equal(engine.process(button('PLAY')).modeChanged, true);
  assert.equal(engine.activeModeId, target.id);
  assert.equal(engine.selectingMode, false);
});

test('mode button triggers validate uniqueness, reserved keys, selector conflicts and exclusive Pad assignment', () => {
  const p = createDefaultProfile(); p.modes[1].selectorPad = null; p.modes[1].selectorButton = 'PLAY';
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(p))), p);
  for (const change of [
    (v: any) => v.modes[2].selectorButton = 'PLAY',
    (v: any) => v.modes[1].selectorPad = 'PAD_1',
    (v: any) => v.modes[1].selectorButton = 'GROUP',
    (v: any) => v.modes[1].selectorButton = 'SHIFT',
    (v: any) => v.modes[1].selectorButton = 'FAVORITES',
    (v: any) => v.modes[1].selectorButton = 'BROWSER',
    (v: any) => v.modes[1].selectorButton = 'ENCODER_PUSH',
    (v: any) => v.modes[1].selectorButton = 'ENCODER_TOUCH',
    (v: any) => v.modes[1].selectorButton = 'SMART_STRIP'
  ]) {const invalid = structuredClone(p); change(invalid); assert.throws(() => parseProfile(invalid));}
});

test('selector plus ordinary button switches once and consumes releases while preserving ordinary MIDI outside selection', () => {
  const p = createDefaultProfile(); p.modes[1].selectorPad = null; p.modes[1].selectorButton = 'PLAY';
  p.modes[0].bindings.PLAY = {type:'note',channel:1,note:60,velocity:127};
  p.modes[1].bindings.PLAY = {type:'cc',channel:1,controller:74,style:'trigger',value:99,actionOn:'up'};
  const e = new MappingEngine(p);
  assert.deepEqual(e.process(button('PLAY')).messages,[[0x90,60,127]]);
  assert.deepEqual(e.process(button('PLAY',false)).messages,[[0x80,60,0]]);
  e.process(button());
  const selected=e.process(button('PLAY'));
  assert.equal(selected.modeChanged,true); assert.equal(selected.handled,true); assert.deepEqual(selected.messages,[]);
  assert.equal(e.activeModeId,p.modes[1].id);
  assert.equal(e.process(button('PLAY')).modeChanged,false);
  e.process(button('GROUP',false));
  assert.deepEqual(e.process(button('PLAY',false)).messages,[]);
  assert.deepEqual(e.process(button('PLAY')).messages,[]);
  assert.deepEqual(e.process(button('PLAY',false)).messages,[[0xb0,74,99]]);
});

test('held buttons release before receiving a new mode binding; unassigned selector buttons stay silent', () => {
  const p=createDefaultProfile();p.modes[1].selectorPad=null;p.modes[1].selectorButton='PLAY';
  p.modes[0].bindings.REC={type:'note',channel:1,note:61,velocity:127};
  p.modes[1].bindings.REC={type:'cc',channel:1,controller:75,style:'trigger',value:100,actionOn:'up'};
  const e=new MappingEngine(p); e.process(button('REC'));e.process(button());
  assert.deepEqual(e.process(button('REC')).messages,[]);assert.equal(e.activeModeId,p.modes[0].id);
  assert.deepEqual(e.process(button('REC',false)).messages,[[0x80,61,0]]);
  assert.deepEqual(e.process(button('STOP')).messages,[]);e.process(button('STOP',false));
  e.process(button('GROUP',false)); e.process(button('REC')); e.process(button());
  assert.deepEqual(e.process(button('PLAY')).messages,[[0x80,61,0]]);
  e.process(button('GROUP',false));
  assert.deepEqual(e.process(button('REC',false)).messages,[]);
  assert.deepEqual(e.process(button('PLAY',false)).messages,[]);
  assert.deepEqual(e.process(button('REC')).messages,[]);
  assert.deepEqual(e.process(button('REC',false)).messages,[[0xb0,75,100]]);
});

test('button mode palette matches Pad selection brightness, restores normal lights and remains LED opt-in', async () => {
  const p=createDefaultProfile();p.modes[1].selectorPad=null;p.modes[1].selectorButton='PLAY';
  p.modes[0].bindings.REC={type:'note',channel:1,note:62,velocity:127};
  const {runtime,input,midi}=fixture(p);await runtime.connect();await runtime.selectOutput('a');
  const normal=[...runtime.snapshot.lightReport.data];input.report(1,report('GROUP'));
  const index=BUTTON_IDS.indexOf('PLAY');
  assert.equal(runtime.snapshot.lightReport.data[index],0x7c);
  assert.equal(runtime.snapshot.lightReport.data[BUTTON_IDS.indexOf('REC')],0);
  assert.equal(input.sent.length,0);
  runtime.setLedEnabled(true);await tick();assert.equal(input.sent.at(-1)!.data[index],0x7c);
  const held=report('GROUP');const key=BUTTON_IDS.indexOf('PLAY');held[key>>3]|=1<<(key%8);input.report(1,held);await tick();
  assert.equal(runtime.activeModeId,p.modes[1].id);assert.equal(runtime.snapshot.lightReport.data[index],0x7f);assert.equal(midi.sent.length,0);
  input.report(1,report('PLAY'));input.report(1,report('PLAY',false));await tick();
  assert.equal(runtime.snapshot.selectingMode,false);assert.deepEqual([...runtime.snapshot.lightReport.data],normal);assert.equal(midi.sent.length,0);
  input.report(1,report('GROUP'));runtime.panic();assert.equal(runtime.snapshot.selectingMode,false);
});
