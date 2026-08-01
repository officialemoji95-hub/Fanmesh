import { createHash } from "node:crypto";
import { prepareFanActivation } from "./activation.js";

const ORGANIC_PLATFORMS = Object.freeze(["instagram", "tiktok", "youtube", "x", "threads"]);
const CONTENT_MATCH_WINDOW_DAYS = 21;
const CONTENT_MATCH_THRESHOLD = 0.58;
const CONTENT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "from", "have", "into", "just",
  "more", "much", "only", "over", "that", "their", "them", "then", "there", "these",
  "they", "this", "those", "very", "want", "what", "when", "where", "which", "with",
  "your", "https", "http", "www", "com",
]);

function text(value, maxLength = 180) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function rate(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function keyFor(platform, postId) {
  const digest = createHash("sha256").update(`${platform}:${postId}`).digest("hex").slice(0, 16);
  return `post_${digest}`;
}

function ageInDays(value, now) {
  const published = Date.parse(value || "");
  const current = Date.parse(now);
  if (!Number.isFinite(published) || !Number.isFinite(current)) return null;
  return Math.max(0, Math.floor((current - published) / 86400000));
}

function priorityFor(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "monitor";
}

function recoveryWindow(ageDays) {
  if (ageDays === null) return "Evergreen follow-up";
  if (ageDays <= 1) return "First 24 hours";
  if (ageDays <= 3) return "48-hour follow-up";
  if (ageDays <= 7) return "This week";
  return "Evergreen retry";
}

function scorePost({ currentReach, followers, benchmark, engagementRate, ageDays }) {
  const underBenchmark = benchmark > 0 ? clamp((benchmark - currentReach) / benchmark) : 0;
  const audienceGap = followers > 0 ? clamp(1 - (currentReach / followers)) : 0;
  const recency = ageDays === null ? 0.25 : clamp(1 - (ageDays / 30));
  const engagementEvidence = clamp(engagementRate / 10);
  const components = {
    underBenchmark: Math.round(underBenchmark * 40),
    audienceGap: Math.round(audienceGap * 30),
    recency: Math.round(recency * 20),
    engagementEvidence: Math.round(engagementEvidence * 10),
  };
  return {
    score: Object.values(components).reduce((sum, value) => sum + value, 0),
    components,
  };
}

function actionsFor(platform, reachableNow) {
  const directAction = reachableNow > 0
    ? `Alert up to ${reachableNow} opted-in fans once an approved email or SMS provider is connected.`
    : "Use the tracked FanMesh link to invite followers into a direct, voluntary fan relationship.";
  if (platform === "instagram") {
    return [
      "Share the original post to your Instagram Story with one clear reason to watch, save, or reply.",
      "Reply to genuine comments and questions from the creator account; do not automate engagement.",
      directAction,
    ];
  }
  if (platform === "tiktok") return [
      "Publish a native TikTok follow-up or Story that points people back to the original post.",
      "Reply to genuine comments with useful context or a creator-made response video.",
      directAction,
    ];
  if (platform === "youtube") return [
      "Create a native Short, Community post, or pinned comment that gives viewers a fresh reason to watch the original upload.",
      "Strengthen the title, thumbnail, and opening seconds only when the authorized retention and click signals support the change.",
      directAction,
    ];
  if (platform === "x") return [
      "Quote the original post from the creator account with new context instead of repeating the same copy.",
      "Reply genuinely where followers have already asked relevant questions; do not automate mentions or engagement.",
      directAction,
    ];
  return [
    "Publish a native Threads follow-up with a stronger first line and a clear link back to the original post.",
    "Continue the conversation through genuine replies from the creator account; do not automate engagement.",
    directAction,
  ];
}

function normalizedPost(input, now) {
  const followers = count(input.followers);
  const followersAvailable = input.followersAvailable !== false;
  const currentReach = count(input.currentReach);
  const benchmark = count(input.benchmark);
  const interactions = count(input.interactions);
  const engagementRate = currentReach ? rate((interactions / currentReach) * 100) : 0;
  const ageDays = ageInDays(input.publishedAt, now);
  const score = scorePost({ currentReach, followers, benchmark, engagementRate, ageDays });
  const coverageRate = followersAvailable && followers ? rate((currentReach / followers) * 100) : null;
  const gapToBenchmark = Math.max(0, benchmark - currentReach);
  const reasons = [];
  if (benchmark && currentReach < benchmark) reasons.push(`${gapToBenchmark.toLocaleString("en-US")} below the recent ${input.benchmarkLabel}`);
  if (followersAvailable && followers) reasons.push(`${coverageRate.toFixed(2)}% observed follower coverage`);
  else if (!followersAvailable) reasons.push("follower count is not supplied by this API");
  if (ageDays !== null && ageDays <= 7) reasons.push("still inside a useful organic follow-up window");
  if (!reasons.length) reasons.push("keep measuring before adding paid distribution");
  return {
    key: keyFor(input.platform, input.postId),
    platform: input.platform,
    postId: text(input.postId, 80),
    account: text(input.account, 120),
    title: text(input.title, 180) || "Untitled post",
    url: text(input.url, 1000),
    publishedAt: input.publishedAt || null,
    ageDays,
    followers,
    followersAvailable,
    views: count(input.views),
    currentReach,
    reachMetric: input.reachMetric,
    interactions,
    engagementRate,
    followerCoverageRate: coverageRate,
    benchmark,
    benchmarkLabel: input.benchmarkLabel,
    gapToBenchmark,
    opportunityScore: score.score,
    scoreComponents: score.components,
    priority: priorityFor(score.score),
    recoveryWindow: recoveryWindow(ageDays),
    reasons,
  };
}

function collectOrganicPosts(connectionStatuses, now) {
  const posts = [];
  const meta = connectionStatuses.meta;
  if (meta?.status === "connected" && meta.account) {
    const benchmark = count(meta.account.medianMetaReach || meta.account.averageMetaReach);
    for (const account of meta.account.instagramAccounts || []) {
      for (const post of account.recentMedia || []) {
        if (!post.id || !post.permalink) continue;
        const reach = count(post.reach || post.views);
        posts.push(normalizedPost({
          platform: "instagram",
          postId: post.id,
          account: account.username || account.name || meta.account.name,
          title: post.caption,
          url: post.permalink,
          publishedAt: post.createdAt,
          followers: account.followers,
          followersAvailable: true,
          views: post.views,
          currentReach: reach,
          reachMetric: post.reach ? "reach" : "views",
          interactions: post.totalInteractions || post.interactions,
          benchmark,
          benchmarkLabel: "median reach",
        }, now));
      }
    }
  }

  const tiktok = connectionStatuses.tiktok;
  if (tiktok?.status === "connected" && tiktok.account) {
    const benchmark = count(tiktok.account.medianViews || tiktok.account.averageViews);
    for (const post of tiktok.account.recentVideos || []) {
      if (!post.id || !post.shareUrl) continue;
      posts.push(normalizedPost({
        platform: "tiktok",
        postId: post.id,
        account: tiktok.account.username || tiktok.account.name,
        title: post.title || post.description,
        url: post.shareUrl,
        publishedAt: post.createdAt,
        followers: tiktok.account.followers,
        followersAvailable: true,
        views: post.views,
        currentReach: post.views,
        reachMetric: "views",
        interactions: count(post.likes) + count(post.comments) + count(post.shares),
        benchmark,
        benchmarkLabel: "median views",
      }, now));
    }
  }

  const youtube = connectionStatuses.youtube;
  if (youtube?.status === "connected" && youtube.account) {
    const benchmark = count(youtube.account.medianViews || youtube.account.averageViews);
    for (const post of youtube.account.recentVideos || []) {
      if (!post.id || !post.shareUrl) continue;
      posts.push(normalizedPost({
        platform: "youtube",
        postId: post.id,
        account: youtube.account.username || youtube.account.name,
        title: post.title || post.description,
        url: post.shareUrl,
        publishedAt: post.createdAt,
        followers: youtube.account.followers,
        followersAvailable: !youtube.account.hiddenSubscribers,
        views: post.views,
        currentReach: post.views,
        reachMetric: "views",
        interactions: count(post.likes) + count(post.comments) + count(post.shares),
        benchmark,
        benchmarkLabel: "recent-video median",
      }, now));
    }
  }

  for (const platform of ["x", "threads"]) {
    const source = connectionStatuses[platform];
    if (source?.status !== "connected" || !source.account) continue;
    const benchmark = count(source.account.averageViews);
    for (const post of source.account.recentPosts || []) {
      if (!post.id || !post.permalink) continue;
      posts.push(normalizedPost({
        platform,
        postId: post.id,
        account: source.account.username || source.account.name,
        title: post.text,
        url: post.permalink,
        publishedAt: post.createdAt,
        followers: source.account.followers,
        followersAvailable: platform !== "threads",
        views: post.impressions,
        currentReach: post.impressions,
        reachMetric: platform === "threads" ? "views" : "impressions",
        interactions: count(post.likes) + count(post.replies) + count(post.reposts) + count(post.quotes) + count(post.shares),
        benchmark,
        benchmarkLabel: platform === "threads" ? "recent average views" : "recent average impressions",
      }, now));
    }
  }
  return posts;
}

export function buildOrganicQueue(connectionStatuses = {}, options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
  const posts = collectOrganicPosts(connectionStatuses, now);

  posts.sort((first, second) => second.opportunityScore - first.opportunityScore
    || (Date.parse(second.publishedAt || "") || 0) - (Date.parse(first.publishedAt || "") || 0));
  return {
    generatedAt: now,
    posts: posts.slice(0, 20),
    summary: {
      postsAnalyzed: posts.length,
      highPriority: posts.filter((post) => post.priority === "high").length,
      platforms: [...new Set(posts.map((post) => post.platform))],
    },
    methodology: "Opportunity is explainable: 40% recent-benchmark gap, 30% observed follower-coverage gap when the API supplies followers, 20% recency, and 10% real engagement evidence. Paid results are excluded. It predicts where a careful follow-up may help; it does not predict or guarantee feed delivery.",
  };
}

function contentTokens(value) {
  return [...new Set(text(value, 500)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !CONTENT_STOP_WORDS.has(token)))];
}

