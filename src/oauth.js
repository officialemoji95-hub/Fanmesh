import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { parseCookies } from "./auth.js";

const STATE_COOKIE = "fanmesh_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_META_GRAPH_VERSION = "v25.0";

export class OAuthError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OAuthError";
    this.statusCode = statusCode;
  }
}

const PROVIDERS = Object.freeze({
  meta: {
    label: "Meta",
    clientIdKey: "META_APP_ID",
    clientSecretKey: "META_APP_SECRET",
    scopesKey: "META_OAUTH_SCOPES",
    scopes: ["public_profile", "pages_show_list", "pages_read_engagement", "instagram_basic", "ads_read", "leads_retrieval", "business_management"],
    capabilities: ["Facebook Pages", "Instagram professional media", "Meta ad insights", "Lead-form inventory"],
    caveat: "Pages, Instagram professional accounts, ads and lead forms appear only when Meta grants the matching scopes and asset roles.",
  },
  tiktok: {
    label: "TikTok",
    clientIdKey: "TIKTOK_CLIENT_KEY",
    clientSecretKey: "TIKTOK_CLIENT_SECRET",
    scopesKey: "TIKTOK_OAUTH_SCOPES",
    scopes: ["user.info.basic", "user.info.stats", "video.list"],
    capabilities: ["Creator profile", "Follower totals", "Video metadata"],
    caveat: "TikTok Ads uses a separate TikTok for Business app; this connection starts with the creator account.",
  },
  snapchat: {
    label: "Snapchat",
    clientIdKey: "SNAPCHAT_CLIENT_ID",
    clientSecretKey: "SNAPCHAT_CLIENT_SECRET",
    scopesKey: "SNAPCHAT_OAUTH_SCOPES",
    scopes: ["snapchat-marketing-api"],
    capabilities: ["Organizations", "Snap ad accounts", "Campaign reporting"],
    caveat: "Public Profile metrics require Snapchat allowlisting and the snapchat-profile-api scope.",
  },
  x: {
    label: "X",
    clientIdKey: "X_CLIENT_ID",
    clientSecretKey: "X_CLIENT_SECRET",
    scopesKey: "X_OAUTH_SCOPES",
    scopes: ["tweet.read", "users.read", "offline.access"],
    capabilities: ["Creator profile", "Public metrics", "Post metadata"],
    caveat: "X Ads requires separate Ads API approval and OAuth 1.0a; organic account OAuth uses OAuth 2.0 with PKCE.",
  },
  threads: {
    label: "Threads",
    clientIdKey: "THREADS_APP_ID",
    clientSecretKey: "THREADS_APP_SECRET",
    scopesKey: "THREADS_OAUTH_SCOPES",
    scopes: ["threads_basic", "threads_manage_insights"],
    capabilities: ["Threads profile", "Content metadata", "Insights"],
    caveat: "Threads uses its own Meta developer product and callback even when the same business owns Instagram.",
  },
});

