import { createHash } from "node:crypto";

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "spotify"];
export const LEAD_SOURCES = ["meta_ads", "facebook_export", "instagram_export", "tiktok_ads", "google_ads", "youtube_export", "csv"];

const PLATFORM_CAPABILITIES = {
  meta: {
    label: "Meta",
    authMethod: "oauth",
    capabilities: ["facebook_pages", "instagram_insights", "meta_ad_accounts", "lead_access"],
    caveat: "Facebook Pages, Instagram professional accounts and ad assets remain limited to the scopes Meta approves.",
  },
  tiktok: {
    label: "TikTok",
    authMethod: "oauth",
    capabilities: ["creator_profile", "follower_totals", "video_metadata"],
    caveat: "Creator OAuth and TikTok for Business advertising access are separate authorizations.",
  },
  snapchat: {
    label: "Snapchat",
    authMethod: "oauth",
    capabilities: ["organizations", "ad_accounts", "campaign_reporting"],
    caveat: "Public Profile insights require Snapchat allowlisting in addition to Marketing API authorization.",
  },
  x: {
    label: "X",
    authMethod: "oauth",
    capabilities: ["creator_profile", "public_metrics", "post_metadata"],
    caveat: "X Ads requires separate approval and OAuth 1.0a even after the organic account is connected.",
  },
  threads: {
    label: "Threads",
    authMethod: "oauth",
    capabilities: ["creator_profile", "content_metadata", "creator_insights"],
    caveat: "Threads is a separate developer product and authorization flow from Facebook and Instagram.",
  },
};

const IMPORT_CAPABILITIES = {
  meta_ads: { label: "Meta Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  facebook_export: { label: "Facebook data export", authMethod: "official_export", capabilities: ["authorized_export", "identity_signal"] },
  instagram_export: { label: "Instagram data export", authMethod: "official_export", capabilities: ["authorized_export", "identity_signal"] },
  tiktok_ads: { label: "TikTok Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  google_ads: { label: "Google Ads leads", authMethod: "official_export_or_api", capabilities: ["lead_import", "ad_attribution"] },
  youtube_export: { label: "YouTube data export", authMethod: "official_export", capabilities: ["authorized_export", "identity_signal"] },
  csv: { label: "Consent export (CSV)", authMethod: "file_upload", capabilities: ["lead_import"] },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMPORT_ROWS = 1000;

function text(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function bool(value) {
  return value === true || value === 1 || value === "1" || (typeof value === "string" && value.trim().toLowerCase() === "true");
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

function normalizeSource(value) {
  return text(value, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function consentChannels(value, { email, phone }) {
  const supplied = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[|,;]/) : [];
  const channels = [...new Set(supplied.map((item) => text(item, 20).toLowerCase()).filter((item) => ["email", "sms"].includes(item)))];
  if (!channels.length && email && !phone) return ["email"];
  if (!channels.length && phone && !email) return ["sms"];
  return channels;
}

function invalid(index, reason) {
  return { row: index + 1, reason };
}

export function getConnectionCatalog(statuses = {}, configuredProviders = []) {
  const baseProviders = configuredProviders.length
    ? configuredProviders
    : Object.entries(PLATFORM_CAPABILITIES).map(([platform, details]) => ({ platform, ...details, configured: false }));
  const social = baseProviders.map((details) => {
    const connection = statuses[details.platform];
    const state = typeof connection === "string" ? { status: connection } : connection || {};
    return {
      ...details,
      status: state.status || details.status || "not_connected",
      account: state.account || details.account || null,
      tokenPolicy: details.tokenPolicy || "Access and refresh tokens are encrypted before storage and never returned to the browser.",
    };
  });
  const imports = Object.entries(IMPORT_CAPABILITIES).map(([platform, details]) => ({
    platform,
    ...details,
    status: statuses[platform] || "ready_for_authorized_import",
    tokenPolicy: "Use an official export or API. Do not upload purchased, scraped, or unconsented lists.",
  }));
  return { social, imports };
}

export function normalizeLead(row = {}, index = 0, defaults = {}) {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone);
  const name = text(row.name || row.fullName || row.displayName, 120);
  const location = text(row.location, 160);
  const source = normalizeSource(row.source || row.sourcePlatform || defaults.source || "csv");
  const sourceId = text(row.sourceId || row.leadId || row.id, 160);
  const consent = bool(row.consent || row.marketingConsent || row.optedIn);
  const consentAt = text(row.consentAt || row.consent_at, 50);
  const consentSource = text(row.consentSource || row.consent_source || source, 80);
  const channels = consentChannels(row.consentChannels || row.consentChannel || row.channels, { email, phone });

  if (!email && !phone) return { error: invalid(index, "a valid email or phone is required") };
  if (row.email && !email) return { error: invalid(index, "email is not valid") };
  if (row.phone && !phone) return { error: invalid(index, "phone must use 7–15 digits, optionally prefixed with +") };
  if (!LEAD_SOURCES.includes(source)) return { error: invalid(index, `source must be one of: ${LEAD_SOURCES.join(", ")}`) };
  if (!consent) return { error: invalid(index, "explicit marketing consent is required") };
  if (!consentAt || Number.isNaN(Date.parse(consentAt))) {
    return { error: invalid(index, "consentAt must be a valid timestamp") };
  }
  if (!consentSource) return { error: invalid(index, "consentSource is required for provenance") };
  if (!channels.length) return { error: invalid(index, "consentChannels is required when a record contains both email and phone") };
  if (channels.includes("email") && !email) return { error: invalid(index, "email consent requires a valid email") };
  if (channels.includes("sms") && !phone) return { error: invalid(index, "SMS consent requires a valid phone") };

  const contactKey = hash([email, phone].filter(Boolean).join("|"));
  return {
    value: {
      contactKey,
      sourceKey: hash(`${source || "unknown"}:${sourceId || contactKey}`),
      name,
      location: location || undefined,
      email: email || undefined,
      phone: phone || undefined,
      source: source || "unknown",
      sourceId: sourceId || undefined,
      consent: { granted: true, at: new Date(consentAt).toISOString(), source: consentSource, channels },
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

  const source = normalizeSource(input.source || "csv");
  if (!LEAD_SOURCES.includes(source)) throw new TypeError(`source must be one of: ${LEAD_SOURCES.join(", ")}`);

  const valid = [];
  const invalidRows = [];
  const seen = new Set();
  let duplicates = 0;
  input.rows.forEach((row, index) => {
    const result = normalizeLead(row, index, { source });
    if (result.error) {
      invalidRows.push(result.error);
      return;
    }
    if (seen.has(result.value.contactKey)) {
      invalidRows.push(invalid(index, "duplicate contact in this import"));
      duplicates += 1;
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
    source,
    valid,
    invalid: invalidRows,
    summary: {
      received: input.rows.length,
      valid: valid.length,
      invalid: invalidRows.length,
      duplicates,
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
