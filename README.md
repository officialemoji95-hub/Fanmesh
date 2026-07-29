# FanMesh

FanMesh is a creator-owned audience intelligence system. It turns scattered, permissioned signals into a unified fan view, an explainable **True Fan Score**, and practical activation plans across channels where fans have chosen to hear from a creator.

This repository contains a deployable proof of concept. It uses demo data and intentionally does **not** connect to or automate any social platform yet.

## What works now

- Responsive creator dashboard
- Audience health and reach-gap analysis
- Explainable fan scoring API
- Scored fan records and identity graph demonstration
- Campaign sequence recommendations for releases, sales, and community growth
- Social connection capability catalog (official OAuth boundaries, no tokens)
- Consent-checked ad-lead import preview with deterministic identity keys
- Measured social distribution experiment planner with holdout cohorts
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

The next milestone replaces demo data with organizations, authentication, PostgreSQL persistence, consent records, official OAuth connections, imports, and webhooks. The social-first slice is documented in [docs/SOCIAL-PHASE-1.md](docs/SOCIAL-PHASE-1.md). See [docs/PRODUCT.md](docs/PRODUCT.md), [docs/API.md](docs/API.md), and [docs/SECURITY.md](docs/SECURITY.md).

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

The current prototype needs no secrets or database. Production connections will add environment variables through Render's secret manager.

## License

All rights reserved while the product is in private development.
