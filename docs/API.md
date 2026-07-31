# FanMesh API v0.12

The prototype serves JSON under `/api`. Responses use `{ "data": ... }` for successful resources and `{ "error": { "message": ... } }` for errors. When Supabase is configured, workspace endpoints require the secure creator session cookie and PostgreSQL row-level security isolates every workspace. When Supabase is unconfigured, dashboard reads use clearly labeled demo data.

## Endpoints

### `GET /api/health`

Render health check. Returns the service name and version.

### Account endpoints

- `GET /api/v1/auth/session` returns whether Supabase is configured and whether the request has an authenticated creator session.
- `POST /api/v1/auth/signup` accepts `displayName`, `email`, and `password` and provisions a workspace through the database trigger.
- `POST /api/v1/auth/signin` establishes HTTP-only access and refresh cookies.
- `POST /api/v1/auth/signout` revokes the session and clears both cookies.

Passwords and tokens are never returned to browser JavaScript or stored in local storage.

### `GET /api/v1/dashboard`

Returns the current workspace, insights, scored fans, and connection statuses in one authenticated request.

### `GET /api/v1/workspace`

Returns the signed-in user's workspace and role.

### `GET /api/v1/fans?limit=20`

Returns scored fan records. The maximum limit is 100.

### `GET /api/v1/insights`

Returns the audience snapshot, tier distribution, reach-health ratios, and recommended actions.

### `GET /api/v1/connections`

Returns the social-account and lead-source capability catalog without access tokens. A connected TikTok account includes its safe profile summary, latest-public-post performance metrics, and up to 20 normalized public video records returned by the official `video.list` scope.

### `POST /api/v1/score`

Accepts these numeric metrics plus a boolean direct opt-in:

| Field | Type | Meaning |
| --- | --- | --- |
| `engagements30d` | number | First-party or creator-authorized interactions in 30 days |
| `daysSinceEngagement` | number | Days since the most recent qualifying interaction |
| `activeWeeks8` | number | Weeks with a qualifying action in the last eight weeks |
| `spend180d` | number | Creator-attributed spend in the workspace currency |
| `linkedPlatforms` | number | Fan-confirmed or strongly resolved identities |
| `directOptIn` | boolean | Active direct-channel consent |
| `referrals180d` | number | Attributed successful referrals |

The response includes the total score, tier, component points, strongest signals, and model version.

### `POST /api/v1/campaigns/recommend`

Accepts an `objective` (`release`, `sales`, or `community`) and a `contentType`. Returns a segment, timed channel sequence, and compliance guardrail.

### `POST /api/v1/activations/prepare`

Requires a creator session in account mode. Accepts a creator-controlled public HTTPS `contentUrl`, a title, objective, alert message, selected `email`/`sms` channels, an optional measurement holdout, and `confirmedOwnedContent: true`. FanMesh calculates exact workspace eligibility, separates platform-only identities from directly alertable fans, creates channel-specific UTM attribution links, and saves the draft in `social_experiments`. The response explicitly reports that zero messages were sent.

### `GET /api/v1/activations?limit=5`

Returns recent saved `fan_activation_v1` drafts for the signed-in workspace. Contact details are not included.

### Lead Outreach

- `GET /api/v1/outreach/readiness` reports whether Resend email and Twilio SMS are configured without returning any secret.
- `POST /api/v1/outreach/preview` accepts a title, destination, subject/message, `email`/`sms` channels, authorized source filters, holdout, and both ownership/consent confirmations. It returns eligible, held-out, suppressed, selected, source, and channel counts; no contact fields are returned.
- `POST /api/v1/outreach/send` requires the preview `campaignId` and `confirmedSend: true`. It re-queries consent and the 48-hour frequency window, caps the launch at 100 leads, delivers through the configured provider, and records safe delivery receipts.
- `GET /api/v1/outreach/campaigns` lists campaign status and aggregate results without contact fields.

Supported outreach provenance filters are `meta_ads`, `tiktok_ads`, `snapchat_ads`, `x_ads`, `google_ads`, `youtube_ads`, `threads_ads`, and `csv`.

