// Manual browser regression harness: real UI/Runtime with simulated hardware only.
import { BUTTON_IDS, padNumberToIndex } from '@midiy/mikro-core';
import page from '../../index.html?raw';
import { fixture } from '../runtime-fixture';
import { TranslatorUI } from '../../src/devices/mikro-mk3/mapping/translator-ui';
import { ProfileLibrary } from '../../src/devices/mikro-mk3/mapping/profile-library';
import { NotePreferences } from '../../src/shared/notes/note-format';
import { initializeLocale, mountLanguageSwitcher } from '../../src/i18n/index';
import { mountPages } from '../../src/shared/pages';
document.documentElement.innerHTML = page.replace(/<script[\s\S]*?<\/script>/g, '').replaceAll('href="./', 'href="/');
const values = new Map<string,string>();
const storage = {getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => {values.set(k,v);}};
initializeLocale(storage, ['zh-TW']); mountLanguageSwitcher();
const library = new ProfileLibrary(storage);
const {runtime,input,midi} = fixture(library.current);
const ui = new TranslatorUI(runtime, library, {toast() {}, notePreferences:new NotePreferences(storage)});
mountPages();
const initialRuntime = runtime;
const diagnostics = document.createElement('section');
diagnostics.innerHTML = `<button id="test-connect">Simulate connection + MIDI + LED</button><button id="test-strip-touch">Simulate Strip touch</button><button id="test-strip-release">Simulate Strip release</button><button id="test-selector-down">Hold mode selector</button><button id="test-mode-pad">Select Pad 14</button><button id="test-selector-up">Release mode selector</button><button id="test-check">Check state</button><output id="test-state" style="white-space:pre-wrap"></output>`;
document.body.prepend(diagnostics);
let stateEvents = 0;
runtime.subscribe(() => stateEvents++);
const check = () => {
 document.getElementById('test-state')!.textContent = JSON.stringify({
  selectingMode:runtime.snapshot.selectingMode, activeModeId:runtime.activeModeId, padLights:[...runtime.snapshot.lightReport.data.slice(39,55)],
  stripLights:[...runtime.snapshot.lightReport.data.slice(55)], sameRuntime:runtime===initialRuntime, device:runtime.snapshot.device, midi:runtime.snapshot.midi,
  ledEnabled:runtime.snapshot.ledEnabled, midiSends:midi.sent.length, ledSends:input.sent.length, stateEvents,
  profile:library.current, storage:[...values],
  dirty:(ui as any).session.bindingDirty, batch:(ui as any).session.batchChanges,
 },null,2);
};
document.getElementById('test-connect')!.onclick = async () => {await runtime.connect(); await runtime.enableMidi(); await runtime.selectOutput('a'); runtime.setLedEnabled(true); check();};
for (const [id, raw] of [['test-strip-touch',150],['test-strip-release',0]] as const) document.getElementById(id)!.onclick = () => {const report=Array(13).fill(0);report[9]=raw;input.report(1,report);check();};
document.getElementById('test-check')!.onclick = check;
check();

for (const [id, pressed] of [['test-selector-down',true],['test-selector-up',false]] as const) document.getElementById(id)!.onclick = () => {
 const bytes=Array(13).fill(0), index=BUTTON_IDS.indexOf(library.current.modeSelector);
 if(pressed) bytes[index >> 3] = 1 << (index % 8);
 input.report(1,bytes);check();
};
document.getElementById('test-mode-pad')!.onclick = () => {
 input.report(2,[padNumberToIndex(14),0x18,0]); input.report(2,[padNumberToIndex(14),0x30,0]);check();
};
