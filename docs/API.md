# FanMesh API v0.3

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

Returns the social-account and lead-source capability catalog. Prototype responses contain no access tokens and report every source as unconnected or ready for an authorized import.

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

### `POST /api/v1/imports/leads/preview`

Accepts `{ "source": "meta_ads", "rows": [...] }` and validates up to 1,000 first-party lead records without persisting them. A valid row needs an email or phone, `consent: true`, a parseable `consentAt`, a `consentSource`, and channel-specific consent when both email and phone are present. The response includes normalized records, hashed contact keys, invalid-row reasons, duplicate counts, and source counts. Purchased, scraped, or unconsented lists are not accepted.

### `POST /api/v1/imports/leads/commit`

Requires a creator session and accepts the same source and rows plus `"confirmedAuthorized": true`. The server revalidates the full upload, upserts deduplicated fan records, merges earlier source provenance and channel signals, writes new consent events, and records an import run. Repeating an identical import does not duplicate the matching consent event.

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
