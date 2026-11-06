# Costs module: setup (only Sohail can run these)

What it shows: Admin > Costs, per month, for production (bbc-practice-mgmt) and staging (bbc-practice-mgmt-staging), by service, with a prior-month comparison. Source: Cloud Billing "standard usage cost" export to BigQuery. Billing data only, no PHI.

Finding (2026-11-05, read-only): both projects are on billing account `019E81-6EF37E-083323` ("My Billing Account"). BigQuery API is enabled in both projects, and neither project has any dataset. So no export exists yet. The export only holds data from the day it is turned on (Google does not backfill), so Costs starts empty and fills from that day.

Where the data lives (decision): a dataset `billing_export` in the PRODUCTION project. Only the production app reads it, so staging identities never touch prod resources (playbook section 3). The production app shows both environments; the staging app shows clearly labelled SAMPLE numbers (layout check only).

## Mandatory steps
1. Create the dataset (billing admin not needed):
   `bq --project_id=bbc-practice-mgmt mk --dataset --location=US bbc-practice-mgmt:billing_export`
2. Turn on the export (console only; needs Billing Account Administrator): Google Cloud console > Billing > billing account `019E81-6EF37E-083323` > Billing export > BigQuery export > Standard usage cost > Edit settings > project `bbc-practice-mgmt`, dataset `billing_export` > Save. The table `gcp_billing_export_v1_019E81_6EF37E_083323` appears within about a day.
3. Let the production app read it (IAM on the dataset and the job project):
   `bq show --format=prettyjson bbc-practice-mgmt:billing_export > /tmp/ds.json` then add an access entry for `pm-run@bbc-practice-mgmt.iam.gserviceaccount.com` with role READER (BigQuery Data Viewer), then `bq update --source /tmp/ds.json bbc-practice-mgmt:billing_export`; and `gcloud projects add-iam-policy-binding bbc-practice-mgmt --member=serviceAccount:pm-run@bbc-practice-mgmt.iam.gserviceaccount.com --role=roles/bigquery.jobUser`
   (Use the service account the production Cloud Run service actually runs as: `gcloud run services describe practice-mgmt --project bbc-practice-mgmt --region us-east4 --format='value(spec.template.spec.serviceAccountName)'`.)
4. Point the production app at the table:
   `gcloud run services update practice-mgmt --project bbc-practice-mgmt --region us-east4 --update-env-vars COSTS_BQ_TABLE=bbc-practice-mgmt.billing_export.gcp_billing_export_v1_019E81_6EF37E_083323`
   (Production Agent should carry this env var on promotions, or it must be re-set after a deploy that drops it.)

## Optional
- Detailed usage cost export (adds resource-level rows): not needed.
- Vertex AI by SKU is already shown from the standard export.
- Budget alert: Billing > Budgets & alerts.

Not granted to staging: nothing in this setup gives any staging identity access to the production project or the dataset.
