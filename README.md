# FanMesh

FanMesh is a creator-owned audience intelligence system. It turns scattered, permissioned signals into a unified fan view, an explainable **True Fan Score**, and practical activation plans across channels where fans have chosen to hear from a creator.

This repository contains a deployable proof of concept. Without Supabase configuration it uses clearly labeled demo data; with Supabase configured it requires a creator account and loads only that user's private workspace. Official OAuth adapters are available for Meta, TikTok, Snapchat, X, and Threads once the operator configures each platform's developer app.

## What works now

- Responsive routed workspace with focused Overview, Audience, Outreach, Organic Pulse, Connections, and Developer views
- Supabase email/password accounts with server-managed HTTP-only sessions
- Private creator workspaces with PostgreSQL row-level security
- Live workspace dashboard mode that starts at zero instead of showing invented audience data
- Audience health and reach-gap analysis
- Explainable fan scoring API
- Scored fan records and identity graph demonstration
- Campaign sequence recommendations for releases, sales, and community growth
- Official Meta, TikTok, Snapchat, X, and Threads OAuth connection flows
- Signed OAuth state, X PKCE, server-side code exchange, and encrypted token storage
- Authorized creator/business account discovery, aggregate metrics, manual sync, and disconnect
- Meta Page and Instagram professional discovery, per-post views/reach/interaction health, 30-day ad-account results, lead-form inventory, and actionable permission gaps
- Server-side Meta Instant Form lead preview and consent-confirmed import with no contact fields returned in the preview response
- TikTok latest-public-post sync with explainable average views, median views, and engagement-per-view metrics
- Consent-checked CSV import with preview, deterministic identity keys, deduplication, provenance, and private-workspace persistence
- Official Facebook, Instagram, TikTok, and YouTube follower-download ingestion from JSON/CSV, with large-file batching and a strict platform-only activation boundary
- Measured social distribution experiment planner with holdout cohorts
- Persisted fan-alert activations with exact email/SMS eligibility, platform-only reach reporting, attribution-ready links, message templates, and provider-readiness status
- Consent-gated lead outreach across Meta Ads, TikTok Ads, Snapchat Ads, X Ads, Google/YouTube Ads, Threads Ads, and authorized imports
- Live Resend email and Twilio SMS adapters with explicit launch confirmation, a 48-hour frequency cap, holdouts, safe delivery receipts, and no contact fields returned to the browser
- Organic Pulse queue that ranks synced Instagram/TikTok posts with an explainable recovery-opportunity score, captures a pre-ad baseline, and prepares native plus consented-direct follow-up actions
- OpenAPI document at `/api/v1/openapi.json`
- Render Blueprint and health check
- Node.js tests with no third-party runtime dependencies

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Activate accounts and real workspace data

1. Create a Supabase project.
2. Run [`supabase/migrations/202607290001_initial.sql`](supabase/migrations/202607290001_initial.sql), then [`supabase/migrations/202607310001_lead_outreach.sql`](supabase/migrations/202607310001_lead_outreach.sql) in its SQL Editor.
3. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the project's API settings.
4. Restart FanMesh and create the first account from the sign-up screen.

To activate platform buttons, configure `APP_BASE_URL`, a stable 32-byte `OAUTH_TOKEN_ENCRYPTION_KEY`, and the selected provider's developer app ID/secret in Render. See [docs/OAUTH-CONNECTIONS.md](docs/OAUTH-CONNECTIONS.md).

Never add a Supabase dashboard password or `service_role` key. See [docs/AUTH-AND-SUPABASE.md](docs/AUTH-AND-SUPABASE.md).

## API preview

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/v1/insights

curl -X POST http://localhost:3000/api/v1/score \
  -H 'content-type: application/json' \
  -d '{
    "engagements30d": 16,
    "daysSinceEngagement": 2,
    "activeWeeks8": 7,
    "spend180d": 80,
    "linkedPlatforms": 3,
    "directOptIn": true,
    "referrals180d": 1
  }'
```

## True Fan Score v0.1

The score is a 0–100 weighted model:

| Signal | Points | Why it matters |
| --- | ---: | --- |
| Recent engagement volume | 24 | Repeated voluntary attention |
| Engagement recency | 18 | Current intent, decayed over 45 days |
| Eight-week consistency | 14 | Durable interest rather than one viral interaction |
| First-party purchases | 16 | Demonstrated economic support |
| Confirmed cross-platform identity | 12 | A fuller, consented relationship |
| Direct-channel opt-in | 10 | The creator can reach the fan without a feed gate |
| Referrals | 6 | Advocacy that brings other people in |

Every score includes its component points and strongest signals. Sensitive traits, bought data, and private scraped activity are excluded.

## The production direction

Accounts, private workspaces, consented lead imports, official platform-download ingestion, Organic Pulse, source-filtered lead outreach, routed workspace views, and the multi-provider OAuth foundation are implemented. Meta is the first end-to-end provider lane; Snapchat Business follows after the shared connection, sync, consent, health, and attribution contract is proven. Meta measures authorized Instagram post health; automatic Instant Form retrieval remains available only when Meta grants the required app and Page permissions. Creators without Meta business verification can import authorized consent exports. Email and SMS launch when Resend and Twilio credentials are configured. See [docs/LEAD-OUTREACH.md](docs/LEAD-OUTREACH.md), [docs/ORGANIC-PULSE.md](docs/ORGANIC-PULSE.md), [docs/ACTIVATION.md](docs/ACTIVATION.md), [docs/OAUTH-CONNECTIONS.md](docs/OAUTH-CONNECTIONS.md), [docs/SOCIAL-PHASE-1.md](docs/SOCIAL-PHASE-1.md), [docs/AUDIENCE-IMPORT.md](docs/AUDIENCE-IMPORT.md), [docs/AUTH-AND-SUPABASE.md](docs/AUTH-AND-SUPABASE.md), [docs/PRODUCT.md](docs/PRODUCT.md), [docs/API.md](docs/API.md), and [docs/SECURITY.md](docs/SECURITY.md).

## Non-goals

FanMesh will not:

- collect social passwords or hijack sessions;
- scrape private follower data or bypass platform controls;
- manufacture likes, streams, comments, or follows;
- send unsolicited bulk messages;
- claim it can guarantee algorithmic distribution.

Its advantage is ownership, timing, segmentation, attribution, and genuine early fan participation—not tricks that put creator accounts at risk.

## Deploy to Render

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint**.
3. Select the repository and apply `render.yaml`.
4. Confirm `/api/health` returns `{"status":"ok", ...}` after deployment.

Demo mode needs no secrets. Account mode requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Render's secret manager. OAuth additionally requires `APP_BASE_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY`, and each enabled provider's developer app credentials. Lead Outreach uses `RESEND_API_KEY` plus `OUTREACH_EMAIL_FROM` for email, and `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, plus `TWILIO_FROM_NUMBER` for SMS.

## License

All rights reserved while the product is in private development.