function text(value, maxLength = 300) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function safeHttpsUrl(value, allowedHost) {
  try {
    const url = new URL(text(value, 1000));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== allowedHost && !url.hostname.endsWith(`.${allowedHost}`)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function configuredBaseUrl(environment) {
  const value = text(environment.APP_BASE_URL, 500).replace(/\/$/, "");
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(environment.NODE_ENV !== "production" && url.protocol === "http:")) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function decodeKey(value) {
  const raw = text(value, 500);
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function createTokenVault(environment = process.env) {
  const key = decodeKey(environment.OAUTH_TOKEN_ENCRYPTION_KEY);
  const configured = Boolean(key);
  const aad = Buffer.from("fanmesh-oauth-v1", "utf8");

  function seal(value) {
    if (!key) throw new OAuthError("OAuth token encryption is not configured", 503);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  function open(value) {
    if (!key) throw new OAuthError("OAuth token encryption is not configured", 503);
    try {
      const [version, ivValue, tagValue, ciphertextValue] = String(value).split(".");
      if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
      decipher.setAAD(aad);
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8"));
    } catch {
      throw new OAuthError("Stored platform authorization could not be decrypted", 500);
    }
  }

  function digest(value) {
    if (!key) throw new OAuthError("OAuth token encryption is not configured", 503);
    return createHmac("sha256", key).update(String(value)).digest();
  }

  function matches(value, expected) {
    const first = digest(value);
    const second = digest(expected);
    return first.length === second.length && timingSafeEqual(first, second);
  }

  return Object.freeze({ configured, matches, open, seal });
}

function scopesFor(definition, environment) {
  const configured = text(environment[definition.scopesKey], 1000);
  return [...new Set((configured ? configured.split(/[\s,]+/) : definition.scopes).filter(Boolean))];
}

function providerConfiguration(provider, environment, vault) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new OAuthError("Unsupported social platform", 404);
  const clientId = text(environment[definition.clientIdKey], 500);
  const clientSecret = text(environment[definition.clientSecretKey], 1000);
  const baseUrl = configuredBaseUrl(environment);
  const credentialsReady = provider === "x" ? Boolean(clientId) : Boolean(clientId && clientSecret);
  return {
    ...definition,
    provider,
    clientId,
    clientSecret,
    baseUrl,
    callbackUrl: baseUrl ? `${baseUrl}/api/v1/oauth/${provider}/callback` : "",
    scopes: scopesFor(definition, environment),
    graphVersion: provider === "meta" && /^v\d+\.\d+$/.test(text(environment.META_GRAPH_VERSION, 20))
      ? text(environment.META_GRAPH_VERSION, 20)
      : DEFAULT_META_GRAPH_VERSION,
    configured: Boolean(baseUrl && vault.configured && credentialsReady),
  };
}

function metaGraphBase(config) {
  return `https://graph.facebook.com/${config.graphVersion}`;
}

function stateCookie(value, environment, maxAge = 600) {
  return [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/api/v1/oauth",
    "HttpOnly",
    "SameSite=Lax",
    environment.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${Math.max(0, maxAge)}`,
  ].filter(Boolean).join("; ");
}

function clearStateCookie(environment) {
  return stateCookie("", environment, 0);
}

function base64UrlSha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function authorizeUrl(config, state, verifier) {
  let url;
  if (config.provider === "meta") {
    url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: config.scopes.join(","),
      state,
    });
  } else if (config.provider === "tiktok") {
    url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: config.scopes.join(","),
      state,
      // TikTok otherwise reuses a previous grant and can immediately replay a
      // stale partial-scope decision without showing the consent screen.
      disable_auto_auth: "1",
    });
  } else if (config.provider === "snapchat") {
    url = new URL("https://accounts.snapchat.com/login/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
    });
  } else if (config.provider === "x") {
    url = new URL("https://x.com/i/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
      code_challenge: base64UrlSha256(verifier),
      code_challenge_method: "S256",
    });
  } else {
    url = new URL("https://threads.net/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: "code",
      scope: config.scopes.join(","),
      state,
    });
  }
  return url.toString();
}

async function responsePayload(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

async function platformRequest(fetchImpl, url, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new OAuthError("The platform authorization service is temporarily unavailable", 502);
  }
  const payload = await responsePayload(response);
  if (!response.ok) {
    const detail = payload.error_description || payload.error?.message || payload.message || "Platform authorization failed";
    throw new OAuthError(text(detail, 240) || "Platform authorization failed", response.status === 429 ? 429 : 502);
  }
  return payload;
}

function formBody(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== "")).toString();
}

function normalizedToken(payload, previousRefreshToken = null) {
  if (!payload.access_token) throw new OAuthError("The platform did not return an access token", 502);
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previousRefreshToken || null,
    tokenType: payload.token_type || "Bearer",
    expiresAt: new Date(Date.now() + (expiresIn * 1000)).toISOString(),
    openId: payload.open_id || null,
    grantedScopes: text(payload.scope, 1000).split(/[\s,]+/).filter(Boolean),
  };
}

async function exchangeCode(config, code, verifier, fetchImpl) {
  let payload;
  if (config.provider === "meta") {
    const tokenUrl = new URL(`${metaGraphBase(config)}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      code,
    });
    payload = await platformRequest(fetchImpl, tokenUrl);
    try {
      const extendedUrl = new URL(`${metaGraphBase(config)}/oauth/access_token`);
      extendedUrl.search = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        fb_exchange_token: payload.access_token,
      });
      payload = await platformRequest(fetchImpl, extendedUrl);
    } catch {
      // A valid short-lived token is still useful when long-lived exchange is unavailable.
    }
  } else {
    const endpoints = {
      tiktok: "https://open.tiktokapis.com/v2/oauth/token/",
      snapchat: "https://accounts.snapchat.com/login/oauth2/access_token",
      x: "https://api.x.com/2/oauth2/token",
      threads: "https://graph.threads.net/oauth/access_token",
    };
    const values = config.provider === "tiktok" ? {
      client_key: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.callbackUrl,
    } : config.provider === "x" ? {
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.callbackUrl,
    } : {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.callbackUrl,
    };
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    if (config.provider === "x" && config.clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
    }
    payload = await platformRequest(fetchImpl, endpoints[config.provider], {
      method: "POST",
      headers,
      body: formBody(values),
    });
  }
  return normalizedToken(payload);
}

