import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStorySlot, storySchedule } from '../src/publishing/story-schedule.js';
test('Story slots use 9 AM and 5 PM Pacific across daylight saving changes', () => {
    assert.equal(nextStorySlot(new Date('2026-10-01T00:00:00Z')).toISOString(), '2026-10-01T16:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-11-01T00:00:00Z')).toISOString(), '2026-11-01T17:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-10-01T16:00:00Z')).toISOString(), '2026-10-02T00:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-11-01T17:00:00Z')).toISOString(), '2026-11-02T01:00:00.000Z');
    assert.equal(storySchedule.publicationEnabled, false);
});

import { upcomingStorySlots, storyWorkerHealth } from '../src/publishing/story-schedule.js';
test('planning window has six unique future slots across DST', () => {
    assert.deepEqual(upcomingStorySlots(new Date('2026-10-31T17:00:00Z')).map(d=>d.toISOString()), ['2026-11-01T00:00:00.000Z','2026-11-01T17:00:00.000Z','2026-11-02T01:00:00.000Z','2026-11-02T17:00:00.000Z','2026-11-03T01:00:00.000Z','2026-11-03T17:00:00.000Z']);
});
test('a stored future slot cannot stand in for a worker heartbeat', () => {
    const now = new Date('2026-10-01T22:00:00Z');
    assert.equal(storyWorkerHealth(null, now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()-121000), now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()+1000), now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()-30000), now).healthy, true);
});
