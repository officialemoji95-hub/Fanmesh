const WEIGHTS = Object.freeze({
  engagement: 24,
  recency: 18,
  consistency: 14,
  purchase: 16,
  crossPlatform: 12,
  directConnection: 10,
  referral: 6,
});

const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : 0));

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function tierForScore(score) {
  if (score >= 85) return "core";
  if (score >= 65) return "true";
  if (score >= 40) return "rising";
  return "casual";
}

/**
 * Explainable v0 scoring model. It intentionally uses first-party behavior and
 * consent signals, never inferred sensitive traits or bought audience data.
 */
export function scoreFan(metrics = {}) {
  const normalized = {
    engagement: clamp((metrics.engagements30d ?? 0) / 12),
    recency: clamp(Math.exp(-Math.max(0, Number(metrics.daysSinceEngagement ?? 365)) / 45)),
    consistency: clamp((metrics.activeWeeks8 ?? 0) / 8),
    purchase: clamp((metrics.spend180d ?? 0) / 150),
    crossPlatform: clamp(((metrics.linkedPlatforms ?? 1) - 1) / 3),
    directConnection: metrics.directOptIn === true ? 1 : 0,
    referral: clamp((metrics.referrals180d ?? 0) / 3),
  };

  const components = Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [key, round(value * WEIGHTS[key], 1)]),
  );
  const score = round(Object.values(components).reduce((sum, value) => sum + value, 0));

  const strongest = Object.entries(components)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([signal, points]) => ({ signal, points }));

  return {
    score,
    tier: tierForScore(score),
    components,
    strongestSignals: strongest,
    modelVersion: "fanmesh-true-fan-v0.1",
  };
}

export function scoreAudience(fans = []) {
  return fans.map((fan) => ({
    ...fan,
    fanScore: scoreFan(fan.metrics),
  }));
}

export { WEIGHTS };
