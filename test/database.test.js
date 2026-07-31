import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceStore, emptyAudienceSnapshot, publicConnectionState, toFanRecord } from "../src/database.js";

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

test("activation eligibility uses exact workspace counts without exposing contacts", async () => {
  const calls = [];
  function response(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, async text() { return payload === null ? "" : JSON.stringify(payload); } };
  }
  function countResponse(total) {
    return {
      ok: true,
      status: 200,
      headers: { get(name) { return name === "content-range" ? `0-0/${total}` : null; } },
      async text() { return ""; },
    };
  }
  const store = createWorkspaceStore({
    environment: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-key" },
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      if (url.includes("workspace_members")) return response([{ workspace_id: "workspace-1", role: "owner" }]);
      if (url.includes("/workspaces?")) return response([{ id: "workspace-1", name: "Creator workspace", slug: "creator" }]);
      if (options.method === "HEAD") {
        if (url.includes("consented_channels=not.eq")) return countResponse(20);
        if (url.includes("consented_channels=cs.%7Bemail%7D")) return countResponse(18);
        if (url.includes("consented_channels=cs.%7Bsms%7D")) return countResponse(7);
        if (url.includes("channels=cs.%7Binstagram%7D")) return countResponse(70);
        if (url.includes("channels=cs.%7Bfacebook%7D")) return countResponse(30);
        if (url.includes("channels=cs.%7Btiktok%7D")) return countResponse(55);
        if (url.includes("channels=cs.%7Byoutube%7D")) return countResponse(9);
        return countResponse(100);
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  });
  const eligibility = await store.getActivationEligibility({ id: "user-1" }, "user-token");
  assert.equal(eligibility.identifiedFans, 100);
  assert.equal(eligibility.directConnections, 20);
  assert.equal(eligibility.platformOnly, 80);
  assert.deepEqual(eligibility.channels, { email: 18, sms: 7 });
  assert.deepEqual(eligibility.platforms, { instagram: 70, facebook: 30, tiktok: 55, youtube: 9 });
  assert.equal(calls.filter((call) => call.options.method === "HEAD").length, 8);
  assert.equal(calls.some((call) => JSON.stringify(call).includes("email@example.com")), false);
});

