import { createHash } from "node:crypto";
import { normalizeContentUrl } from "./activation.js";

export const OUTREACH_CHANNELS = Object.freeze(["email", "sms"]);
export const OUTREACH_SOURCES = Object.freeze([
  "meta_ads",
  "tiktok_ads",
  "snapchat_ads",
  "x_ads",
  "google_ads",
  "youtube_ads",
  "threads_ads",
  "csv",
]);

export const OUTREACH_SOURCE_LABELS = Object.freeze({
  meta_ads: "Meta Ads (Facebook + Instagram)",
  tiktok_ads: "TikTok Ads",
  snapchat_ads: "Snapchat Ads",
  x_ads: "X Ads",
  google_ads: "Google Ads",
  youtube_ads: "YouTube Ads",
  threads_ads: "Threads Ads",
  csv: "Authorized consent import",
});

const MAX_RECIPIENTS_PER_LAUNCH = 100;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function uniqueAllowed(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 40).toLowerCase()))]
    .filter((value) => allowed.includes(value));
}

function campaignIdFor(input, now) {
  const digest = createHash("sha256")
    .update(`${input.title}|${input.destination}|${now}`)
    .digest("hex")
    .slice(0, 16);
  return `out_${digest}`;
}

function trackedLink(destination, id, channel) {
  const url = new URL(destination);
  url.searchParams.set("utm_source", "fanmesh");
  url.searchParams.set("utm_medium", channel);
  url.searchParams.set("utm_campaign", id);
  url.searchParams.set("fm_campaign", id);
  return url.href;
}

function sourceNames(row = {}) {
  const entries = Array.isArray(row.source_provenance?.sources) ? row.source_provenance.sources : [];
  return [...new Set(entries.map((item) => cleanText(item?.source, 40).toLowerCase()).filter(Boolean))];
}

function stableBucket(value) {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) % 100;
}

export function normalizeOutreachInput(input = {}, { requireSendConfirmation = false } = {}) {
  if (input.confirmedOwnedContent !== true) {
    throw new TypeError("Confirm that you control the content or destination being shared");
  }
  if (input.confirmedAudienceRights !== true) {
    throw new TypeError("Confirm that every selected lead has active permission for the chosen contact channel");
  }
  if (requireSendConfirmation && input.confirmedSend !== true) {
    throw new TypeError("Confirm this launch before FanMesh sends any messages");
  }
  const title = cleanText(input.title, 100);
  if (title.length < 2) throw new TypeError("title must contain at least 2 characters");
  const destination = normalizeContentUrl(input.contentUrl || input.destination);
  const channels = uniqueAllowed(input.channels, OUTREACH_CHANNELS);
  if (!channels.length) throw new TypeError("Choose email, SMS, or both");
  const sources = uniqueAllowed(input.sources, OUTREACH_SOURCES);
  if (!sources.length) throw new TypeError("Choose at least one authorized lead source");
  const subject = cleanText(input.subject, 150) || title;
  const message = cleanText(input.message, 500);
  if (message.length < 2) throw new TypeError("message must contain at least 2 characters");
  const holdoutPercent = Math.min(25, Math.max(0, Number(input.holdoutPercent) || 0));
  return { title, destination, channels, sources, subject, message, holdoutPercent };
}

export function selectOutreachCohort(rows = [], input = {}, options = {}) {
  const selected = [];
  const heldOut = [];
  const suppressed = [];
  const campaignSeed = cleanText(options.campaignSeed, 200) || input.destination;

  for (const row of Array.isArray(rows) ? rows : []) {
    const consented = Array.isArray(row.consented_channels) ? row.consented_channels : [];
    const matchedSources = sourceNames(row).filter((source) => input.sources.includes(source));
    if (!matchedSources.length) continue;
    const channel = input.channels.includes("email") && consented.includes("email") && row.email
      ? "email"
      : input.channels.includes("sms") && consented.includes("sms") && row.phone
        ? "sms"
        : "";
    if (!channel) continue;
    const recentChannels = Array.isArray(row.recent_channels) ? row.recent_channels : [];
    const item = {
      fanId: row.id,
      displayName: cleanText(row.display_name, 120) || "Fan",
      channel,
      address: channel === "email" ? row.email : row.phone,
      sources: matchedSources,
    };
    if (recentChannels.includes(channel) || row.suppressed === true) {
      suppressed.push({ ...item, reason: row.suppressed === true ? "suppressed" : "frequency_cap" });
      continue;
    }
    if (stableBucket(`${campaignSeed}:${row.id}:${channel}`) < input.holdoutPercent) {
      heldOut.push(item);
      continue;
    }
    selected.push(item);
  }
  const limited = selected.slice(0, Math.max(1, Number(options.limit) || MAX_RECIPIENTS_PER_LAUNCH));
  const overflow = selected.length - limited.length;
  const sourceCounts = Object.fromEntries(input.sources.map((source) => [source, 0]));
  const channelCounts = { email: 0, sms: 0 };
  for (const recipient of limited) {
    channelCounts[recipient.channel] += 1;
    for (const source of recipient.sources) sourceCounts[source] += 1;
  }
  return {
    recipients: limited,
    summary: {
      eligible: selected.length + heldOut.length,
      selected: limited.length,
      heldOut: heldOut.length,
      suppressed: suppressed.length,
      overflow,
      channels: channelCounts,
      sources: sourceCounts,
      limit: Math.max(1, Number(options.limit) || MAX_RECIPIENTS_PER_LAUNCH),
    },
  };
}

