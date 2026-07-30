import { createHash } from "node:crypto";

const OBJECTIVES = Object.freeze(["release", "sales", "community", "evergreen"]);
const DIRECT_CHANNELS = Object.freeze(["email", "sms"]);
const PLATFORM_CHANNELS = Object.freeze(["instagram", "facebook", "tiktok", "youtube"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function uniqueAllowed(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 30).toLowerCase()))]
    .filter((value) => allowed.includes(value));
}

function isPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local")) return true;
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function normalizeContentUrl(value) {
  let url;
  try {
    url = new URL(cleanText(value, 1500));
  } catch {
    throw new TypeError("contentUrl must be a valid public HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new TypeError("contentUrl must be a valid public HTTPS URL");
  }
  url.hash = "";
  return url.href;
}

function campaignLink(destination, campaignId, medium) {
  const url = new URL(destination);
  url.searchParams.set("utm_source", "fanmesh");
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaignId);
  url.searchParams.set("fm_campaign", campaignId);
  return url.href;
}

function campaignIdFor({ destination, title, createdAt }) {
  const digest = createHash("sha256").update(`${destination}|${title}|${createdAt}`).digest("hex").slice(0, 14);
  return `act_${digest}`;
}

export function activationEligibilityFromFans(fans = []) {
  const records = Array.isArray(fans) ? fans : [];
  const channelCount = (channel) => records.filter((fan) => fan?.consentedChannels?.includes(channel)).length;
  const platformCount = (platform) => records.filter((fan) => fan?.channels?.includes(platform)).length;
  const directConnections = records.filter((fan) =>
    Array.isArray(fan?.consentedChannels) && fan.consentedChannels.some((channel) => DIRECT_CHANNELS.includes(channel)),
  ).length;
  return {
    identifiedFans: records.length,
    directConnections,
    platformOnly: Math.max(0, records.length - directConnections),
    channels: {
      email: channelCount("email"),
      sms: channelCount("sms"),
    },
    platforms: Object.fromEntries(PLATFORM_CHANNELS.map((platform) => [platform, platformCount(platform)])),
  };
}

export function prepareFanActivation(input = {}, eligibility = {}, options = {}) {
  if (input.confirmedOwnedContent !== true) {
    throw new TypeError("Confirm that you control the content or destination being shared");
  }
  const title = cleanText(input.title || input.contentTitle, 100);
  if (title.length < 2) throw new TypeError("title must contain at least 2 characters");
  const destination = normalizeContentUrl(input.contentUrl || input.destination);
  const objective = OBJECTIVES.includes(input.objective) ? input.objective : "evergreen";
  const channels = uniqueAllowed(input.channels, DIRECT_CHANNELS);
  if (!channels.length) throw new TypeError("Choose email, SMS, or both for the fan alert");
  const createdAt = new Date(options.now || Date.now()).toISOString();
  const id = cleanText(options.id, 80) || campaignIdFor({ destination, title, createdAt });
  const holdoutPercent = Math.min(25, Math.max(0, Number(input.holdoutPercent) || 0));
  const message = cleanText(input.message, 280) || `${title} is live. See it here:`;
  const emailEligible = count(eligibility.channels?.email);
  const smsEligible = count(eligibility.channels?.sms);
  const directConnections = count(eligibility.directConnections);
  const identifiedFans = count(eligibility.identifiedFans);
  const selectedEligible = channels.length === 2
    ? directConnections
    : channels[0] === "email" ? emailEligible : smsEligible;
  const holdout = Math.floor((selectedEligible * holdoutPercent) / 100);
  const reachableNow = Math.max(0, selectedEligible - holdout);
  const platformOnly = Math.max(0, count(eligibility.platformOnly || identifiedFans - directConnections));
  const links = {
    social: campaignLink(destination, id, "social"),
    ...Object.fromEntries(channels.map((channel) => [channel, campaignLink(destination, id, channel)])),
  };
  const delivery = Object.fromEntries(channels.map((channel) => {
    const eligible = channel === "email" ? emailEligible : smsEligible;
    return [channel, {
      eligible,
      status: eligible > 0 ? "provider_connection_required" : "no_eligible_fans",
      explanation: eligible > 0
        ? `${eligible} fan${eligible === 1 ? "" : "s"} have active ${channel.toUpperCase()} consent. Connect a delivery provider before sending.`
        : `No fans currently have active ${channel.toUpperCase()} consent.`,
    }];
  }));

  return {
    id,
    kind: "fan_activation_v1",
    contentId: id,
    title,
    destination,
    objective,
    message,
    channels,
    createdAt,
    status: "draft",
    readiness: reachableNow > 0 ? "audience_ready" : "capture_needed",
    audience: {
      identifiedFans,
      platformOnly,
      directConnections,
      selectedEligible,
      holdout,
      holdoutPercent,
      reachableNow,
      channels: { email: emailEligible, sms: smsEligible },
      platforms: Object.fromEntries(
        PLATFORM_CHANNELS.map((platform) => [platform, count(eligibility.platforms?.[platform])]),
      ),
      explanation: "Platform-only followers are known identities but cannot receive direct alerts until they explicitly opt in.",
    },
    links,
    messageTemplates: Object.fromEntries(channels.map((channel) => [channel, `${message} ${links[channel]}`])),
    delivery,
    steps: [
      {
        order: 1,
        title: "Publish natively",
        detail: "Post through each platform's official publishing flow with creative made for that platform.",
      },
      {
        order: 2,
        title: "Alert reachable fans",
        detail: reachableNow > 0
          ? `Reserve the holdout and send one useful alert to up to ${reachableNow} consented fans after a delivery provider is connected.`
          : "There are no directly alertable fans yet. Use the share link to begin converting followers into opt-ins.",
      },
      {
        order: 3,
        title: "Convert more followers",
        detail: "Use the social attribution link in a bio, Story, description, or pinned post where the platform supports it.",
      },
      {
        order: 4,
        title: "Measure the response",
        detail: "Compare channel clicks and meaningful actions using the FanMesh campaign parameters in each link.",
      },
    ],
    guardrails: [
      "A prepared activation does not send messages or claim platform delivery.",
      "Only fans with active channel consent count as directly alertable.",
      "Respect opt-outs, provider rules, and a default one-alert-per-48-hours frequency cap.",
    ],
  };
}

export { DIRECT_CHANNELS, OBJECTIVES, PLATFORM_CHANNELS };
