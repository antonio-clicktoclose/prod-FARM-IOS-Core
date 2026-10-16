import test from 'node:test';
import assert from 'node:assert/strict';
import {slotsFrom,publishingCadence as c} from '../src/publishing/cadence.js';

const pt=(ms:number)=>new Date(ms).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:false,day:'numeric'});
test('TikTok and Shorts slots land on 9, 13, 17 and 21 PT across the Nov 1 clock change',()=>{
    const slots=slotsFrom(Date.parse('2026-10-31T07:00:00Z'),c.tiktokHours,2).slice(0,8);
    assert.deepEqual(slots.map(pt),['31, 09','31, 13','31, 17','31, 21','1, 09','1, 13','1, 17','1, 21']);
});
test('8 Instagram slots a day, 4 TikTok and 4 Shorts',()=>{
    const day=Date.parse('2026-10-16T07:00:00Z');
    assert.equal(slotsFrom(day,c.instagramHours,0).length,8);
    assert.equal(slotsFrom(day,c.tiktokHours,0).length,4);
    assert.equal(slotsFrom(day,c.youtubeHours,0).length,4);
});
