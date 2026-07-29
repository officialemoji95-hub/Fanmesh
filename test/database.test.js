import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceStore, emptyAudienceSnapshot, toFanRecord } from "../src/database.js";

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

test("audience commits upsert fans and record consent provenance", async () => {
  const calls = [];
  function response(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, async text() { return payload === null ? "" : JSON.stringify(payload); } };
  }
  const store = createWorkspaceStore({
    environment: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-key" },
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      if (url.includes("workspace_members")) return response([{ workspace_id: "workspace-1", role: "owner" }]);
      if (url.includes("/workspaces?")) return response([{ id: "workspace-1", name: "Creator workspace", slug: "creator" }]);
      if (url.endsWith("/rest/v1/import_runs") && options.method === "POST") return response([{ id: "run-1" }], 201);
      if (url.includes("/fans?select=")) return response([]);
      if (url.includes("/fans?on_conflict=")) {
        const body = JSON.parse(options.body);
        return response(body.map((row) => ({ id: "fan-1", contact_key: row.contact_key })), 201);
      }
      if (url.includes("/consents?select=")) return response([]);
      if (url.endsWith("/rest/v1/consents") && options.method === "POST") return response(null, 201);
      if (url.includes("/import_runs?id=eq.run-1") && options.method === "PATCH") return response(null, 204);
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  });
  const saved = await store.commitLeadImport({ id: "user-1" }, "user-token", {
    source: "meta_ads",
    valid: [{
      contactKey: "contact-key",
      sourceKey: "source-key",
      name: "Ari",
      email: "ari@example.com",
      source: "meta_ads",
      consent: { granted: true, at: "2026-07-25T10:00:00.000Z", source: "meta-lead-form", channels: ["email"] },
      utm: {},
    }],
    summary: { received: 1, valid: 1, invalid: 0 },
  });
  assert.equal(saved.created, 1);
  assert.equal(saved.consentEventsAdded, 1);
  const fanCall = calls.find((call) => call.url.includes("/fans?on_conflict="));
  const fan = JSON.parse(fanCall.options.body)[0];
  assert.deepEqual(fan.consented_channels, ["email"]);
  assert.equal(fan.source_provenance.latest.consentSource, "meta-lead-form");
});
