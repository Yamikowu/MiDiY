import test from 'node:test';
import assert from 'node:assert/strict';
import {NotePreferences, NOTE_PREFERENCES_KEY, noteName, noteParts, midiNote, noteSummary, octavesForPitch} from '../src/mapping/note-format.ts';
import {TranslatorUI} from '../src/mapping/translator-ui.ts';
import {ProfileLibrary} from '../src/mapping/profile-library.ts';
import {fixture, tick} from './runtime-fixture.ts';

test('every MIDI note roundtrips in all three octave conventions', () => {
 for (const middle of [3,4,5] as const) for (let note=0;note<128;note++) {
  const parts=noteParts(note,middle);
  assert.equal(midiNote(parts.pitch,parts.octave,middle),note);
  assert.ok(octavesForPitch(parts.pitch,middle).includes(parts.octave));
 }
 assert.equal(noteName(60,4),'C4'); assert.equal(noteName(61,3),'C♯3');
 assert.equal(noteName(72,3),'C4'); assert.equal(noteSummary(127,5),'G10 (127)');
});
test('octave and pitch bounds allow only integer MIDI 0–127', () => {
 for (const middle of [3,4,5] as const) {
  for (let pitch=0;pitch<12;pitch++) for (const octave of octavesForPitch(pitch,middle)) {
   const note=midiNote(pitch,octave,middle)!; assert.ok(note>=0&&note<=127);
  }
  assert.equal(midiNote(8,middle+5,middle),null);
  assert.equal(midiNote(7,middle+5,middle),127);
  assert.equal(midiNote(0,middle-5,middle),0);
  assert.equal(midiNote(0,middle-6,middle),null);
 }
 for (const note of [-1,128,1.2,NaN]) assert.throws(()=>noteParts(note,4),RangeError);
 for (const pitch of [-1,12,0.5,NaN]) assert.equal(midiNote(pitch,4,4),null);
 assert.equal(midiNote(0,4.5,4),null);
});
test('display preferences use their own storage key, persist and unsubscribe', () => {
 const stored=new Map([['midiy-profile-v1','untouched'],['mpa-profile-v1','legacy']]);
 const storage={getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>{stored.set(k,v);}};
 const prefs=new NotePreferences(storage); let changes=0; const off=prefs.subscribe(()=>changes++);
 assert.deepEqual(prefs.current,{middleC:4,inputMode:'number'});
 prefs.update({middleC:3}); prefs.update({inputMode:'name'});prefs.update({inputMode:'name'});
 assert.equal(changes,2);off();prefs.update({middleC:5});assert.equal(changes,2);
 assert.deepEqual(new NotePreferences(storage).current,{middleC:5,inputMode:'name'});
 assert.equal(stored.get('midiy-profile-v1'),'untouched');assert.equal(stored.get('mpa-profile-v1'),'legacy');
 assert.deepEqual([...stored.keys()],['midiy-profile-v1','mpa-profile-v1',NOTE_PREFERENCES_KEY]);
 const copy=prefs.current;copy.middleC=3;assert.equal(prefs.current.middleC,5);
});
test('malformed and unavailable storage falls back without blocking display changes', () => {
 for (const raw of ['bad','null','[]','{"middleC":8,"inputMode":"bad"}']) {
  assert.deepEqual(new NotePreferences({getItem:()=>raw,setItem(){}}).current,{middleC:4,inputMode:'number'});
 }
 const p=new NotePreferences({getItem(){throw Error();},setItem(){throw Error();}});
 p.update({middleC:3,inputMode:'name'});assert.deepEqual(p.current,{middleC:3,inputMode:'name'});
});
test('UI display preferences preserve connected Runtime, profile, drafts and batch state with zero MIDI/LED or Runtime events',async () => {
 // Exercise the actual UI preference subscription against a connected real Runtime.
 // Rendering is isolated here; full DOM/input behavior is covered by the browser harness.
 class UI extends (TranslatorUI as any) {
  mount(){} renderPressed(){} renderDevice(){} renderPorts(){} queueModeLights(){} renderMap(){} previewBatch(){} previewPadLight(){}
  el(){return {textContent:''};}
 }
 const {runtime,input,midi}=fixture();await runtime.connect();await runtime.enableMidi();await runtime.selectOutput('a');runtime.setLedEnabled(true);await tick();
 const prefs=new NotePreferences();const library=new ProfileLibrary({getItem:()=>null,setItem(){}});
 const ui=new UI(runtime,library,{toast(){},notePreferences:prefs});
 ui.bindingDirty=true; ui.batchChanges={'hit.note':61};const batch=ui.batchChanges;
 ui.pendingPaste=structuredClone(library.current);const paste=ui.pendingPaste;
 const profile=JSON.stringify(library.current),snapshot=runtime.snapshot;
 const sends=[midi.sent.length,input.sent.length];let events=0;const off=runtime.subscribe(()=>events++);
 for (const middleC of [3,4,5] as const) for (const inputMode of ['name','number'] as const) prefs.update({middleC,inputMode});
 await tick();off();
 assert.equal(ui.runtime,runtime);assert.deepEqual(runtime.snapshot,snapshot);assert.equal(events,0);
 assert.deepEqual([midi.sent.length,input.sent.length],sends);assert.equal(JSON.stringify(library.current),profile);
 assert.equal(ui.bindingDirty,true);assert.equal(ui.batchChanges,batch);assert.equal(ui.pendingPaste,paste);
});
