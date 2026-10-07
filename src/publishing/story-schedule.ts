import type { Pool } from 'pg';
import { CronExpressionParser } from 'cron-parser';
import { StorySequenceStore } from './story-sequences.js';
import { publishingCadence } from './cadence.js';

export const storySchedule = {
    owner: 'phone_farm_worker', timezone: publishingCadence.timezone, cron: publishingCadence.storyCron,
    times: publishingCadence.storyTimes, sequencesPerDay: publishingCadence.storySequencesPerDay,
    enabled: true, publicationEnabled: false, planningDays: 3, preparationLeadHours: 24,
    nativePilotVerified: true,
    blockers: ['Select and review the exact photos, B-roll clips and source post.', 'Approve the actual native drafts for each new sequence.', 'Build and test the unattended publisher with per-frame claims and both platform receipts.'],
} as const;
export function nextStorySlot(now: Date): Date {
    return CronExpressionParser.parse(storySchedule.cron, { currentDate: now, tz: storySchedule.timezone }).next().toDate();
}
export function upcomingStorySlots(now: Date): Date[] {
    const slots: Date[] = [];
    let cursor = now;
    for (let i = 0; i < storySchedule.planningDays * storySchedule.sequencesPerDay; i++) {
        cursor = nextStorySlot(cursor);
        slots.push(cursor);
    }
    return slots;
}
export function storyWorkerHealth(lastTick: Date | null, now = new Date()) {
    return { lastTick: lastTick?.toISOString() ?? null,
        healthy: lastTick !== null && now.getTime() - lastTick.getTime() >= 0 && now.getTime() - lastTick.getTime() < 120_000 };
}
export class StoryScheduleStore {
    constructor(private pool: Pool, private workerMode: 'planning_only' | 'publishing' = 'planning_only') {}
    async initialize() {
        await new StorySequenceStore(this.pool).initialize();
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.story_daily_slots (
            run_at timestamptz PRIMARY KEY,
            state text NOT NULL CHECK (state IN ('waiting_for_draft','blocked')),
            updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.story_worker_health (id integer PRIMARY KEY CHECK (id=1), last_tick timestamptz NOT NULL)`);
        await this.pool.query(`ALTER TABLE scheduler.story_worker_health ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'planning_only'`);
        await this.ensureFutureSlots();
    }
    async ensureFutureSlots(now = new Date()) {
        for (const next of upcomingStorySlots(now)) {
            await this.pool.query(`INSERT INTO scheduler.story_daily_slots (run_at,state) VALUES ($1,'waiting_for_draft') ON CONFLICT DO NOTHING`, [next]);
        }
    }
    // Calendar bookkeeping only. No phone, model, upload or Share calls.
    // Each timestamp is unique across workers. Missed slots block instead of replaying.
    async tick(now = new Date()) {
        await new StorySequenceStore(this.pool).tick(now);
        await this.pool.query(`UPDATE scheduler.story_daily_slots SET state='blocked',updated_at=$1 WHERE run_at <= $1 AND state='waiting_for_draft'`, [now]);
        await this.ensureFutureSlots(now);
        await this.pool.query(`INSERT INTO scheduler.story_worker_health (id,last_tick,mode) VALUES (1,$1,$2) ON CONFLICT(id) DO UPDATE SET last_tick=EXCLUDED.last_tick,mode=EXCLUDED.mode`, [now,this.workerMode]);
    }
    async status() {
        const slots = await this.pool.query(`SELECT run_at,state FROM scheduler.story_daily_slots ORDER BY run_at DESC LIMIT 14`);
        const health = await this.pool.query(`SELECT last_tick,mode FROM scheduler.story_worker_health WHERE id=1`);
        return { ...storySchedule, worker: {...storyWorkerHealth(health.rows[0]?.last_tick ?? null), mode:health.rows[0]?.mode ?? 'unknown'}, sequences: await new StorySequenceStore(this.pool).list(), slots: slots.rows.map(slot => ({ ...slot, prepare_at: new Date(new Date(slot.run_at).getTime() - storySchedule.preparationLeadHours * 3_600_000).toISOString() })) };
    }
}
export async function startStorySchedule(pool: Pool, mode: 'planning_only' | 'publishing' = 'planning_only') {
    const owner = await pool.connect();
    const locked = (await owner.query("SELECT pg_try_advisory_lock(hashtextextended('phone-farm:story-scheduler',3)) AS locked")).rows[0].locked;
    if (!locked) { owner.release(); throw new Error('A Phone Farm Story scheduler is already running'); }
    const store = new StoryScheduleStore(pool,mode);
    try { await store.initialize(); await store.tick(); }
    catch (error) { owner.release(true); throw error; }
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
        if (pending) return;
        pending = store.tick().catch(error => console.error('Story schedule:', error)).finally(() => { pending = undefined; });
    }, 30_000);
    return { async close() { clearInterval(timer); await pending; owner.release(true); } };
}
