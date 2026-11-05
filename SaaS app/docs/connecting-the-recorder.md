# Connecting the recorder to this app

Two ways. The first needs nothing set up and is the quickest; the second is better once other providers use it.

## 1. A pairing token (works today)

1. In this app, open **Settings**.
2. Under **Mac Desktop App**, type a name for the Mac ("Consulting room") and press **Connect a recorder**.
3. A token appears **once**, in the message at the top. Copy it now; it cannot be shown again, because only its hash
   is stored.
4. In the recorder, open **Setup**, enter this app's address, expand **Or paste a token instead**, paste the token and
   press **Save setup**.

To take a Mac's access away, press **Sign out** next to it in Settings. That stops it immediately.

## 2. Sign in with Google

This needs an OAuth client, which is a one-off job in Google Cloud.

1. Open the [Google Cloud console](https://console.cloud.google.com/apis/credentials) for the project this app runs in.
2. **Create credentials** then **OAuth client ID**, and choose the type **Desktop app**. Name it something like
   "Practice Recorder".
3. Copy the client ID and client secret it gives you. The secret stays on the server and is never sent to the recorder.
4. Put both in this app's `.env`:
   ```
   GOOGLE_DESKTOP_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_DESKTOP_CLIENT_SECRET=...
   ```
5. Restart this app. The recorder's Setup screen will then offer **Sign in with Google**.

No redirect URI needs adding: a Desktop app client may redirect to `http://127.0.0.1` on any port, which is how the
recorder catches the reply.

**On that client secret.** Google issues one for Desktop app clients but does not treat it as confidential, because it
ships inside every copy of the app. What actually protects the sign-in is PKCE and this app's own allowlist: a Google
account that is not an active user here is refused. If that reasoning is unwelcome, use a pairing token instead.

## Which to use
- **One Mac, yours:** a pairing token. Nothing to set up, nothing to leak.
- **Several providers, each on their own Mac:** Google sign-in, so each person signs in as themselves and their own
  module access applies, with no token to pass around.

Either way the recorder only ever receives the day's visits as initials, and only ever sends back the transcript. The
audio stays on the Mac.
