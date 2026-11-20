# One-time setup for staging auto-deploy (run by Sohail; nothing here is run by an agent)
Reason: lets GitHub deploy to STAGING only, with short-lived credentials (no key files). The identity lives in the staging project and has no role in the production project.
Staging project number 321509350517. Repo SohailZ7/Practice-management.

1. Create the deploy identity (can only deploy staging):
   gcloud iam service-accounts create gh-deploy --project bbc-practice-mgmt-staging --display-name "GitHub staging deploy"
2. Let it push images to the one image repository, and deploy the one service:
   gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy --project bbc-practice-mgmt-staging --location us-east4 --member serviceAccount:gh-deploy@bbc-practice-mgmt-staging.iam.gserviceaccount.com --role roles/artifactregistry.writer
   gcloud run services add-iam-policy-binding practice-mgmt --project bbc-practice-mgmt-staging --region us-east4 --member serviceAccount:gh-deploy@bbc-practice-mgmt-staging.iam.gserviceaccount.com --role roles/run.developer
3. Allow it to run the service as the app identity (needed for any deploy):
   gcloud iam service-accounts add-iam-policy-binding pm-run@bbc-practice-mgmt-staging.iam.gserviceaccount.com --project bbc-practice-mgmt-staging --member serviceAccount:gh-deploy@bbc-practice-mgmt-staging.iam.gserviceaccount.com --role roles/iam.serviceAccountUser
4. Create the GitHub trust (pool + provider), accepting ONLY this repo's main branch:
   gcloud iam workload-identity-pools create github --project bbc-practice-mgmt-staging --location global --display-name "GitHub"
   gcloud iam workload-identity-pools providers create-oidc github-main --project bbc-practice-mgmt-staging --location global --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" --attribute-condition "assertion.repository=='SohailZ7/Practice-management' && assertion.ref=='refs/heads/main'"
5. Let that trust act as the deploy identity:
   gcloud iam service-accounts add-iam-policy-binding gh-deploy@bbc-practice-mgmt-staging.iam.gserviceaccount.com --project bbc-practice-mgmt-staging --member "principalSet://iam.googleapis.com/projects/321509350517/locations/global/workloadIdentityPools/github/attribute.repository/SohailZ7/Practice-management" --role roles/iam.workloadIdentityUser
Undo: delete the service account and the pool; nothing else changes.
Not covered: schema changes (still applied by the schema job before traffic); production (separate step, Production agent only).
