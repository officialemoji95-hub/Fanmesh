import { createHash } from "node:crypto";

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "spotify"];
export const LEAD_SOURCES = ["meta_ads", "tiktok_ads", "google_ads", "csv"];

const PLATFORM_CAPABILITIES = {
  instagram: {
    label: "Instagram / Meta",
    authMethod: "oauth",
    capabilities: ["native_publish", "aggregate_analytics", "creator_insights"],
    caveat: "Follower identities are not assumed; only authorized account data and fan opt-ins are linked.",
  },
  facebook: {
    label: "Facebook / Meta",
    authMethod: "oauth",
    capabilities: ["native_publish", "aggregate_analytics", "creator_insights"],
    caveat: "Page and ad data remain scoped to the authorized assets; feed delivery is still platform-controlled.",
  },
  tiktok: {
    label: "TikTok",
    authMethod: "oauth",
    capabilities: ["native_publish", "aggregate_analytics"],
    caveat: "Publishing requires creator authorization and the platform's approved posting access.",
  },
  youtube: {
    label: "YouTube",
    authMethod: "oauth",
    capabilities: ["native_publish", "aggregate_analytics", "content_metadata"],
    caveat: "Subscriber and viewer data are permissioned; reports are not a promise that every subscriber sees a post.",
  },
  spotify: {
    label: "Spotify",
    authMethod: "oauth",
    capabilities: ["catalog_metadata", "aggregate_analytics"],
    caveat: "Spotify exposes aggregate following information for artists, not a portable list of every follower identity.",
  },
};

const IMPORT_CAPABILITIES = {
  meta_ads: { label: "Meta Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  tiktok_ads: { label: "TikTok Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  google_ads: { label: "Google Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  csv: { label: "Consent export (CSV)", authMethod: "file_upload", capabilities: ["lead_import"] },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMPORT_ROWS = 1000;

function text(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizeEmail(value) {
  const email = text(value, 254).toLowerCase();
  return email && EMAIL_PATTERN.test(email) ? email : "";
}

function normalizePhone(value) {
  const phone = text(value, 40);
  if (!phone) return "";
  const normalized = phone.replace(/[\s().-]/g, "");
  return /^\+?[0-9]{7,15}$/.test(normalized) ? normalized : "";
}

function invalid(index, reason) {
  return { row: index + 1, reason };
}

export function getConnectionCatalog() {
  const social = Object.entries(PLATFORM_CAPABILITIES).map(([platform, details]) => ({
    platform,
    ...details,
    status: "not_connected",
    tokenPolicy: "FanMesh stores connection metadata only; access tokens belong in the production secret store.",
  }));
  const imports = Object.entries(IMPORT_CAPABILITIES).map(([platform, details]) => ({
    platform,
    ...details,
    status: "ready_for_authorized_import",
    tokenPolicy: "Use an official export or API. Do not upload purchased, scraped, or unconsented lists.",
  }));
  return { social, imports };
}

export function normalizeLead(row = {}, index = 0) {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone);
  const name = text(row.name || row.fullName, 120);
  const source = text(row.source || row.sourcePlatform, 40).toLowerCase().replace(/\s+/g, "_");
  const sourceId = text(row.sourceId || row.leadId || row.id, 160);
  const consent = bool(row.consent || row.marketingConsent || row.optedIn);
  const consentAt = text(row.consentAt || row.consent_at, 50);
  const consentSource = text(row.consentSource || row.consent_source || source, 80);

  if (!email && !phone) return { error: invalid(index, "a valid email or phone is required") };
  if (row.email && !email) return { error: invalid(index, "email is not valid") };
  if (row.phone && !phone) return { error: invalid(index, "phone must use 7–15 digits, optionally prefixed with +") };
  if (!consent) return { error: invalid(index, "explicit marketing consent is required") };
  if (!consentAt || Number.isNaN(Date.parse(consentAt))) {
    return { error: invalid(index, "consentAt must be a valid timestamp") };
  }
  if (!consentSource) return { error: invalid(index, "consentSource is required for provenance") };

  const contactKey = hash([email, phone].filter(Boolean).join("|"));
  return {
    value: {
      contactKey,
      sourceKey: hash(`${source || "unknown"}:${sourceId || contactKey}`),
      name,
      email: email || undefined,
      phone: phone || undefined,
      source: source || "unknown",
      sourceId: sourceId || undefined,
      consent: { granted: true, at: new Date(consentAt).toISOString(), source: consentSource },
      campaignId: text(row.campaignId || row.campaign_id, 100) || undefined,
      utm: {
        source: text(row.utmSource || row.utm_source, 100) || undefined,
        medium: text(row.utmMedium || row.utm_medium, 100) || undefined,
        campaign: text(row.utmCampaign || row.utm_campaign, 100) || undefined,
      },
    },
  };
}

export function previewLeadImport(input = {}) {
  if (!Array.isArray(input.rows)) throw new TypeError("rows must be an array");
  if (input.rows.length === 0) throw new TypeError("rows must contain at least one lead");
  if (input.rows.length > MAX_IMPORT_ROWS) throw new TypeError(`rows cannot exceed ${MAX_IMPORT_ROWS} records`);

  const valid = [];
  const invalidRows = [];
  const seen = new Set();
  input.rows.forEach((row, index) => {
    const result = normalizeLead(row, index);
    if (result.error) {
      invalidRows.push(result.error);
      return;
    }
    if (seen.has(result.value.contactKey)) {
      invalidRows.push(invalid(index, "duplicate contact in this import"));
      return;
    }
    seen.add(result.value.contactKey);
    valid.push(result.value);
  });

  const sourceCounts = valid.reduce((counts, lead) => {
    counts[lead.source] = (counts[lead.source] || 0) + 1;
    return counts;
  }, {});
  return {
    valid,
    invalid: invalidRows,
    summary: {
      received: input.rows.length,
      valid: valid.length,
      invalid: invalidRows.length,
      withEmail: valid.filter((lead) => lead.email).length,
      withPhone: valid.filter((lead) => lead.phone).length,
      sourceCounts,
      consentRequired: true,
    },
  };
}

function uniqueStrings(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 40).toLowerCase()))]
    .filter((value) => allowed.includes(value));
}

