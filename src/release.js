import { createHash } from "node:crypto";

const RELEASE_OBJECTIVES = Object.freeze(["discovery", "engagement", "streams", "sales"]);
const RELEASE_PLATFORMS = Object.freeze(["instagram", "tiktok", "youtube", "x", "threads"]);
const DIRECT_CHANNELS = Object.freeze(["email", "sms"]);
const PLATFORM_OFFSETS = Object.freeze({ instagram: 0, x: 10, threads: 20, tiktok: 30, youtube: 45 });

function validationError(message, statusCode = 400) {
  const error = new TypeError(message);
  error.statusCode = statusCode;
  return error;
}

function shortText(value, maxLength = 180) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function wholeNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function boundedPercent(value, maximum = 25) {
  return Math.min(maximum, Math.max(0, Math.round((Number(value) || 0) * 100) / 100));
}

function rounded(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function uniqueAllowed(values, allowed) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => shortText(value, 40).toLowerCase()))]
    .filter((value) => allowed.includes(value));
}

function releaseDate(value, now) {
  const parsed = Date.parse(value || "");
  const current = Date.parse(now);
  if (!Number.isFinite(parsed)) throw validationError("Choose a valid release date and time");
  if (parsed < current - (5 * 60 * 1000)) throw validationError("Release time cannot be in the past");
  if (parsed > current + (180 * 86400000)) throw validationError("Release time must be within the next 180 days");
  return new Date(parsed).toISOString();
}

function scheduledAt(releaseAt, offsetMinutes) {
  return new Date(Date.parse(releaseAt) + (offsetMinutes * 60000)).toISOString();
}

function platformGuidance(platform, objective, hasExistingPost) {
  const guidance = {
    instagram: {
      format: "Native Reel or carousel with a clean, unwatermarked master",
      hook: "Make the first frame understandable without sound and give one clear reason to save, reply, or watch.",
      followUp: "Share the published post to Story and answer genuine comments from the creator account.",
    },
    tiktok: {
      format: "Native vertical video with a TikTok-specific opening line",
      hook: "Test a faster first two seconds and on-screen context; keep the idea, not another platform's packaging.",
      followUp: "Use a creator-made reply video only when a real comment creates a useful follow-up.",
    },
    youtube: {
      format: "Native Short, Community post, or full upload chosen for the source asset",
      hook: "State the payoff early and make title/thumbnail promises match what the viewer receives.",
      followUp: "Use a pinned comment or Community follow-up to add context, not to manufacture engagement.",
    },
    x: {
      format: "Native video or media post with concise new context",
      hook: "Lead with the strongest claim or question; do not paste a caption written for another feed.",
      followUp: "Quote the original with genuinely new context after the first measurement window.",
    },
    threads: {
      format: "Native media post or conversation starter",
      hook: "Use a strong first line that stands alone, then add the content link or media naturally.",
      followUp: "Continue useful replies from the creator account without automated mentions or DMs.",
    },
  }[platform];
  return {
    ...guidance,
    objective,
    sourceState: hasExistingPost ? "existing_version" : "native_adaptation_needed",
  };
}

function primaryMetric(objective) {
  if (objective === "engagement") return "real interaction rate";
  if (objective === "streams") return "tracked destination clicks";
  if (objective === "sales") return "tracked conversions";
  return "reach versus each platform's own recent benchmark";
}

function planId(meshId, releaseAt, createdAt) {
  const digest = createHash("sha256").update(`${meshId}:${releaseAt}:${createdAt}`).digest("hex").slice(0, 16);
  return `release_${digest}`;
}

function baselineFor(meshItem, platform) {
  const post = (meshItem.posts || []).find((item) => item.platform === platform);
  if (!post) return null;
  return {
    postKey: post.key,
    postId: post.postId,
    url: post.url,
    capturedAt: null,
    reachMetric: post.reachMetric,
    currentReach: wholeNumber(post.currentReach),
    benchmark: wholeNumber(post.benchmark),
    performanceIndex: post.performanceIndex === null || post.performanceIndex === undefined
      ? null
      : rounded(post.performanceIndex),
    interactions: wholeNumber(post.interactions),
  };
}

