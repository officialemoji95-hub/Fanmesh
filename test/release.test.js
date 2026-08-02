import test from "node:test";
import assert from "node:assert/strict";
import { applyReleaseCheckpoint, buildReleasePlan, publicReleasePlan } from "../src/release.js";

const meshItem = {
  id: "mesh_midnight",
  title: "Midnight Drive official video",
  opportunityScore: 82,
  status: "recovery_gap",
  matchEvidence: "Matched 2 platform versions by caption overlap.",
  platforms: ["instagram", "tiktok"],
  missingPlatforms: ["youtube"],
  posts: [
    {
      key: "post_ig",
      platform: "instagram",
      postId: "ig-1",
      url: "https://instagram.com/p/ig-1",
      reachMetric: "reach",
      currentReach: 140,
      benchmark: 200,
      performanceIndex: 70,
      interactions: 20,
    },
    {
      key: "post_tt",
      platform: "tiktok",
      postId: "tt-1",
      url: "https://tiktok.com/@artist/video/1",
      reachMetric: "views",
      currentReach: 90,
      benchmark: 300,
      performanceIndex: 30,
      interactions: 10,
    },
  ],
};

const eligibility = {
  identifiedFans: 1000,
  directConnections: 120,
  platformOnly: 880,
  channels: { email: 100, sms: 35 },
};

function plan() {
  return buildReleasePlan(meshItem, {
    title: "Midnight Drive recovery",
    releaseAt: "2026-08-03T12:00:00.000Z",
    objective: "discovery",
    platforms: ["instagram", "tiktok", "youtube"],
    channels: ["email"],
    holdoutPercent: 10,
    confirmedOwnedContent: true,
  }, eligibility, { now: "2026-08-02T12:00:00.000Z" });
}

test("release plan turns a content mesh group into native actions, a direct cohort, and measurement windows", () => {
  const result = plan();
  assert.equal(result.kind, "release_plan_v1");
  assert.equal(result.status, "draft");
  assert.deepEqual(result.platforms.map((item) => item.platform), ["instagram", "tiktok", "youtube"]);
  assert.equal(result.platforms.find((item) => item.platform === "instagram").baseline.currentReach, 140);
  assert.equal(result.platforms.find((item) => item.platform === "youtube").baseline, null);
  assert.equal(result.platforms.find((item) => item.platform === "youtube").guidance.sourceState, "native_adaptation_needed");
  assert.equal(result.audience.eligibleDirect, 100);
  assert.equal(result.audience.heldOut, 10);
  assert.equal(result.audience.activationCohort, 90);
  assert.equal(result.schedule.some((item) => item.id === "checkpoint_24h"), true);
  assert.equal(result.schedule.some((item) => item.id === "checkpoint_72h"), true);
  assert.match(result.guardrails.join(" "), /does not guarantee feed placement/i);
  assert.match(result.guardrails.join(" "), /No automated likes/i);
});

test("release plan requires ownership, a future schedule, and a connected platform", () => {
  assert.throws(() => buildReleasePlan(meshItem, {
    releaseAt: "2026-08-03T12:00:00.000Z",
    confirmedOwnedContent: false,
  }, eligibility, { now: "2026-08-02T12:00:00.000Z" }), /Confirm that you control/);
  assert.throws(() => buildReleasePlan(meshItem, {
    releaseAt: "2026-07-01T12:00:00.000Z",
    confirmedOwnedContent: true,
  }, eligibility, { now: "2026-08-02T12:00:00.000Z" }), /cannot be in the past/);
  assert.throws(() => buildReleasePlan(meshItem, {
    releaseAt: "2026-08-03T12:00:00.000Z",
    platforms: ["threads"],
    confirmedOwnedContent: true,
  }, eligibility, { now: "2026-08-02T12:00:00.000Z" }), /Select at least one connected/);
});

test("24-hour checkpoint compares every result to its own platform baseline", () => {
  const updated = applyReleaseCheckpoint(plan(), {
    checkpoint: "24h",
    confirmedOrganicOnly: true,
    metrics: [
      { platform: "instagram", currentReach: 240, interactions: 36, linkClicks: 9, conversions: 1 },
      { platform: "tiktok", currentReach: 150, interactions: 24, linkClicks: 5, conversions: 0 },
      { platform: "youtube", currentReach: 80, interactions: 12, linkClicks: 3, conversions: 0 },
    ],
  }, { now: "2026-08-04T12:00:00.000Z" });
  assert.equal(updated.status, "active");
  assert.equal(updated.checkpoints[0].timing.state, "on_time");
  const instagram = updated.checkpoints[0].metrics.find((item) => item.platform === "instagram");
  const tiktok = updated.checkpoints[0].metrics.find((item) => item.platform === "tiktok");
  assert.equal(instagram.performanceIndex, 120);
  assert.equal(instagram.deltaFromBaseline, 100);
  assert.equal(tiktok.performanceIndex, 50);
  assert.equal(updated.learning.strongestPlatform.platform, "instagram");
  assert.match(updated.learning.nextAction, /Rework the tiktok hook/i);
});

test("72-hour checkpoint completes the learning loop and replaces duplicate checkpoint windows", () => {
  const initial = applyReleaseCheckpoint(plan(), {
    checkpoint: "24h",
    confirmedOrganicOnly: true,
    metrics: [{ platform: "instagram", currentReach: 220, interactions: 30 }],
  }, { now: "2026-08-04T12:00:00.000Z" });
  const completed = applyReleaseCheckpoint(initial, {
    checkpoint: "72h",
    confirmedOrganicOnly: true,
    metrics: [{ platform: "instagram", currentReach: 310, interactions: 50 }],
    notes: "Story follow-up added after the first checkpoint.",
  }, { now: "2026-08-06T12:00:00.000Z" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.learning.state, "complete");
  assert.deepEqual(completed.checkpoints.map((item) => item.checkpoint), ["24h", "72h"]);
  assert.equal(completed.checkpoints[1].metrics[0].paidIncluded, false);
});

test("checkpoint refuses totals unless paid delivery is explicitly excluded", () => {
  assert.throws(() => applyReleaseCheckpoint(plan(), {
    checkpoint: "24h",
    confirmedOrganicOnly: false,
    metrics: [{ platform: "instagram", currentReach: 200 }],
  }), /exclude paid delivery/);
});

test("public release plan marks the contact-field boundary", () => {
  const result = publicReleasePlan(plan());
  assert.equal(result.audience.contactFieldsReturned, false);
  assert.equal(JSON.stringify(result).includes("fan@example.com"), false);
});
