import { CronExpressionParser } from 'cron-parser';

/** Antonio's October 5 hourly cadence. This sets target times, not publication approval. */
export const publishingCadence = {
    owner: 'phone_farm_worker', timezone: 'America/Los_Angeles',
    videoCron: '0 * * * *', videoIntervalMinutes: 60,
    platforms: ['instagram', 'facebook', 'youtube', 'tiktok'],
    videosPerDayPerPlatform: 24, tiktokDailyLimit: 24,
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
