# Scheduled agent

`scheduled-agent.yaml` is the routine definition for a Claude Code scheduled agent. The default is 5:00 AM Eastern every day.

## Setup

1. Create a cloud routine that checks out this repository's `main` branch.
2. Copy the schedule, prompt, and command from `scheduled-agent.yaml`.
3. Set the live environment variables listed in `.env.example` in the routine's secret store.
4. Run once with outbound mail paused, review the dashboard, then set `mail.paused: false` in `business.yaml`.
5. Confirm the routine persists a `runs` record and publishes the dashboard report.

The CLI is idempotent. A repeat on the same date uses message dedupe keys and does not send the same initial request twice.

## Other schedulers

- **GitHub Actions:** run `pnpm pipeline` from a scheduled workflow and store all secrets in GitHub Environments. This repository does not ship the workflow because the approved default is the cloud scheduled agent.
- **pg_cron:** invoke a trusted edge function that starts the pipeline. Do not put provider or Gmail secrets in SQL.

Neither alternative changes pipeline behavior. Set `schedule.scheduler` in `business.yaml` so the read-only config view reports the active scheduler.
