# Connect live Google and Brevo — beginner setup

You do not need to write more application code. Create the accounts, copy their values into the local `.env`, restart the server, and test the connections. Keep secret values out of chat, screenshots, Git, and frontend JavaScript.

## 1. Create a Supabase project

1. Open the [Supabase dashboard](https://supabase.com/dashboard), sign in, and create a project. Give it a name such as **Deadline Scout**. Save its database password privately; this app does not need that password.
2. After the project is ready, find its **Project URL** and **publishable key** under the project's API settings/connect dialog.
3. In PowerShell, from the project folder:

   ```powershell
   Copy-Item -LiteralPath '.env.example' -Destination '.env'
   notepad .env
   ```

   Run Copy-Item only if `.env` does not already exist. Set:

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

   Use the publishable/anon key, **not** a service-role key. These names describe public project configuration, but keep all configuration together server-side.

4. In Supabase → Authentication → URL configuration, set the local Site URL to:

   ```text
   http://localhost:4317
   ```

   Add this exact local callback pattern to the additional redirect allowlist:

   ```text
   http://localhost:4317/auth/callback**
   ```

   The wildcard is needed because the app appends a one-time `?flow=...` query parameter. Restrict this to the callback prefix; do not allow unrelated domains. Supabase documents redirect matching in its [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).

## 2. Create the Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project named **Deadline Scout**.
2. In its API Library, enable **Google Calendar API** and **Google Tasks API**.
3. Open Google Auth Platform. Complete Branding with an app name, support email, and developer contact email.
4. Audience: choose the audience available for your account. For a personal hackathon demo, use External in Testing mode and add your own Google email under **Test users**. Add teammates who will test it as well.
5. In Data Access, add these scopes:

   ```text
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.settings.readonly
   https://www.googleapis.com/auth/tasks
   ```

   Calendar settings access is used to preview all-day reminders in your actual primary Calendar timezone. The app requests the Calendar/Tasks scopes when you click Connect Google.

6. Clients → Create client → **Web application**. This project uses a backend/Supabase redirect flow, so choose Web application rather than a Chrome-extension OAuth client.
7. Add the local JavaScript origin:

   ```text
   http://localhost:4317
   ```

8. In Supabase → Authentication → Providers → Google, copy the displayed **Callback URL**. It normally looks like:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

   Add that exact URL as an **Authorized redirect URI** in the Google Web client.
9. Save the Google client and copy its **Client ID** and **Client secret**. Put both in Supabase's Google provider form and enable the provider.
10. Put the same client values in your local `.env`:

    ```dotenv
    GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
    ```

    The server needs the same client secret to refresh Google's offline token. Supabase refresh tokens and Google provider refresh tokens are different; this backend stores the latter, encrypted.

Follow Supabase's [official Google sign-in guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) if dashboard labels differ. It also documents requesting offline access and consent to obtain the provider refresh token.

## 3. Register your local extension ID

1. Load the unpacked `extension` folder in Edge as described in the README.
2. Find its 32-character ID in `edge://extensions` (or `chrome://extensions` for Chrome) or the side panel's Settings section.
3. Set this in `.env`:

   ```dotenv
   EXTENSION_IDS=YOUR_32_CHARACTER_EXTENSION_ID
   ```

No `chromiumapp.org` URL is needed in Google's redirect allowlist for this implementation. Google returns to Supabase; Supabase returns to the backend; the backend finishes the Chrome identity flow with a one-time, PKCE-bound redemption code. The [Chrome identity API documentation](https://developer.chrome.com/docs/extensions/reference/api/identity) explains the generated final extension redirect.

## 4. Connect Google and create one entry of each type

1. Stop the server with Ctrl+C, then restart:

   ```powershell
   node --env-file-if-exists=.env server/index.js
   ```

2. Reload the companion/extension and open Settings → **Connect Google**. Choose your test-user account and review the requested scopes.
3. Confirm the Google status shows Connected. You are now using a separate private account namespace; track the fictional registration again if it was previously saved as local-demo.
4. Track a registration and confirm its dates.
5. Click **Add to Calendar**. Choose a milestone/reminder, click **Preview reminder time**, then approve.
6. Click **Create Google Task**, select the milestone, and approve.
7. Open Google Calendar and Google Tasks to verify the entries exist, with the original registration link.
8. Move the fictional deadline, Check now, then approve Update Calendar event and Update Google Task. Verify the same entries changed.

Common issues:

| Message | What to check |
| --- | --- |
| `redirect_uri_mismatch` | Google's redirect must be the exact Supabase `/auth/v1/callback`, including project reference |
| Redirect not allowed or callback page fails | Supabase additional redirect allowlist must cover the local `/auth/callback?flow=...` URL |
| Google access blocked / app in testing | Add the signing-in email as a Google OAuth test user; do not bypass browser security interstitials |
| Google HTTP 403 | Enable both APIs, add required scopes, and reconnect to consent again |
| Reconnect / offline access required | Use Connect Google again; confirm Google client values match Supabase's provider configuration |
| Session unexpectedly expired | Sign in again; the app's own session and Google authorization have separate lifetimes |
| Calendar preview looks early | Date-only events remind before midnight at the start of the deadline date in Calendar's timezone |

Google's testing-mode authorization may need reconnection. Public release can require Google verification for requested scopes; keep your hackathon testers on the test-user list while developing.

## 5. Configure Brevo

1. Create a [Brevo account](https://www.brevo.com/) and complete its account requirements for transactional email.
2. In sender/domain settings, add a sender you control and complete its verification. If you own a domain, follow Brevo's domain authentication instructions. Sender verification and recipient verification are separate.
3. Create a transactional API key in Brevo's API/SMTP settings.
4. Set in `.env`:

   ```dotenv
   EMAIL_PROVIDER=brevo
   BREVO_API_KEY=YOUR_BREVO_API_KEY
   BREVO_SENDER_EMAIL=YOUR_VERIFIED_SENDER@example.com
   ```

5. Restart the server. Settings must show **Live · Brevo**.
6. If signed in with Google, your Google email is already verified. Enable Email alerts and click Send test email.
7. For another recipient, enter the address, click Verify email, retrieve the six-digit code from that inbox, and confirm it. The app does not expose live codes in its activity API.
8. Check your inbox/spam and Brevo transactional logs. An Accepted status means API acceptance; inbox delivery is a separate check.

The adapter follows Brevo's [transactional email API](https://developers.brevo.com/docs/send-a-transactional-email). The app never sends live alerts to an unverified recipient. Brevo configuration failures are visible; it does not silently switch back to demo delivery.

## 6. Before hosting

Hosting is optional for local judging. A running local Node process already checks sources while Chrome is closed; it stops when your PC sleeps or the server stops.

For an always-on hosted backend, configure a persistent disk and HTTPS. Set APP_URL to its real external origin and DATA_DIR to the mounted disk. Generate a stable 32-byte encryption key locally without printing it:

```powershell
$tokenKeyBytes = New-Object byte[] 32
$tokenKeyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$tokenKeyGenerator.GetBytes($tokenKeyBytes)
$tokenKeyGenerator.Dispose()
$tokenKeyValue = [Convert]::ToBase64String($tokenKeyBytes)
# Paste $tokenKeyValue into the host's TOKEN_ENCRYPTION_KEY secret field.
# Do not paste it into chat or a public repository.
```

Add the hosted backend's callback prefix to Supabase and update the extension's Backend URL. Run exactly one scheduler process for this SQLite deployment. Do not discard or rotate the encryption key without handling the encrypted provider tokens.
