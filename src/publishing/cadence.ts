import { CronExpressionParser } from 'cron-parser';

/** Antonio's cadence: one video every 2 hours from Oct 11 16:45 (every 3 hours from Oct 7, hourly from Oct 5). Target times, not publication approval. */
export const publishingCadence = {
    owner: 'phone_farm_worker', timezone: 'America/Los_Angeles',
    videoCron: '22 0-23/2 * * *', videoIntervalMinutes: 120,
    platforms: ['instagram', 'facebook', 'youtube', 'tiktok'],
    videosPerDayPerPlatform: 12, tiktokDailyLimit: 24,
    storyCron: '0 9,17 * * *', storyTimes: ['09:00', '17:00'],
    storySequencesPerDay: 2, planningDays: 3,
    missedSlotPolicy: 'review_before_rescheduling',
} as const;

export function upcomingVideoSlots(now = new Date(), count = 72): Date[] {
    const cron = CronExpressionParser.parse(publishingCadence.videoCron, {
        currentDate: now, tz: publishingCadence.timezone,
    });
    return Array.from({length: count}, () => cron.next().toDate());
}
