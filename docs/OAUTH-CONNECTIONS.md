# Official platform connections

FanMesh v0.6 connects creator and business accounts through official OAuth consent screens. It never asks for a platform password. Authorization codes are exchanged on the server, and access and refresh tokens are encrypted with AES-256-GCM before the encrypted value is stored in the workspace's row-level-secured `source_connections` record.

## Shared Render settings

Set these first:

```text
APP_BASE_URL=https://fanmesh.onrender.com
OAUTH_TOKEN_ENCRYPTION_KEY=<32 random bytes encoded as base64>
```

Generate the encryption key locally with `openssl rand -base64 32`. Keep this value stable. Replacing it intentionally invalidates every stored platform connection, and each account must reconnect.

Each provider card remains labeled **Developer app needed** until its required ID and secret are present in Render. Never put provider secrets in browser code, GitHub, screenshots or chat.

## Callback URLs

Register the exact HTTPS callback for every developer app:

| Provider | Callback |
| --- | --- |
| Meta | `https://fanmesh.onrender.com/api/v1/oauth/meta/callback` |
| TikTok | `https://fanmesh.onrender.com/api/v1/oauth/tiktok/callback` |
| Snapchat | `https://fanmesh.onrender.com/api/v1/oauth/snapchat/callback` |
| X | `https://fanmesh.onrender.com/api/v1/oauth/x/callback` |
| Threads | `https://fanmesh.onrender.com/api/v1/oauth/threads/callback` |

Callback matching is normally exact, including the scheme and path.

## Meta

Create a Meta developer app intended for business account management, add Facebook Login for Business or the current Meta login product required for Pages/Instagram, and register the Meta callback. Add these Render variables:

```text
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=v25.0
```

FanMesh requests `public_profile`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `ads_read`, `leads_retrieval`, and `business_management` by default. Meta can grant only a subset, and advanced access or app review is commonly required before non-role users can authorize business, advertising or lead permissions.

The sync discovers the authorized Meta user, Pages, linked Instagram professional accounts, Meta ad accounts, and Page Instant Forms. FanMesh then reads:

- up to 20 recent media objects per authorized Instagram professional account with basic organic like/comment totals;
- account-level ad spend, impressions, reach, clicks, and reported lead actions for Meta's `last_30d` preset;
- Instant Form names/statuses and an aggregate lead count when `leads_retrieval` and Page lead access are granted.

FanMesh deliberately does not retrieve lead `field_data` during this inventory phase. A form lead is not added to the direct audience until a later consent-aware ingestion flow maps the form's disclosure and opt-in fields. The UI also reports Page, Instagram, ad, and lead-form access gaps separately so a partial Meta grant is not shown as a complete sync.

OAuth does not provide a portable list of every follower. Instagram basic media totals exclude ad-driven activity, so FanMesh keeps organic interactions and paid delivery in separate panels instead of combining them into a misleading benchmark.

## TikTok

Create a TikTok for Developers app, add Login Kit for Web, register the TikTok callback and add:

```text
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

The default Login Kit scopes are `user.info.basic`, `user.info.stats`, and `video.list`. Some scopes require approval. TikTok for Business ad accounts use a separate developer product and authorization; they are not silently included in Login Kit.

Each TikTok connection or manual sync reads the creator profile and up to the 20 most recent public posts through TikTok's official Display API. FanMesh stores safe post metadata and the returned view, like, comment, and share totals in the encrypted creator workspace. It calculates:

- average views across the returned posts;
- median views across the same window;
- engagement per view as `(likes + comments + shares) / views`;
- the latest-post timestamp and aggregate interaction totals.

This is an explicit `latest_20_public_posts` measurement window, not a claim about every historical post or every follower. FanMesh never treats TikTok OAuth as permission to enumerate or contact followers.

## Snapchat

Create the OAuth app under Snap Business Manager → Business Details, not a consumer login integration. Register the Snapchat callback and add:

```text
SNAPCHAT_CLIENT_ID=
SNAPCHAT_CLIENT_SECRET=
```

FanMesh initially requests `snapchat-marketing-api` and discovers accessible organizations and ad accounts. Public Profile API access uses the separate `snapchat-profile-api` scope and is currently subject to Snapchat allowlisting; add that scope only after approval.

## X

Create an X developer project/app, enable OAuth 2.0, set it as a confidential web client when available, register the X callback and add:

```text
X_CLIENT_ID=
X_CLIENT_SECRET=
```

FanMesh uses the Authorization Code flow with PKCE and requests `tweet.read`, `users.read`, and `offline.access`. The initial sync reads the authorized profile and public metrics. X Ads is a separate approved API that currently uses OAuth 1.0a; it will be implemented as a distinct ad connection rather than mixing credentials into the organic profile flow.

## Threads

Create/configure the Threads API product in Meta's developer dashboard, register the Threads callback and add:

```text
THREADS_APP_ID=
THREADS_APP_SECRET=
```

Threads is intentionally a separate connection from Meta Pages/Instagram. Its default scopes are `threads_basic` and `threads_manage_insights`.

## What a completed connection does

1. Verifies the signed-in FanMesh creator.
2. Generates a one-time state value; X also receives a PKCE challenge.
3. Redirects to the platform's own consent screen.
4. Verifies the callback state and exchanges the short-lived code on the server.
5. Discovers only the accounts/assets allowed by the granted scopes.
6. Encrypts all returned tokens before database storage.
7. Stores a sanitized profile/asset summary and refreshes FanMesh's aggregate audience snapshot.

The Connections screen can then run a manual sync or disconnect. Disconnecting erases the encrypted credential bundle from FanMesh; it does not delete the creator's platform account.

## Next connection work

After live developer apps have authorized successfully, the next adapters are:

- Meta Lead Ads webhook subscription and consent-aware lead ingestion;
- scheduled token refresh and background sync jobs;
- TikTok for Business advertising authorization;
- X Ads OAuth 1.0a after Ads API approval;
- Snapchat Public Profile metrics after allowlisting;
- platform-native publishing only for products/scopes explicitly approved for the app.