### `GET /api/v1/organic/posts`

Requires a creator session. Returns up to 20 recent Instagram and TikTok posts from the latest authorized sync, ranked by an explainable organic-recovery opportunity score. Each record includes the current reach/view baseline, recent median benchmark, follower-coverage rate, real interaction rate, score components, and a public platform URL. The score is a prioritization aid, not a delivery prediction.

### `POST /api/v1/organic/activate`

Requires a creator session and a `postKey` returned by `GET /api/v1/organic/posts`. FanMesh re-resolves the key against the server-side authorized connection, captures the pre-ad organic baseline, calculates the exact consented email/SMS cohort and holdout, creates tracked links, saves native follow-up actions, and persists the activation. Preparing the pulse sends no messages and does not interact with followers automatically.

### `POST /api/v1/imports/leads/preview`

Accepts `{ "source": "meta_ads", "rows": [...] }` and validates up to 1,000 first-party lead records without persisting them. A valid row needs an email or phone, `consent: true`, a parseable `consentAt`, a `consentSource`, and channel-specific consent when both email and phone are present. The response includes normalized records, hashed contact keys, invalid-row reasons, duplicate counts, and source counts. Purchased, scraped, or unconsented lists are not accepted.

### `POST /api/v1/imports/leads/commit`

Requires a creator session and accepts the same source and rows plus `"confirmedAuthorized": true`. The server revalidates the full upload, upserts deduplicated fan records, merges earlier source provenance and channel signals, writes new consent events, and records an import run. Repeating an identical import does not duplicate the matching consent event.

### `POST /api/v1/imports/identities/preview`

Requires a creator session in account mode. Accepts an official-export source (`facebook_export`, `instagram_export`, `tiktok_export`, or `youtube_export`), a relationship type, and up to 2,000 locally extracted JSON/CSV rows per batch. It validates usernames, platform IDs, and platform-owned HTTPS profile URLs and returns only summary counts plus limited row errors. No direct-contact consent is created.

### `POST /api/v1/imports/identities/commit`

Requires the same batch plus `confirmedAuthorized: true` and `confirmedOfficialExport: true`. The server revalidates and upserts platform-only fan records with source, relationship, observation time, and import provenance. The browser sets `finalBatch: true` on the last batch so FanMesh refreshes exact aggregate audience counts efficiently.

### `POST /api/v1/oauth/meta/leads/preview`

Requires a creator session and a connected Meta account with `leads_retrieval`. Accepts selected authorized `formIds`, `consentChannels`, `confirmedAuthorized: true`, and `confirmedConsent: true`. FanMesh fetches up to 100 recent submissions server-side and returns only validation counts, invalid reasons, and form metadata. Lead names, emails, phone numbers, platform tokens, and normalized rows are not returned to browser JavaScript.

### `POST /api/v1/oauth/meta/leads/commit`

Accepts the same confirmation payload, re-fetches the selected forms, revalidates every submission, and commits only valid consented contacts. Each record stores deterministic deduplication keys plus `meta_instant_form:<form-id>:creator_attested` provenance. This creator attestation is appropriate only when the selected form disclosure genuinely permits the chosen email or SMS use.

### `POST /api/v1/experiments/social`

Accepts a `contentId`, optional `objective`, `platforms`, `channels`, `candidateCounts`, and `holdoutPercent`. Returns a draft sequence for native publishing, consented direct channels, and authorized ad audiences, plus an explicit holdout and guardrails. It does not publish, message, or alter platform ranking by itself.

### `GET /api/v1/openapi.json`

Returns the machine-readable OpenAPI 3.1 preview.

## Production API requirements

- Supabase creator sessions, OAuth, or scoped API keys; never social account passwords
- Organization isolation on every record and query
- Idempotency keys for event and campaign writes
- Cursor pagination and stable object IDs
- Rate limits with standard response headers
- Signed webhooks with replay protection
- Audit logs for consent and data export/deletion
- API versioning and score-model version pinning
