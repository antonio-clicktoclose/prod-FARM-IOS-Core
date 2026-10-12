/** Immediate phone alerts. Deterministic, read-only. Runs every 5 minutes under launchd.
 * Alerts (Slack DM, macOS notification if Slack fails) when WDA is not ready, the phone is unplugged or locked,
 * or the battery is under 15% and falling. One alert per problem, repeated every 3 hours while it lasts.
 * Pings HEARTBEAT_URL (optional, from .env) after each run. Also retries the WDA runner when it reports "retries stopped" so posting resumes after the passcode is entered. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Message, Blocks, Md } from 'slack-block-builder';
import { probeDevice, deviceIssues, PHONE_UDID } from './lib/device-health.js';
import { sendAlert } from './lib/ops-notify.js';

const statePath = '.scheduler-data/device-alert-state.json';
const REALERT_MS = 3 * 60 * 60_000;
const dashboard = 'https://phonefarm.clicktoclose.ai/publishing';
type State = { alerts: Record<string, number>; batteryPct?: number };

const state: State = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
state.alerts ??= {};
const probe = await probeDevice();
if (!probe.wdaReady && probe.usbConnected && /retries stopped|error/i.test(probe.serviceMessage))
    try { execFileSync('curl', ['-s', '-m', '20', '-X', 'POST', '--unix-socket', '.wda/wda-service.sock', `http://localhost/devices/${PHONE_UDID}/reconnect`], { stdio: 'ignore' }); } catch { /* next run tries again */ }
const issues = deviceIssues(probe, state.batteryPct);
if (probe.battery) state.batteryPct = probe.battery.pct;
const now = Date.now();
const fresh = issues.filter(i => !state.alerts[i.key] || now - state.alerts[i.key]! > REALERT_MS);
for (const k of Object.keys(state.alerts)) if (!issues.some(i => i.key === k)) delete state.alerts[k];
if (fresh.length) {
    const message = Message({ text: `Phone Farm device: ${fresh.length} issue(s)` }).blocks(
        Blocks.Header({ text: 'Phone Farm device alert' }),
        ...fresh.map(i => Blocks.Section({ text: i.text })),
        Blocks.Context().elements(Md.link(dashboard, 'Open the calendar')),
    ).buildToObject() as any;
    if ((await sendAlert(message.blocks, message.text, { title: 'Phone Farm device alert' })).ok) for (const i of fresh) state.alerts[i.key] = now;
}
// Dead-man's switch: a cloud monitor (Healthchecks.io, see docs/cloud-architecture.md) alerts if these pings stop, e.g. the Mac is off.
if (process.env.HEARTBEAT_URL) await fetch(process.env.HEARTBEAT_URL, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
await mkdir('.scheduler-data', { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2));
console.log(`${new Date().toISOString()} device: ${issues.length} issue(s), ${fresh.length} alerted, battery ${probe.battery?.pct ?? 'n/a'}%`);
