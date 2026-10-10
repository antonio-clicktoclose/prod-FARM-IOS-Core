import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';import path from'node:path';import type{Pool}from'pg';
import{NativeStoryStore,nativeStoryRevision,type NativeStoryFrame}from'./mirroring-stories.js';
import{DirectMediaStore}from'./direct-media.js';import{NativeMuteGuard}from'./native-mute.js';import{loadRegisteredDevices}from'../devices/registry.js';
import{WdaStoryDriver}from'./wda-story-driver.js';import{reviewStoryDraft}from'./story-policy.js';
// Story code only. Video driver changes do not invalidate an approved Story; Story driver changes need a new pilot.
const storySources=['src/publishing/wda-stories.ts','src/publishing/wda-story-driver.ts','src/publishing/story-receipts.ts','src/publishing/mirroring-stories.ts','src/publishing/story-policy.ts'];
export async function directStoryFingerprint(){const h=createHash('sha256');for(const p of storySources)h.update(await readFile(p));return h.digest('hex');}
export async function directStoryStatus(pool:Pool){const fingerprint=await directStoryFingerprint(),row=(await pool.query("SELECT * FROM scheduler.mirroring_flow_certificates WHERE flow='stories_wda'")).rows[0];return{layoutAvailable:true,fingerprint,qualified:row?.fingerprint===fingerprint&&!!row?.verified_at,reason:row?.fingerprint===fingerprint?'Each native sequence still needs owner approval.':'One approved direct iPhone Story pilot is required.'};}
/** True when an armed or running video release is within `minutes`. Stories never delay a video slot. */
export async function storyBlockedByVideo(pool:Pool,minutes:number){return !!(await pool.query(`SELECT 1 FROM scheduler.publishing_releases WHERE state IN('armed','running') AND run_at>now()-interval '10 minutes' AND run_at<now()+make_interval(mins=>$1) LIMIT 1`,[minutes])).rowCount;}
/** A saved plan's frames as runner input. Only reviewed PNG photos stored inside Phone Farm data are accepted. */
export async function storyFramesFromPlan(draft:any):Promise<NativeStoryFrame[]>{
 if(!reviewStoryDraft(draft).valid)throw Error('The Story plan does not pass review');
 for(const f of draft.frames){
  if(['b_roll','native_reel'].includes(f.assetKind))throw Error('B-roll and native Reel Story frames are not supported by the iPhone runner yet');
  if(typeof f.assetRef!=='string'||!path.isAbsolute(f.assetRef)||!f.assetRef.endsWith('.png'))throw Error('Each Story frame needs a local reviewed PNG path');
 }
 const frames:NativeStoryFrame[]=[];
 for(const f of draft.frames){
  const sha256=createHash('sha256').update(await readFile(f.assetRef)).digest('hex');
  frames.push({text:f.text,assetRef:f.assetRef,sourceSha256:sha256,sourcePath:f.assetRef,media:{path:f.assetRef,name:path.basename(f.assetRef),mimeType:'image/png',sha256},previewPath:'',previewSha256:''});
 }
 return frames;
}
async function driver(pool:Pool,row:any,signal:AbortSignal,root:string){
 const device=(await loadRegisteredDevices()).find(d=>!d.disabled&&d.udid===row.device_udid&&d.coordinateProfile==='iphone15promax');if(!device)throw Error('Story phone is unavailable');
 const base='http://127.0.0.1:'+(device.wdaLocalPort??8100),imports=new DirectMediaStore(pool);await imports.initialize();
 await new NativeMuteGuard(base,signal).prepare();
 return new WdaStoryDriver(base,signal,imports,row.device_udid,root);
}
/** No Share call or claims. Save five real phone previews for owner approval. Frames default to the plan's own. */
export async function captureDirectStoryDraft(pool:Pool,sequenceId:string,frames?:NativeStoryFrame[]){
 const store=new NativeStoryStore(pool),c=await pool.connect();let phone='',locked=false,d:WdaStoryDriver|undefined;
 try{const row=(await c.query('SELECT * FROM scheduler.story_sequences WHERE id=$1',[sequenceId])).rows[0];if(!row||row.state!=='needs_review'||Date.parse(row.run_at)<=Date.now())throw Error('Choose a future reviewed Story sequence');
 const input=frames??await storyFramesFromPlan(row.draft);if(input.length!==5)throw Error('Five Story frames are required');
 if((await c.query('SELECT 1 FROM scheduler.mirroring_story_jobs WHERE sequence_id=$1',[sequenceId])).rowCount)throw Error('An approval job already exists');
 if(await storyBlockedByVideo(pool,25))throw Error('A video release is due soon; capture the Story drafts later');
 phone=row.device_udid;locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;if(!locked)throw Error('Phone busy');
 const fingerprint=await directStoryFingerprint();d=await driver(pool,row,AbortSignal.timeout(15*60000),path.resolve('.scheduler-data/publishing/wda-story-drafts',sequenceId+'-'+Date.now()));const captured=[];
 for(const [i,frame] of input.entries())captured.push(await d.captureDraftFrame(frame,'frame-'+(i+1)));
 const revision=await nativeStoryRevision(row.draft,captured);await c.query('INSERT INTO scheduler.mirroring_story_preview_sets(sequence_id,native_frames,revision,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[sequenceId,JSON.stringify(captured),revision,fingerprint]);
 const saved=await store.prepare(sequenceId,captured,fingerprint);return{id:saved.id,revision:saved.revision,state:saved.state,shareAttempted:false,previewUrls:[1,2,3,4,5].map(n=>'/api/publishing/stories/native/'+saved.id+'/frames/'+n)};
 }finally{await d?.leaveVideo().catch(()=>{});if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();}
}
/** One automatic draft capture per valid plan, 1 to 30 hours ahead, away from video slots. Never shares. */
let capturesReady=false;
async function captureNextDraft(pool:Pool){
 if(!capturesReady)await pool.query(`CREATE TABLE IF NOT EXISTS scheduler.story_draft_captures(sequence_id uuid PRIMARY KEY REFERENCES scheduler.story_sequences(id),
  state text NOT NULL CHECK(state IN('running','captured','failed')),result jsonb NOT NULL DEFAULT '{}',attempted_at timestamptz NOT NULL DEFAULT now())`);
 capturesReady=true;
 if(await storyBlockedByVideo(pool,40))return;
 const row=(await pool.query(`SELECT s.id FROM scheduler.story_sequences s WHERE s.state='needs_review' AND s.review->>'valid'='true'
  AND s.run_at>now()+interval '1 hour' AND s.run_at<now()+interval '30 hours'
  AND NOT EXISTS(SELECT 1 FROM scheduler.mirroring_story_jobs j WHERE j.sequence_id=s.id)
  AND NOT EXISTS(SELECT 1 FROM scheduler.story_draft_captures a WHERE a.sequence_id=s.id) ORDER BY s.run_at LIMIT 1`)).rows[0];
 if(!row)return;
 if(!(await pool.query(`INSERT INTO scheduler.story_draft_captures(sequence_id,state) VALUES($1,'running') ON CONFLICT DO NOTHING RETURNING sequence_id`,[row.id])).rowCount)return;
 try{const r=await captureDirectStoryDraft(pool,row.id);await pool.query(`UPDATE scheduler.story_draft_captures SET state='captured',result=$2 WHERE sequence_id=$1`,[row.id,JSON.stringify(r)]);}
 catch(e){await pool.query(`UPDATE scheduler.story_draft_captures SET state='failed',result=$2 WHERE sequence_id=$1`,[row.id,JSON.stringify({error:e instanceof Error?e.message:String(e)})]);}
}
export async function runDirectStories(pool:Pool,signal:AbortSignal){
 const s=await directStoryStatus(pool),store=new NativeStoryStore(pool);
 // An approval belongs to the code that captured it. Fail loudly instead of leaving the job armed forever.
 await pool.query(`UPDATE scheduler.mirroring_story_jobs SET state='needs_review',result=result||'{"error":"Story code changed after approval. Capture and approve the drafts again."}'::jsonb
  WHERE state='armed' AND fingerprint<>$1 AND sequence_id IN(SELECT id FROM scheduler.story_sequences WHERE run_at<=now())`,[s.fingerprint]);
 if(await storyBlockedByVideo(pool,15))return;
 await store.tick(s.fingerprint,row=>driver(pool,row,signal,path.resolve('.scheduler-data/publishing/wda-story-runs',row.id)),!s.qualified,'stories_wda');
 await captureNextDraft(pool);
}
