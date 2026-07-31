import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSnapchatWebhookLead,
  publicSnapchatLeadMetadata,
  verifySnapchatWebhookSignature,
} from "../src/snapchat.js";

test("Snapchat webhook signatures require a fresh matching HMAC", () => {
  const rawBody = JSON.stringify({ form_id: "form-1", lead_id: "lead-1", first_name: "Ari" });
  const timestampHeader = "1785492000";
  const secret = "snap-secret";
  const signature = createHmac("sha256", secret).update(`${timestampHeader}.${rawBody}`).digest("hex");
  const now = () => 1785492000 * 1000;
  assert.equal(verifySnapchatWebhookSignature({ secret, signature, timestampHeader, rawBody, now }), true);
  assert.equal(verifySnapchatWebhookSignature({ secret, signature, timestampHeader, rawBody: `${rawBody} `, now }), false);
  assert.equal(verifySnapchatWebhookSignature({ secret, signature, timestampHeader, rawBody, now: () => now() + 301000 }), false);
});

test("Snapchat lead normalization keeps consent provenance and selected available channels", () => {
  const payload = {
    lead_id: "lead-1",
    form_id: "form-1",
    form_name: "Release list",
    ad_account_id: "ad-account-1",
    campaign_id: "campaign-1",
    campaign_name: "New single",
    create_time: "1785492000000",
    first_name: "Ari",
    last_name: "Fan",
    email: "ARI@EXAMPLE.COM",
    postal_code: "100001",
  };
  const lead = normalizeSnapchatWebhookLead(payload, ["email", "sms"]);
  assert.equal(lead.name, "Ari Fan");
  assert.equal(lead.email, "ari@example.com");
  assert.deepEqual(lead.consentChannels, ["email"]);
  assert.equal(lead.consentSource, "snapchat_lead_form:form-1:creator_attested");
  assert.equal(lead.utmMedium, "paid_social");
  assert.equal(lead.consentAt, "2026-07-31T10:00:00.000Z");
  assert.deepEqual(publicSnapchatLeadMetadata(payload), {
    formId: "form-1",
    formName: "Release list",
    adAccountId: "ad-account-1",
    campaignId: "campaign-1",
    campaignName: "New single",
    adSquadId: "",
    adId: "",
    preferredStatus: "",
    createdAt: "2026-07-31T10:00:00.000Z",
  });
});
