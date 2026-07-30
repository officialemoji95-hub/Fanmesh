import test from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler, handleRequest } from "../src/server.js";

async function dispatch({ method = "GET", url = "/", body = "", handler = handleRequest } = {}) {
  const request = {
    method,
    url,
    headers: { host: "localhost" },
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body);
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) this.chunks.push(Buffer.from(chunk));
    },
    json() {
      return JSON.parse(Buffer.concat(this.chunks).toString("utf8"));
    },
  };
  await handler(request, response);
  return response;
}

test("health endpoint reports an operational service", async () => {
  const response = await dispatch({ url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", service: "fanmesh", version: "0.9.0", database: "demo" });
});

test("public legal pages explain FanMesh data and platform rules", async () => {
  const privacy = await dispatch({ url: "/privacy.html" });
  const terms = await dispatch({ url: "/terms.html" });
  assert.equal(privacy.statusCode, 200);
  assert.equal(terms.statusCode, 200);
  assert.match(Buffer.concat(privacy.chunks).toString("utf8"), /official platform APIs/i);
  assert.match(Buffer.concat(terms.chunks).toString("utf8"), /no guarantee that any follower will see a post/i);
});

test("auth session clearly reports unconfigured demo mode", async () => {
  const response = await dispatch({ url: "/api/v1/auth/session" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { configured: false, authenticated: false, mode: "demo" });
});

test("consolidated dashboard labels demo records", async () => {
  const response = await dispatch({ url: "/api/v1/dashboard?limit=2" });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.meta.demo, true);
  assert.equal(body.data.fans.length, 2);
  assert.equal(body.data.workspace.role, "demo");
});

test("account creation refuses to pretend Supabase is configured", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/auth/signup",
    body: JSON.stringify({ displayName: "Creator", email: "creator@example.com", password: "strong-pass" }),
  });
  assert.equal(response.statusCode, 503);
  assert.match(response.json().error.message, /not configured/);
});

test("configured workspaces require an authenticated session", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { configured: true, authenticated: false, mode: "supabase" }, cookies: [] };
      },
    },
    workspaceStore: {},
  });
  const response = await dispatch({ url: "/api/v1/dashboard", handler });
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error.message, /Sign in/);
});

test("authenticated dashboards return private workspace data instead of demo totals", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return {
          data: {
            configured: true,
            authenticated: true,
            mode: "supabase",
            accessToken: "server-only-token",
            user: { id: "user-1", email: "creator@example.com", displayName: "Creator" },
          },
          cookies: [],
        };
      },
    },
    workspaceStore: {
      async getDashboard() {
        return {
          workspace: { id: "workspace-1", name: "Creator workspace", role: "owner" },
          fans: [],
          snapshot: { totalFollowers: 0, averageViews: 0, identifiedFans: 0, directConnections: 0, connectedPlatforms: 0 },
          connectionStatuses: {},
        };
      },
    },
  });
  const response = await dispatch({ url: "/api/v1/dashboard", handler });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.meta.demo, false);
  assert.equal(body.data.insights.snapshot.totalFollowers, 0);
  assert.equal(body.data.fans.length, 0);
  assert.equal(JSON.stringify(body).includes("server-only-token"), false);
});

test("fan endpoint returns scored records", async () => {
  const response = await dispatch({ url: "/api/v1/fans?limit=2" });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.data.length, 2);
  assert.equal(typeof body.data[0].fanScore.score, "number");
});

test("score endpoint validates malformed JSON", async () => {
  const response = await dispatch({ method: "POST", url: "/api/v1/score", body: "not-json" });
  const body = response.json();
  assert.equal(response.statusCode, 400);
  assert.match(body.error.message, /valid JSON/);
});

test("campaign endpoint builds a release sequence", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/campaigns/recommend",
    body: JSON.stringify({ objective: "release", contentType: "single" }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.data.objective, "release");
  assert.ok(body.data.sequence.length >= 3);
});

test("activation preparation reports real eligibility without pretending to send", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/activations/prepare",
    body: JSON.stringify({
      title: "New single",
      contentUrl: "https://example.com/listen",
      channels: ["email"],
      confirmedOwnedContent: true,
    }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.meta.persisted, false);
  assert.equal(body.data.kind, "fan_activation_v1");
  assert.equal(body.data.audience.identifiedFans, 5);
  assert.equal(body.data.delivery.email.status, "provider_connection_required");
  assert.match(body.data.links.email, /utm_source=fanmesh/);
});