async function refreshAccessToken(config, token, fetchImpl) {
  if (!token.refreshToken || !["tiktok", "snapchat", "x"].includes(config.provider)) {
    throw new OAuthError(`${config.label} authorization has expired; reconnect the account`, 401);
  }
  const endpoints = {
    tiktok: "https://open.tiktokapis.com/v2/oauth/token/",
    snapchat: "https://accounts.snapchat.com/login/oauth2/access_token",
    x: "https://api.x.com/2/oauth2/token",
  };
  const values = config.provider === "tiktok" ? {
    client_key: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  } : {
    client_id: config.clientId,
    client_secret: config.provider === "snapchat" ? config.clientSecret : undefined,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  };
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (config.provider === "x" && config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }
  const payload = await platformRequest(fetchImpl, endpoints[config.provider], {
    method: "POST",
    headers,
    body: formBody(values),
  });
  return {
    ...token,
    ...normalizedToken(payload, token.refreshToken),
    openId: payload.open_id || token.openId || null,
    grantedScopes: text(payload.scope, 1000)
      ? text(payload.scope, 1000).split(/[\s,]+/).filter(Boolean)
      : token.grantedScopes || [],
  };
}

function accessTokenUrl(base, token, parameters = {}) {
  const url = new URL(base);
  url.search = new URLSearchParams({ ...parameters, access_token: token });
  return url;
}

function metaIssueMessage(area) {
  const messages = {
    permissions: "Meta did not return the permission inventory; reconnect before relying on the asset summary.",
    pages: "Grant Page list/read access and confirm the Facebook account has a role on the Page.",
    instagram: "Link an Instagram professional account to an authorized Page and grant Instagram basic access.",
    ads: "Grant ads_read and confirm the authorized person can access the ad account.",
    lead_forms: "Grant leads_retrieval and Page lead access before FanMesh can inventory Instant Forms.",
  };
  return messages[area] || "Meta did not grant access to this asset.";
}

function metaLeadActions(actions) {
  const leadTypes = new Set([
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
  ]);
  return (Array.isArray(actions) ? actions : []).reduce((sum, action) => (
    leadTypes.has(action?.action_type) ? sum + nonNegativeNumber(action.value) : sum
  ), 0);
}

function normalizedMetaMedia(media) {
  const likes = Math.round(nonNegativeNumber(media.like_count));
  const comments = Math.round(nonNegativeNumber(media.comments_count));
  return {
    id: text(media.id, 80),
    caption: text(media.caption, 180),
    mediaType: text(media.media_type, 30).toLowerCase(),
    productType: text(media.media_product_type, 30).toLowerCase(),
    permalink: safeHttpsUrl(media.permalink, "instagram.com"),
    createdAt: Number.isFinite(Date.parse(media.timestamp || "")) ? new Date(media.timestamp).toISOString() : null,
    likes,
    comments,
    interactions: likes + comments,
  };
}