function publicEligibility(eligibility = {}, channels = [], holdoutPercent = 10) {
  const channelCounts = Object.fromEntries(DIRECT_CHANNELS.map((channel) => [channel, wholeNumber(eligibility.channels?.[channel])]));
  const directConnections = wholeNumber(eligibility.directConnections);
  const eligibleDirect = channels.length === 1
    ? channelCounts[channels[0]]
    : channels.length > 1 ? directConnections : 0;
  const heldOut = Math.floor(eligibleDirect * (holdoutPercent / 100));
  return {
    identifiedFans: wholeNumber(eligibility.identifiedFans),
    directConnections,
    platformOnly: wholeNumber(eligibility.platformOnly),
    channelCounts,
    selectedChannels: channels,
    eligibleDirect,
    heldOut,
    activationCohort: Math.max(0, eligibleDirect - heldOut),
  };
}

export function buildReleasePlan(meshItem, input = {}, eligibility = {}, options = {}) {
  if (!meshItem?.id || !Array.isArray(meshItem.posts) || !meshItem.posts.length) {
    throw validationError("Choose a content idea from the current authorized Content Mesh", 404);
  }
  if (input.confirmedOwnedContent !== true) {
    throw validationError("Confirm that you control the content used in this release plan");
  }
  const now = new Date(options.now || Date.now()).toISOString();
  const releaseAt = releaseDate(input.releaseAt, now);
  const objective = RELEASE_OBJECTIVES.includes(input.objective) ? input.objective : "discovery";
  const availablePlatforms = uniqueAllowed(
    [...(meshItem.platforms || []), ...(meshItem.missingPlatforms || [])],
    RELEASE_PLATFORMS,
  );
  const requestedPlatforms = uniqueAllowed(input.platforms, RELEASE_PLATFORMS);
  const platforms = (requestedPlatforms.length ? requestedPlatforms : availablePlatforms)
    .filter((platform) => availablePlatforms.includes(platform));
  if (!platforms.length) throw validationError("Select at least one connected creator platform");
  const channels = uniqueAllowed(input.channels, DIRECT_CHANNELS);
  const holdoutPercent = boundedPercent(input.holdoutPercent ?? 10);
  const audience = publicEligibility(eligibility, channels, holdoutPercent);
  const createdAt = now;
  const id = planId(meshItem.id, releaseAt, createdAt);
  const platformPlan = platforms.map((platform) => {
    const baseline = baselineFor(meshItem, platform);
    return {
      platform,
      publishAt: scheduledAt(releaseAt, PLATFORM_OFFSETS[platform] || 0),
      offsetMinutes: PLATFORM_OFFSETS[platform] || 0,
      baseline: baseline ? { ...baseline, capturedAt: createdAt } : null,
      guidance: platformGuidance(platform, objective, Boolean(baseline)),
    };
  });
  const schedule = [
    {
      id: "asset_lock",
      offsetMinutes: -1440,
      scheduledAt: scheduledAt(releaseAt, -1440),
      owner: "creator",
      action: "Lock the native asset, opening hook, destination, and measurement links for every selected platform.",
    },
    ...platformPlan.map((item) => ({
      id: `publish_${item.platform}`,
      offsetMinutes: item.offsetMinutes,
      scheduledAt: item.publishAt,
      owner: "creator",
      action: `Publish the ${item.platform} version natively; the stagger is for readable attribution, not a feed-ranking promise.`,
    })),
    ...(channels.length ? [{
      id: "direct_alert",
      offsetMinutes: 60,
      scheduledAt: scheduledAt(releaseAt, 60),
      owner: "fanmesh",
      action: `Prepare one consented ${channels.join(" + ")} alert for ${audience.activationCohort} fans after the public destination is verified. Sending remains a separate confirmed action.`,
    }] : []),
    {
      id: "checkpoint_24h",
      offsetMinutes: 1440,
      scheduledAt: scheduledAt(releaseAt, 1440),
      owner: "creator",
      action: "Record the 24-hour platform totals before changing the creative or adding paid distribution.",
    },
    {
      id: "checkpoint_72h",
      offsetMinutes: 4320,
      scheduledAt: scheduledAt(releaseAt, 4320),
      owner: "creator",
      action: "Record the 72-hour totals, separate any paid delivery, and keep the strongest native lesson.",
    },
  ].sort((first, second) => first.offsetMinutes - second.offsetMinutes);
  return {
    id,
    kind: "release_plan_v1",
    contentId: meshItem.id,
    title: shortText(input.title, 120) || meshItem.title,
    objective,
    status: "draft",
    createdAt,
    releaseAt,
    primaryMetric: primaryMetric(objective),
    sourceOpportunity: {
      score: wholeNumber(meshItem.opportunityScore),
      status: meshItem.status,
      evidence: shortText(meshItem.matchEvidence, 300),
    },
    platforms: platformPlan,
    audience: { ...audience, holdoutPercent },
    schedule,
    checkpoints: [],
    learning: {
      state: "awaiting_24h",
      strongestPlatform: null,
      weakestPlatform: null,
      nextAction: "Publish the native versions, preserve the organic baseline, and record the first checkpoint after 24 hours.",
    },
    guardrails: [
      "FanMesh does not guarantee feed placement, views, or engagement.",
      "Every platform version must be published through the creator's authorized account or native app.",
      "No automated likes, comments, mentions, follows, direct messages, or follower scraping are used.",
      "Email and SMS are limited to active channel consent and remain unsent until a separate launch confirmation.",
      "Paid delivery must be recorded separately from the organic 24-hour and 72-hour checkpoints.",
      "Platform comparisons use each platform's own benchmark rather than raw cross-platform view totals.",
    ],
  };
}