export function publicOutreachPlan(input = {}, cohort = {}, readiness = {}, options = {}) {
  const createdAt = new Date(options.now || Date.now()).toISOString();
  const id = cleanText(options.id, 80) || campaignIdFor(input, createdAt);
  const links = Object.fromEntries(input.channels.map((channel) => [channel, trackedLink(input.destination, id, channel)]));
  const providers = Object.fromEntries(input.channels.map((channel) => [channel, readiness[channel] || { configured: false }]));
  const neededChannels = input.channels.filter((channel) => Number(cohort.summary.channels?.[channel]) > 0);
  return {
    id,
    kind: "lead_outreach_v1",
    status: "preview",
    createdAt,
    title: input.title,
    destination: input.destination,
    subject: input.subject,
    message: input.message,
    channels: input.channels,
    sources: input.sources,
    holdoutPercent: input.holdoutPercent,
    audience: cohort.summary,
    links,
    providers,
    launchable: cohort.summary.selected > 0 && neededChannels.every((channel) => providers[channel]?.configured),
    guardrails: [
      "Only contacts with active channel consent and matching provenance are selected.",
      "Each fan receives at most one message in a launch; email is preferred when both channels are selected.",
      "FanMesh suppresses contacts messaged on the same channel during the previous 48 hours.",
      `A single launch is capped at ${cohort.summary.limit} recipients while the delivery worker is in beta.`,
    ],
  };
}

function providerReadiness(environment) {
  const email = Boolean(environment.RESEND_API_KEY && environment.OUTREACH_EMAIL_FROM);
  const sms = Boolean(environment.TWILIO_ACCOUNT_SID && environment.TWILIO_AUTH_TOKEN && environment.TWILIO_FROM_NUMBER);
  return {
    email: {
      provider: "resend",
      configured: email,
      explanation: email ? "Resend sender is configured." : "Add RESEND_API_KEY and OUTREACH_EMAIL_FROM in Render.",
    },
    sms: {
      provider: "twilio",
      configured: sms,
      explanation: sms ? "Twilio sender is configured." : "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Render.",
    },
  };
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function createOutreachService({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const readiness = providerReadiness(environment);

  async function sendEmail(recipient, plan) {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        authorization: `Bearer ${environment.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": `${plan.id}:${recipient.fanId}:email`.slice(0, 256),
      },
      body: JSON.stringify({
        from: environment.OUTREACH_EMAIL_FROM,
        to: [recipient.address],
        subject: plan.subject,
        text: `${plan.message}\n\n${plan.links.email}\n\nYou received this because you opted in to creator updates. Reply UNSUBSCRIBE to stop.`,
        html: `<p>${escapeHtml(plan.message)}</p><p><a href="${escapeHtml(plan.links.email)}">View the post</a></p><p><small>You received this because you opted in to creator updates. Reply UNSUBSCRIBE to stop.</small></p>`,
        ...(environment.OUTREACH_REPLY_TO ? { reply_to: environment.OUTREACH_REPLY_TO } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `Resend rejected the email (${response.status})`);
    return { provider: "resend", providerMessageId: payload.id || null, status: "sent" };
  }

  async function sendSms(recipient, plan) {
    const params = new URLSearchParams({
      To: recipient.address,
      From: environment.TWILIO_FROM_NUMBER,
      Body: `${plan.message} ${plan.links.sms} Reply STOP to opt out.`.slice(0, 1500),
    });
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(environment.TWILIO_ACCOUNT_SID)}/Messages.json`, {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        authorization: `Basic ${Buffer.from(`${environment.TWILIO_ACCOUNT_SID}:${environment.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `Twilio rejected the SMS (${response.status})`);
    return { provider: "twilio", providerMessageId: payload.sid || null, status: "sent" };
  }

  async function deliver(plan, recipients = []) {
    const results = [];
    async function sendOne(recipient) {
      try {
        if (!readiness[recipient.channel]?.configured) throw new Error(`${recipient.channel.toUpperCase()} provider is not configured`);
        const result = recipient.channel === "email"
          ? await sendEmail(recipient, plan)
          : await sendSms(recipient, plan);
        return { fanId: recipient.fanId, channel: recipient.channel, ...result };
      } catch (error) {
        return { fanId: recipient.fanId, channel: recipient.channel, provider: readiness[recipient.channel]?.provider, status: "failed", reason: cleanText(error.message, 240) };
      }
    }
    for (let index = 0; index < recipients.length; index += 5) {
      results.push(...await Promise.all(recipients.slice(index, index + 5).map(sendOne)));
    }
    return results;
  }

  return Object.freeze({ readiness, deliver });
}
