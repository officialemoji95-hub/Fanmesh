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
  assert.deepEqual(response.json(), { status: "ok", service: "fanmesh", version: "0.6.0", database: "demo" });
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