function contentSimilarity(first, second) {
  const firstTokens = contentTokens(first.title);
  const secondTokens = contentTokens(second.title);
  if (!firstTokens.length || !secondTokens.length) return 0;
  const secondSet = new Set(secondTokens);
  const shared = firstTokens.filter((token) => secondSet.has(token)).length;
  const exact = firstTokens.join(" ") === secondTokens.join(" ");
  if (exact && firstTokens.join("").length >= 8) return 1;
  if (shared < 2) return 0;
  const overlap = shared / Math.min(firstTokens.length, secondTokens.length);
  const union = new Set([...firstTokens, ...secondTokens]).size;
  return rate((overlap * 0.7) + ((shared / union) * 0.3));
}

function publicationGapDays(first, second) {
  const firstTime = Date.parse(first.publishedAt || "");
  const secondTime = Date.parse(second.publishedAt || "");
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(firstTime - secondTime) / 86400000;
}

function connectedOrganicPlatforms(connectionStatuses) {
  const connected = [];
  if (connectionStatuses.meta?.status === "connected" && connectionStatuses.meta.account?.instagramAccounts?.length) connected.push("instagram");
  for (const platform of ["tiktok", "youtube", "x", "threads"]) {
    if (connectionStatuses[platform]?.status === "connected") connected.push(platform);
  }
  return connected;
}

