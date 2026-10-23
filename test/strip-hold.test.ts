import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultProfile, parseProfile} from '@midiy/mikro-core';
import {fixture, tick} from './runtime-fixture.ts';
import {ProfileLibrary} from '../src/mapping/profile-library.ts';
const strip = (raw:number) => {const data=Array(13).fill(0);data[9]=raw;return data;};
const lights = (runtime: ReturnType<typeof fixture>['runtime']) => [...runtime.snapshot.lightReport.data.slice(55)];
const profile = (mode:'dot'|'bar'|'pan'='dot') => {
 const p=createDefaultProfile();p.modes[0].stripLight={mode,brightness:'normal',hold:true};
 p.modes[0].bindings.SMART_STRIP_TOUCH={type:'note',channel:1,note:60,velocity:127};return p;
};
test('Strip hold is optional, boolean validated, and persists in legacy/current profiles and library',()=>{
 const p=profile(); assert.equal(parseProfile(p).modes[0].stripLight?.hold,true);
 assert.equal(parseProfile({...p,schema:'mpa-profile-v1'}).modes[0].stripLight?.hold,true);
 delete p.modes[0].stripLight!.hold;assert.equal(parseProfile(p).modes[0].stripLight?.hold,undefined);
 for(const invalid of [0,'true',null]){(p.modes[0].stripLight as any).hold=invalid;assert.throws(()=>parseProfile(p));}
 const values=new Map<string,string>();const store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const library=new ProfileLibrary(store);library.save(profile());assert.equal(new ProfileLibrary(store).current.modes[0].stripLight?.hold,true);
});
test('Dot, Bar and Pan retain final light after release while MIDI Note Off still sends', async()=>{
 for(const mode of ['dot','bar','pan'] as const){
  const {runtime,input,midi}=fixture(profile(mode));await runtime.connect();await runtime.selectOutput('a');runtime.setLedEnabled(true);await tick();
  input.report(1,strip(150));await tick();const held=lights(runtime);assert.ok(held.some(Boolean));
  input.report(1,strip(0));await tick();assert.deepEqual(lights(runtime),held);
  assert.deepEqual(midi.sent.map(s=>s.message),[[0x90,60,127],[0x80,60,0]]);
  assert.deepEqual([...input.sent.at(-1)!.data.slice(55)],held);
  input.report(1,strip(30));assert.notDeepEqual(lights(runtime),held);
 }
});
test('default/off still extinguish Strip, and hold never implicitly takes over LEDs',async()=>{
 for(const hold of [undefined,false,true]){
  const p=profile();p.modes[0].stripLight!.hold=hold;
  const {runtime,input}=fixture(p);await runtime.connect();input.report(1,strip(130));input.report(1,strip(0));await tick();
  assert.equal(lights(runtime).some(Boolean),hold===true);assert.equal(input.sent.length,0);assert.equal(runtime.snapshot.ledEnabled,false);
 }
});
test('Panic, mode changes, reapply, LED disable and reconnect clear retained Strip position',async()=>{
 const p=profile();p.modes.push({...structuredClone(p.modes[0]),id:'second',name:'Second'});
 const {runtime,input}=fixture(p);await runtime.connect();runtime.setLedEnabled(true);await tick();
 const touch=()=>{input.report(1,strip(125));input.report(1,strip(0));assert.ok(lights(runtime).some(Boolean));};
 touch();runtime.panic();assert.ok(lights(runtime).every(n=>n===0));
 touch();runtime.switchMode('second');assert.ok(lights(runtime).every(n=>n===0));
 touch();runtime.applyProfile(p);assert.ok(lights(runtime).every(n=>n===0));
 touch();runtime.setLedEnabled(false);await tick();assert.ok(lights(runtime).every(n=>n===0));
 assert.ok(input.sent.at(-1)!.data.every(n=>n===0));runtime.setLedEnabled(true);assert.ok(lights(runtime).every(n=>n===0));
 touch();await runtime.disconnect();await runtime.disconnect();await runtime.connect();assert.ok(lights(runtime).every(n=>n===0));
 touch();input.unplug();await runtime.connect();assert.ok(lights(runtime).every(n=>n===0));
});
