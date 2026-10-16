/** Give held Shorts the reviewed long-form link the YouTube driver requires (prepared-youtube.ts reviewedLongForm).
 * Usage: link-shorts-long-form.ts <id,id,...> [--apply]. Held items with no release only; database only. */
import {createDatabaseConnection} from '../src/database/client.js';
import {reviewedLongForm} from '../src/publishing/prepared-youtube.js';
import {requestHash,validatePostingInput} from '../src/publishing/model.js';
const [list]=process.argv.slice(2),apply=process.argv.includes('--apply');
const db=createDatabaseConnection();
try{for(const id of list.split(',')){
 const i=(await db.pool.query(`SELECT i.* FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
   WHERE i.id=$1 AND i.status='held' AND r.item_id IS NULL AND i.input->'targets' @> '[{"platform":"youtube"}]'`,[id])).rows[0];
 if(!i){console.log('skip (not a held, unreleased Short):',id);continue;}
 const input=validatePostingInput({...i.input,youtube:{...i.input.youtube,publishing:{...i.input.youtube.publishing,relatedVideoId:reviewedLongForm.id}}});
 if(apply)await db.pool.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now() WHERE id=$1 AND status='held'`,[id,input,requestHash(input,i.media.sha256)]);
 console.log(apply?'linked:':'would link:',i.media.name);
}}finally{await db.close();}
