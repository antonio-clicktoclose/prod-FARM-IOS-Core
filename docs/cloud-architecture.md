# Phone Farm: what moves to the cloud (plan, 2026-10-12)

Status: plan only. Nothing here is provisioned and the live database has not been migrated. Each paid step needs Antonio's approval.

## Constraint

The iPhone stays plugged into a Mac by USB. WebDriverAgent (WDA), the worker, the release loop and the Appium driver cannot run in a cloud Mac or device farm against that phone. They stay on one Mac (today the laptop, later a home Mac mini). "Cloud" means everything around the phone.

## What runs where

| Piece | Today | Recommendation | Why |
|---|---|---|---|
| WDA, Appium, worker, release loop, awake job | Mac | **Stays on the Mac** | Needs USB to the phone |
| Device alerts (WDA, USB, lock, battery) | Mac, every 5 min | **Stays on the Mac** | Reads the phone directly |
| Burn-in report, monitor, daily summary | Mac, launchd | **Stays on the Mac for now** | They read the phone and the DB; a cloud copy could not see the phone |
| Dead-man's switch (is the Mac alive?) | Nothing | **Move to the cloud: Healthchecks.io** | The Mac cannot report its own power loss |
| Postgres scheduler DB (12 MB) | Local `DATABASE_URL` | **Move to a managed Postgres** (see below) | Survives a dead Mac, cheap, tiny |
| Backups | None automatic | **Nightly `pg_dump` to Cloudflare R2** | Pennies per month |
| Media files (`.scheduler-data/publishing`, 8.6 GB) | Mac disk | **Copy to R2, keep working copies on the Mac** | Not needed to post from a new Mac if the DB points at them |
| Calendar / web UI | Mac port 3000 via Cloudflare tunnel | **Stays on the Mac behind the tunnel** (free) | Arm/disarm actions call the local worker, which needs the phone |

## Recommended option

Total about **$6 to $10 per month**, and one new vendor account at most.

1. **Postgres on Neon (Launch, usage-based) or Supabase Pro.** The database is 12 MB, so usage-based Neon should cost a few dollars a month; Supabase Pro is a flat $25. Recommendation: **Neon, a new project dedicated to Phone Farm**. Do not use the c2c-analytics or platform databases (hard rule: one content database; the farm's scheduler data is separate operational state).
2. **Backups and media on Cloudflare R2**: 10 GB free, then $0.015 per GB per month. Use `scripts/backup-db.sh` with `BACKUP_REMOTE=r2:phone-farm-backups` and an rclone remote.
3. **Healthchecks.io free plan** (20 checks): set `HEARTBEAT_URL` in `.env`; `device-alert.ts` pings it every 5 minutes. If pings stop for 15 minutes the service emails or Slack-DMs Antonio. This is the one alert the Mac cannot send for itself.
4. **Cloudflare Tunnel** stays as is (free).

Prices are from memory and move; confirm on each vendor's pricing page before signing up.

## Database migration plan (not run)

Needs Antonio's explicit approval and a short window with the worker stopped.

1. Create the Neon project. Record the connection string in 1Password (Business account, `c2c-monorepo` vault), never in the repo.
2. Run `scripts/backup-db.sh`, then restore the dump into Neon and compare table row counts.
3. In a quiet moment (no armed release within 30 minutes, no running release), stop the worker with `.scheduler-data/diag/restart-when-idle.ts` semantics, change `DATABASE_URL` in `.env`, and restart worker and web.
4. Watch two hourly cycles. Keep the old local database untouched for 7 days as a rollback.
5. Latency: the worker polls every 20 seconds; a cloud round trip of under 100 ms is fine. Advisory locks used by the backlog job work on Neon's pooled-off (direct) connection string only; use the direct string, not the pooler.

Risk: the worker then depends on the internet. A short outage delays posting but never double-posts, because claims are written before Share. The local Postgres can stay as a read replica target later if wanted.

## Reports and alerts in the cloud

The burn-in report and monitor need the phone and the Mac's launchd, so they stay put. Cloud adds only the heartbeat check above. A later option, once the DB is cloud-hosted: a small GitHub Actions or Cloudflare Worker cron that reads release rows and DMs the same summary if the Mac heartbeat is red. Not needed now.

## What the Mac mini needs

See `docs/new-mac-setup.md` and `scripts/setup-new-mac.sh`. With a cloud DB the move becomes: clone repo, copy `.env` and the tunnel files, plug in the phone, run the script.

## Open decisions for Antonio

- Approve Neon (or choose Supabase) and the R2 account.
- Approve the DB migration window.
- Tell me the Mac mini arrival date; the setup script is ready.
