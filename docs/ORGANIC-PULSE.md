# Organic Pulse

Organic Pulse helps a creator decide which recent authorized Instagram or TikTok post deserves a careful follow-up before adding paid distribution.

## What it measures

FanMesh reads only post information returned by the creator's authorized connection. Every post receives a transparent 0–100 opportunity score:

- 40 points: distance below the account's recent median reach or views;
- 30 points: observed gap between current reach/views and follower count;
- 20 points: recency across a 30-day window; and
- 10 points: evidence from genuine likes, comments, shares, saves, or other returned interactions.

The score ranks follow-up opportunities. It is not an estimate of how many additional followers will see the post and it does not claim the platform will distribute it.

## Starting a pulse

Select **Start organic pulse** on a recent-post card. The server verifies that the opaque post key still exists in the latest authorized sync and then:

1. records the post's current organic reach/views, interactions, follower coverage, benchmark, and capture time;
2. keeps `paidIncluded: false` so later ad results can be compared without rewriting the organic starting point;
3. calculates the exact direct-alert cohort from current email/SMS consent and a measurement holdout;
4. saves tracked social and direct-channel links; and
5. produces platform-appropriate native actions such as a creator-made Story/follow-up and genuine comment replies.

No email, SMS, comment, follow, like, view, or direct message is sent by preparing a pulse. Direct delivery remains disabled until an approved provider is connected and suppression, opt-out, and frequency checks are implemented.

## Organic and paid separation

When the creator later runs an ad, FanMesh should record the ad start time and platform-reported paid metrics as a separate observation. Organic reach, paid reach, and direct-link response must remain separate so the creator can see what changed without attributing paid delivery to the organic workflow.
