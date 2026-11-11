# Web "Promote to production" button: setup

The button is in the row menu of the Schedule list on **staging**, for admins only. It copies one visit and its
transcript to production, add-only (never replaces), safe to press twice. The browser signs in to production itself with
Google and calls production's own Desktop API, so there is no shared secret and no staging identity reaches the
production database. Always use the numeric addresses (the -uk.a.run.app ones fail Google sign-in). The button stays hidden until every step below is done.

## Steps (mandatory, in this order)
1. **Google Cloud Console** (project that holds the app's sign-in): APIs & Services > Credentials > Create credentials >
   OAuth client ID > Application type **Web application**. Name it "BBC web promote". Under **Authorized JavaScript
   origins** add the staging address: `https://practice-mgmt-321509350517.us-east4.run.app` (and the custom staging address
   if one is used). Leave redirect URIs empty. Copy the **Client ID** (ends in .apps.googleusercontent.com). There is no
   secret to copy.
2. **Production settings** (prod change, Sohail approves): add to the production service
   `GOOGLE_WEB_CLIENT_ID=<the client id>` and `PROMOTE_WEB_ORIGINS=https://practice-mgmt-321509350517.us-east4.run.app`
   (comma list of exact https origins). Production must run Web 1.16 or later first. Both values are public, not secrets.
3. **Staging settings:** add `GOOGLE_WEB_CLIENT_ID=<the same client id>` and `PROMOTE_PROD_URL=<production address>`
   (production address: https://practice-mgmt-802176721153.us-east4.run.app).
4. **Accounts:** the admin pressing the button needs "Full names" on in Admin > Users on **both** staging and
   production (production needs the name to match the patient; without it the button refuses and changes nothing).

## What it does
Looks up the day on production, matches the visit by patient name, time and program, creates it by name if missing
(production's own API finds or creates the patient), then adds the transcript. A production visit that already has a
transcript is left alone. Documents are not copied. Audit entries hold ids and counts only.
