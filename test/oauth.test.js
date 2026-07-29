import test from "node:test";
import assert from "node:assert/strict";
import { createOAuthService, createTokenVault, OAuthError, STATE_COOKIE } from "../src/oauth.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function cookieHeader(setCookie) {
  return setCookie.split(";")[0];
}

test("token vault encrypts credential payloads and detects tampering", () => {
  const vault = createTokenVault({ OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey });
  const sealed = vault.seal({ accessToken: "never-plaintext" });
  assert.equal(sealed.includes("never-plaintext"), false);
  assert.deepEqual(vault.open(sealed), { accessToken: "never-plaintext" });
  const parts = sealed.split(".");
  parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
  assert.throws(() => vault.open(parts.join(".")), OAuthError);
});

test("provider catalog activates only fully configured OAuth apps", () => {
  const service = createOAuthService({
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
    },
  });
  const tiktok = service.catalog().find((provider) => provider.platform === "tiktok");
  const meta = service.catalog().find((provider) => provider.platform === "meta");
  assert.equal(tiktok.configured, true);
  assert.equal(tiktok.callbackUrl, "https://fanmesh.example/api/v1/oauth/tiktok/callback");
  assert.equal(meta.configured, false);
  assert.equal(meta.connectUrl, null);
});

test("TikTok callback verifies state, encrypts tokens, and stores a safe account summary", async () => {
  let savedConnection;
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  const service = createOAuthService({
    now: () => now,
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
    },
    workspaceStore: {
      async saveSourceConnection(user, accessToken, connection) {
        assert.equal(user.id, "user-1");
        assert.equal(accessToken, "supabase-token");
        savedConnection = connection;
        return { status: connection.status };
      },
    },
    async fetchImpl(url, options = {}) {
      if (String(url).includes("/v2/oauth/token/")) {
        assert.equal(options.method, "POST");
        return response({ access_token: "tiktok-access", refresh_token: "tiktok-refresh", expires_in: 86400, open_id: "open-1", scope: "user.info.basic,user.info.stats,video.list" });
      }
      if (String(url).includes("/v2/user/info/")) {
        assert.equal(options.headers.authorization, "Bearer tiktok-access");
        const requestedFields = new URL(String(url)).searchParams.get("fields").split(",");
        assert.equal(requestedFields.includes("username"), false);
        assert.equal(requestedFields.includes("follower_count"), true);
        return response({ data: { user: { open_id: "open-1", display_name: "Artist", follower_count: 118000, video_count: 42 } }, error: { code: "ok" } });
      }
      if (String(url).includes("/v2/video/list/")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers.authorization, "Bearer tiktok-access");
        assert.deepEqual(JSON.parse(options.body), { max_count: 20 });
        const requestedFields = new URL(String(url)).searchParams.get("fields").split(",");
        assert.equal(requestedFields.includes("view_count"), true);
        assert.equal(requestedFields.includes("share_count"), true);
        return response({
          data: { videos: [
            { id: "video-2", title: "New post", create_time: 1785319200, share_url: "https://www.tiktok.com/@artist/video/2", view_count: 1000, like_count: 100, comment_count: 20, share_count: 10 },
            { id: "video-1", video_description: "Previous post", create_time: 1785232800, share_url: "https://www.tiktok.com/@artist/video/1", view_count: 500, like_count: 40, comment_count: 5, share_count: 5 },
          ] },
          error: { code: "ok" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("tiktok", session);
  const authorization = new URL(started.redirectUrl);
  assert.equal(authorization.searchParams.get("disable_auto_auth"), "1");
  const state = authorization.searchParams.get("state");
  const callbackUrl = new URL(`https://fanmesh.example/api/v1/oauth/tiktok/callback?code=code-1&state=${encodeURIComponent(state)}`);
  const result = await service.callback("tiktok", session, callbackUrl, {
    headers: { cookie: cookieHeader(started.cookies[0]) },
  });

  assert.equal(result.status, "connected");
  assert.equal(result.account, "Artist");
  assert.equal(savedConnection.metadata.public.profile.followers, 118000);
  assert.equal(savedConnection.metadata.public.recentVideos.length, 2);
  assert.equal(savedConnection.metadata.public.recentVideos[0].title, "New post");
  assert.equal(savedConnection.metadata.metrics.averageViews, 750);
  assert.equal(savedConnection.metadata.metrics.medianViews, 750);
  assert.equal(savedConnection.metadata.metrics.engagementRate, 12);
  assert.equal(savedConnection.metadata.metrics.totalRecentViews, 1500);
  assert.equal(savedConnection.metadata.metrics.performanceWindow, "latest_20_public_posts");
  assert.equal(JSON.stringify(savedConnection).includes("tiktok-access"), false);
  assert.equal(service.vault.open(savedConnection.metadata.credentials).refreshToken, "tiktok-refresh");
  assert.match(result.cookies[0], new RegExp(`^${STATE_COOKIE}=`));
  assert.match(result.cookies[0], /Max-Age=0/);
});

test("Meta callback syncs authorized Pages, organic Instagram media, ad insights, and lead-form inventory", async () => {
  let savedConnection;
  let tokenExchanges = 0;
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  const service = createOAuthService({
    now: () => now,
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      META_APP_ID: "meta-client",
      META_APP_SECRET: "meta-secret",
      META_GRAPH_VERSION: "v25.0",
    },
    workspaceStore: {
      async saveSourceConnection(user, accessToken, connection) {
        assert.equal(user.id, "user-1");
        assert.equal(accessToken, "supabase-token");
        savedConnection = connection;
        return { status: connection.status };
      },
    },
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/oauth/access_token")) {
        tokenExchanges += 1;
        return response({ access_token: tokenExchanges === 1 ? "meta-short" : "meta-long", expires_in: 5184000 });
      }
      assert.match(parsed.pathname, /^\/v25\.0\//);
      if (parsed.pathname.endsWith("/me/accounts")) {
        assert.match(parsed.searchParams.get("fields"), /access_token/);
        return response({ data: [{
          id: "page-1",
          name: "Artist Page",
          access_token: "page-secret",
          followers_count: 12000,
          tasks: ["ANALYZE", "ADVERTISE"],
          instagram_business_account: { id: "ig-1" },
        }] });
      }
      if (parsed.pathname.endsWith("/me/adaccounts")) {
        return response({ data: [{ id: "act_1", name: "Release Ads", account_status: 1, currency: "USD", timezone_name: "Africa/Lagos" }] });
      }
      if (parsed.pathname.endsWith("/me/permissions")) {
        return response({ data: [
          { permission: "public_profile", status: "granted" },
          { permission: "pages_show_list", status: "granted" },
          { permission: "pages_read_engagement", status: "granted" },
          { permission: "instagram_basic", status: "granted" },
          { permission: "ads_read", status: "granted" },
          { permission: "leads_retrieval", status: "granted" },
          { permission: "business_management", status: "declined" },
        ] });
      }
      if (parsed.pathname.endsWith("/me")) return response({ id: "person-1", name: "Artist" });
      if (parsed.pathname.endsWith("/ig-1/media")) {
        return response({ data: [{
          id: "media-1",
          caption: "New release",
          media_type: "VIDEO",
          media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/example/",
          timestamp: "2026-07-28T10:00:00+0000",
          like_count: 80,
          comments_count: 20,
        }] });
      }
      if (parsed.pathname.endsWith("/ig-1")) {
        return response({ id: "ig-1", username: "artist", name: "Artist IG", followers_count: 8000, follows_count: 100, media_count: 30 });
      }
      if (parsed.pathname.endsWith("/page-1/leadgen_forms")) {
        return response({ data: [{ id: "form-1", name: "Early access", status: "ACTIVE", created_time: "2026-07-01T09:00:00+0000" }] });
      }
      if (parsed.pathname.endsWith("/form-1/leads")) {
        assert.equal(parsed.searchParams.get("fields"), "id,created_time");
        return response({ data: [{ id: "lead-hidden", created_time: "2026-07-27T11:00:00+0000" }], summary: { total_count: 43 } });
      }
      if (parsed.pathname.endsWith("/act_1/insights")) {
        assert.equal(parsed.searchParams.get("date_preset"), "last_30d");
        return response({ data: [{ spend: "125.50", impressions: "50000", reach: "31000", clicks: "900", actions: [{ action_type: "lead", value: "42" }] }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("meta", session);
  const authorization = new URL(started.redirectUrl);
  assert.equal(authorization.pathname, "/v25.0/dialog/oauth");
  const state = authorization.searchParams.get("state");
  const result = await service.callback("meta", session, new URL(
    `https://fanmesh.example/api/v1/oauth/meta/callback?code=code-1&state=${encodeURIComponent(state)}`,
  ), { headers: { cookie: cookieHeader(started.cookies[0]) } });

  assert.equal(result.status, "connected");
  assert.equal(result.account, "Artist");
  assert.equal(savedConnection.metadata.metrics.totalFollowers, 20000);
  assert.equal(savedConnection.metadata.metrics.recentMediaInteractions, 100);
  assert.equal(savedConnection.metadata.metrics.knownLeads, 43);
  assert.equal(savedConnection.metadata.public.instagramAccounts[0].recentMedia[0].productType, "reels");
  assert.equal(savedConnection.metadata.public.adSummary30d.spend, 125.5);
  assert.equal(savedConnection.metadata.public.adSummary30d.leads, 42);
  assert.deepEqual(savedConnection.metadata.public.syncIssues, []);
  assert.equal(savedConnection.scopes.includes("leads_retrieval"), true);
  assert.equal(savedConnection.scopes.includes("business_management"), false);
  assert.equal(JSON.stringify(savedConnection).includes("meta-long"), false);
  assert.equal(JSON.stringify(savedConnection).includes("page-secret"), false);
  const privateCredentials = service.vault.open(savedConnection.metadata.credentials);
  assert.equal(privateCredentials.accessToken, "meta-long");
  assert.equal(privateCredentials.grantedScopes.includes("business_management"), false);
  assert.equal(privateCredentials.providerAssets.pageTokens["page-1"], "page-secret");
});

test("OAuth callback refuses a mismatched anti-forgery state", async () => {
  const service = createOAuthService({
    environment: {
      APP_BASE_URL: "http://localhost:3000",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
    },
    workspaceStore: { async saveSourceConnection() { throw new Error("must not save"); } },
    async fetchImpl() { throw new Error("must not fetch"); },
  });
  const session = { user: { id: "user-1" }, accessToken: "token" };
  const started = await service.begin("tiktok", session);
  const callbackUrl = new URL("http://localhost:3000/api/v1/oauth/tiktok/callback?code=code-1&state=wrong-state");
  await assert.rejects(
    service.callback("tiktok", session, callbackUrl, { headers: { cookie: cookieHeader(started.cookies[0]) } }),
    /state verification failed/,
  );
});

test("X authorization uses a PKCE challenge and never places its verifier in the redirect URL", async () => {
  const service = createOAuthService({
    environment: {
      APP_BASE_URL: "http://localhost:3000",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      X_CLIENT_ID: "x-client",
    },
    workspaceStore: {},
  });
  const started = await service.begin("x", { user: { id: "user-1" }, accessToken: "token" });
  const url = new URL(started.redirectUrl);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.has("code_verifier"), false);
});

test("expired TikTok access is refreshed server-side before synchronization", async () => {
  let stored;
  const environment = {
    APP_BASE_URL: "http://localhost:3000",
    OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
    TIKTOK_CLIENT_KEY: "client-key",
    TIKTOK_CLIENT_SECRET: "client-secret",
  };
  const vault = createTokenVault(environment);
  const expiredCredentials = vault.seal({
    accessToken: "expired-access",
    refreshToken: "valid-refresh",
    expiresAt: "2000-01-01T00:00:00.000Z",
    grantedScopes: ["user.info.basic"],
  });
  const service = createOAuthService({
    environment,
    now: () => Date.parse("2026-07-29T12:00:00.000Z"),
    workspaceStore: {
      async getSourceConnection() {
        return { status: "connected", scopes: ["user.info.basic"], metadata: { credentials: expiredCredentials } };
      },
      async saveSourceConnection(user, token, connection) {
        stored = connection;
        return { status: "connected" };
      },
    },
    async fetchImpl(url, options = {}) {
      if (String(url).includes("/v2/oauth/token/")) {
        assert.match(options.body, /grant_type=refresh_token/);
        return response({ access_token: "fresh-access", refresh_token: "rotated-refresh", expires_in: 86400 });
      }
      if (String(url).includes("/v2/user/info/")) {
        assert.equal(options.headers.authorization, "Bearer fresh-access");
        return response({ data: { user: { open_id: "open-1", display_name: "Artist", follower_count: 10 } }, error: { code: "ok" } });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  await service.sync("tiktok", { user: { id: "user-1" }, accessToken: "supabase-token" });
  const refreshed = service.vault.open(stored.metadata.credentials);
  assert.equal(refreshed.accessToken, "fresh-access");
  assert.equal(refreshed.refreshToken, "rotated-refresh");
});