test("configured activation preparation uses workspace counts and persists only a draft", async () => {
  let savedPlan;
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return {
          data: { authenticated: true, accessToken: "token", user: { id: "user-1" } },
          cookies: ["session=refreshed"],
        };
      },
    },
    workspaceStore: {
      async getActivationEligibility(user, token) {
        assert.equal(user.id, "user-1");
        assert.equal(token, "token");
        return {
          identifiedFans: 100,
          directConnections: 25,
          platformOnly: 75,
          channels: { email: 20, sms: 8 },
          platforms: { instagram: 90, facebook: 20, tiktok: 50, youtube: 4 },
        };
      },
      async saveExperiment(user, token, plan) {
        savedPlan = plan;
        return { ...plan, databaseId: "activation-1", status: "saved" };
      },
    },
    oauthService: { catalog() { return []; } },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/activations/prepare",
    handler,
    body: JSON.stringify({
      title: "New video",
      contentUrl: "https://example.com/watch",
      channels: ["email", "sms"],
      holdoutPercent: 10,
      confirmedOwnedContent: true,
    }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 201);
  assert.equal(body.meta.messagesSent, 0);
  assert.equal(body.data.databaseId, "activation-1");
  assert.equal(savedPlan.audience.selectedEligible, 25);
  assert.equal(savedPlan.audience.reachableNow, 23);
  assert.equal(savedPlan.delivery.sms.status, "provider_connection_required");
});

test("activation preparation rejects unsafe destinations", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/activations/prepare",
    body: JSON.stringify({
      title: "Post",
      contentUrl: "http://localhost/post",
      channels: ["email"],
      confirmedOwnedContent: true,
    }),
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /public HTTPS/);
});

test("recent activations are empty but explicit in demo mode", async () => {
  const response = await dispatch({ url: "/api/v1/activations" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, []);
  assert.equal(response.json().meta.persisted, false);
});

test("connections endpoint exposes authorized source contracts", async () => {
  const response = await dispatch({ url: "/api/v1/connections" });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.ok(body.data.social.some((source) => source.platform === "meta"));
  assert.ok(body.data.social.some((source) => source.platform === "tiktok"));
  assert.equal(body.data.social.every((source) => source.tokenPolicy.includes("encrypted")), true);
  assert.ok(body.data.imports.some((source) => source.platform === "csv"));
});

test("OAuth start requires a signed-in creator", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { configured: true, authenticated: false }, cookies: [] };
      },
    },
    workspaceStore: {},
    oauthService: { catalog() { return []; } },
  });
  const response = await dispatch({ url: "/api/v1/oauth/tiktok/start", handler });
  assert.equal(response.statusCode, 401);
});

test("OAuth start redirects only after server-side session authorization", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, user: { id: "user-1" }, accessToken: "private" }, cookies: ["session=refreshed"] };
      },
    },
    workspaceStore: {},
    oauthService: {
      catalog() { return []; },
      async begin(provider, session) {
        assert.equal(provider, "tiktok");
        assert.equal(session.user.id, "user-1");
        return { redirectUrl: "https://www.tiktok.com/v2/auth/authorize/?state=test", cookies: ["oauth=state"] };
      },
    },
  });
  const response = await dispatch({ url: "/api/v1/oauth/tiktok/start", handler });
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.location, /tiktok\.com/);
  assert.deepEqual(response.headers["set-cookie"], ["session=refreshed", "oauth=state"]);
});

test("lead preview endpoint returns consent validation results", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/leads/preview",
    body: JSON.stringify({ rows: [{ email: "fan@example.com", consent: true, consentAt: "2026-07-25", consentSource: "form" }] }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.data.summary.valid, 1);
});

test("Meta lead preview validates server-fetched contacts without returning contact fields", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, accessToken: "token", user: { id: "user-1" } }, cookies: [] };
      },
    },
    workspaceStore: {},
    oauthService: {
      catalog() { return []; },
      async fetchMetaLeadImport(session, input) {
        assert.equal(session.user.id, "user-1");
        assert.equal(input.confirmedConsent, true);
        return {
          source: "meta_ads",
          forms: [{ id: "form-1", name: "Early access", pageId: "page-1" }],
          fetchedAt: "2026-07-30T10:00:00.000Z",
          limit: 100,
          rows: [{
            name: "Private Fan",
            email: "private@example.com",
            source: "meta_ads",
            sourceId: "lead-1",
            consent: true,
            consentAt: "2026-07-30T09:00:00.000Z",
            consentSource: "meta_instant_form:form-1:creator_attested",
            consentChannels: ["email"],
          }],
        };
      },
    },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/oauth/meta/leads/preview",
    body: JSON.stringify({ formIds: ["form-1"], consentChannels: ["email"], confirmedAuthorized: true, confirmedConsent: true }),
    handler,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.summary.valid, 1);
  assert.equal(response.json().meta.contactFieldsReturned, false);
  assert.equal(Buffer.concat(response.chunks).includes("private@example.com"), false);
});

