import test from "node:test";
import assert from "node:assert/strict";
import { activationEligibilityFromFans, normalizeContentUrl, prepareFanActivation } from "../src/activation.js";

test("activation eligibility separates platform identities from directly alertable fans", () => {
  const eligibility = activationEligibilityFromFans([
    { channels: ["instagram"], consentedChannels: [] },
    { channels: ["instagram", "email"], consentedChannels: ["email"] },
    { channels: ["tiktok", "email", "sms"], consentedChannels: ["email", "sms"] },
  ]);
  assert.deepEqual(eligibility, {
    identifiedFans: 3,
    directConnections: 2,
    platformOnly: 1,
    channels: { email: 2, sms: 1 },
    platforms: { instagram: 2, facebook: 0, tiktok: 1, youtube: 0 },
  });
});

test("fan activation creates channel attribution links and an explainable cohort", () => {
  const plan = prepareFanActivation({
    title: "New single",
    contentUrl: "https://example.com/listen?ref=artist#player",
    objective: "release",
    message: "The new single is here:",
    channels: ["email", "sms"],
    holdoutPercent: 10,
    confirmedOwnedContent: true,
  }, {
    identifiedFans: 100,
    directConnections: 20,
    platformOnly: 80,
    channels: { email: 18, sms: 7 },
    platforms: { instagram: 70, facebook: 25, tiktok: 60, youtube: 5 },
  }, {
    id: "act_test",
    now: "2026-07-30T10:00:00.000Z",
  });

  assert.equal(plan.id, "act_test");
  assert.equal(plan.audience.selectedEligible, 20);
  assert.equal(plan.audience.holdout, 2);
  assert.equal(plan.audience.reachableNow, 18);
  assert.equal(plan.audience.platformOnly, 80);
  assert.equal(plan.delivery.email.eligible, 18);
  assert.equal(plan.delivery.email.status, "provider_connection_required");
  assert.match(plan.links.email, /utm_medium=email/);
  assert.match(plan.links.sms, /fm_campaign=act_test/);
  assert.equal(plan.links.email.includes("#player"), false);
  assert.equal(plan.status, "draft");
});

test("fan activation refuses private, insecure, and unconfirmed destinations", () => {
  assert.throws(() => normalizeContentUrl("http://example.com/post"), /public HTTPS/);
  assert.throws(() => normalizeContentUrl("https://localhost/post"), /public HTTPS/);
  assert.throws(() => prepareFanActivation({
    title: "Post",
    contentUrl: "https://example.com/post",
    channels: ["email"],
  }), /Confirm/);
});

test("fan activation reports capture needed when no direct fans are eligible", () => {
  const plan = prepareFanActivation({
    title: "New video",
    contentUrl: "https://www.youtube.com/watch?v=example",
    channels: ["email"],
    confirmedOwnedContent: true,
  }, {
    identifiedFans: 500,
    directConnections: 0,
    platformOnly: 500,
    channels: { email: 0, sms: 0 },
  }, { id: "act_empty", now: "2026-07-30T10:00:00.000Z" });
  assert.equal(plan.readiness, "capture_needed");
  assert.equal(plan.audience.reachableNow, 0);
  assert.equal(plan.delivery.email.status, "no_eligible_fans");
});
