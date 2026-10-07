import type { Pool } from 'pg';
import type { PostingInput } from './model.js';
import { ENGAGEMENT_SCHEMA } from './engage-task.js';

export type CommentPlatform = 'instagram' | 'facebook' | 'tiktok';
export interface CommentResult { status: string; commentVerified: boolean; pinned: boolean; evidence: string }
export interface CommentDriver {
    commentOnPost(input: PostingInput, text: string, claim: () => Promise<void>, existingOnly?: boolean): Promise<CommentResult>;
    leaveVideo(): Promise<void>;
}
export const commentKey = (platform: CommentPlatform, id: string) => platform==='instagram' ? `pin:item:${id}` : `comment:${platform}:item:${id}`;

/** Comments have their own claims. A failed comment never changes the video release or retries its Share. */
export async function runPostComment(pool: Pool, id: string, platform: CommentPlatform, driver: CommentDriver) {
    const c=await pool.connect();let phone='';let locked=false;let claimed=false;let ownsAttempt=false;
    const key=commentKey(platform,id);
    try {
        await c.query(ENGAGEMENT_SCHEMA);
        const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];
        if(!item || !['published','needs_review'].includes(item.status) || !item.input.firstComment || !item.input.targets.some((t:any)=>t.platform===platform))return;
        if(!item.results?.release?.receipts?.[platform]?.verified)throw new Error('Native post receipt is required before commenting');
        phone=item.input.deviceUdid;
        locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;
        if(!locked)return;
        const prior=(await c.query('SELECT status FROM scheduler.engagement_actions WHERE claim_key=$1',[key])).rows[0]?.status;
        // Reserve the attempt before opening an app. Interrupted attempts stay visible for review.
        const reserved=await c.query(`INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status)
          VALUES($1,'comment_pin',$2,'preparing')
          ON CONFLICT (claim_key) DO UPDATE SET status='preparing',updated_at=now(),
            result=jsonb_build_object('retries',COALESCE((scheduler.engagement_actions.result->>'retries')::int,0)+1)
          WHERE (scheduler.engagement_actions.status='failed_before_action' OR (scheduler.engagement_actions.status='uncertain_review' AND $3))
            AND scheduler.engagement_actions.updated_at<now()-interval '10 minutes'
            AND COALESCE((scheduler.engagement_actions.result->>'retries')::int,0)<3
          RETURNING claim_key`,[key,'item:'+id,platform!=='tiktok']);
        if(!reserved.rowCount)return;ownsAttempt=true;
        // A comment that may already be up (uncertain) is retried in pin-only mode: the driver never types or posts a second one.
        const existingOnly=prior==='uncertain_review';
        const result=await driver.commentOnPost(item.input,item.input.firstComment,async()=>{
            const r=await c.query(`UPDATE scheduler.engagement_actions SET status='claimed',updated_at=now() WHERE claim_key=$1 AND status='preparing' RETURNING claim_key`,[key]);
            if(!r.rowCount)throw new Error('Comment already claimed');claimed=true;
        },existingOnly);
        await c.query(`UPDATE scheduler.engagement_actions SET status='done',result=$2,updated_at=now() WHERE claim_key=$1`,[key,JSON.stringify(result)]);
        await c.query(`UPDATE scheduler.publishing_items SET results=jsonb_set(results,ARRAY[$2],$3::jsonb),updated_at=now() WHERE id=$1`,[id,platform+'Comment',JSON.stringify(result)]);
    } catch(error) {
        if(ownsAttempt)await c.query(`UPDATE scheduler.engagement_actions SET status=$2,result=COALESCE(result,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE claim_key=$1`,[key,claimed?'uncertain_review':'failed_before_action',JSON.stringify({error:error instanceof Error?error.message:String(error)})]);
    } finally {
        if(ownsAttempt)await driver.leaveVideo().catch(()=>undefined);
        if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);
        c.release();
    }
}