test("Meta lead commit revalidates fetched submissions and persists consent provenance", async () => {
  let persistedPreview;
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, accessToken: "token", user: { id: "user-1" } }, cookies: [] };
      },
    },
    workspaceStore: {
      async commitLeadImport(user, token, preview) {
        assert.equal(user.id, "user-1");
        assert.equal(token, "token");
        persistedPreview = preview;
        return { id: "run-meta-1", accepted: 1, rejected: 0, created: 1, updated: 0, consentEventsAdded: 1, status: "completed" };
      },
    },
    oauthService: {
      catalog() { return []; },
      async fetchMetaLeadImport() {
        return {
          source: "meta_ads",
          forms: [{ id: "form-1", name: "Early access", pageId: "page-1" }],
          fetchedAt: "2026-07-30T10:00:00.000Z",
          limit: 100,
          rows: [{ email: "fan@example.com", source: "meta_ads", sourceId: "lead-1", consent: true, consentAt: "2026-07-30T09:00:00.000Z", consentSource: "meta_instant_form:form-1:creator_attested", consentChannels: ["email"] }],
        };
      },
    },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/oauth/meta/leads/commit",
    body: JSON.stringify({ formIds: ["form-1"], consentChannels: ["email"], confirmedAuthorized: true, confirmedConsent: true }),
    handler,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().meta.persisted, true);
  assert.equal(persistedPreview.valid[0].consent.source, "meta_instant_form:form-1:creator_attested");
});

test("lead commit requires an explicit authorized-data confirmation", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, accessToken: "token", user: { id: "user-1" } }, cookies: [] };
      },
    },
    workspaceStore: { async commitLeadImport() { throw new Error("should not be called"); } },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/leads/commit",
    body: JSON.stringify({ source: "csv", rows: [{ email: "fan@example.com" }] }),
    handler,
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /Confirm/);
});

test("authorized lead commits are revalidated and persisted through the workspace store", async () => {
  let persistedPreview;
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return {
          data: { authenticated: true, accessToken: "token", user: { id: "user-1" } },
          cookies: ["refreshed=cookie"],
        };
      },
    },
    workspaceStore: {
      async commitLeadImport(user, token, preview) {
        assert.equal(user.id, "user-1");
        assert.equal(token, "token");
        persistedPreview = preview;
        return { id: "run-1", accepted: 1, rejected: 0, created: 1, updated: 0, consentEventsAdded: 1, status: "completed" };
      },
    },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/leads/commit",
    body: JSON.stringify({
      source: "meta_ads",
      confirmedAuthorized: true,
      rows: [{ email: "fan@example.com", consent: true, consentAt: "2026-07-25", consentSource: "meta-lead-form" }],
    }),
    handler,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().meta.persisted, true);
  assert.equal(persistedPreview.summary.valid, 1);
});

test("official platform export preview returns identity counts without granting contact consent", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/identities/preview",
    body: JSON.stringify({
      source: "instagram_export",
      relationship: "follower",
      rows: [{ username: "fan.one", profileUrl: "https://www.instagram.com/fan.one/" }],
    }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.data.summary.valid, 1);
  assert.equal(body.data.summary.directlyReachable, 0);
  assert.equal(body.meta.directContactConsentGranted, false);
  assert.equal("valid" in body.data, false);
});

test("platform identity commit requires official-export confirmation", async () => {
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, accessToken: "token", user: { id: "user-1" } }, cookies: [] };
      },
    },
    workspaceStore: { async commitPlatformIdentityImport() { throw new Error("should not be called"); } },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/identities/commit",
    body: JSON.stringify({ source: "instagram_export", relationship: "follower", confirmedAuthorized: true, rows: [{ username: "fan.one" }] }),
    handler,
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /official platform data export/);
});

test("confirmed platform identity commits remain platform-only", async () => {
  let persistedPreview;
  let options;
  const handler = createRequestHandler({
    authService: {
      config: { configured: true },
      async session() {
        return { data: { authenticated: true, accessToken: "token", user: { id: "user-1" } }, cookies: [] };
      },
    },
    workspaceStore: {
      async commitPlatformIdentityImport(user, token, preview, commitOptions) {
        assert.equal(user.id, "user-1");
        assert.equal(token, "token");
        persistedPreview = preview;
        options = commitOptions;
        return { id: "run-platform-1", accepted: 1, created: 1, updated: 0, consentEventsAdded: 0, directlyReachable: 0 };
      },
    },
  });
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/imports/identities/commit",
    body: JSON.stringify({
      source: "tiktok_export",
      relationship: "follower",
      rows: [{ username: "fan.one", profileUrl: "https://www.tiktok.com/@fan.one" }],
      confirmedAuthorized: true,
      confirmedOfficialExport: true,
      finalBatch: false,
    }),
    handler,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(persistedPreview.valid[0].platform, "tiktok");
  assert.equal("consent" in persistedPreview.valid[0], false);
  assert.equal(options.refreshSnapshot, false);
  assert.equal(response.json().meta.directContactConsentGranted, false);
});

test("social experiment endpoint returns a measured distribution plan", async () => {
  const response = await dispatch({
    method: "POST",
    url: "/api/v1/experiments/social",
    body: JSON.stringify({ contentId: "post-1", candidateCounts: { optedInFans: 100 } }),
  });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(body.data.status, "draft");
  assert.ok(body.data.steps.some((step) => step.id === "measure"));
});
