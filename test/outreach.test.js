import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutreachService,
  normalizeOutreachInput,
  publicOutreachPlan,
  selectOutreachCohort,
} from "../src/outreach.js";

const validInput = {
  title: "New release",
  contentUrl: "https://example.com/watch",
  subject: "Watch the new release",
  message: "I made this for you.",
  channels: ["email", "sms"],
  sources: ["meta_ads", "snapchat_ads", "x_ads", "google_ads", "youtube_ads", "threads_ads"],
  holdoutPercent: 0,
  confirmedOwnedContent: true,
  confirmedAudienceRights: true,
};

test("outreach requires content ownership, audience rights, and an authorized source", () => {
  assert.throws(() => normalizeOutreachInput({ ...validInput, confirmedAudienceRights: false }), /active permission/i);
  assert.throws(() => normalizeOutreachInput({ ...validInput, sources: ["scraped_followers"] }), /authorized lead source/i);
  assert.throws(() => normalizeOutreachInput(validInput, { requireSendConfirmation: true }), /Confirm this launch/i);
});

test("cohort selection filters provenance, consent, frequency, and duplicate channels", () => {
  const input = normalizeOutreachInput(validInput);
  const state = selectOutreachCohort([
    {
      id: "fan-1",
      display_name: "Email First",
      email: "one@example.com",
      phone: "+15551234567",
      consented_channels: ["email", "sms"],
      source_provenance: { sources: [{ source: "meta_ads" }] },
      recent_channels: [],
    },
    {
      id: "fan-2",
      display_name: "Frequency Capped",
      email: "two@example.com",
      consented_channels: ["email"],
      source_provenance: { sources: [{ source: "google_ads" }] },
      recent_channels: ["email"],
    },
    {
      id: "fan-3",
      display_name: "Wrong source",
      email: "three@example.com",
      consented_channels: ["email"],
      source_provenance: { sources: [{ source: "instagram_export" }] },
      recent_channels: [],
    },
    {
      id: "fan-4",
      display_name: "SMS",
      phone: "+2348012345678",
      consented_channels: ["sms"],
      source_provenance: { sources: [{ source: "snapchat_ads" }] },
      recent_channels: [],
    },
  ], input, { limit: 100 });
  assert.equal(state.summary.selected, 2);
  assert.equal(state.summary.suppressed, 1);
  assert.equal(state.summary.channels.email, 1);
  assert.equal(state.summary.channels.sms, 1);
  assert.equal(state.recipients[0].channel, "email");
  assert.equal(JSON.stringify(state.summary).includes("one@example.com"), false);
});

test("public outreach plan exposes counts and readiness but never recipient addresses", () => {
  const input = normalizeOutreachInput(validInput);
  const cohort = selectOutreachCohort([{
    id: "fan-private",
    display_name: "Private",
    email: "private@example.com",
    consented_channels: ["email"],
    source_provenance: { sources: [{ source: "meta_ads" }] },
  }], input);
  const plan = publicOutreachPlan(input, cohort, {
    email: { provider: "resend", configured: true },
    sms: { provider: "twilio", configured: true },
  }, { now: "2026-07-31T10:00:00.000Z" });
  assert.equal(plan.launchable, true);
  assert.match(plan.links.email, /utm_medium=email/);
  assert.equal(JSON.stringify(plan).includes("private@example.com"), false);
});

test("provider adapters use Resend and Twilio server APIs", async () => {
  const calls = [];
  const service = createOutreachService({
    environment: {
      RESEND_API_KEY: "re_private",
      OUTREACH_EMAIL_FROM: "Artist <updates@example.com>",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "twilio-private",
      TWILIO_FROM_NUMBER: "+15550001111",
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() { return url.includes("resend") ? { id: "email-1" } : { sid: "sms-1" }; },
      };
    },
  });
  const results = await service.deliver({
    id: "out_1234567890abcdef",
    subject: "New release",
    message: "Listen now",
    links: { email: "https://example.com/email", sms: "https://example.com/sms" },
  }, [
    { fanId: "fan-1", channel: "email", address: "fan@example.com" },
    { fanId: "fan-2", channel: "sms", address: "+2348012345678" },
  ]);
  assert.deepEqual(results.map((item) => item.status), ["sent", "sent"]);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.match(calls[0].options.headers["idempotency-key"], /fan-1:email/);
  assert.match(calls[1].url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC123\/Messages\.json/);
  assert.match(calls[1].options.body, /Reply\+STOP\+to\+opt\+out/);
});

test("missing provider credentials fail closed", async () => {
  const service = createOutreachService({ environment: {}, async fetchImpl() { throw new Error("must not call"); } });
  assert.equal(service.readiness.email.configured, false);
  assert.equal(service.readiness.sms.configured, false);
  const results = await service.deliver({ id: "out_1", links: {} }, [{ fanId: "fan-1", channel: "email", address: "fan@example.com" }]);
  assert.equal(results[0].status, "failed");
});