async function syncMeta(config, token, fetchImpl) {
  const base = metaGraphBase(config);
  const issues = [];
  const issueAreas = new Set();
  async function optional(area, request, fallback) {
    try {
      return await request();
    } catch {
      if (!issueAreas.has(area)) {
        issueAreas.add(area);
        issues.push({ area, message: metaIssueMessage(area) });
      }
      return fallback;
    }
  }

  const profile = await platformRequest(fetchImpl, accessTokenUrl(`${base}/me`, token.accessToken, { fields: "id,name" }));
  const [permissionPayload, pagePayload, adPayload] = await Promise.all([
    optional("permissions", () => platformRequest(fetchImpl, accessTokenUrl(`${base}/me/permissions`, token.accessToken, { limit: "100" })), { data: [] }),
    optional("pages", () => platformRequest(fetchImpl, accessTokenUrl(`${base}/me/accounts`, token.accessToken, {
      fields: "id,name,access_token,fan_count,followers_count,tasks,instagram_business_account",
      limit: "100",
    })), { data: [] }),
    optional("ads", () => platformRequest(fetchImpl, accessTokenUrl(`${base}/me/adaccounts`, token.accessToken, {
      fields: "id,name,account_status,currency,timezone_name",
      limit: "100",
    })), { data: [] }),
  ]);
  const grantedScopes = (Array.isArray(permissionPayload.data) ? permissionPayload.data : [])
    .filter((permission) => permission?.status === "granted")
    .map((permission) => text(permission.permission, 100))
    .filter(Boolean);

  const pageTokens = {};
  const pages = (Array.isArray(pagePayload.data) ? pagePayload.data : []).map((page) => {
    if (page.access_token) pageTokens[page.id] = page.access_token;
    return {
      id: text(page.id, 80),
      name: text(page.name, 120),
      followers: Math.round(nonNegativeNumber(page.followers_count || page.fan_count)),
      tasks: Array.isArray(page.tasks) ? page.tasks.map((task) => text(task, 40)).filter(Boolean) : [],
      instagramId: text(page.instagram_business_account?.id, 80) || null,
    };
  });

  const instagramAccounts = (await Promise.all(pages.filter((page) => page.instagramId).map(async (page) => {
    const assetToken = pageTokens[page.id] || token.accessToken;
    const instagram = await optional("instagram", () => platformRequest(fetchImpl, accessTokenUrl(
      `${base}/${page.instagramId}`,
      assetToken,
      { fields: "id,username,name,profile_picture_url,followers_count,follows_count,media_count" },
    )), null);
    if (!instagram) return { id: page.instagramId, pageId: page.id, access: "scope_required", recentMedia: [] };
    const mediaPayload = await optional("instagram", () => platformRequest(fetchImpl, accessTokenUrl(
      `${base}/${page.instagramId}/media`,
      assetToken,
      {
        fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
        limit: "20",
      },
    )), { data: [] });
    const recentMedia = (Array.isArray(mediaPayload.data) ? mediaPayload.data : [])
      .slice(0, 20)
      .map(normalizedMetaMedia)
      .filter((media) => media.id);
    return {
      id: text(instagram.id, 80),
      username: text(instagram.username, 120),
      name: text(instagram.name, 120),
      profilePictureUrl: safeHttpsUrl(instagram.profile_picture_url, "cdninstagram.com")
        || safeHttpsUrl(instagram.profile_picture_url, "fbcdn.net"),
      followers: Math.round(nonNegativeNumber(instagram.followers_count)),
      follows: Math.round(nonNegativeNumber(instagram.follows_count)),
      mediaCount: Math.round(nonNegativeNumber(instagram.media_count)),
      pageId: page.id,
      recentMedia,
    };
  }))).filter(Boolean);

  const leadFormsByPage = await Promise.all(pages.map(async (page) => {
    const assetToken = pageTokens[page.id];
    if (!assetToken) return [];
    const formPayload = await optional("lead_forms", () => platformRequest(fetchImpl, accessTokenUrl(
      `${base}/${page.id}/leadgen_forms`,
      assetToken,
      { fields: "id,name,status,created_time", limit: "25" },
    )), { data: [] });
    return Promise.all((Array.isArray(formPayload.data) ? formPayload.data : []).slice(0, 25).map(async (form) => {
      const leadPayload = await optional("lead_forms", () => platformRequest(fetchImpl, accessTokenUrl(
        `${base}/${form.id}/leads`,
        assetToken,
        { fields: "id,created_time", limit: "1", summary: "true" },
      )), null);
      return {
        id: text(form.id, 80),
        pageId: page.id,
        name: text(form.name, 120) || "Untitled Instant Form",
        status: text(form.status, 40).toLowerCase(),
        createdAt: Number.isFinite(Date.parse(form.created_time || "")) ? new Date(form.created_time).toISOString() : null,
        leadCount: leadPayload && Number.isFinite(Number(leadPayload.summary?.total_count))
          ? Math.max(0, Number(leadPayload.summary.total_count))
          : null,
        latestLeadAt: leadPayload?.data?.[0]?.created_time || null,
      };
    }));
  }));
  const leadForms = leadFormsByPage.flat();

  const adAccounts = await Promise.all((Array.isArray(adPayload.data) ? adPayload.data : []).map(async (account) => {
    const insightPayload = await optional("ads", () => platformRequest(fetchImpl, accessTokenUrl(
      `${base}/${account.id}/insights`,
      token.accessToken,
      { fields: "spend,impressions,reach,clicks,actions", date_preset: "last_30d", level: "account", limit: "1" },
    )), { data: [] });
    const insight = insightPayload.data?.[0] || {};
    return {
      id: text(account.id, 80),
      name: text(account.name, 120),
      status: Number(account.account_status) || 0,
      currency: text(account.currency, 10),
      timezone: text(account.timezone_name, 80),
      insights30d: {
        spend: nonNegativeNumber(insight.spend),
        impressions: Math.round(nonNegativeNumber(insight.impressions)),
        reach: Math.round(nonNegativeNumber(insight.reach)),
        clicks: Math.round(nonNegativeNumber(insight.clicks)),
        leads: Math.round(metaLeadActions(insight.actions)),
      },
    };
  }));

  const currencies = [...new Set(adAccounts.map((account) => account.currency).filter(Boolean))];
  const adSummary30d = {
    period: "last_30d",
    currency: currencies.length === 1 ? currencies[0] : currencies.length ? "mixed" : null,
    spend: currencies.length <= 1 ? adAccounts.reduce((sum, account) => sum + account.insights30d.spend, 0) : null,
    impressions: adAccounts.reduce((sum, account) => sum + account.insights30d.impressions, 0),
    reach: adAccounts.reduce((sum, account) => sum + account.insights30d.reach, 0),
    clicks: adAccounts.reduce((sum, account) => sum + account.insights30d.clicks, 0),
    leads: adAccounts.reduce((sum, account) => sum + account.insights30d.leads, 0),
  };
  const recentMedia = instagramAccounts.flatMap((account) => account.recentMedia || []);
  const totalFollowers = pages.reduce((sum, page) => sum + page.followers, 0)
    + instagramAccounts.reduce((sum, account) => sum + (account.followers || 0), 0);
  const knownLeadCount = leadForms.reduce((sum, form) => sum + (Number(form.leadCount) || 0), 0);
  return {
    externalAccountId: profile.id,
    publicData: {
      profile: { id: text(profile.id, 80), name: text(profile.name, 120) },
      pages,
      instagramAccounts,
      adAccounts,
      leadForms,
      adSummary30d,
      grantedPermissions: grantedScopes,
      syncIssues: issues,
    },
    privateData: { pageTokens },
    grantedScopes,
    metrics: {
      totalFollowers,
      averageViews: 0,
      pages: pages.length,
      instagramAccounts: instagramAccounts.length,
      adAccounts: adAccounts.length,
      leadForms: leadForms.length,
      knownLeads: knownLeadCount,
      recentMediaCount: recentMedia.length,
      recentMediaInteractions: recentMedia.reduce((sum, media) => sum + media.interactions, 0),
      adImpressions30d: adSummary30d.impressions,
      adReach30d: adSummary30d.reach,
      adClicks30d: adSummary30d.clicks,
      adLeads30d: adSummary30d.leads,
    },
  };
}

