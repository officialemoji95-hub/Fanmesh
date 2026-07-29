import test from "node:test";
import assert from "node:assert/strict";
import { getConnectionCatalog, normalizeLead, planSocialExperiment, previewLeadImport } from "../src/social.js";

test("connection catalog distinguishes social accounts from lead imports", () => {
  const catalog = getConnectionCatalog();
  assert.ok(catalog.social.some((connection) => connection.platform === "tiktok"));
  assert.ok(catalog.social.some((connection) => connection.platform === "meta"));
  assert.ok(catalog.imports.some((connection) => connection.platform === "meta_ads"));
  assert.equal(catalog.social.find((connection) => connection.platform === "x").capabilities.includes("follower_identities"), false);
});

test("lead normalization preserves consent provenance without returning raw contact keys", () => {
  const result = normalizeLead({
    email: " Fan@Example.com ",
    source: "Meta Ads",
    leadId: "lead-1",
    consent: true,
    consentAt: "2026-07-25T10:00:00Z",
    consentSource: "release-form",
  });
  assert.ok(result.value.contactKey);
  assert.equal(result.value.email, "fan@example.com");
  assert.equal(result.value.consent.source, "release-form");
  assert.equal(result.value.source, "meta_ads");
});

test("lead import preview rejects missing consent and deduplicates contacts", () => {
  const preview = previewLeadImport({ rows: [
    { email: "fan@example.com", source: "csv", consent: true, consentAt: "2026-07-25", consentSource: "landing-page" },
    { email: "FAN@example.com", source: "csv", consent: true, consentAt: "2026-07-25", consentSource: "landing-page" },
    { email: "no-consent@example.com", source: "csv" },
  ] });
  assert.equal(preview.summary.valid, 1);
  assert.equal(preview.summary.invalid, 2);
  assert.match(preview.invalid[0].reason, /duplicate/);
  assert.match(preview.invalid[1].reason, /consent/);
});

test("records with both contact methods require channel-specific consent", () => {
  const result = normalizeLead({
    email: "fan@example.com",
    phone: "+2348012345678",
    source: "meta_ads",
    consent: true,
    consentAt: "2026-07-25T10:00:00Z",
    consentSource: "meta-lead-form",
  });
  assert.match(result.error.reason, /consentChannels/);

  const accepted = normalizeLead({
    email: "fan@example.com",
    phone: "+2348012345678",
    source: "meta_ads",
    consent: "TRUE",
    consentAt: "2026-07-25T10:00:00Z",
    consentSource: "meta-lead-form",
    consentChannels: "email,sms",
  });
  assert.deepEqual(accepted.value.consent.channels, ["email", "sms"]);
});

test("social experiment plan keeps a holdout and states platform delivery limits", () => {
  const plan = planSocialExperiment({
    contentId: "single-01",
    objective: "release",
    platforms: ["instagram", "tiktok"],
    channels: ["native_social", "consented_direct"],
    candidateCounts: { followers: 118000, adLeads: 1200, optedInFans: 800 },
    holdoutPercent: 10,
  });
  assert.equal(plan.audience.eligibleDirect, 2000);
  assert.equal(plan.audience.estimatedHoldout, 200);
  assert.equal(plan.steps.some((step) => step.id === "publish"), true);
  assert.match(plan.audience.note, /cannot guarantee/);
  assert.equal(plan.guardrails.length, 3);
});
