# Promote to production

Staging-only feature. Contract and setup for Sohail. Nothing here has been created or deployed by the build session.

## API contract
`POST {PROMOTE_TARGET_URL}/api/internal/promote` (production)

Headers: `Authorization: Bearer <PROMOTE_SERVICE_KEY>`, `Content-Type: application/json`. Body max 60 KB.

```json
{ "kind": "task", "sourceId": "<staging id, [A-Za-z0-9_-]{1,64}>",
  "item": { "title": "<=300", "notes": "", "dueDate": "YYYY-MM-DD|null", "expiresAt": "YYYY-MM-DD|null",
            "completed": false, "categoryName": "name|null", "assigneeEmail": "email|null" } }
{ "kind": "feedback", "sourceId": "...",
  "item": { "kind": "FEEDBACK|BUG", "title": "<=200", "description": "<=5000", "authorEmail": "email|null" } }
```
Responses: `201 {"status":"created","targetId"}`, `200 {"status":"exists","targetId"}` (retry of the same kind+sourceId),
`400 {error}` invalid input, `401 unauthorized`, `404` (staging, or no key configured), `413 too_large`,
`422 test_item | phi_blocked (+kinds)`, `429` rate limit (60/min/IP), `500 server_error`.

## Environment
- Staging: `APP_ENV=staging`, `PROMOTE_SERVICE_KEY`, `PROMOTE_TARGET_URL=https://<prod host>`.
- Production: `PROMOTE_SERVICE_KEY` (same value). Do NOT set `APP_ENV=staging` in production (leave unset or `production`).

## Commands for Sohail (not run by the build session)
Generate a key and store it for both environments (replace project, secret names and service names with yours):
```bash
KEY=$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)
printf %s "$KEY" | gcloud secrets create promote-service-key --data-file=- --project=PROJECT   # first time
# or: printf %s "$KEY" | gcloud secrets versions add promote-service-key --data-file=- --project=PROJECT
```
Attach to the services (prod gets the key only; staging also gets APP_ENV and the target):
```bash
gcloud run services update PROD_SERVICE --region=REGION --project=PROJECT \
  --update-secrets=PROMOTE_SERVICE_KEY=promote-service-key:latest
gcloud run services update STAGING_SERVICE --region=REGION --project=PROJECT \
  --update-secrets=PROMOTE_SERVICE_KEY=promote-service-key:latest \
  --update-env-vars=APP_ENV=staging,PROMOTE_TARGET_URL=https://PROD_HOST
```
Database (additive, run against staging and production): `npx prisma db push` (adds `isTest`, `promotedAt`, `promotedProdId` to Task and FeedbackItem, and the `PromotedItem` table).
Verify: in production `curl -i -X POST https://PROD_HOST/api/internal/promote` returns 401 with the key set, 404 without it; staging's Admin > Promote page exists, production's returns 404.
