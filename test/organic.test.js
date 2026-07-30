import test from "node:test";
import assert from "node:assert/strict";
import { buildOrganicQueue, prepareOrganicPulse } from "../src/organic.js";

const statuses = {
  meta: {
    status: "connected",
    account: {
      name: "Artist",
      medianMetaReach: 1200,
      instagramAccounts: [{
        id: "ig-1",
        username: "artist",
        followers: 20000,
        recentMedia: [{
          id: "media-1",
          caption: "New reel",
          permalink: "https://www.instagram.com/reel/example/",
          createdAt: "2026-07-28T12:00:00.000Z",
          views: 1500,
          reach: 900,
          totalInteractions: 155,
        }],
      }],
    },
  },
  tiktok: {
    status: "connected",
    account: {
      name: "Artist",
      username: "artist",
      followers: 100000,
      medianViews: 1000,
      recentVideos: [{
        id: "video-1",
        title: "Low-view video",
        shareUrl: "https://www.tiktok.com/@artist/video/1",
        createdAt: "2026-07-29T12:00:00.000Z",
        views: 127,
        likes: 8,
        comments: 3,
        shares: 1,
      }],
    },
  },
};

test("organic queue ranks explainable recent-post recovery opportunities", () => {
  const queue = buildOrganicQueue(statuses, { now: "2026-07-30T12:00:00.000Z" });
  assert.equal(queue.summary.postsAnalyzed, 2);
  assert.deepEqual(queue.summary.platforms, ["tiktok", "instagram"]);
  assert.equal(queue.posts[0].platform, "tiktok");
  assert.equal(queue.posts[0].currentReach, 127);
  assert.equal(queue.posts[0].benchmark, 1000);
  assert.equal(queue.posts[0].gapToBenchmark, 873);
  assert.equal(queue.posts[0].opportunityScore, 93);
  assert.deepEqual(queue.posts[0].scoreComponents, {
    underBenchmark: 35,
    audienceGap: 30,
    recency: 19,
    engagementEvidence: 9,
  });
  assert.match(queue.methodology, /does not predict or guarantee/i);
});

test("organic pulse saves the pre-ad baseline and uses only consented direct channels", () => {
  const post = buildOrganicQueue(statuses, { now: "2026-07-30T12:00:00.000Z" }).posts[0];
  const plan = prepareOrganicPulse(post, {
    channels: ["email"],
    holdoutPercent: 10,
  }, {
    identifiedFans: 5000,
    directConnections: 200,
    platformOnly: 4800,
    channels: { email: 180, sms: 40 },
    platforms: { instagram: 2000, facebook: 0, tiktok: 4000, youtube: 0 },
  }, {
    id: "act_organic",
    now: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(plan.mode, "organic_pulse");
  assert.equal(plan.sourcePost.postId, "video-1");
  assert.equal(plan.organicBaseline.currentReach, 127);
  assert.equal(plan.organicBaseline.paidIncluded, false);
  assert.equal(plan.audience.selectedEligible, 180);
  assert.equal(plan.audience.reachableNow, 162);
  assert.equal(plan.delivery.email.status, "provider_connection_required");
  assert.equal(plan.nativeActions.length, 3);
  assert.match(plan.nativeActions[0], /native TikTok follow-up/i);
});

test("organic queue ignores disconnected accounts and posts without public links", () => {
  const queue = buildOrganicQueue({
    tiktok: { ...statuses.tiktok, status: "expired" },
    meta: {
      status: "connected",
      account: {
        medianMetaReach: 100,
        instagramAccounts: [{ recentMedia: [{ id: "missing-url", reach: 1 }] }],
      },
    },
  }, { now: "2026-07-30T12:00:00.000Z" });
  assert.equal(queue.posts.length, 0);
});
