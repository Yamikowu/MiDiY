// Development-only replay: actual UI/runtime, deterministic reports, no physical I/O or persistent profiles.
import page from '../../index.html?raw';
import { fixture } from '../runtime-fixture';
import { TranslatorUI } from '../../src/devices/mikro-mk3/mapping/translator-ui';
import { ProfileLibrary } from '../../src/devices/mikro-mk3/mapping/profile-library';
import { initializeLocale, mountLanguageSwitcher } from '../../src/i18n/index';
import { mountPages } from '../../src/shared/pages';
import { mountTesting } from '../../src/research/testing-ui.js';
import { mikroResearch } from '../../src/devices/mikro-mk3/research';
history.replaceState(null,'','#mapping');
document.documentElement.innerHTML=page.replace(/<script[\s\S]*?<\/script>/g,'').replaceAll('href="./','href="/');
const storage={getItem:()=>null,setItem(){}};
initializeLocale(storage,['zh-TW']);mountLanguageSwitcher();
const {runtime,input,midi}=fixture();
const methodCounts:Record<string,number>={},methodMs:Record<string,number>={};
class MeasuredUI extends (TranslatorUI as any) {}
for(const name of ['renderPressed','queueModeLights','renderPlayingMode','previewBatch','renderDevice','renderPorts']) {
 const original=(TranslatorUI.prototype as any)[name];
 (MeasuredUI.prototype as any)[name]=function(...args:unknown[]){
  const start=performance.now();try{return original.apply(this,args);}finally{methodCounts[name]=(methodCounts[name]??0)+1;methodMs[name]=(methodMs[name]??0)+performance.now()-start;}
 };
}
let snapshots=0;const snapshotGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(runtime),'snapshot')!.get!;
Object.defineProperty(runtime,'snapshot',{get(){snapshots++;return snapshotGetter.call(runtime);}});
new MeasuredUI(runtime,new ProfileLibrary(storage),{toast(){}});
mountTesting(runtime,()=>{},mikroResearch);mountPages();
const output=document.createElement('pre');output.id='performance-results';output.style.cssText='white-space:pre-wrap;color:#ddd';document.body.append(output);
let animationCallbackMs=0;
const browserFrame=window.requestAnimationFrame.bind(window);
window.requestAnimationFrame=callback=>browserFrame(time=>{
 const start=performance.now();try{callback(time);}finally{animationCallbackMs+=performance.now()-start;}
});
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
let tableReplacements=0;const observer=new MutationObserver(records=>{tableReplacements+=records.filter(r=>r.target===document.getElementById('report-rows')).length;});
observer.observe(document.getElementById('report-rows')!,{childList:true});
const hash=(value:unknown)=>{let h=2166136261;for(const c of JSON.stringify(value))h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(16);};
const quantile=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))];
const rounds:any[]=[];
let reportIndex=0;let states=0;runtime.subscribe(event=>{if(event.type==='state')states++;});
async function replay(count:number) {
 const timings:number[]=[];const beforeMidi=midi.sent.length,beforeHid=input.sent.length;
 const start=performance.now();
 for(let i=0;i<count;i++){
  const n=reportIndex++,phase=n%12;
  const code=phase===0?0x18:phase===11?0x30:0x48;
  const then=performance.now();input.report(2,[12,code,phase===11?0:(n%200)+1]);timings.push(performance.now()-then);
  if(i%8===7){await Promise.resolve();await frame();}
 }
 await Promise.resolve();await frame();await frame();
 return {reports:count,wallMs:performance.now()-start,dispatchMs:timings.reduce((a,b)=>a+b,0),p50ReportMs:quantile(timings,.5),p95ReportMs:quantile(timings,.95),midiCount:midi.sent.length-beforeMidi,midiHash:hash(midi.sent.slice(beforeMidi)),hidCount:input.sent.length-beforeHid,hidHash:hash(input.sent.slice(beforeHid).map(r=>[r.reportId,[...r.data]]))};
}
try {
 await runtime.connect();await runtime.enableMidi();await runtime.selectOutput('a');runtime.setLedEnabled(true);
 await replay(120);
 for(const mode of ['mapping','testing','paused']){
  location.hash=mode==='mapping'?'#mapping':'#testing';
  const paused=document.getElementById('pause-log') as HTMLInputElement;paused.checked=mode==='paused';paused.dispatchEvent(new Event('change'));
  await frame();await frame();
  for(let trial=0;trial<3;trial++){
   for(const key of Object.keys(methodCounts)){methodCounts[key]=0;methodMs[key]=0;}snapshots=0;states=0;tableReplacements=0;animationCallbackMs=0;
   const result=await replay(240);
   rounds.push({mode,trial,...result,animationCallbackMs,totalMeasuredWorkMs:result.dispatchMs+animationCallbackMs,states,snapshots,tableReplacements,methodCounts:{...methodCounts},methodMs:{...methodMs}});
   output.textContent=JSON.stringify({status:'running',rounds},null,2);
  }
 }
 const allRecorded=Number(document.getElementById('metric-reports')!.textContent!.replaceAll(',',''))===reportIndex;
 await runtime.disconnect();observer.disconnect();
 output.textContent=JSON.stringify({status:'complete',environment:{userAgent:navigator.userAgent,width:innerWidth,reportsPerFrame:8},allRecorded,totalReports:reportIndex,rounds},null,2);
 document.title='PASS performance replay';
}catch(error){output.textContent=JSON.stringify({status:'failed',error:String(error),rounds},null,2);document.title='FAIL performance replay';}
