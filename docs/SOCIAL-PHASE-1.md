# Social phase 1: authorized reach and measurement

The first social milestone is an orchestration layer, not an algorithm bypass. It gives FanMesh one place to describe authorized accounts, validate first-party lead data, and draft a measurable distribution experiment for each post.

## What this phase does

- Keeps social account connections scoped to official OAuth and creator-owned assets.
- Separates platform-gated follower counts from identities the creator can directly reach.
- Accepts ad leads only when a row includes a usable contact method and consent provenance.
- Produces deterministic, hashed contact keys so a future database can deduplicate a fan without exposing raw contact data in a plan.
- Builds a post plan with native publishing, consented direct channels, authorized ad audiences, a holdout cohort, and outcome metrics.

## What this phase does not do

FanMesh does not scrape followers, collect passwords, imitate user activity, buy or append contact lists, send unsolicited bulk messages, or guarantee that a platform will put a post in every follower's feed. A platform follower count is a reach signal, not a portable audience list.

The prototype returns `demo: true` and does not persist connections, leads, tokens, campaigns, or events. The production service will add organization-scoped authentication, Postgres/Supabase persistence, encrypted secret storage, signed webhooks, deletion workflows, and provider-specific OAuth adapters.

## API flow

1. `GET /api/v1/connections` shows the capability boundary for Instagram/Meta, TikTok, YouTube, Spotify, and authorized lead sources.
2. `POST /api/v1/imports/leads/preview` validates a user-provided export before anything is stored. Fix rows with invalid contact fields or missing consent provenance.
3. `POST /api/v1/experiments/social` drafts the next post's distribution sequence. It defaults to a 10% holdout of eligible direct identities and explicitly labels platform-only followers as gated.
4. A future authenticated worker will execute only the steps whose provider connection and consent record are active, then record delivery, click, save, and conversion events.

## Provider setup needed before production execution

- Create a developer app for each provider and configure the Render callback URL and privacy/terms URLs.
- Request only the scopes required for the selected capability (publishing, analytics, or lead export); keep refresh tokens in Render/Supabase secrets, never in GitHub.
- Use official exports or APIs for ad leads and preserve the form, timestamp, campaign, and source that produced consent.
- Treat provider review, rate limits, audience-match rules, opt-outs, and deletion requests as hard constraints.

Official boundary references:

- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [YouTube Analytics API](https://developers.google.com/youtube/analytics/reference)
- [Spotify Get Followed Artists](https://developer.spotify.com/documentation/web-api/reference/get-followed?query=Users)

These sources illustrate why FanMesh can coordinate authorized publishing and aggregate measurement, but cannot promise a portable identity list or guaranteed feed delivery.
