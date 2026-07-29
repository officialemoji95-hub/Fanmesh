import test from "node:test";
import assert from "node:assert/strict";
import { emptyAudienceSnapshot, toFanRecord } from "../src/database.js";

test("database fan rows map into the scoring contract", () => {
  const fan = toFanRecord({
    id: "fan-1",
    display_name: "Ari K.",
    channels: ["instagram", "email"],
    consented_channels: ["email"],
    metrics: { directOptIn: true },
    last_seen: new Date().toISOString(),
  });
  assert.equal(fan.displayName, "Ari K.");
  assert.deepEqual(fan.consentedChannels, ["email"]);
  assert.equal(fan.metrics.directOptIn, true);
  assert.match(fan.lastSeen, /ago/);
});

test("new private workspaces start with truthful zero metrics", () => {
  assert.deepEqual(emptyAudienceSnapshot, {
    totalFollowers: 0,
    averageViews: 0,
    identifiedFans: 0,
    directConnections: 0,
    connectedPlatforms: 0,
  });
  assert.equal(Object.isFrozen(emptyAudienceSnapshot), true);
});
