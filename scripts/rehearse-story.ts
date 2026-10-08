/** Rehearse a five-frame Instagram Story on the phone up to the share options sheet, then close Instagram. Never shares.
 * Usage: rehearse-story.ts SEQUENCE_ID   (frames from a saved plan; nothing is recorded on the plan)
 *        rehearse-story.ts --synthetic   (.scheduler-data/story-rehearsal/rehearsal-frame-N.png, labelled "Never shared")
 * Holds the phone lock, refuses within 25 minutes of an armed video release, runs the zero-volume check, and per frame
 * proves: exact PF- album photo, approved track in music-only style, exact native text, Your story + Facebook story
 * selected. Evidence goes to .scheduler-data/publishing/story-rehearsals/; failures also to release-failures. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createDatabaseConnection} from '../src/database/client.js';
import {DirectMediaStore} from '../src/publishing/direct-media.js';
import {NativeMuteGuard} from '../src/publishing/native-mute.js';
import {WdaStoryDriver} from '../src/publishing/wda-story-driver.js';
import {storyBlockedByVideo,storyFramesFromPlan} from '../src/publishing/wda-stories.js';
import type {NativeStoryFrame} from '../src/publishing/mirroring-stories.js';
const arg=process.argv[2]??'',PHONE='00008130-000229EE1AA0001C';
if(arg!=='--synthetic'&&!/^[a-f0-9-]{36}$/.test(arg))throw Error('Usage: rehearse-story.ts SEQUENCE_ID | --synthetic');
const db=createDatabaseConnection(),c=await db.pool.connect(),base='http://127.0.0.1:8100';
const signal=AbortSignal.timeout(15*60_000);let locked=false,phone=PHONE;
const root=path.resolve('.scheduler-data/publishing/story-rehearsals',new Date().toISOString().replace(/[:.]/g,'-'));
try{
 let frames:NativeStoryFrame[];
 if(arg==='--synthetic'){
  frames=[];
  for(let n=1;n<=5;n++){
   const file=path.resolve(`.scheduler-data/story-rehearsal/rehearsal-frame-${n}.png`),sha256=createHash('sha256').update(await readFile(file)).digest('hex');
   frames.push({text:`Rehearsal frame ${n}. Nothing here is shared.`,assetRef:file,sourceSha256:sha256,sourcePath:file,media:{path:file,name:path.basename(file),mimeType:'image/png',sha256},previewPath:'',previewSha256:''});
  }
 }else{
  const row=(await c.query('SELECT * FROM scheduler.story_sequences WHERE id=$1',[arg])).rows[0];if(!row)throw Error('Story plan not found');
  phone=row.device_udid;frames=await storyFramesFromPlan(row.draft);
 }
 if(await storyBlockedByVideo(db.pool,25))throw Error('A video release is due within 25 minutes; not rehearsed');
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l',[phone])).rows[0].l;if(!locked)throw Error('Phone busy');
 const imports=new DirectMediaStore(db.pool);await imports.initialize();
 await new NativeMuteGuard(base,signal).prepare();
 const driver=new WdaStoryDriver(base,signal,imports,phone,root),started=Date.now();
 for(const [i,frame] of frames.entries()){
  const t=Date.now(),done=await driver.captureDraftFrame(frame,'frame-'+(i+1));
  console.log(`frame ${i+1}: ready to share, stopped before Share (${Math.round((Date.now()-t)/1000)} s) preview ${path.relative(process.cwd(),done.previewPath)}`);
 }
 console.log(`STORY REHEARSAL PASSED: 5 frames in ${Math.round((Date.now()-started)/1000)} s; no Share tapped. Evidence: ${path.relative(process.cwd(),root)}`);
}catch(e:any){console.log('STORY REHEARSAL STOPPED:',e.message);process.exitCode=1;}
finally{
 // captureDraftFrame already closed Instagram after each frame. Return Home without locking the phone.
 await fetch(base+'/wda/homescreen',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15_000)}).catch(()=>undefined);
 if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();await db.close();
}
