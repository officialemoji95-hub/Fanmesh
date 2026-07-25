import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudience, scoreFan, tierForScore, WEIGHTS } from "../src/scoring.js";

test("all scoring weights total 100 points", () => {
  assert.equal(Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
});

test("maximum qualifying signals produce a core score of 100", () => {
  const result = scoreFan({
    engagements30d: 40,
    daysSinceEngagement: 0,
    activeWeeks8: 8,
    spend180d: 500,
    linkedPlatforms: 6,
    directOptIn: true,
    referrals180d: 9,
  });
  assert.equal(result.score, 100);
  assert.equal(result.tier, "core");
  assert.equal(result.modelVersion, "fanmesh-true-fan-v0.1");
});

test("missing and hostile values are clamped safely", () => {
  const result = scoreFan({
    engagements30d: -50,
    daysSinceEngagement: -2,
    activeWeeks8: -8,
    spend180d: -100,
    linkedPlatforms: -4,
    directOptIn: "true",
    referrals180d: -3,
  });
  assert.equal(result.score, 18);
  assert.equal(result.tier, "casual");
  assert.equal(result.components.directConnection, 0);
});

test("recency decays and newer engagement scores higher", () => {
  const recent = scoreFan({ daysSinceEngagement: 1 });
  const old = scoreFan({ daysSinceEngagement: 180 });
  assert.ok(recent.components.recency > old.components.recency);
});

test("tier boundaries are stable", () => {
  assert.equal(tierForScore(85), "core");
  assert.equal(tierForScore(65), "true");
  assert.equal(tierForScore(40), "rising");
  assert.equal(tierForScore(39), "casual");
});

test("audience scoring keeps source fields", () => {
  const [fan] = scoreAudience([{ id: "fan_1", metrics: { directOptIn: true } }]);
  assert.equal(fan.id, "fan_1");
  assert.equal(fan.fanScore.components.directConnection, 10);
});
