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
  assert.deepEqual(tiktok.setup, {
    callbackReady: true,
    tokenEncryptionReady: true,
    developerCredentialsReady: true,
    serviceRoleReady: null,
    webhookSchemaReady: null,
  });
  assert.equal(meta.configured, false);
  assert.equal(meta.connectUrl, null);
});

test("Snapchat catalog exposes safe activation gates without returning secrets", () => {
  const service = createOAuthService({
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      SNAPCHAT_CLIENT_ID: "snap-client",
      SNAPCHAT_CLIENT_SECRET: "snap-secret",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-secret",
    },
  });
  const snapchat = service.catalog({}, { providerWebhookSchemaReady: true })
    .find((provider) => provider.platform === "snapchat");
  assert.equal(snapchat.configured, true);
  assert.deepEqual(snapchat.setup, {
    callbackReady: true,
    tokenEncryptionReady: true,
    developerCredentialsReady: true,
    serviceRoleReady: true,
    webhookSchemaReady: true,
  });
  assert.equal(JSON.stringify(snapchat).includes("server-only-secret"), false);
  assert.equal(JSON.stringify(snapchat).includes("snap-secret"), false);
});

test("Snapchat callback inventories campaigns, delivery hierarchy, lifetime stats, and authorized lead forms", async () => {
  let savedConnection;
  const service = createOAuthService({
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      SNAPCHAT_CLIENT_ID: "snap-client",
      SNAPCHAT_CLIENT_SECRET: "snap-secret",
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
      const value = String(url);
      if (value.includes("/login/oauth2/access_token")) {
        return response({ access_token: "snap-access", refresh_token: "snap-refresh", expires_in: 3600, scope: "snapchat-marketing-api" });
      }
      if (value.includes("/v1/me/organizations")) {
        assert.equal(options.headers.authorization, "Bearer snap-access");
        return response({ organizations: [{ organization: {
          id: "org-1",
          name: "Artist Business",
          roles: ["admin"],
          ad_accounts: [{ id: "ad-1", name: "Release Ads", status: "ACTIVE", currency: "USD", timezone: "Africa/Lagos", roles: ["admin"] }],
        } }] });
      }
      if (value.includes("/v1/adaccounts/ad-1/lead_generation_forms")) {
        return response({ lead_generation_forms: [{ lead_generation_form: {
          id: "form-1",
          ad_account_id: "ad-1",
          name: "Release waitlist",
          form_fields: [{ type: "FIRST_NAME" }, { type: "EMAIL" }],
          legal_disclosures: { description: "Creator updates", consent_form_fields: [{ required: true, consent_description: "Send updates" }] },
        } }] });
      }
      if (value.includes("/v1/adaccounts/ad-1/campaigns")) {
        const request = new URL(value);
        assert.equal(request.searchParams.get("limit"), "200");
        assert.equal(request.searchParams.get("sort"), "updated_at-desc");
        return response({ campaigns: [{ campaign: {
          id: "campaign-1",
          ad_account_id: "ad-1",
          name: "New single launch",
          status: "ACTIVE",
          objective: "WEB_CONVERSION",
          objective_v2_properties: { objective_v2_type: "SALES" },
          delivery_status: ["DELIVERING"],
          daily_budget_micro: 25000000,
          start_time: "2026-07-20T00:00:00.000Z",
          updated_at: "2026-07-31T12:00:00.000Z",
        } }] });
      }
      if (value.includes("/v1/adaccounts/ad-1/adsquads")) {
        return response({ adsquads: [{ adsquad: {
          id: "squad-1",
          campaign_id: "campaign-1",
          name: "Core fans",
          status: "ACTIVE",
          type: "SNAP_ADS",
          optimization_goal: "SWIPES",
          daily_budget_micro: 20000000,
        } }] });
      }
      if (value.includes("/v1/adaccounts/ad-1/ads?")) {
        return response({ ads: [{ ad: {
          id: "snap-ad-1",
          ad_squad_id: "squad-1",
          creative_id: "creative-1",
          name: "Release teaser",
          status: "ACTIVE",
          type: "REMOTE_WEBPAGE",
          review_status: "APPROVED",
          delivery_status: ["DELIVERING"],
        } }] });
      }
      if (value.includes("/v1/adaccounts/ad-1/stats")) {
        const request = new URL(value);
        assert.equal(request.searchParams.get("breakdown"), "campaign");
        assert.equal(request.searchParams.get("granularity"), "TOTAL");
        assert.match(request.searchParams.get("fields"), /native_leads/);
        return response({ total_stats: [{ total_stat: {
          id: "ad-1",
          type: "AD_ACCOUNT",
          finalized_data_end_time: "2026-07-29T00:00:00.000Z",
          breakdown_stats: { campaign: [{
            id: "campaign-1",
            type: "CAMPAIGN",
            stats: {
              impressions: 125000,
              swipes: 3200,
              spend: 420500000,
              video_views: 90000,
              view_completion: 28000,
              native_leads: 38,
              conversion_purchases: 12,
              conversion_sign_ups: 19,
            },
          }] },
        } }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("snapchat", session);
  const state = new URL(started.redirectUrl).searchParams.get("state");
  const result = await service.callback("snapchat", session, new URL(
    `https://fanmesh.example/api/v1/oauth/snapchat/callback?code=code-1&state=${encodeURIComponent(state)}`,
  ), { headers: { cookie: cookieHeader(started.cookies[0]) } });

  assert.equal(result.account, "Artist Business");
  assert.equal(savedConnection.metadata.metrics.adAccounts, 1);
  assert.equal(savedConnection.metadata.metrics.campaigns, 1);
  assert.equal(savedConnection.metadata.metrics.adSquads, 1);
  assert.equal(savedConnection.metadata.metrics.ads, 1);
  assert.equal(savedConnection.metadata.metrics.campaignImpressionsLifetime, 125000);
  assert.equal(savedConnection.metadata.metrics.leadForms, 1);
  assert.equal(savedConnection.metadata.public.campaigns[0].name, "New single launch");
  assert.equal(savedConnection.metadata.public.campaigns[0].stats.spend, 420.5);
  assert.equal(savedConnection.metadata.public.campaigns[0].stats.conversions, 31);
  assert.equal(savedConnection.metadata.public.adSquads[0].campaignId, "campaign-1");
  assert.equal(savedConnection.metadata.public.ads[0].campaignId, "campaign-1");
  assert.equal(savedConnection.metadata.public.campaignSummaryLifetime.nativeLeads, 38);
  assert.equal(savedConnection.metadata.public.leadForms[0].id, "form-1");
  assert.deepEqual(savedConnection.metadata.public.leadForms[0].contactFields, ["EMAIL"]);
  assert.equal(savedConnection.metadata.public.leadForms[0].hasLegalDisclosure, true);
  assert.equal(JSON.stringify(savedConnection).includes("snap-access"), false);
});

test("Snapchat live-lead setup creates a verified form webhook and stores no plaintext secret", async () => {
  let savedWebhook;
  let savedConnection;
  const environment = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://fanmesh.example",
    OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
    SNAPCHAT_CLIENT_ID: "snap-client",
    SNAPCHAT_CLIENT_SECRET: "snap-secret",
  };
  const vault = createTokenVault(environment);
  const credentials = vault.seal({
    accessToken: "snap-access",
    refreshToken: "snap-refresh",
    expiresAt: "2026-09-01T00:00:00.000Z",
    grantedScopes: ["snapchat-marketing-api"],
    providerAssets: {},
  });
  const service = createOAuthService({
    environment,
    now: () => Date.parse("2026-07-31T10:00:00.000Z"),
    workspaceStore: {
      async getSourceConnection() {
        return {
          status: "connected",
          external_account_id: "org-1",
          scopes: ["snapchat-marketing-api"],
          metadata: {
            credentials,
            public: { leadForms: [{ id: "form-1", adAccountId: "ad-1", name: "Release waitlist", contactFields: ["EMAIL"], webhookStatus: "not_configured" }] },
            metrics: { adAccounts: 1, leadForms: 1 },
          },
        };
      },
      async saveProviderWebhook(user, accessToken, webhook) {
        assert.equal(user.id, "user-1");
        assert.equal(accessToken, "supabase-token");
        savedWebhook = webhook;
        return { id: "webhook-1" };
      },
      async saveSourceConnection(user, accessToken, connection) {
        savedConnection = connection;
        return connection;
      },
    },
    async fetchImpl(url, options = {}) {
      assert.equal(String(url), "https://adsapi.snapchat.com/v1/lead_gen/integrations/public_webhook");
      assert.equal(options.method, "POST");
      const request = JSON.parse(options.body).webhook_integrations[0];
      assert.equal(request.form_id, "form-1");
      assert.match(request.webhook_url, /^https:\/\/fanmesh\.example\/api\/v1\/webhooks\/snapchat\/leads\//);
      return response({ webhookIntegrations: [{ webhookIntegration: {
        formId: "form-1",
        adAccountId: "ad-1",
        integrationId: "integration-1",
        hmacSecret: "never-plaintext",
      } }] });
    },
  });
  const result = await service.configureSnapchatLeadWebhooks(
    { user: { id: "user-1" }, accessToken: "supabase-token" },
    { formIds: ["form-1"], consentChannels: ["email"], confirmedAuthorized: true, confirmedConsent: true },
  );
  assert.equal(result.webhookCount, 1);
  assert.equal(savedWebhook.externalFormId, "form-1");
  assert.equal(savedWebhook.consentedChannels[0], "email");
  assert.equal(savedWebhook.encryptedSecret.includes("never-plaintext"), false);
  assert.equal(savedConnection.metadata.public.leadForms[0].webhookStatus, "active");
  assert.equal(JSON.stringify(savedConnection).includes("never-plaintext"), false);
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

test("YouTube callback requests offline consent and syncs channel, uploads, and 28-day analytics", async () => {
  let savedConnection;
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const service = createOAuthService({
    now: () => now,
    environment: {
      NODE_ENV: "production",
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
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
      const parsed = new URL(String(url));
      if (parsed.hostname === "oauth2.googleapis.com") {
        assert.equal(options.method, "POST");
        assert.match(options.body, /grant_type=authorization_code/);
        return response({ access_token: "youtube-access", refresh_token: "youtube-refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly" });
      }
      assert.equal(options.headers.authorization, "Bearer youtube-access");
      if (parsed.pathname.endsWith("/youtube/v3/channels")) {
        assert.equal(parsed.searchParams.get("mine"), "true");
        return response({ items: [{
          id: "channel-1",
          snippet: { title: "Official Emoji", customUrl: "@officialemoji95", description: "Artist", thumbnails: { high: { url: "https://yt3.ggpht.com/avatar" } }, country: "NG" },
          statistics: { subscriberCount: "118000", viewCount: "2500000", videoCount: "75", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: "uploads-1" } },
        }] });
      }
      if (parsed.pathname.endsWith("/youtube/v3/playlistItems")) {
        return response({ items: [{ contentDetails: { videoId: "video-1" }, snippet: { resourceId: { videoId: "video-1" } } }] });
      }
      if (parsed.pathname.endsWith("/youtube/v3/videos")) {
        return response({ items: [{
          id: "video-1",
          snippet: { title: "New release", description: "Listen now", publishedAt: "2026-07-31T10:00:00Z", thumbnails: { high: { url: "https://i.ytimg.com/vi/video-1/hqdefault.jpg" } } },
          statistics: { viewCount: "127", likeCount: "20", commentCount: "4" },
          contentDetails: { duration: "PT2M30S" },
          status: { privacyStatus: "public" },
        }] });
      }
      if (parsed.hostname === "youtubeanalytics.googleapis.com") {
        assert.equal(parsed.searchParams.get("ids"), "channel==MINE");
        assert.equal(parsed.searchParams.get("startDate"), "2026-07-04");
        assert.equal(parsed.searchParams.get("endDate"), "2026-07-31");
        return response({
          columnHeaders: ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained", "subscribersLost", "likes", "comments", "shares"].map((name) => ({ name })),
          rows: [[42000, 120000, 171, 600, 45, 5200, 410, 920]],
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("youtube", session);
  const authorization = new URL(started.redirectUrl);
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  assert.match(authorization.searchParams.get("scope"), /yt-analytics\.readonly/);
  const state = authorization.searchParams.get("state");
  const result = await service.callback("youtube", session, new URL(
    `https://fanmesh.example/api/v1/oauth/youtube/callback?code=code-1&state=${encodeURIComponent(state)}`,
  ), { headers: { cookie: cookieHeader(started.cookies[0]) } });

  assert.equal(result.account, "Official Emoji");
  assert.equal(savedConnection.metadata.metrics.totalFollowers, 118000);
  assert.equal(savedConnection.metadata.metrics.channelViews, 2500000);
  assert.equal(savedConnection.metadata.public.recentVideos[0].views, 127);
  assert.equal(savedConnection.metadata.public.analytics28d.views, 42000);
  assert.equal(savedConnection.metadata.public.analytics28d.estimatedMinutesWatched, 120000);
  assert.equal(JSON.stringify(savedConnection).includes("youtube-access"), false);
  assert.equal(service.vault.open(savedConnection.metadata.credentials).refreshToken, "youtube-refresh");
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
          { permission: "instagram_manage_insights", status: "granted" },
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
      if (parsed.pathname.endsWith("/media-1/insights")) {
        assert.equal(parsed.searchParams.get("metric"), "views,reach,saved,shares,total_interactions");
        return response({ data: [
          { name: "views", values: [{ value: 1200 }] },
          { name: "reach", values: [{ value: 900 }] },
          { name: "saved", values: [{ value: 25 }] },
          { name: "shares", values: [{ value: 30 }] },
          { name: "total_interactions", total_value: { value: 155 } },
        ] });
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
  assert.equal(savedConnection.metadata.metrics.recentMediaInteractions, 155);
  assert.equal(savedConnection.metadata.metrics.averageViews, 1200);
  assert.equal(savedConnection.metadata.metrics.averageMetaReach, 900);
  assert.equal(savedConnection.metadata.metrics.metaEngagementRate, 17.22);
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

test("Meta lead import fetches selected authorized forms only after creator consent confirmation", async () => {
  const now = Date.parse("2026-07-30T10:00:00.000Z");
  const environment = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://fanmesh.example",
    OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
    META_APP_ID: "meta-client",
    META_APP_SECRET: "meta-secret",
    META_GRAPH_VERSION: "v25.0",
  };
  const vault = createTokenVault(environment);
  const credentials = vault.seal({
    accessToken: "meta-user-token",
    expiresAt: "2026-09-01T00:00:00.000Z",
    grantedScopes: ["leads_retrieval"],
    providerAssets: { pageTokens: { "page-1": "page-token" } },
  });
  const service = createOAuthService({
    environment,
    now: () => now,
    workspaceStore: {
      async getSourceConnection() {
        return {
          platform: "meta",
          status: "connected",
          scopes: ["leads_retrieval"],
          metadata: {
            credentials,
            public: { leadForms: [{ id: "form-1", pageId: "page-1", name: "Early access" }] },
          },
        };
      },
    },
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      assert.equal(parsed.pathname, "/v25.0/form-1/leads");
      assert.match(parsed.searchParams.get("fields"), /field_data/);
      assert.equal(parsed.searchParams.get("access_token"), "page-token");
      return response({ data: [{
        id: "lead-1",
        created_time: "2026-07-29T11:00:00+0000",
        campaign_id: "campaign-1",
        campaign_name: "Release waitlist",
        field_data: [
          { name: "full_name", values: ["Ari Fan"] },
          { name: "email", values: ["ari@example.com"] },
          { name: "phone_number", values: ["+2348012345678"] },
          { name: "city", values: ["Lagos"] },
        ],
      }] });
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };

  await assert.rejects(
    service.fetchMetaLeadImport(session, { formIds: ["form-1"], consentChannels: ["email"] }),
    /Confirm that the selected Meta forms/,
  );
  const batch = await service.fetchMetaLeadImport(session, {
    formIds: ["form-1"],
    consentChannels: ["email", "sms"],
    confirmedAuthorized: true,
    confirmedConsent: true,
  });
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.rows[0].email, "ari@example.com");
  assert.equal(batch.rows[0].phone, "+2348012345678");
  assert.equal(batch.rows[0].consentSource, "meta_instant_form:form-1:creator_attested");
  assert.deepEqual(batch.rows[0].consentChannels, ["email", "sms"]);
  assert.equal(JSON.stringify(batch).includes("page-token"), false);
  assert.equal(JSON.stringify(batch).includes("meta-user-token"), false);
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

test("X callback syncs recent original-post performance without exposing tokens", async () => {
  let savedConnection;
  const service = createOAuthService({
    environment: {
      APP_BASE_URL: "http://localhost:3000",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      X_CLIENT_ID: "x-client",
    },
    workspaceStore: {
      async saveSourceConnection(user, accessToken, connection) {
        savedConnection = connection;
        return connection;
      },
    },
    async fetchImpl(url, options = {}) {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/2/oauth2/token") {
        assert.match(options.body, /code_verifier=/);
        return response({ access_token: "x-access", refresh_token: "x-refresh", expires_in: 7200, scope: "tweet.read users.read offline.access" });
      }
      assert.equal(options.headers.authorization, "Bearer x-access");
      if (parsed.pathname === "/2/users/me") {
        return response({ data: { id: "x-user-1", name: "Official Emoji", username: "officialemoji95", verified: true, public_metrics: { followers_count: 118000 } } });
      }
      if (parsed.pathname === "/2/users/x-user-1/tweets") {
        assert.equal(parsed.searchParams.get("exclude"), "retweets");
        assert.equal(parsed.searchParams.get("max_results"), "20");
        return response({ data: [{ id: "post-1", text: "New music is out", created_at: "2026-07-31T12:00:00Z", public_metrics: { impression_count: 127, like_count: 12, reply_count: 3, retweet_count: 4, quote_count: 1 } }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("x", session);
  const state = new URL(started.redirectUrl).searchParams.get("state");
  await service.callback("x", session, new URL(
    `http://localhost:3000/api/v1/oauth/x/callback?code=code-1&state=${encodeURIComponent(state)}`,
  ), { headers: { cookie: cookieHeader(started.cookies[0]) } });

  assert.equal(savedConnection.metadata.metrics.totalFollowers, 118000);
  assert.equal(savedConnection.metadata.metrics.recentPostImpressions, 127);
  assert.equal(savedConnection.metadata.metrics.recentPostInteractions, 20);
  assert.equal(savedConnection.metadata.public.recentPosts[0].permalink, "https://x.com/officialemoji95/status/post-1");
  assert.equal(JSON.stringify(savedConnection).includes("x-access"), false);
});

test("Threads uses current threads.com endpoints, extends its token, and syncs post insights", async () => {
  let savedConnection;
  const service = createOAuthService({
    environment: {
      APP_BASE_URL: "https://fanmesh.example",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
      THREADS_APP_ID: "threads-client",
      THREADS_APP_SECRET: "threads-secret",
    },
    workspaceStore: {
      async saveSourceConnection(user, accessToken, connection) {
        savedConnection = connection;
        return connection;
      },
    },
    async fetchImpl(url, options = {}) {
      const parsed = new URL(String(url));
      assert.equal(parsed.hostname, "graph.threads.com");
      if (parsed.pathname === "/oauth/access_token") {
        assert.equal(options.method, "POST");
        return response({ access_token: "threads-short", user_id: "threads-user-1", expires_in: 3600, scope: "threads_basic,threads_manage_insights" });
      }
      if (parsed.pathname === "/access_token") {
        assert.equal(parsed.searchParams.get("grant_type"), "th_exchange_token");
        assert.equal(parsed.searchParams.get("access_token"), "threads-short");
        return response({ access_token: "threads-long", token_type: "bearer", expires_in: 5184000 });
      }
      assert.equal(parsed.searchParams.get("access_token"), "threads-long");
      if (parsed.pathname === "/v1.0/me") {
        return response({ id: "threads-user-1", username: "officialemoji95", name: "The Emoji" });
      }
      if (parsed.pathname === "/v1.0/me/threads") {
        return response({ data: [{ id: "thread-1", text: "New music", permalink: "https://www.threads.com/@officialemoji95/post/thread-1", media_type: "TEXT", timestamp: "2026-07-31T12:00:00Z" }] });
      }
      if (parsed.pathname === "/v1.0/thread-1/insights") {
        return response({ data: [
          { name: "views", total_value: { value: 127 } },
          { name: "likes", total_value: { value: 12 } },
          { name: "replies", total_value: { value: 3 } },
          { name: "reposts", total_value: { value: 4 } },
          { name: "quotes", total_value: { value: 1 } },
          { name: "shares", total_value: { value: 2 } },
        ] });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const session = { user: { id: "user-1" }, accessToken: "supabase-token" };
  const started = await service.begin("threads", session);
  const authorization = new URL(started.redirectUrl);
  assert.equal(authorization.origin, "https://threads.com");
  assert.equal(authorization.pathname, "/oauth/authorize");
  const state = authorization.searchParams.get("state");
  await service.callback("threads", session, new URL(
    `https://fanmesh.example/api/v1/oauth/threads/callback?code=code-1&state=${encodeURIComponent(state)}`,
  ), { headers: { cookie: cookieHeader(started.cookies[0]) } });

  assert.equal(savedConnection.metadata.public.profile.username, "officialemoji95");
  assert.equal(savedConnection.metadata.public.recentPosts[0].permalink, "https://www.threads.com/@officialemoji95/post/thread-1");
  assert.equal(savedConnection.metadata.metrics.recentPostImpressions, 127);
  assert.equal(savedConnection.metadata.metrics.recentPostInteractions, 22);
  const storedToken = service.vault.open(savedConnection.metadata.credentials);
  assert.equal(storedToken.accessToken, "threads-long");
  assert.deepEqual(storedToken.grantedScopes, ["threads_basic", "threads_manage_insights"]);
  assert.equal(JSON.stringify(savedConnection).includes("threads-long"), false);
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
