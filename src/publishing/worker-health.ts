import type { Pool } from 'pg';

export const mirroringPublisherBlocker = 'The Mirroring posting flow is being built. Related-Reel selection and native Instagram and Facebook receipt checks still need calibration. Automatic posting remains blocked.';

export interface ReleaseWorkerTick {
    controlMode: 'wda' | 'mirroring';
    state: 'running' | 'blocked';
    blockers: string[];
}

export function releaseWorkerHealth(row: any, now = new Date()) {
    const tick = row?.last_tick ? new Date(row.last_tick) : null;
    const age = tick ? now.getTime() - tick.getTime() : Infinity;
    const healthy = Number.isFinite(age) && age >= 0 && age < 90_000;
    const blocked = row?.state !== 'running' || !Array.isArray(row?.blockers) || row.blockers.length > 0;
    return {
        lastTick: tick?.toISOString() ?? null,
        healthy,
        controlMode: row?.control_mode ?? null,
        state: healthy ? blocked ? 'blocked' : 'running' : 'stopped',
        blockers: healthy && Array.isArray(row?.blockers) ? row.blockers : ['The release worker is not running.'],
        automaticPostingRequested: healthy,
        videoPostingRunning: healthy && !blocked,
    };
}

export class ReleaseWorkerStatusStore {
    constructor(private pool: Pool) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.publishing_worker_health (
            id integer PRIMARY KEY CHECK (id=1), last_tick timestamptz NOT NULL,
            control_mode text NOT NULL CHECK (control_mode IN ('wda','mirroring')),
            state text NOT NULL CHECK (state IN ('running','blocked')),
            blockers jsonb NOT NULL
        )`);
    }
    async tick(value: ReleaseWorkerTick) {
        await this.pool.query(`INSERT INTO scheduler.publishing_worker_health(id,last_tick,control_mode,state,blockers)
            VALUES(1,now(),$1,$2,$3) ON CONFLICT(id) DO UPDATE SET last_tick=EXCLUDED.last_tick,
            control_mode=EXCLUDED.control_mode,state=EXCLUDED.state,blockers=EXCLUDED.blockers`,
            [value.controlMode,value.state,JSON.stringify(value.blockers)]);
    }
    async status() {
        return releaseWorkerHealth((await this.pool.query('SELECT * FROM scheduler.publishing_worker_health WHERE id=1')).rows[0]);
    }
}
