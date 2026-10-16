/** One owner for posting times (Antonio, Oct 15: "make sure it doesn't break again"). One lane per platform, each with its
 * own hours in src/publishing/cadence.ts: Instagram Trial Reels with linked Facebook (8 a day), TikTok (4) and YouTube
 * Shorts (4, 22 minutes after the slot). Every armed, unclaimed post moves to the next free slot in its lane, oldest booking
 * first. Slots with a Share claim, a running or published post, or a post due within 10 minutes are kept and skipped.
 * Dry run by default; --apply writes. Database only; no phone input. */
import {createDatabaseConnection} from '../src/database/client.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
import {publishingCadence as cadence,slotsFrom} from '../src/publishing/cadence.js';

const apply=process.argv.includes('--apply'),phone='00008130-000229EE1AA0001C',minute=60000,hour=3600000;
export const laneOf=(input:any)=>input.targets.some((x:any)=>x.platform==='youtube')?'youtube':input.targets.some((x:any)=>x.platform==='tiktok')?'tiktok':'instagram';
const hoursOf={instagram:cadence.instagramHours,tiktok:cadence.tiktokHours,youtube:cadence.youtubeHours} as const;
const db=createDatabaseConnection(),c=await db.pool.connect();const moves:any[]=[];
try{
 await c.query('BEGIN');
 if(!(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) l',[phone])).rows[0].l)throw Error('Phone busy; the next hourly run retries');
 const rows=(await c.query(`SELECT i.*,r.run_at,r.state,r.share_claimed_at FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE r.state<>'cancelled' FOR UPDATE OF i,r`)).rows;
 const now=Date.now(),t=(r:any)=>new Date(r.run_at).getTime();
 const fixed=(r:any)=>r.state!=='armed'||!!r.share_claimed_at||t(r)<now+10*minute;
 const slotOf=(r:any)=>Math.round((t(r)-(laneOf(r.input)==='youtube'?cadence.youtubeOffsetMinutes*minute:0))/hour)*hour;
 const from=now+30*minute;
 for(const lane of ['instagram','tiktok','youtube'] as const){
  const mine=rows.filter(r=>laneOf(r.input)===lane);
  const taken=new Set(mine.filter(r=>fixed(r)&&(r.state!=='needs_review'||r.share_claimed_at)).map(slotOf));
  const grid=slotsFrom(from,hoursOf[lane]).filter(s=>!taken.has(s));
  const queue=mine.filter(r=>!fixed(r)).sort((a,b)=>t(a)-t(b)||String(a.created_at).localeCompare(String(b.created_at)));
  queue.forEach((r,n)=>{if(!grid[n])throw Error(`No free ${lane} slot in 30 days`);});
  for(const [n,r] of queue.entries()){
   const runAt=new Date(grid[n]!+(lane==='youtube'?cadence.youtubeOffsetMinutes*minute:0)).toISOString();
   if(Date.parse(runAt)===t(r))continue;
   const input=validatePostingInput({...r.input,runAt});
   await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,results=results||jsonb_build_object('laneSlotter',jsonb_build_object('at',now(),'from',$4::text,'to',$5::text)),updated_at=now() WHERE id=$1`,
     [r.id,input,requestHash(input,r.media.sha256),r.run_at.toISOString(),runAt]);
   await c.query(`UPDATE scheduler.publishing_releases SET run_at=$2,item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[r.id,runAt]);
   moves.push({lane,name:r.media.name,from:r.run_at.toISOString(),to:runAt});
  }
 }
 await c.query(apply?'COMMIT':'ROLLBACK');
 const pt=(s:string)=>new Date(s).toLocaleString('en-US',{timeZone:cadence.timezone,weekday:'short',hour:'numeric',minute:'2-digit'});
 if(process.argv.includes('--verbose'))for(const m of moves)console.log(`${m.lane.padEnd(10)} ${pt(m.from).padEnd(14)} -> ${pt(m.to).padEnd(14)} ${m.name}`);
 console.log(JSON.stringify({moved:moves.length,applied:apply}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
finally{c.release();await db.close();}