function contentGroup(group, connectedPlatforms) {
  const posts = group.map((post) => ({
    ...post,
    performanceIndex: post.benchmark ? rate((post.currentReach / post.benchmark) * 100) : null,
  })).sort((first, second) => (second.performanceIndex ?? -1) - (first.performanceIndex ?? -1));
  const comparable = posts.filter((post) => post.performanceIndex !== null);
  const strongest = comparable[0] || null;
  const weakest = comparable.at(-1) || null;
  const spread = strongest && weakest && strongest.key !== weakest.key
    ? rate(strongest.performanceIndex - weakest.performanceIndex)
    : 0;
  const platforms = [...new Set(posts.map((post) => post.platform))];
  const isCrossPlatform = platforms.length > 1;
  const hasPerformanceGap = isCrossPlatform && spread >= 35;
  const baseOpportunity = Math.max(...posts.map((post) => post.opportunityScore), 0);
  const opportunityScore = Math.min(100, Math.round(baseOpportunity + (hasPerformanceGap ? Math.min(10, spread / 10) : 0)));
  const missingPlatforms = connectedPlatforms.filter((platform) => !platforms.includes(platform));
  const representative = [...posts].sort((first, second) => contentTokens(second.title).length - contentTokens(first.title).length)[0];
  const recommendations = [];
  if (hasPerformanceGap) {
    recommendations.push(`Recover ${weakest.platform} first: it is at ${weakest.performanceIndex.toFixed(0)}% of its own recent benchmark versus ${strongest.platform} at ${strongest.performanceIndex.toFixed(0)}%.`);
  } else if (weakest?.benchmark && weakest.currentReach < weakest.benchmark) {
    recommendations.push(`Give the ${weakest.platform} version a native follow-up; it is below its own recent benchmark.`);
  } else {
    recommendations.push("Keep this content organic while FanMesh gathers a larger same-platform baseline.");
  }
  if (missingPlatforms.length) recommendations.push(`Adapt the idea natively for ${missingPlatforms.join(", ")}; do not simply repost a watermarked asset.`);
  recommendations.push("Measure again after 24 and 72 hours, and keep any later paid delivery in a separate comparison.");
  const digest = createHash("sha256").update(posts.map((post) => post.key).sort().join(":" )).digest("hex").slice(0, 14);
  return {
    id: `mesh_${digest}`,
    title: representative.title,
    platforms,
    missingPlatforms,
    posts,
    opportunityScore,
    priority: priorityFor(opportunityScore),
    status: hasPerformanceGap ? "recovery_gap" : isCrossPlatform ? "cross_platform" : "single_platform",
    strongestPlatform: strongest ? { platform: strongest.platform, performanceIndex: strongest.performanceIndex } : null,
    weakestPlatform: weakest ? { platform: weakest.platform, performanceIndex: weakest.performanceIndex } : null,
    performanceSpread: spread,
    recommendations,
    matchEvidence: isCrossPlatform
      ? `Matched ${platforms.length} platform versions by caption/title overlap within ${CONTENT_MATCH_WINDOW_DAYS} days.`
      : "No matching version was found among the currently synchronized platform posts.",
  };
}