function checkpointName(value) {
  const normalized = shortText(value, 20).toLowerCase().replace(/[^0-9a-z]/g, "");
  if (["24", "24h", "hour24"].includes(normalized)) return "24h";
  if (["72", "72h", "hour72"].includes(normalized)) return "72h";
  throw validationError("Checkpoint must be 24h or 72h");
}

function timingFor(plan, checkpoint, capturedAt) {
  const targetHours = checkpoint === "24h" ? 24 : 72;
  const elapsedHours = (Date.parse(capturedAt) - Date.parse(plan.releaseAt)) / 3600000;
  return {
    targetHours,
    elapsedHours: rounded(elapsedHours),
    state: elapsedHours < targetHours - 4 ? "early" : elapsedHours > targetHours + 18 ? "late" : "on_time",
  };
}

function metricFor(plan, input, platform) {
  const platformPlan = plan.platforms.find((item) => item.platform === platform);
  if (!platformPlan) throw validationError(`${platform} is not part of this release plan`);
  const currentReach = wholeNumber(input.currentReach);
  const interactions = wholeNumber(input.interactions);
  const linkClicks = wholeNumber(input.linkClicks);
  const conversions = wholeNumber(input.conversions);
  const baseline = wholeNumber(platformPlan.baseline?.currentReach);
  const benchmark = wholeNumber(platformPlan.baseline?.benchmark);
  const deltaFromBaseline = currentReach - baseline;
  const performanceIndex = benchmark ? rounded((currentReach / benchmark) * 100) : null;
  const baselineLiftPercent = baseline ? rounded((deltaFromBaseline / baseline) * 100) : null;
  let result = "building_baseline";
  if (platformPlan.baseline && currentReach < baseline) result = "lower_reported_total";
  else if (performanceIndex !== null && performanceIndex >= 100) result = "above_recent_benchmark";
  else if (deltaFromBaseline > 0) result = "recovering";
  else if (platformPlan.baseline) result = "flat";
  return {
    platform,
    reachMetric: shortText(input.reachMetric, 40) || platformPlan.baseline?.reachMetric || "views",
    currentReach,
    interactions,
    linkClicks,
    conversions,
    baselineReach: baseline,
    benchmark,
    deltaFromBaseline,
    baselineLiftPercent,
    performanceIndex,
    interactionRate: currentReach ? rounded((interactions / currentReach) * 100) : 0,
    result,
    paidIncluded: false,
  };
}

