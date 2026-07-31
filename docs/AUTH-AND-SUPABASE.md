# Accounts and Supabase setup

FanMesh uses Supabase Auth and row-level-secured PostgreSQL workspaces. Passwords are sent directly from the FanMesh server to Supabase Auth, are never logged, and are never stored in the FanMesh database or browser storage.

## What FanMesh needs

Create a Supabase **project**, then copy these two public project values from **Project Settings → API**:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (the legacy `SUPABASE_ANON_KEY` also works)

Normal creator requests use each signed-in user's access token so database row-level security remains active. Live provider webhooks have no creator session, so the trusted FanMesh server also needs `SUPABASE_SERVICE_ROLE_KEY` to persist a submission only after verifying the provider signature, timestamp, form, ad account, and deduplication key. Store that key only as a server-side Render secret—never in GitHub, browser code, screenshots, or chat. Never provide a Supabase dashboard password.

## Initialize the database

1. Open the Supabase SQL Editor.
2. Run `supabase/migrations/202607290001_initial.sql`, `supabase/migrations/202607310001_lead_outreach.sql`, and `supabase/migrations/202607310002_snapchat_lead_webhooks.sql` in order.
3. In Render, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as secret environment variables.
4. Add `SUPABASE_SERVICE_ROLE_KEY` only when enabling signed provider-webhook ingestion.
5. Redeploy the FanMesh service.
6. Create the first FanMesh account from the sign-up screen.

The migration creates a profile and private creator workspace automatically for every new authenticated user. Audience, consent, connection, snapshot, import, and experiment records are isolated by PostgreSQL row-level security.

## Runtime modes

- **Supabase configured:** the dashboard requires authentication and reads the signed-in workspace. A new workspace starts at zero; FanMesh does not show invented audience numbers.
- **Supabase unconfigured:** the existing demo dataset remains available and is clearly labeled as demo data.

## Session security

- Access and refresh tokens use `HttpOnly`, `SameSite=Lax` cookies.
- Production cookies use the `Secure` flag.
- The browser never receives Supabase keys or tokens through JavaScript-accessible storage.
- The service-role key is never returned by an API and is used only on the server for verified provider-webhook reads/writes.
- Expired access tokens are refreshed server-side when a valid refresh cookie exists.
