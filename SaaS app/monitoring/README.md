# Monitoring and alerting (F5)

Alert policies as files so they are reviewed and repeatable. Nothing here contains secrets or patient data.
Apply with `./apply.sh <project> <notification-channel-id>`. Create the email channel once (Console > Monitoring >
Alerting > Notification channels, or `gcloud beta monitoring channels create --type=email`). Creating a channel sends
the owner a verification email, so Sohail asks for it first.

Policies (each in its own JSON file):
1. uptime.json: login page uptime check fails for 5 minutes.
2. http-5xx.json: Cloud Run 5xx responses above 5 in 5 minutes.
3. latency.json: request latency p95 above 3 s for 10 minutes.
4. cloudsql-health.json: Cloud SQL instance down, or disk above 85 percent.
5. app-error-log.json: log-based alert on audit-trigger or schema-gate failure lines (severity ERROR, text match).

Status 2026-11-21: staging and production projects have NO alert policies and no notification channels yet.