async function syncTikTok(token, fetchImpl) {
  const fields = [
    "open_id",
    "union_id",
    "avatar_url",
    "display_name",
    ...(token.grantedScopes.includes("user.info.profile") ? ["username"] : []),
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");
  const payload = await platformRequest(fetchImpl, `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (payload.error?.code && payload.error.code !== "ok") throw new OAuthError(text(payload.error.message, 240) || "TikTok profile sync failed", 502);
  const user = payload.data?.user || {};
  let recentVideos = [];
  if (token.grantedScopes.includes("video.list")) {
    const videoFields = [
      "id",
      "create_time",
      "share_url",
      "video_description",
      "duration",
      "title",
      "like_count",
      "comment_count",
      "share_count",
      "view_count",
    ].join(",");
    const videoPayload = await platformRequest(fetchImpl, `https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(videoFields)}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ max_count: 20 }),
    });
    if (videoPayload.error?.code && videoPayload.error.code !== "ok") {
      throw new OAuthError(text(videoPayload.error.message, 240) || "TikTok video sync failed", 502);
    }
    recentVideos = (Array.isArray(videoPayload.data?.videos) ? videoPayload.data.videos : [])
      .slice(0, 20)
      .map((video) => {
        const createdSeconds = nonNegativeNumber(video.create_time);
        return {
          id: text(video.id, 80),
          title: text(video.title || video.video_description, 150) || "Untitled TikTok post",
          description: text(video.video_description, 150),
          shareUrl: safeHttpsUrl(video.share_url, "tiktok.com"),
          createdAt: createdSeconds ? new Date(createdSeconds * 1000).toISOString() : null,
          duration: Math.round(nonNegativeNumber(video.duration)),
          views: Math.round(nonNegativeNumber(video.view_count)),
          likes: Math.round(nonNegativeNumber(video.like_count)),
          comments: Math.round(nonNegativeNumber(video.comment_count)),
          shares: Math.round(nonNegativeNumber(video.share_count)),
        };
      })
      .filter((video) => video.id);
  }
  const totalViews = recentVideos.reduce((sum, video) => sum + video.views, 0);
  const totalLikes = recentVideos.reduce((sum, video) => sum + video.likes, 0);
  const totalComments = recentVideos.reduce((sum, video) => sum + video.comments, 0);
  const totalShares = recentVideos.reduce((sum, video) => sum + video.shares, 0);
  const sortedViews = recentVideos.map((video) => video.views).sort((first, second) => first - second);
  const middle = Math.floor(sortedViews.length / 2);
  const medianViews = sortedViews.length
    ? Math.round(sortedViews.length % 2 ? sortedViews[middle] : (sortedViews[middle - 1] + sortedViews[middle]) / 2)
    : 0;
  const averageViews = recentVideos.length ? Math.round(totalViews / recentVideos.length) : 0;
  const engagementRate = totalViews
    ? Math.round(((totalLikes + totalComments + totalShares) / totalViews) * 10000) / 100
    : 0;
  return {
    externalAccountId: user.open_id || token.openId,
    publicData: { profile: {
      id: user.open_id || token.openId,
      username: user.username,
      name: user.display_name,
      avatarUrl: user.avatar_url,
      followers: Number(user.follower_count) || 0,
      following: Number(user.following_count) || 0,
      likes: Number(user.likes_count) || 0,
      videos: Number(user.video_count) || 0,
    }, recentVideos },
    privateData: {},
    metrics: {
      totalFollowers: Math.round(nonNegativeNumber(user.follower_count)),
      averageViews,
      medianViews,
      engagementRate,
      recentVideoCount: recentVideos.length,
      totalRecentViews: totalViews,
      recentLikes: totalLikes,
      recentComments: totalComments,
      recentShares: totalShares,
      latestVideoAt: recentVideos[0]?.createdAt || null,
      performanceWindow: "latest_20_public_posts",
    },
  };
}