function learningFrom(checkpoints) {
  const latest = checkpoints.at(-1);
  const comparable = (latest?.metrics || []).filter((item) => item.performanceIndex !== null)
    .sort((first, second) => second.performanceIndex - first.performanceIndex);
  const strongest = comparable[0] || null;
  const weakest = comparable.at(-1) || null;
  let nextAction = "Keep collecting same-platform organic baselines before changing the release playbook.";
  if (strongest && weakest && strongest.platform !== weakest.platform) {
    nextAction = `${strongest.platform} is strongest versus its own benchmark. Rework the ${weakest.platform} hook and packaging natively; do not copy raw view totals or automate engagement.`;
  } else if (strongest?.performanceIndex >= 100) {
    nextAction = `${strongest.platform} cleared its recent benchmark. Preserve the native hook and format as a reusable playbook hypothesis.`;
  }
  return {
    state: latest?.checkpoint === "72h" ? "complete" : "awaiting_72h",
    strongestPlatform: strongest ? { platform: strongest.platform, performanceIndex: strongest.performanceIndex } : null,
    weakestPlatform: weakest ? { platform: weakest.platform, performanceIndex: weakest.performanceIndex } : null,
    nextAction,
  };
}

export function applyReleaseCheckpoint(plan, input = {}, options = {}) {
  if (plan?.kind !== "release_plan_v1" || !Array.isArray(plan.platforms)) {
    throw validationError("Release plan was not found", 404);
  }
  if (input.confirmedOrganicOnly !== true) {
    throw validationError("Confirm that these checkpoint totals exclude paid delivery");
  }
  const checkpoint = checkpointName(input.checkpoint);
  const capturedAt = new Date(options.now || Date.now()).toISOString();
  const rawMetrics = Array.isArray(input.metrics) ? input.metrics : [];
  const selected = rawMetrics.filter((item) => item && plan.platforms.some((platform) => platform.platform === item.platform));
  if (!selected.length) throw validationError("Add at least one platform result for this checkpoint");
  const metrics = [...new Map(selected.map((item) => [item.platform, item])).values()]
    .map((item) => metricFor(plan, item, item.platform));
  const result = {
    checkpoint,
    capturedAt,
    timing: timingFor(plan, checkpoint, capturedAt),
    metrics,
    notes: shortText(input.notes, 500),
  };
  const checkpoints = [...(plan.checkpoints || []).filter((item) => item.checkpoint !== checkpoint), result]
    .sort((first, second) => (first.checkpoint === "24h" ? 24 : 72) - (second.checkpoint === "24h" ? 24 : 72));
  return {
    ...plan,
    status: checkpoints.some((item) => item.checkpoint === "72h") ? "completed" : "active",
    updatedAt: capturedAt,
    checkpoints,
    learning: learningFrom(checkpoints),
  };
}

export function publicReleasePlan(plan = {}) {
  return {
    ...plan,
    audience: {
      ...(plan.audience || {}),
      contactFieldsReturned: false,
    },
  };
}

export const releaseConstants = Object.freeze({
  objectives: RELEASE_OBJECTIVES,
  platforms: RELEASE_PLATFORMS,
  checkpoints: ["24h", "72h"],
});
