import test from 'node:test';
import assert from 'node:assert/strict';
import {directReleaseIds,directPublicationStatus} from '../src/publishing/direct-policy.js';
test('direct release defaults to no phone actions and never expands to the whole queue',()=>{
 assert.deepEqual(directReleaseIds(''),[]);
 assert.equal(directPublicationStatus('').enabled,false);
 for(const bad of ['*','all','not-an-id',','])assert.throws(()=>directReleaseIds(bad));
 const id='5dda32ab-38e0-4299-ac08-6fbc6cfff113';
 assert.deepEqual(directReleaseIds(id+','+id),[id]);
});

test('paused comments are explicit and independent of video selection',async()=>{
 const {directPausedCommentPlatforms}=await import('../src/publishing/direct-policy.js');
 assert.deepEqual(directPausedCommentPlatforms('tiktok,tiktok'),['tiktok']);
 assert.deepEqual(directPausedCommentPlatforms(''),[]);
 assert.throws(()=>directPausedCommentPlatforms('youtube'),/Unknown/);
});