export function buildContentMesh(connectionStatuses = {}, options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
  const posts = collectOrganicPosts(connectionStatuses, now)
    .sort((first, second) => (Date.parse(second.publishedAt || "") || 0) - (Date.parse(first.publishedAt || "") || 0));
  const groups = [];
  for (const post of posts) {
    let bestGroup = null;
    let bestSimilarity = 0;
    for (const group of groups) {
      if (group.some((candidate) => candidate.platform === post.platform)) continue;
      for (const candidate of group) {
        if (publicationGapDays(post, candidate) > CONTENT_MATCH_WINDOW_DAYS) continue;
        const similarity = contentSimilarity(post, candidate);
        if (similarity >= CONTENT_MATCH_THRESHOLD && similarity > bestSimilarity) {
          bestGroup = group;
          bestSimilarity = similarity;
        }
      }
    }
    if (bestGroup) bestGroup.push(post);
    else groups.push([post]);
  }
  const connectedPlatforms = connectedOrganicPlatforms(connectionStatuses);
  const content = groups.map((group) => contentGroup(group, connectedPlatforms))
    .sort((first, second) => second.opportunityScore - first.opportunityScore
      || Math.max(...second.posts.map((post) => Date.parse(post.publishedAt || "") || 0))
        - Math.max(...first.posts.map((post) => Date.parse(post.publishedAt || "") || 0)));
  return {
    generatedAt: now,
    content: content.slice(0, 30),
    summary: {
      postsAnalyzed: posts.length,
      contentGroups: content.length,
      crossPlatformGroups: content.filter((item) => item.platforms.length > 1).length,
      recoveryGaps: content.filter((item) => item.status === "recovery_gap").length,
      connectedPlatforms,
    },
    methodology: `FanMesh matches authorized organic posts by caption/title token overlap and a ${CONTENT_MATCH_WINDOW_DAYS}-day publication window. Performance is compared as a percentage of each platform's own recent benchmark, never by raw views across platforms. Paid delivery is excluded, and recommendations do not guarantee feed placement.`,
  };
}

export function prepareOrganicPulse(post, input = {}, eligibility = {}, options = {}) {
  if (!post || !ORGANIC_PLATFORMS.includes(post.platform) || !post.key || !post.url) {
    throw new TypeError("Choose a recent post from an authorized Instagram, TikTok, YouTube, X, or Threads connection");
  }
  const channels = Array.isArray(input.channels) && input.channels.length ? input.channels : ["email", "sms"];
  const plan = prepareFanActivation({
    title: input.title || post.title,
    contentUrl: post.url,
    objective: input.objective || "evergreen",
    message: input.message || `${post.title} is worth another look:`,
    channels,
    holdoutPercent: input.holdoutPercent ?? 10,
    confirmedOwnedContent: true,
  }, eligibility, options);
  return {
    ...plan,
    mode: "organic_pulse",
    sourcePost: {
      key: post.key,
      platform: post.platform,
      postId: post.postId,
      account: post.account,
      url: post.url,
      publishedAt: post.publishedAt,
    },
    organicBaseline: {
      capturedAt: new Date(options.now || Date.now()).toISOString(),
      reachMetric: post.reachMetric,
      currentReach: post.currentReach,
      views: post.views,
      interactions: post.interactions,
      engagementRate: post.engagementRate,
      followerCoverageRate: post.followerCoverageRate,
      benchmark: post.benchmark,
      benchmarkLabel: post.benchmarkLabel,
      paidIncluded: false,
      note: "This baseline is captured before any later ad spend is added to the FanMesh comparison.",
    },
    opportunity: {
      score: post.opportunityScore,
      priority: post.priority,
      recoveryWindow: post.recoveryWindow,
      reasons: post.reasons,
      components: post.scoreComponents,
    },
    nativeActions: actionsFor(post.platform, plan.audience.reachableNow),
    guardrails: [
      ...plan.guardrails,
      "Keep organic baseline metrics separate from paid reach and label the time ads begin.",
      "Use native creator actions and genuine replies only; never automate likes, follows, comments, or views.",
    ],
  };
}

export { ORGANIC_PLATFORMS };
