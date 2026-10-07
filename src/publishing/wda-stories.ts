import{readFile,mkdir,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import type{Pool}from'pg';
import{NativeStoryStore,NativeStoryDriver,loadNativeStoryFlow,nativeStoryRevision,type NativeStoryFrame}from'./mirroring-stories.js';
import{WdaNativeScreen}from'./wda-native-screen.js';import{DirectMediaStore}from'./direct-media.js';import{NativeMuteGuard}from'./native-mute.js';import{loadRegisteredDevices}from'../devices/registry.js';
const layout='.scheduler-data/native-layouts/stories-wda.json';
export async function directStoryFingerprint(){const h=createHash('sha256');for(const p of ['src/publishing/wda-stories.ts','src/publishing/wda-native-screen.ts','src/publishing/native-mute.ts','src/publishing/mirroring-stories.ts','src/publishing/mirroring-flow.ts','src/publishing/story-policy.ts'])h.update(await readFile(p));h.update(JSON.stringify(await loadNativeStoryFlow(layout)));return h.digest('hex');}
export async function directStoryStatus(pool:Pool){try{const fingerprint=await directStoryFingerprint(),row=(await pool.query("SELECT * FROM scheduler.mirroring_flow_certificates WHERE flow='stories_wda'")).rows[0];return{layoutAvailable:true,fingerprint,qualified:row?.fingerprint===fingerprint&&!!row?.verified_at,reason:row?.fingerprint===fingerprint?'Each native sequence still needs owner approval.':'A direct iPhone Story pilot is required.'};}catch{return{layoutAvailable:false,qualified:false,reason:'Review and save the direct iPhone Story layout, then approve all five native previews.'};}}
async function driver(pool:Pool,row:any,signal:AbortSignal,root:string){
 const device=(await loadRegisteredDevices()).find(d=>!d.disabled&&d.udid===row.device_udid&&d.coordinateProfile==='iphone15promax');if(!device)throw Error('Story phone is unavailable');
 const base='http://127.0.0.1:'+(device.wdaLocalPort??8100),mute=new NativeMuteGuard(base,signal),imports=new DirectMediaStore(pool);await imports.initialize();
 const screen=new WdaNativeScreen(base,signal,()=>mute.verify()),fingerprint=await directStoryFingerprint();
 screen.beforeInput=async()=>{if(await directStoryFingerprint()!==fingerprint)throw Error('Native Story code or layout changed');};
 return new NativeStoryDriver(signal,await loadNativeStoryFlow(layout),root,screen,async frame=>{await mute.prepare();await imports.ensure(row.device_udid,frame.media,base,signal);});
}
/** No Share call or claims. Save five real phone previews for owner approval. */
export async function captureDirectStoryDraft(pool:Pool,sequenceId:string,frames:NativeStoryFrame[]){
 const store=new NativeStoryStore(pool),c=await pool.connect();let phone='',locked=false,d:NativeStoryDriver|undefined;
 try{const row=(await c.query('SELECT * FROM scheduler.story_sequences WHERE id=$1',[sequenceId])).rows[0];if(!row||row.state!=='needs_review'||Date.parse(row.run_at)<=Date.now())throw Error('Choose a future reviewed Story sequence');await nativeStoryRevision(row.draft,frames);
 if((await c.query('SELECT 1 FROM scheduler.mirroring_story_jobs WHERE sequence_id=$1',[sequenceId])).rowCount)throw Error('An approval job already exists');
 phone=row.device_udid;locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;if(!locked)throw Error('Phone busy');
 const fingerprint=await directStoryFingerprint();d=await driver(pool,row,AbortSignal.timeout(15*60000),path.resolve('.scheduler-data/publishing/wda-story-drafts',sequenceId+'-'+Date.now()));const captured=[];
 for(const frame of frames){captured.push(await d.captureDraftFrame(frame));await d.leaveVideo();}
 const revision=await nativeStoryRevision(row.draft,captured);await c.query('INSERT INTO scheduler.mirroring_story_preview_sets(sequence_id,native_frames,revision,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[sequenceId,JSON.stringify(captured),revision,fingerprint]);
 const saved=await store.prepare(sequenceId,captured,fingerprint);return{id:saved.id,revision:saved.revision,state:saved.state,shareAttempted:false,previewUrls:[1,2,3,4,5].map(n=>'/api/publishing/stories/native/'+saved.id+'/frames/'+n)};
 }finally{await d?.leaveVideo().catch(()=>{});if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();}
}
export async function runDirectStories(pool:Pool,signal:AbortSignal){const s=await directStoryStatus(pool);if(!s.layoutAvailable||!s.fingerprint)return;await new NativeStoryStore(pool).tick(s.fingerprint,row=>driver(pool,row,signal,path.resolve('.scheduler-data/publishing/wda-story-runs',row.id)),!s.qualified,'stories_wda');}