async function syncSnapchat(token, fetchImpl) {
  const payload = await platformRequest(fetchImpl, "https://adsapi.snapchat.com/v1/me/organizations?with_ad_accounts=true", {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  const organizations = (payload.organizations || payload.data || []).map((organization) => ({
    id: organization.id,
    name: organization.name,
    adAccounts: (organization.ad_accounts || organization.adaccounts || []).map((account) => ({
      id: account.id,
      name: account.name,
      status: account.status,
      currency: account.currency,
      timezone: account.timezone,
    })),
  }));
  return {
    externalAccountId: organizations[0]?.id || "snapchat-user",
    publicData: { organizations },
    privateData: {},
    metrics: {
      totalFollowers: 0,
      averageViews: 0,
      adAccounts: organizations.reduce((sum, organization) => sum + organization.adAccounts.length, 0),
    },
  };
}

async function syncX(token, fetchImpl) {
  const payload = await platformRequest(fetchImpl, "https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,public_metrics,verified", {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  const user = payload.data || {};
  return {
    externalAccountId: user.id,
    publicData: { profile: {
      id: user.id,
      username: user.username,
      name: user.name,
      profileImageUrl: user.profile_image_url,
      verified: Boolean(user.verified),
      metrics: user.public_metrics || {},
    } },
    privateData: {},
    metrics: {
      totalFollowers: Number(user.public_metrics?.followers_count) || 0,
      averageViews: 0,
    },
  };
}

async function syncThreads(token, fetchImpl) {
  const profile = await platformRequest(fetchImpl, accessTokenUrl("https://graph.threads.net/v1.0/me", token.accessToken, {
    fields: "id,username,threads_profile_picture_url,threads_biography",
  }));
  return {
    externalAccountId: profile.id,
    publicData: { profile: {
      id: profile.id,
      username: profile.username,
      profilePictureUrl: profile.threads_profile_picture_url,
      biography: profile.threads_biography,
    } },
    privateData: {},
    metrics: { totalFollowers: 0, averageViews: 0 },
  };
}

async function synchronize(config, token, fetchImpl) {
  if (config.provider === "meta") return syncMeta(config, token, fetchImpl);
  if (config.provider === "tiktok") return syncTikTok(token, fetchImpl);
  if (config.provider === "snapchat") return syncSnapchat(token, fetchImpl);
  if (config.provider === "x") return syncX(token, fetchImpl);
  return syncThreads(token, fetchImpl);
}

function safeAccountLabel(syncResult, providerLabel) {
  const profile = syncResult.publicData?.profile;
  return text(profile?.name || profile?.username || syncResult.publicData?.organizations?.[0]?.name, 120) || providerLabel;
}

export function createOAuthService({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  workspaceStore,
  now = () => Date.now(),
} = {}) {
  const vault = createTokenVault(environment);

  function config(provider) {
    return providerConfiguration(provider, environment, vault);
  }

  function catalog(connections = {}) {
    return Object.keys(PROVIDERS).map((provider) => {
      const providerConfig = config(provider);
      const connection = connections[provider] || {};
      const status = typeof connection === "string" ? connection : connection.status || "not_connected";
      const account = typeof connection === "object" ? connection.account : undefined;
      return {
        platform: provider,
        label: providerConfig.label,
        authMethod: provider === "x" ? "oauth_2_pkce" : "oauth_2",
        capabilities: providerConfig.capabilities,
        caveat: providerConfig.caveat,
        status,
        configured: providerConfig.configured,
        connectUrl: providerConfig.configured ? `/api/v1/oauth/${provider}/start` : null,
        callbackUrl: providerConfig.callbackUrl || null,
        account,
        tokenPolicy: "Access and refresh tokens are encrypted before storage and never returned to the browser.",
      };
    });
  }

  function requireReady(provider) {
    const providerConfig = config(provider);
    if (!providerConfig.configured) {
      throw new OAuthError(`${providerConfig.label} developer credentials are not configured yet`, 503);
    }
    if (!workspaceStore) throw new OAuthError("OAuth connection storage is unavailable", 503);
    return providerConfig;
  }

  async function begin(provider, session) {
    const providerConfig = requireReady(provider);
    const state = randomBytes(24).toString("base64url");
    const verifier = provider === "x" ? randomBytes(48).toString("base64url") : null;
    const stateRecord = {
      state,
      provider,
      userId: session.user.id,
      verifier,
      issuedAt: now(),
    };
    return {
      redirectUrl: authorizeUrl(providerConfig, state, verifier),
      cookies: [stateCookie(vault.seal(stateRecord), environment)],
    };
  }

  function readState(provider, session, request, returnedState) {
    const cookies = parseCookies(request.headers?.cookie);
    if (!cookies[STATE_COOKIE]) throw new OAuthError("OAuth session is missing or expired");
    const stateRecord = vault.open(cookies[STATE_COOKIE]);
    if (
      stateRecord.provider !== provider
      || stateRecord.userId !== session.user.id
      || !vault.matches(stateRecord.state, returnedState)
      || now() - Number(stateRecord.issuedAt) > STATE_TTL_MS
      || now() < Number(stateRecord.issuedAt) - 60000
    ) {
      throw new OAuthError("OAuth state verification failed");
    }
    return stateRecord;
  }

  async function callback(provider, session, requestUrl, request) {
    const providerConfig = requireReady(provider);
    const error = text(requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error"), 240);
    if (error) throw new OAuthError(error);
    const code = text(requestUrl.searchParams.get("code"), 4000);
    const returnedState = text(requestUrl.searchParams.get("state"), 500);
    if (!code || !returnedState) throw new OAuthError("The platform did not return a valid authorization code");
    const stateRecord = readState(provider, session, request, returnedState);
    const token = await exchangeCode(providerConfig, code, stateRecord.verifier, fetchImpl);
    const syncResult = await synchronize(providerConfig, token, fetchImpl);
    const storedToken = Array.isArray(syncResult.grantedScopes)
      ? { ...token, grantedScopes: syncResult.grantedScopes }
      : token;
    const credentials = vault.seal({ ...storedToken, providerAssets: syncResult.privateData });
    const saved = await workspaceStore.saveSourceConnection(session.user, session.accessToken, {
      platform: provider,
      status: "connected",
      externalAccountId: syncResult.externalAccountId,
      scopes: Array.isArray(syncResult.grantedScopes)
        ? syncResult.grantedScopes
        : token.grantedScopes.length ? token.grantedScopes : providerConfig.scopes,
      metadata: {
        public: syncResult.publicData,
        metrics: syncResult.metrics,
        credentials,
        connectedAt: new Date(now()).toISOString(),
        syncedAt: new Date(now()).toISOString(),
      },
    });
    return {
      provider,
      status: "connected",
      account: safeAccountLabel(syncResult, providerConfig.label),
      saved,
      cookies: [clearStateCookie(environment)],
    };
  }

  async function sync(provider, session) {
    const providerConfig = requireReady(provider);
    const connection = await workspaceStore.getSourceConnection(session.user, session.accessToken, provider);
    if (!connection?.metadata?.credentials) throw new OAuthError(`${providerConfig.label} is not connected`, 409);
    let token = vault.open(connection.metadata.credentials);
    if (Date.parse(token.expiresAt || "") <= now()) token = await refreshAccessToken(providerConfig, token, fetchImpl);
    const syncResult = await synchronize(providerConfig, token, fetchImpl);
    const storedToken = Array.isArray(syncResult.grantedScopes)
      ? { ...token, grantedScopes: syncResult.grantedScopes }
      : token;
    const saved = await workspaceStore.saveSourceConnection(session.user, session.accessToken, {
      platform: provider,
      status: "connected",
      externalAccountId: syncResult.externalAccountId,
      scopes: Array.isArray(syncResult.grantedScopes) ? syncResult.grantedScopes : connection.scopes || providerConfig.scopes,
      metadata: {
        ...connection.metadata,
        public: syncResult.publicData,
        metrics: syncResult.metrics,
        credentials: vault.seal({ ...storedToken, providerAssets: syncResult.privateData }),
        syncedAt: new Date(now()).toISOString(),
      },
    });
    return { provider, status: "connected", account: safeAccountLabel(syncResult, providerConfig.label), saved };
  }

  async function disconnect(provider, session) {
    const providerConfig = config(provider);
    if (!PROVIDERS[provider]) throw new OAuthError("Unsupported social platform", 404);
    await workspaceStore.saveSourceConnection(session.user, session.accessToken, {
      platform: provider,
      status: "revoked",
      externalAccountId: null,
      scopes: [],
      metadata: { public: {}, metrics: {}, revokedAt: new Date(now()).toISOString() },
    });
    return { provider, label: providerConfig.label, status: "revoked" };
  }

  return Object.freeze({ begin, callback, catalog, disconnect, sync, vault });
}

export { PROVIDERS, STATE_COOKIE };
