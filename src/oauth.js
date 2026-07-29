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
    capabilities: ["Facebook Pages", "Instagram insights", "Meta ad accounts", "Lead access"],
    caveat: "Pages, Instagram professional accounts, ads and leads appear only when Meta grants the matching scopes.",
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
    configured: Boolean(baseUrl && vault.configured && credentialsReady),
  };
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
    url = new URL("https://www.facebook.com/dialog/oauth");
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
    const tokenUrl = new URL("https://graph.facebook.com/oauth/access_token");
    tokenUrl.search = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      code,
    });
    payload = await platformRequest(fetchImpl, tokenUrl);
    try {
      const extendedUrl = new URL("https://graph.facebook.com/oauth/access_token");
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

async function syncMeta(token, fetchImpl) {
  const profile = await platformRequest(fetchImpl, accessTokenUrl("https://graph.facebook.com/me", token.accessToken, { fields: "id,name" }));
  const [pagePayload, adPayload] = await Promise.all([
    platformRequest(fetchImpl, accessTokenUrl("https://graph.facebook.com/me/accounts", token.accessToken, {
      fields: "id,name,fan_count,followers_count,tasks,instagram_business_account",
      limit: "100",
    })).catch(() => ({ data: [] })),
    platformRequest(fetchImpl, accessTokenUrl("https://graph.facebook.com/me/adaccounts", token.accessToken, {
      fields: "id,name,account_status,currency,timezone_name",
      limit: "100",
    })).catch(() => ({ data: [] })),
  ]);
  const pages = [];
  const instagramAccounts = [];
  const pageTokens = {};
  for (const page of pagePayload.data || []) {
    pages.push({
      id: page.id,
      name: page.name,
      followers: Number(page.followers_count || page.fan_count) || 0,
      tasks: Array.isArray(page.tasks) ? page.tasks : [],
    });
    if (page.access_token) pageTokens[page.id] = page.access_token;
    if (page.instagram_business_account?.id) {
      try {
        const instagram = await platformRequest(fetchImpl, accessTokenUrl(
          `https://graph.facebook.com/${page.instagram_business_account.id}`,
          page.access_token || token.accessToken,
          { fields: "id,username,name,profile_picture_url,followers_count,follows_count,media_count" },
        ));
        instagramAccounts.push({
          id: instagram.id,
          username: instagram.username,
          name: instagram.name,
          profilePictureUrl: instagram.profile_picture_url,
          followers: Number(instagram.followers_count) || 0,
          follows: Number(instagram.follows_count) || 0,
          mediaCount: Number(instagram.media_count) || 0,
          pageId: page.id,
        });
      } catch {
        instagramAccounts.push({ id: page.instagram_business_account.id, pageId: page.id, access: "scope_required" });
      }
    }
  }
  const adAccounts = (adPayload.data || []).map((account) => ({
    id: account.id,
    name: account.name,
    status: account.account_status,
    currency: account.currency,
    timezone: account.timezone_name,
  }));
  const totalFollowers = pages.reduce((sum, page) => sum + page.followers, 0)
    + instagramAccounts.reduce((sum, account) => sum + (account.followers || 0), 0);
  return {
    externalAccountId: profile.id,
    publicData: { profile: { id: profile.id, name: profile.name }, pages, instagramAccounts, adAccounts },
    privateData: { pageTokens },
    metrics: { totalFollowers, averageViews: 0, pages: pages.length, adAccounts: adAccounts.length },
  };
}

async function syncTikTok(token, fetchImpl) {
  const fields = "open_id,union_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count";
  const payload = await platformRequest(fetchImpl, `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });
  if (payload.error?.code && payload.error.code !== "ok") throw new OAuthError(text(payload.error.message, 240) || "TikTok profile sync failed", 502);
  const user = payload.data?.user || {};
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
    } },
    privateData: {},
    metrics: { totalFollowers: Number(user.follower_count) || 0, averageViews: 0 },
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
  if (config.provider === "meta") return syncMeta(token, fetchImpl);
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
    const credentials = vault.seal({ ...token, providerAssets: syncResult.privateData });
    const saved = await workspaceStore.saveSourceConnection(session.user, session.accessToken, {
      platform: provider,
      status: "connected",
      externalAccountId: syncResult.externalAccountId,
      scopes: token.grantedScopes.length ? token.grantedScopes : providerConfig.scopes,
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
    const saved = await workspaceStore.saveSourceConnection(session.user, session.accessToken, {
      platform: provider,
      status: "connected",
      externalAccountId: syncResult.externalAccountId,
      scopes: connection.scopes || providerConfig.scopes,
      metadata: {
        ...connection.metadata,
        public: syncResult.publicData,
        metrics: syncResult.metrics,
        credentials: vault.seal({ ...token, providerAssets: syncResult.privateData }),
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
