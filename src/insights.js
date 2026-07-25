import { audienceSnapshot } from "./demo-data.js";
import { scoreAudience } from "./scoring.js";

const percentage = (part, total) => total > 0 ? Math.round((part / total) * 10000) / 100 : 0;

export function buildInsights(fans, snapshot = audienceSnapshot) {
  const scoredFans = scoreAudience(fans);
  const tierCounts = scoredFans.reduce(
    (counts, fan) => ({ ...counts, [fan.fanScore.tier]: counts[fan.fanScore.tier] + 1 }),
    { core: 0, true: 0, rising: 0, casual: 0 },
  );

  return {
    snapshot: {
      ...snapshot,
      viewRate: percentage(snapshot.averageViews, snapshot.totalFollowers),
      identityRate: percentage(snapshot.identifiedFans, snapshot.totalFollowers),
      directConnectionRate: percentage(snapshot.directConnections, snapshot.identifiedFans),
    },
    tierCounts,
    recommendations: [
      {
        id: "capture-direct",
        priority: "high",
        title: "Move recognition into a direct relationship",
        detail: "Offer a fan-only drop or early access page that collects explicit email or SMS consent.",
        expectedImpact: "+12–18% reachable audience",
      },
      {
        id: "activate-core",
        priority: "high",
        title: "Activate the core 30 minutes before release",
        detail: "Give your highest-intent fans one clear action and a tracked deep link before the public post.",
        expectedImpact: "Stronger early velocity",
      },
      {
        id: "cross-platform-link",
        priority: "medium",
        title: "Link fan identities with consent",
        detail: "Let fans confirm their profiles from a branded link hub so duplicate reach becomes one usable record.",
        expectedImpact: "Cleaner attribution",
      },
    ],
  };
}

export function recommendCampaign(input = {}) {
  const objective = ["release", "sales", "community"].includes(input.objective)
    ? input.objective
    : "release";
  const contentType = input.contentType || "single";

  const playbooks = {
    release: {
      primarySegment: "core + true fans",
      sequence: [
        { offset: "T-24h", channel: "email / SMS", action: "Private preview and one-tap reminder" },
        { offset: "T-30m", channel: "direct channels", action: "Tracked smart link and one clear action" },
        { offset: "T+0", channel: "social", action: `Publish the ${contentType} with native creative per platform` },
        { offset: "T+4h", channel: "community", action: "Share proof, replies, and a second creative angle" },
      ],
      guardrail: "Send only to opted-in channels and respect frequency caps.",
    },
    sales: {
      primarySegment: "buyers + high-intent non-buyers",
      sequence: [
        { offset: "T-48h", channel: "email", action: "Story-led preview with preference capture" },
        { offset: "T+0", channel: "email / SMS", action: "Offer with attributed checkout link" },
        { offset: "T+24h", channel: "social", action: "Customer proof and product demo" },
      ],
      guardrail: "Exclude recent purchasers from repetitive conversion messages.",
    },
    community: {
      primarySegment: "rising + true fans",
      sequence: [
        { offset: "T+0", channel: "community", action: "Invite a response, vote, or remix" },
        { offset: "T+6h", channel: "social", action: "Feature selected fan responses" },
        { offset: "T+24h", channel: "email", action: "Recap and invite the next contribution" },
      ],
      guardrail: "Reward genuine participation; never automate fake engagement.",
    },
  };

  return { objective, contentType, ...playbooks[objective] };
}
