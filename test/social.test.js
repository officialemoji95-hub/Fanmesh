import test from "node:test";
import assert from "node:assert/strict";
import {
  getConnectionCatalog,
  normalizeLead,
  normalizePlatformIdentity,
  planSocialExperiment,
  previewLeadImport,
  previewPlatformIdentityImport,
} from "../src/social.js";

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

test("official Snapchat lead exports accept common column labels only after creator attestation", () => {
  const rows = [{
    "Email Address": " SnapFan@Example.com ",
    "Mobile Number": "+234 801 234 5678",
    "First Name": "Snap",
    "Last Name": "Fan",
    "Lead ID": "snap-lead-1",
    "Submission Time": "2026-07-31T12:00:00Z",
    "Campaign ID": "campaign-1",
  }];
  const withoutAttestation = previewLeadImport({ source: "snapchat_ads", rows });
  assert.equal(withoutAttestation.summary.valid, 0);
  assert.match(withoutAttestation.invalid[0].reason, /consent/);

  const preview = previewLeadImport({
    source: "snapchat_ads",
    rows,
    confirmedAuthorized: true,
    confirmedConsent: true,
    consentChannels: ["email", "sms"],
  });
  assert.equal(preview.summary.valid, 1);
  assert.equal(preview.summary.creatorAttested, true);
  assert.equal(preview.valid[0].email, "snapfan@example.com");
  assert.equal(preview.valid[0].phone, "+2348012345678");
  assert.equal(preview.valid[0].name, "Snap Fan");
  assert.equal(preview.valid[0].sourceId, "snap-lead-1");
  assert.equal(preview.valid[0].campaignId, "campaign-1");
  assert.deepEqual(preview.valid[0].consent.channels, ["email", "sms"]);
  assert.equal(preview.valid[0].consent.source, "snapchat_ads:official_export:creator_attested");
});

test("official lead-export attestation requires an explicit permitted channel", () => {
  assert.throws(() => previewLeadImport({
    source: "snapchat_ads",
    rows: [{ "Email Address": "fan@example.com", "Submission Time": "2026-07-31T12:00:00Z" }],
    confirmedAuthorized: true,
    confirmedConsent: true,
  }), /Choose at least one contact channel/);
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

test("official Instagram identities remain platform-only without direct consent", () => {
  const result = normalizePlatformIdentity({
    username: "@Fan.One",
    profileUrl: "https://www.instagram.com/fan.one/",
    timestamp: 1785402000,
    relationship: "follower",
  }, 0, { source: "instagram_export" });
  assert.equal(result.value.platform, "instagram");
  assert.equal(result.value.handle, "fan.one");
  assert.equal(result.value.relationship, "follower");
  assert.match(result.value.contactKey, /^platform_/);
  assert.equal("consent" in result.value, false);
});

test("platform identity previews deduplicate official export rows", () => {
  const preview = previewPlatformIdentityImport({
    source: "facebook_export",
    relationship: "friend",
    rows: [
      { externalId: "person-1", name: "Ari", profileUrl: "https://www.facebook.com/ari" },
      { externalId: "person-1", name: "Ari", profileUrl: "https://www.facebook.com/ari" },
    ],
  });
  assert.equal(preview.summary.valid, 1);
  assert.equal(preview.summary.duplicates, 1);
  assert.equal(preview.summary.directlyReachable, 0);
  assert.match(preview.summary.activationBoundary, /not email, SMS/i);
});

test("platform identity imports reject unrelated or insecure profile URLs", () => {
  const result = normalizePlatformIdentity({
    username: "fan",
    profileUrl: "http://example.com/fan",
  }, 0, { source: "instagram_export" });
  assert.match(result.error.reason, /valid instagram URL/);
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