function nonNegativeCount(value) {
  return Math.max(0, Math.floor(finiteNumber(value, 0)));
}

export function planSocialExperiment(input = {}) {
  const contentId = text(input.contentId || input.contentType || "next-post", 100) || "next-post";
  const objective = ["release", "sales", "community", "evergreen"].includes(input.objective)
    ? input.objective
    : "evergreen";
  const platforms = uniqueStrings(input.platforms, SOCIAL_PLATFORMS);
  const channels = uniqueStrings(input.channels, ["native_social", "consented_direct", "authorized_ads"]);
  const selectedPlatforms = platforms.length ? platforms : ["instagram", "facebook", "tiktok", "youtube"];
  const selectedChannels = channels.length ? channels : ["native_social", "consented_direct", "authorized_ads"];
  const holdoutPercent = Math.min(50, Math.max(0, finiteNumber(input.holdoutPercent, 10)));
  const counts = {
    followers: nonNegativeCount(input.candidateCounts?.followers ?? 0),
    adLeads: nonNegativeCount(input.candidateCounts?.adLeads ?? 0),
    optedInFans: nonNegativeCount(input.candidateCounts?.optedInFans ?? 0),
  };
  const eligibleDirect = counts.adLeads + counts.optedInFans;
  const estimatedHoldout = Math.floor((eligibleDirect * holdoutPercent) / 100);
  const id = `exp_${hash(`${contentId}:${objective}:${selectedPlatforms.join(",")}`).slice(0, 12)}`;

  const steps = [
    {
      id: "resolve",
      order: 1,
      channel: "FanMesh",
      action: "Resolve authorized leads and fan opt-ins into one deduplicated audience; keep platform-only followers as an estimated reach signal.",
      audience: "consented identities",
    },
    ...(selectedChannels.includes("native_social") ? [{
      id: "publish",
      order: 2,
      channel: selectedPlatforms.join(" + "),
      action: `Publish ${contentId} natively with platform-specific creative and a tracked destination.`,
      audience: "all authorized creator accounts",
    }] : []),
    ...(selectedChannels.includes("consented_direct") ? [{
      id: "direct",
      order: 3,
      channel: "email / SMS / owned community",
      action: "Send one useful, preference-aware message only to people with active direct-channel consent.",
      audience: "opted-in identities",
    }] : []),
    ...(selectedChannels.includes("authorized_ads") ? [{
      id: "retarget",
      order: 4,
      channel: "authorized ad audiences",
      action: "Build a retargeting audience from first-party or official lead data, then measure delivery and conversion in the ad platform.",
      audience: "authorized ad leads",
    }] : []),
    {
      id: "measure",
      order: 5,
      channel: "measurement",
      action: `Compare exposed and ${holdoutPercent}% holdout cohorts using reach, clicks, saves, and conversions—not likes alone.`,
      audience: "experiment cohorts",
    },
  ];

  return {
    id,
    contentId,
    objective,
    platforms: selectedPlatforms,
    channels: selectedChannels,
    audience: {
      counts,
      eligibleDirect,
      estimatedHoldout,
      holdoutPercent,
      note: "Follower counts are platform-gated estimates. FanMesh can improve eligible, consented reach; it cannot guarantee that every follower is served a feed post.",
    },
    steps,
    guardrails: [
      "Use official APIs, webhooks, and user-provided exports only.",
      "Never collect passwords, scrape private follower lists, or automate likes, comments, follows, or streams.",
      "Respect platform frequency caps, opt-outs, ad policies, and deletion requests.",
    ],
    status: "draft",
  };
}
