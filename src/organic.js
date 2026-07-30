import { createHash } from "node:crypto";
import { prepareFanActivation } from "./activation.js";

const ORGANIC_PLATFORMS = Object.freeze(["instagram", "tiktok"]);

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
  return [
    "Publish a native TikTok follow-up or Story that points people back to the original post.",
    "Reply to genuine comments with useful context or a creator-made response video.",
    directAction,
  ];
}

function normalizedPost(input, now) {
  const followers = count(input.followers);
  const currentReach = count(input.currentReach);
  const benchmark = count(input.benchmark);
  const interactions = count(input.interactions);
  const engagementRate = currentReach ? rate((interactions / currentReach) * 100) : 0;
  const ageDays = ageInDays(input.publishedAt, now);
  const score = scorePost({ currentReach, followers, benchmark, engagementRate, ageDays });
  const coverageRate = followers ? rate((currentReach / followers) * 100) : 0;
  const gapToBenchmark = Math.max(0, benchmark - currentReach);
  const reasons = [];
  if (benchmark && currentReach < benchmark) reasons.push(`${gapToBenchmark.toLocaleString("en-US")} below the recent ${input.benchmarkLabel}`);
  if (followers) reasons.push(`${coverageRate.toFixed(2)}% observed follower coverage`);
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

export function buildOrganicQueue(connectionStatuses = {}, options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
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
        views: post.views,
        currentReach: post.views,
        reachMetric: "views",
        interactions: count(post.likes) + count(post.comments) + count(post.shares),
        benchmark,
        benchmarkLabel: "median views",
      }, now));
    }
  }

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
    methodology: "Opportunity is explainable: 40% recent-benchmark gap, 30% observed follower-coverage gap, 20% recency, and 10% real engagement evidence. It predicts where a careful follow-up may help; it does not predict or guarantee feed delivery.",
  };
}

export function prepareOrganicPulse(post, input = {}, eligibility = {}, options = {}) {
  if (!post || !ORGANIC_PLATFORMS.includes(post.platform) || !post.key || !post.url) {
    throw new TypeError("Choose a recent post from an authorized Instagram or TikTok connection");
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
