# Release Command

Release Command closes the FanMesh product loop: authorized platform signals become a plan, the creator executes the native actions, and FanMesh records comparable 24-hour and 72-hour results.

## What a plan contains

1. A current Content Mesh group resolved from the signed-in creator's latest authorized platform sync.
2. A creator-selected objective: discovery, engagement, streams/clicks, or sales.
3. Platform-native format, hook, follow-up, and staggered publication instructions.
4. The existing organic baseline for every version already published.
5. An exact direct-audience summary from the private workspace, including a measurement holdout.
6. A command timeline from asset lock through the 24-hour and 72-hour checkpoints.
7. Explicit guardrails stating which actions remain manual or require a separate delivery confirmation.

Plans are stored as `release_plan_v1` records in the existing row-level-secured `social_experiments` table. No new database migration is required for v0.18.

## Learning model

Checkpoint totals are never compared as raw views across platforms. For each platform FanMesh calculates:

- change from that version's captured organic baseline;
- performance as a percentage of that platform's own recent benchmark;
- interaction rate from the supplied organic totals;
- tracked link clicks and conversions when available; and
- whether the result is flat, recovering, above its recent benchmark, or still building a baseline.

The strongest and weakest platforms are explainable because they are selected by own-platform benchmark index. The next recommendation changes the weakest platform's hook or packaging without claiming that FanMesh can force feed delivery.

## Delivery boundary

Creating a release plan does not publish a post, send an email or SMS, message a follower, start an ad, or manipulate ranking. Platform publication remains a creator action unless an official publishing API is later added for that specific provider. Direct outreach remains a separate consent recheck, preview, and confirmed launch through the existing Outreach service.

Checkpoint submission requires the creator to confirm that paid ads, boosts, and purchased traffic are excluded. Paid performance can still be analyzed elsewhere, but it must not contaminate the organic learning baseline.

## API sequence

1. `GET /api/v1/content-mesh`
2. `POST /api/v1/releases/plan`
3. `GET /api/v1/releases`
4. `POST /api/v1/releases/{databaseId}/checkpoints` at 24 hours
5. Repeat the checkpoint endpoint at 72 hours

All release endpoints require the secure creator session in account mode and return no fan contact fields.