test("recent activation listing returns only fan-alert plans", async () => {
  function response(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, async text() { return payload === null ? "" : JSON.stringify(payload); } };
  }
  const store = createWorkspaceStore({
    environment: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-key" },
    async fetchImpl(url) {
      if (url.includes("workspace_members")) return response([{ workspace_id: "workspace-1", role: "owner" }]);
      if (url.includes("/workspaces?")) return response([{ id: "workspace-1", name: "Creator workspace", slug: "creator" }]);
      if (url.includes("/social_experiments?")) return response([
        { id: "row-1", status: "draft", created_at: "2026-07-30T10:00:00.000Z", plan: { id: "act_1", kind: "fan_activation_v1", title: "Post" } },
        { id: "row-2", status: "draft", created_at: "2026-07-29T10:00:00.000Z", plan: { id: "exp_1", kind: "social_experiment" } },
      ]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  const activations = await store.listActivations({ id: "user-1" }, "user-token", 5);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].databaseId, "row-1");
  assert.equal(activations[0].title, "Post");
});

test("Meta connection summaries expose aggregate assets without credentials or lead identities", () => {
  const state = publicConnectionState({
    status: "connected",
    external_account_id: "person-1",
    scopes: ["pages_show_list", "ads_read", "leads_retrieval"],
    metadata: {
      credentials: "v1.private.encrypted",
      public: {
        profile: { name: "Artist" },
        pages: [{ id: "page-1", name: "Artist Page", followers: 12000, access_token: "must-not-leak" }],
        instagramAccounts: [{
          id: "ig-1",
          username: "artist",
          followers: 8000,
          recentMedia: [{ id: "media-1", caption: "New release", permalink: "https://www.instagram.com/reel/example/", likes: 80, comments: 20, interactions: 100, views: 1200, reach: 900, saves: 25, shares: 30, totalInteractions: 155, engagementRate: 17.22 }],
        }],
        adAccounts: [{ id: "act_1", name: "Release Ads", currency: "USD", insights30d: { spend: 125.5, impressions: 50000, reach: 31000, clicks: 900, leads: 42 } }],
        leadForms: [{ id: "form-1", pageId: "page-1", name: "Early access", status: "active", leadCount: 43 }],
        adSummary30d: { currency: "USD", spend: 125.5, impressions: 50000, reach: 31000, clicks: 900, leads: 42 },
        syncIssues: [],
      },
      metrics: { totalFollowers: 20000, pages: 1, instagramAccounts: 1, adAccounts: 1, leadForms: 1, knownLeads: 43, averageMetaReach: 900, medianMetaReach: 900, metaEngagementRate: 17.22, recentMediaReach: 900, recentMediaViews: 1200 },
    },
  });
  assert.equal(state.account.followers, 20000);
  assert.equal(state.account.instagramAccounts[0].recentMedia[0].interactions, 100);
  assert.equal(state.account.instagramAccounts[0].recentMedia[0].views, 1200);
  assert.equal(state.account.instagramAccounts[0].recentMedia[0].totalInteractions, 155);
  assert.equal(state.account.averageMetaReach, 900);
  assert.equal(state.account.adSummary30d.spend, 125.5);
  assert.equal(state.account.leadForms[0].leadCount, 43);
  assert.equal(JSON.stringify(state).includes("credentials"), false);
  assert.equal(JSON.stringify(state).includes("must-not-leak"), false);
});

test("Snapchat connection summaries expose safe campaign hierarchy and reporting metrics", () => {
  const state = publicConnectionState({
    status: "connected",
    external_account_id: "org-1",
    scopes: ["snapchat-marketing-api"],
    metadata: {
      credentials: "v1.encrypted.never-return",
      public: {
        organizations: [{ id: "org-1", name: "Artist Business", private_note: "must-not-leak" }],
        campaigns: [{
          id: "campaign-1",
          adAccountId: "ad-1",
          adAccountName: "Release Ads",
          currency: "USD",
          name: "New single launch",
          status: "ACTIVE",
          objectiveType: "SALES",
          deliveryStatus: ["DELIVERING"],
          dailyBudget: 25,
          updatedAt: "2026-07-31T12:00:00.000Z",
          unsafe: "must-not-leak",
          stats: { impressions: 125000, swipes: 3200, spend: 420.5, nativeLeads: 38, purchases: 12, signUps: 19, conversions: 31, spendMicros: 420500000 },
        }],
        adSquads: [{ id: "squad-1", adAccountId: "ad-1", campaignId: "campaign-1", name: "Core fans", status: "ACTIVE", optimizationGoal: "SWIPES" }],
        ads: [{ id: "snap-ad-1", adAccountId: "ad-1", campaignId: "campaign-1", adSquadId: "squad-1", creativeId: "must-not-leak", name: "Release teaser", status: "ACTIVE", reviewStatus: "APPROVED" }],
        campaignSummaryLifetime: { currency: "USD", spend: 420.5, impressions: 125000, swipes: 3200, nativeLeads: 38, purchases: 12, signUps: 19, conversions: 31 },
      },
      metrics: { adAccounts: 1, campaigns: 1, activeCampaigns: 1, adSquads: 1, ads: 1 },
    },
  });
  assert.equal(state.account.name, "Artist Business");
  assert.equal(state.account.campaignCount, 1);
  assert.equal(state.account.adSquadCount, 1);
  assert.equal(state.account.adCount, 1);
  assert.equal(state.account.snapchatCampaigns[0].stats.spend, 420.5);
  assert.equal(state.account.snapchatCampaigns[0].stats.conversions, 31);
  assert.equal(state.account.snapchatAdSquads[0].campaignId, "campaign-1");
  assert.equal(state.account.snapchatAds[0].reviewStatus, "APPROVED");
  assert.equal(state.account.snapchatCampaignSummaryLifetime.nativeLeads, 38);
  assert.equal(JSON.stringify(state).includes("credentials"), false);
  assert.equal(JSON.stringify(state).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(state).includes("spendMicros"), false);
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

test("platform identity commits never invent direct-contact consent", async () => {
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
      if (url.endsWith("/rest/v1/import_runs") && options.method === "POST") return response([{ id: "run-identity-1" }], 201);
      if (url.includes("/fans?select=")) return response([]);
      if (url.includes("/fans?on_conflict=")) {
        const body = JSON.parse(options.body);
        return response(body.map((row) => ({ id: "fan-platform-1", contact_key: row.contact_key })), 201);
      }
      if (url.includes("/import_runs?id=eq.run-identity-1") && options.method === "PATCH") return response(null, 204);
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  });
  const saved = await store.commitPlatformIdentityImport({ id: "user-1" }, "user-token", {
    source: "instagram_export",
    platform: "instagram",
    valid: [{
      contactKey: "platform_contact-key",
      sourceKey: "source-key",
      source: "instagram_export",
      platform: "instagram",
      handle: "fan.one",
      name: "Fan One",
      relationship: "follower",
    }],
    summary: { received: 1, valid: 1, invalid: 0 },
  }, { refreshSnapshot: false });
  assert.equal(saved.created, 1);
  assert.equal(saved.consentEventsAdded, 0);
  assert.equal(saved.directlyReachable, 0);
  const fanCall = calls.find((call) => call.url.includes("/fans?on_conflict="));
  const fan = JSON.parse(fanCall.options.body)[0];
  assert.deepEqual(fan.channels, ["instagram"]);
  assert.deepEqual(fan.consented_channels, []);
  assert.equal(fan.source_provenance.latest.directContactConsent, false);
  assert.equal(calls.some((call) => call.url.includes("/consents")), false);
});

test("OAuth connections persist encrypted metadata and refresh aggregate audience totals", async () => {
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
      if (url.includes("source_connections?on_conflict=") && options.method === "POST") {
        const row = JSON.parse(options.body)[0];
        return response([{ ...row, updated_at: "2026-07-29T12:00:00.000Z" }], 201);
      }
      if (url.includes("source_connections?select=platform,status,metadata")) {
        return response([{ platform: "tiktok", status: "connected", metadata: { metrics: { totalFollowers: 118000 } } }]);
      }
      if (url.includes("/fans?select=id")) return response([]);
      if (url.endsWith("/rest/v1/audience_snapshots") && options.method === "POST") return response(null, 201);
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    },
  });
  const saved = await store.saveSourceConnection({ id: "user-1" }, "user-token", {
    platform: "tiktok",
    status: "connected",
    externalAccountId: "open-1",
    scopes: ["user.info.basic"],
    metadata: {
      credentials: "v1.encrypted.only",
      public: {
        profile: { name: "Artist", username: "artist" },
        recentVideos: [{ id: "video-1", title: "Release day", shareUrl: "https://www.tiktok.com/@artist/video/1", views: 1200, likes: 120, comments: 12, shares: 6 }],
      },
      metrics: { totalFollowers: 118000, averageViews: 1200, medianViews: 1200, engagementRate: 11.5, recentVideoCount: 1, totalRecentViews: 1200, adAccounts: 0 },
    },
  });
  assert.equal(saved.account.name, "Artist");
  assert.equal(saved.account.followers, 118000);
  assert.equal(saved.account.averageViews, 1200);
  assert.equal(saved.account.engagementRate, 11.5);
  assert.equal(saved.account.recentVideos[0].title, "Release day");
  assert.equal(JSON.stringify(saved).includes("credentials"), false);
  const snapshotCall = calls.find((call) => call.url.endsWith("/rest/v1/audience_snapshots"));
  assert.equal(JSON.parse(snapshotCall.options.body)[0].total_followers, 118000);
});
