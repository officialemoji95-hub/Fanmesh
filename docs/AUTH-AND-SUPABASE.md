# Accounts and Supabase setup

FanMesh uses Supabase Auth and row-level-secured PostgreSQL workspaces. Passwords are sent directly from the FanMesh server to Supabase Auth, are never logged, and are never stored in the FanMesh database or browser storage.

## What FanMesh needs

Create a Supabase **project**, then copy these two public project values from **Project Settings → API**:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (the legacy `SUPABASE_ANON_KEY` also works)

Do not provide a Supabase dashboard password or a `service_role`/secret key. FanMesh intentionally uses each signed-in user's access token so database row-level security remains active.

## Initialize the database

1. Open the Supabase SQL Editor.
2. Run `supabase/migrations/202607290001_initial.sql` once.
3. In Render, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as secret environment variables.
4. Redeploy the FanMesh service.
5. Create the first FanMesh account from the sign-up screen.

The migration creates a profile and private creator workspace automatically for every new authenticated user. Audience, consent, connection, snapshot, import, and experiment records are isolated by PostgreSQL row-level security.

## Runtime modes

- **Supabase configured:** the dashboard requires authentication and reads the signed-in workspace. A new workspace starts at zero; FanMesh does not show invented audience numbers.
- **Supabase unconfigured:** the existing demo dataset remains available and is clearly labeled as demo data.

## Session security

- Access and refresh tokens use `HttpOnly`, `SameSite=Lax` cookies.
- Production cookies use the `Secure` flag.
- The browser never receives Supabase keys or tokens through JavaScript-accessible storage.
- Expired access tokens are refreshed server-side when a valid refresh cookie exists.
