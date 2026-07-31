import { createHmac, timingSafeEqual } from "node:crypto";

export class SnapchatWebhookError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SnapchatWebhookError";
    this.statusCode = statusCode;
  }
}

function text(value, maxLength = 300) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function timestamp(value) {
  const raw = text(String(value ?? ""), 80);
  if (!raw) return "";
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(raw.length === 13 ? numeric : numeric * 1000);
    return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
  }
  return Number.isNaN(Date.parse(raw)) ? "" : new Date(raw).toISOString();
}

export function verifySnapchatWebhookSignature({
  secret,
  signature,
  timestampHeader,
  rawBody,
  now = () => Date.now(),
  toleranceSeconds = 300,
} = {}) {
  const key = text(secret, 500);
  const supplied = text(signature, 200).toLowerCase();
  const header = text(timestampHeader, 80);
  if (!key || !/^[a-f0-9]{64}$/.test(supplied) || !/^\d{10,13}$/.test(header)) return false;
  const eventTime = Number(header.length === 13 ? header : `${header}000`);
  if (!Number.isFinite(eventTime) || Math.abs(now() - eventTime) > toleranceSeconds * 1000) return false;
  const expected = createHmac("sha256", key).update(`${header}.${String(rawBody || "")}`, "utf8").digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function normalizeSnapchatWebhookLead(payload = {}, permittedChannels = []) {
  const email = text(payload.email, 254).toLowerCase();
  const phone = text(payload.phone_number || payload.phone, 40);
  const channels = [...new Set((Array.isArray(permittedChannels) ? permittedChannels : [])
    .map((channel) => text(channel, 20).toLowerCase())
    .filter((channel) => (channel === "email" && email) || (channel === "sms" && phone)))];
  const name = [text(payload.first_name, 80), text(payload.last_name, 80)].filter(Boolean).join(" ");
  const location = [
    text(payload.address_level_2, 80),
    text(payload.address_level_1, 80),
    text(payload.postal_code, 30),
  ].filter(Boolean).join(", ");
  const formId = text(payload.form_id, 160);
  return {
    name,
    email,
    phone,
    location,
    source: "snapchat_ads",
    sourceId: text(payload.lead_id, 160),
    consent: true,
    consentAt: timestamp(payload.create_time),
    consentSource: `snapchat_lead_form:${formId}:creator_attested`,
    consentChannels: channels,
    campaignId: text(payload.campaign_id, 100),
    utmSource: "snapchat",
    utmMedium: "paid_social",
    utmCampaign: text(payload.campaign_name, 100),
  };
}

export function publicSnapchatLeadMetadata(payload = {}) {
  return {
    formId: text(payload.form_id, 160),
    formName: text(payload.form_name, 160),
    adAccountId: text(payload.ad_account_id, 160),
    campaignId: text(payload.campaign_id, 160),
    campaignName: text(payload.campaign_name, 160),
    adSquadId: text(payload.ad_squad_id, 160),
    adId: text(payload.ad_id, 160),
    preferredStatus: text(payload.lead_preferred_status, 40),
    createdAt: timestamp(payload.create_time) || null,
  };
}
