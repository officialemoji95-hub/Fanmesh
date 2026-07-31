import { getSupabaseConfig } from "./auth.js";

export class DatabaseError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "DatabaseError";
    this.statusCode = statusCode;
  }
}

export const emptyAudienceSnapshot = Object.freeze({
  totalFollowers: 0,
  averageViews: 0,
  identifiedFans: 0,
  directConnections: 0,
  connectedPlatforms: 0,
});

function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "No signals yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function toFanRecord(row = {}) {
  return {
    id: row.id,
    displayName: row.display_name || "Anonymous fan",
    location: row.location || "Location unknown",
    channels: Array.isArray(row.channels) ? row.channels : [],
    consentedChannels: Array.isArray(row.consented_channels) ? row.consented_channels : [],
    lastSeen: relativeTime(row.last_seen),
    metrics: row.metrics && typeof row.metrics === "object" ? row.metrics : {},
  };
}

function shortText(value, maxLength = 150) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safePublicUrl(value, allowedHost) {
  try {
    const url = new URL(shortText(value, 1000));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== allowedHost && !url.hostname.endsWith(`.${allowedHost}`)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function publicConnectionState(row = {}, providerWebhooks = []) {
  const publicData = row.metadata?.public || {};
  const profile = publicData.profile || {};
  const organizations = Array.isArray(publicData.organizations) ? publicData.organizations : [];
  const metrics = row.metadata?.metrics || {};
  const recentVideos = (Array.isArray(publicData.recentVideos) ? publicData.recentVideos : [])
    .slice(0, 20)
    .map((video) => ({
      id: String(video?.id || "").slice(0, 80),
      title: String(video?.title || "Untitled TikTok post").slice(0, 150),
      description: String(video?.description || "").slice(0, 150),
      shareUrl: String(video?.shareUrl || "").slice(0, 1000),
      createdAt: video?.createdAt || null,
      duration: Math.max(0, Number(video?.duration) || 0),
      views: Math.max(0, Number(video?.views) || 0),
      likes: Math.max(0, Number(video?.likes) || 0),
      comments: Math.max(0, Number(video?.comments) || 0),
      shares: Math.max(0, Number(video?.shares) || 0),
    }))
    .filter((video) => video.id);
  const pages = (Array.isArray(publicData.pages) ? publicData.pages : []).slice(0, 100).map((page) => ({
    id: shortText(page?.id, 80),
    name: shortText(page?.name, 120) || "Untitled Page",
    followers: Math.max(0, Number(page?.followers) || 0),
  })).filter((page) => page.id);
  const instagramAccounts = (Array.isArray(publicData.instagramAccounts) ? publicData.instagramAccounts : [])
    .slice(0, 100)
    .map((account) => ({
      id: shortText(account?.id, 80),
      username: shortText(account?.username, 120),
      name: shortText(account?.name, 120),
      followers: Math.max(0, Number(account?.followers) || 0),
      follows: Math.max(0, Number(account?.follows) || 0),
      mediaCount: Math.max(0, Number(account?.mediaCount) || 0),
      access: shortText(account?.access, 40) || null,
      recentMedia: (Array.isArray(account?.recentMedia) ? account.recentMedia : []).slice(0, 20).map((media) => ({
        id: shortText(media?.id, 80),
        caption: shortText(media?.caption, 180) || "Untitled Instagram post",
        mediaType: shortText(media?.mediaType, 30),
        productType: shortText(media?.productType, 30),
        permalink: safePublicUrl(media?.permalink, "instagram.com"),
        createdAt: media?.createdAt || null,
        likes: Math.max(0, Number(media?.likes) || 0),
        comments: Math.max(0, Number(media?.comments) || 0),
        interactions: Math.max(0, Number(media?.interactions) || 0),
        views: Math.max(0, Number(media?.views) || 0),
        reach: Math.max(0, Number(media?.reach) || 0),
        saves: Math.max(0, Number(media?.saves) || 0),
        shares: Math.max(0, Number(media?.shares) || 0),
        totalInteractions: Math.max(0, Number(media?.totalInteractions) || 0),
        engagementRate: Math.max(0, Number(media?.engagementRate) || 0),
      })).filter((media) => media.id),
    })).filter((account) => account.id);
  const adAccounts = (Array.isArray(publicData.adAccounts) ? publicData.adAccounts : []).slice(0, 100).map((account) => ({
    id: shortText(account?.id, 80),
    name: shortText(account?.name, 120) || "Untitled ad account",
    status: Number(account?.status) || 0,
    currency: shortText(account?.currency, 10),
    timezone: shortText(account?.timezone, 80),
    insights30d: {
      spend: Math.max(0, Number(account?.insights30d?.spend) || 0),
      impressions: Math.max(0, Number(account?.insights30d?.impressions) || 0),
      reach: Math.max(0, Number(account?.insights30d?.reach) || 0),
      clicks: Math.max(0, Number(account?.insights30d?.clicks) || 0),
      leads: Math.max(0, Number(account?.insights30d?.leads) || 0),
    },
  })).filter((account) => account.id);
  const leadForms = (Array.isArray(publicData.leadForms) ? publicData.leadForms : []).slice(0, 250).map((form) => ({
    id: shortText(form?.id, 80),
    pageId: shortText(form?.pageId, 80),
    adAccountId: shortText(form?.adAccountId, 160),
    name: shortText(form?.name, 120) || "Untitled Instant Form",
    title: shortText(form?.title, 160),
    status: shortText(form?.status, 40),
    createdAt: form?.createdAt || null,
    updatedAt: form?.updatedAt || null,
    contactFields: (Array.isArray(form?.contactFields) ? form.contactFields : []).map((field) => shortText(field, 60)).filter(Boolean),
    requiredConsentCount: Math.max(0, Number(form?.requiredConsentCount) || 0),
    hasLegalDisclosure: Boolean(form?.hasLegalDisclosure),
    webhookStatus: shortText(form?.webhookStatus, 40) || "not_configured",
    capturedLeads: Math.max(0, Number(form?.capturedLeads) || 0),
    lastLeadAt: form?.lastLeadAt || null,
    leadCount: form?.leadCount !== null && form?.leadCount !== undefined && Number.isFinite(Number(form.leadCount))
      ? Math.max(0, Number(form.leadCount))
      : null,
    latestLeadAt: form?.latestLeadAt || null,
  })).filter((form) => form.id);
  for (const form of leadForms) {
    const webhook = providerWebhooks.find((item) => item.external_form_id === form.id);
    if (!webhook) continue;
    form.webhookStatus = shortText(webhook.status, 40) || form.webhookStatus;
    form.capturedLeads = Math.max(0, Number(webhook.received_count) || 0);
    form.lastLeadAt = webhook.last_received_at || form.lastLeadAt;
  }
  const syncIssues = (Array.isArray(publicData.syncIssues) ? publicData.syncIssues : []).slice(0, 10).map((issue) => ({
    area: shortText(issue?.area, 40),
    message: shortText(issue?.message, 240),
  })).filter((issue) => issue.area && issue.message);
  const adSummary30d = publicData.adSummary30d && typeof publicData.adSummary30d === "object" ? {
    period: "last_30d",
    currency: shortText(publicData.adSummary30d.currency, 10) || null,
    spend: Number.isFinite(Number(publicData.adSummary30d.spend)) ? Math.max(0, Number(publicData.adSummary30d.spend)) : null,
    impressions: Math.max(0, Number(publicData.adSummary30d.impressions) || 0),
    reach: Math.max(0, Number(publicData.adSummary30d.reach) || 0),
    clicks: Math.max(0, Number(publicData.adSummary30d.clicks) || 0),
    leads: Math.max(0, Number(publicData.adSummary30d.leads) || 0),
  } : null;
  const accountName = profile.name || profile.username || organizations[0]?.name || null;
  return {
    status: row.status || "not_connected",
    externalAccountId: row.external_account_id || null,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    account: accountName ? {
      name: accountName,
      username: profile.username || null,
      followers: Number(metrics.totalFollowers) || 0,
      adAccounts: Number(metrics.adAccounts) || 0,
      pageCount: Number(metrics.pages) || pages.length,
      instagramAccountCount: Number(metrics.instagramAccounts) || instagramAccounts.length,
      leadFormCount: Number(metrics.leadForms) || leadForms.length,
      knownLeads: Number(metrics.knownLeads) || 0,
      liveLeadForms: providerWebhooks.filter((item) => item.status === "active").length || Number(metrics.liveLeadForms) || 0,
      capturedLeads: providerWebhooks.reduce((sum, item) => sum + (Number(item.received_count) || 0), 0) || Number(metrics.capturedLeads) || 0,
      recentMediaCount: Number(metrics.recentMediaCount) || instagramAccounts.reduce((sum, account) => sum + account.recentMedia.length, 0),
      recentMediaInteractions: Number(metrics.recentMediaInteractions) || 0,
      recentMediaReach: Number(metrics.recentMediaReach) || 0,
      recentMediaViews: Number(metrics.recentMediaViews) || 0,
      averageMetaReach: Number(metrics.averageMetaReach) || 0,
      medianMetaReach: Number(metrics.medianMetaReach) || 0,
      metaEngagementRate: Number(metrics.metaEngagementRate) || 0,
      adImpressions30d: Number(metrics.adImpressions30d) || 0,
      adReach30d: Number(metrics.adReach30d) || 0,
      adClicks30d: Number(metrics.adClicks30d) || 0,
      adLeads30d: Number(metrics.adLeads30d) || 0,
      averageViews: Number(metrics.averageViews) || 0,
      medianViews: Number(metrics.medianViews) || 0,
      engagementRate: Number(metrics.engagementRate) || 0,
      recentVideoCount: Number(metrics.recentVideoCount) || recentVideos.length,
      totalRecentViews: Number(metrics.totalRecentViews) || 0,
      recentLikes: Number(metrics.recentLikes) || 0,
      recentComments: Number(metrics.recentComments) || 0,
      recentShares: Number(metrics.recentShares) || 0,
      latestVideoAt: metrics.latestVideoAt || recentVideos[0]?.createdAt || null,
      performanceWindow: metrics.performanceWindow || null,
      recentVideos,
      pages,
      instagramAccounts,
      adAccountsDetail: adAccounts,
      leadForms,
      adSummary30d,
      syncIssues,
      syncedAt: row.metadata?.syncedAt || row.updated_at || null,
    } : null,
  };
}

function queryValue(value) {
  return encodeURIComponent(String(value));
}

export function createWorkspaceStore({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getSupabaseConfig(environment);
  const adminKey = shortText(environment.SUPABASE_SERVICE_ROLE_KEY, 3000);

  async function request(path, token, { method = "GET", body, prefer } = {}) {
    if (!config.configured) throw new DatabaseError("Supabase is not configured", 503);
    let response;
    try {
      response = await fetchImpl(`${config.url}${path}`, {
        method,
        signal: AbortSignal.timeout(12000),
        headers: {
          apikey: token === adminKey && adminKey ? adminKey : config.key,
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(prefer ? { prefer } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new DatabaseError("Audience database is temporarily unavailable", 502);
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "You do not have access to this workspace"
        : payload?.message || "Audience database request failed";
      throw new DatabaseError(message, response.status === 401 || response.status === 403 ? response.status : 502);
    }
    return payload;
  }

  async function countRows(path, token) {
    if (!config.configured) throw new DatabaseError("Supabase is not configured", 503);
    let response;
    try {
      response = await fetchImpl(`${config.url}${path}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(12000),
        headers: {
          apikey: token === adminKey && adminKey ? adminKey : config.key,
          authorization: `Bearer ${token}`,
          prefer: "count=exact",
          range: "0-0",
        },
      });
    } catch {
      throw new DatabaseError("Audience database is temporarily unavailable", 502);
    }
    if (!response.ok) throw new DatabaseError("Audience database count failed", response.status === 401 || response.status === 403 ? response.status : 502);
    const contentRange = response.headers?.get?.("content-range") || "";
    const exact = Number(contentRange.split("/")[1]);
    if (Number.isFinite(exact)) return exact;
    const fallbackText = await response.text();
    try {
      const fallback = fallbackText ? JSON.parse(fallbackText) : [];
      return Array.isArray(fallback) ? fallback.length : 0;
    } catch {
      return 0;
    }
  }

  async function workspaceFor(user, token) {
    const memberships = await request(
      `/rest/v1/workspace_members?select=workspace_id,role&user_id=eq.${queryValue(user.id)}&limit=1`,
      token,
    );
    if (!memberships?.length) throw new DatabaseError("Your workspace is still being provisioned", 409);
    const membership = memberships[0];
    const workspaces = await request(
      `/rest/v1/workspaces?select=id,name,slug&limit=1&id=eq.${queryValue(membership.workspace_id)}`,
      token,
    );
    if (!workspaces?.length) throw new DatabaseError("Workspace not found", 404);
    return { ...workspaces[0], role: membership.role };
  }

  async function getDashboard(user, token, limit = 20) {
    const workspace = await workspaceFor(user, token);
    const workspaceId = queryValue(workspace.id);
    const [fanRows, snapshots, connectionRows] = await Promise.all([
      request(`/rest/v1/fans?select=id,display_name,location,channels,consented_channels,last_seen,metrics&workspace_id=eq.${workspaceId}&order=last_seen.desc.nullslast&limit=${Math.min(100, Math.max(1, limit))}`, token),
      request(`/rest/v1/audience_snapshots?select=total_followers,average_views,identified_fans,direct_connections,connected_platforms,captured_at&workspace_id=eq.${workspaceId}&order=captured_at.desc&limit=1`, token),
      request(`/rest/v1/source_connections?select=platform,status,external_account_id,scopes,metadata,updated_at&workspace_id=eq.${workspaceId}`, token),
    ]);
    const fans = (fanRows || []).map(toFanRecord);
    const latest = snapshots?.[0];
    const snapshot = latest ? {
      totalFollowers: Number(latest.total_followers) || 0,
      averageViews: Number(latest.average_views) || 0,
      identifiedFans: Number(latest.identified_fans) || fans.length,
      directConnections: Number(latest.direct_connections) || fans.filter((fan) => fan.consentedChannels.length).length,
      connectedPlatforms: Number(latest.connected_platforms) || 0,
    } : {
      ...emptyAudienceSnapshot,
      identifiedFans: fans.length,
      directConnections: fans.filter((fan) => fan.consentedChannels.length).length,
      connectedPlatforms: new Set((connectionRows || []).filter((row) => row.status === "connected").map((row) => row.platform)).size,
    };
    let webhookRows = [];
    let providerWebhookSchemaReady = true;
    try {
      webhookRows = await request(
        `/rest/v1/provider_webhooks?select=platform,external_form_id,status,received_count,last_received_at&workspace_id=eq.${workspaceId}`,
        token,
      ) || [];
    } catch {
      providerWebhookSchemaReady = false;
      // The dashboard remains usable until the optional provider-webhook migration is installed.
    }
    return {
      workspace,
      fans,
      snapshot,
      connectionStatuses: Object.fromEntries((connectionRows || []).map((row) => [
        row.platform,
        publicConnectionState(row, webhookRows.filter((item) => item.platform === row.platform)),
      ])),
      readiness: { providerWebhookSchemaReady },
    };
  }

  async function getActivationEligibility(user, token) {
    const workspace = await workspaceFor(user, token);
    const workspaceId = queryValue(workspace.id);
    const fanCountPath = `/rest/v1/fans?select=id&workspace_id=eq.${workspaceId}`;
    const [
      identifiedFans,
      directConnections,
      email,
      sms,
      instagram,
      facebook,
      tiktok,
      youtube,
    ] = await Promise.all([
      countRows(fanCountPath, token),
      countRows(`${fanCountPath}&consented_channels=not.eq.%7B%7D`, token),
      countRows(`${fanCountPath}&consented_channels=cs.%7Bemail%7D`, token),
      countRows(`${fanCountPath}&consented_channels=cs.%7Bsms%7D`, token),
      countRows(`${fanCountPath}&channels=cs.%7Binstagram%7D`, token),
      countRows(`${fanCountPath}&channels=cs.%7Bfacebook%7D`, token),
      countRows(`${fanCountPath}&channels=cs.%7Btiktok%7D`, token),
      countRows(`${fanCountPath}&channels=cs.%7Byoutube%7D`, token),
    ]);
    return {
      workspace,
      identifiedFans,
      directConnections,
      platformOnly: Math.max(0, identifiedFans - directConnections),
      channels: { email, sms },
      platforms: { instagram, facebook, tiktok, youtube },
    };
  }

  async function saveExperiment(user, token, plan) {
    const workspace = await workspaceFor(user, token);
    const rows = await request("/rest/v1/social_experiments", token, {
      method: "POST",
      prefer: "return=representation",
      body: [{
        workspace_id: workspace.id,
        created_by: user.id,
        external_key: plan.id,
        content_id: plan.contentId,
        objective: plan.objective,
        status: "draft",
        plan,
      }],
    });
    return { ...plan, databaseId: rows?.[0]?.id, status: "saved" };
  }

  async function listActivations(user, token, limit = 10) {
    const workspace = await workspaceFor(user, token);
    const rows = await request(
      `/rest/v1/social_experiments?select=id,status,plan,created_at&workspace_id=eq.${queryValue(workspace.id)}&order=created_at.desc&limit=${Math.min(50, Math.max(1, limit * 3))}`,
      token,
    );
    return (rows || [])
      .filter((row) => row.plan?.kind === "fan_activation_v1")
      .slice(0, limit)
      .map((row) => ({
        ...row.plan,
        databaseId: row.id,
        status: row.status,
        createdAt: row.created_at || row.plan.createdAt,
      }));
  }

  async function getOutreachCandidates(user, token, { frequencyHours = 48 } = {}) {
    const workspace = await workspaceFor(user, token);
    const workspaceId = queryValue(workspace.id);
    const cutoff = new Date(Date.now() - Math.max(1, Number(frequencyHours) || 48) * 60 * 60 * 1000).toISOString();
    const [fans, recentDeliveries] = await Promise.all([
      request(
        `/rest/v1/fans?select=id,display_name,email,phone,consented_channels,source_provenance&workspace_id=eq.${workspaceId}&consented_channels=not.eq.%7B%7D&order=last_seen.desc.nullslast&limit=1000`,
        token,
      ),
      request(
        `/rest/v1/outreach_deliveries?select=fan_id,channel,status&workspace_id=eq.${workspaceId}&sent_at=gte.${queryValue(cutoff)}&status=in.(queued,sent,delivered)&limit=5000`,
        token,
      ),
    ]);
    const recentByFan = new Map();
    for (const row of recentDeliveries || []) {
      const channels = recentByFan.get(row.fan_id) || [];
      if (!channels.includes(row.channel)) channels.push(row.channel);
      recentByFan.set(row.fan_id, channels);
    }
    return {
      workspace,
      candidates: (fans || []).map((row) => ({ ...row, recent_channels: recentByFan.get(row.id) || [] })),
      frequencyHours: Math.max(1, Number(frequencyHours) || 48),
    };
  }

  async function createOutreachCampaign(user, token, plan) {
    const workspace = await workspaceFor(user, token);
    const existing = await request(
      `/rest/v1/outreach_campaigns?select=id,status,summary,created_at&workspace_id=eq.${queryValue(workspace.id)}&external_key=eq.${queryValue(plan.id)}&limit=1`,
      token,
    );
    if (existing?.length) throw new DatabaseError("This outreach launch has already been submitted", 409);
    const rows = await request("/rest/v1/outreach_campaigns", token, {
      method: "POST",
      prefer: "return=representation",
      body: [{
        workspace_id: workspace.id,
        created_by: user.id,
        external_key: plan.id,
        title: plan.title,
        destination: plan.destination,
        subject: plan.subject,
        message: plan.message,
        channels: plan.channels,
        sources: plan.sources,
        holdout_percent: plan.holdoutPercent,
        status: "sending",
        summary: plan.audience,
      }],
    });
    const campaign = rows?.[0];
    if (!campaign?.id) throw new DatabaseError("Outreach campaign could not be created", 502);
    return { workspace, campaign };
  }

  async function finishOutreachCampaign(user, token, campaignId, deliveries = [], summary = {}) {
    const workspace = await workspaceFor(user, token);
    const sentAt = new Date().toISOString();
    const rows = deliveries.map((delivery) => ({
      campaign_id: campaignId,
      workspace_id: workspace.id,
      fan_id: delivery.fanId,
      channel: delivery.channel,
      provider: delivery.provider,
      provider_message_id: delivery.providerMessageId || null,
      status: delivery.status,
      reason: delivery.reason || null,
      sent_at: delivery.status === "sent" || delivery.status === "delivered" ? sentAt : null,
    }));
    if (rows.length) {
      await request("/rest/v1/outreach_deliveries", token, {
        method: "POST",
        prefer: "return=minimal",
        body: rows,
      });
    }
    const sent = deliveries.filter((item) => item.status === "sent" || item.status === "delivered").length;
    const failed = deliveries.filter((item) => item.status === "failed").length;
    const status = sent > 0 && failed === 0 ? "completed" : sent > 0 ? "partial" : "failed";
    await request(`/rest/v1/outreach_campaigns?id=eq.${queryValue(campaignId)}&workspace_id=eq.${queryValue(workspace.id)}`, token, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status, summary: { ...summary, sent, failed }, completed_at: sentAt },
    });
    return { campaignId, status, sent, failed, ...summary };
  }

  async function listOutreachCampaigns(user, token, limit = 10) {
    const workspace = await workspaceFor(user, token);
    const rows = await request(
      `/rest/v1/outreach_campaigns?select=id,external_key,title,destination,channels,sources,status,summary,created_at,completed_at&workspace_id=eq.${queryValue(workspace.id)}&order=created_at.desc&limit=${Math.min(50, Math.max(1, limit))}`,
      token,
    );
    return (rows || []).map((row) => ({
      id: row.external_key,
      databaseId: row.id,
      title: row.title,
      destination: row.destination,
      channels: row.channels,
      sources: row.sources,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  function chunks(values, size = 75) {
    const result = [];
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
    return result;
  }

  function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
  }

  function latestTimestamp(first, second) {
    const firstTime = Date.parse(first || "");
    const secondTime = Date.parse(second || "");
    if (!Number.isFinite(firstTime)) return second;
    if (!Number.isFinite(secondTime)) return first;
    return firstTime >= secondTime ? first : second;
  }

  function consentKey({ fan_id: fanId, channel, status, source, occurred_at: occurredAt }) {
    const timestamp = Number.isFinite(Date.parse(occurredAt || "")) ? new Date(occurredAt).toISOString() : occurredAt;
    return `${fanId}|${channel}|${status}|${source}|${timestamp}`;
  }

  async function existingFans(workspaceId, token, contactKeys) {
    const rows = [];
    for (const group of chunks(contactKeys)) {
      const filter = group.join(",");
      const result = await request(
        `/rest/v1/fans?select=id,contact_key,display_name,email,phone,location,channels,consented_channels,metrics,source_provenance,last_seen&workspace_id=eq.${queryValue(workspaceId)}&contact_key=in.(${filter})`,
        token,
      );
      rows.push(...(result || []));
    }
    return new Map(rows.map((row) => [row.contact_key, row]));
  }

  async function existingConsentKeys(workspaceId, token, fanIds) {
    const keys = new Set();
    for (const group of chunks(fanIds)) {
      const filter = group.join(",");
      const rows = await request(
        `/rest/v1/consents?select=fan_id,channel,status,source,occurred_at&workspace_id=eq.${queryValue(workspaceId)}&fan_id=in.(${filter})`,
        token,
      );
      for (const row of rows || []) keys.add(consentKey(row));
    }
    return keys;
  }

  function fanRow(workspaceId, lead, existing, importedAt) {
    const provenanceEntry = {
      source: lead.source,
      sourceKey: lead.sourceKey,
      sourceId: lead.sourceId || null,
      campaignId: lead.campaignId || null,
      utm: lead.utm,
      consentSource: lead.consent.source,
      consentAt: lead.consent.at,
      importedAt,
    };
    const priorSources = Array.isArray(existing?.source_provenance?.sources)
      ? existing.source_provenance.sources
      : [];
    const sources = [...priorSources.filter((item) => item?.sourceKey !== lead.sourceKey), provenanceEntry].slice(-25);
    return {
      workspace_id: workspaceId,
      contact_key: lead.contactKey,
      display_name: lead.name || existing?.display_name || "Consented fan",
      email: lead.email || existing?.email || null,
      phone: lead.phone || existing?.phone || null,
      location: lead.location || existing?.location || null,
      channels: unique([...(existing?.channels || []), ...lead.consent.channels]),
      consented_channels: unique([...(existing?.consented_channels || []), ...lead.consent.channels]),
      metrics: {
        ...(existing?.metrics || {}),
        directOptIn: true,
        latestImportSource: lead.source,
        latestImportAt: importedAt,
      },
      source_provenance: { version: 1, sources, latest: provenanceEntry },
      last_seen: latestTimestamp(existing?.last_seen, lead.consent.at),
      updated_at: importedAt,
    };
  }

  function platformIdentityFanRow(workspaceId, identity, existing, importedAt) {
    const provenanceEntry = {
      source: identity.source,
      sourceKey: identity.sourceKey,
      platform: identity.platform,
      externalId: identity.externalId || null,
      handle: identity.handle || null,
      profileUrl: identity.profileUrl || null,
      relationship: identity.relationship,
      observedAt: identity.observedAt || null,
      importedAt,
      directContactConsent: false,
    };
    const priorSources = Array.isArray(existing?.source_provenance?.sources)
      ? existing.source_provenance.sources
      : [];
    const sources = [...priorSources.filter((item) => item?.sourceKey !== identity.sourceKey), provenanceEntry].slice(-25);
    return {
      workspace_id: workspaceId,
      contact_key: identity.contactKey,
      display_name: identity.name || identity.handle || existing?.display_name || `${identity.platform} fan`,
      email: existing?.email || null,
      phone: existing?.phone || null,
      location: existing?.location || null,
      channels: unique([...(existing?.channels || []), identity.platform]),
      consented_channels: unique(existing?.consented_channels || []),
      metrics: {
        ...(existing?.metrics || {}),
        directOptIn: Boolean(existing?.metrics?.directOptIn),
        platformIdentity: true,
        platformHandle: identity.handle || existing?.metrics?.platformHandle || null,
        relationship: identity.relationship,
        latestImportSource: identity.source,
        latestImportAt: importedAt,
      },
      source_provenance: { version: 1, sources, latest: provenanceEntry },
      last_seen: latestTimestamp(existing?.last_seen, identity.observedAt || importedAt),
      updated_at: importedAt,
    };
  }

  async function commitLeadImport(user, token, preview) {
    const workspace = await workspaceFor(user, token);
    const importedAt = new Date().toISOString();
    const source = preview.source || "csv";
    const runRows = await request("/rest/v1/import_runs", token, {
      method: "POST",
      prefer: "return=representation",
      body: [{
        workspace_id: workspace.id,
        created_by: user.id,
        source,
        received_count: preview.summary.received,
        accepted_count: 0,
        rejected_count: preview.summary.invalid,
        status: "processing",
      }],
    });
    const importRunId = runRows?.[0]?.id;
    if (!importRunId) throw new DatabaseError("Audience import could not be started", 502);

    try {
      const previous = await existingFans(workspace.id, token, preview.valid.map((lead) => lead.contactKey));
      const rows = preview.valid.map((lead) => fanRow(workspace.id, lead, previous.get(lead.contactKey), importedAt));
      const savedFans = rows.length ? await request(
        "/rest/v1/fans?on_conflict=workspace_id,contact_key&select=id,contact_key",
        token,
        { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: rows },
      ) : [];
      const fanIds = new Map((savedFans || []).map((row) => [row.contact_key, row.id]));
      if (fanIds.size !== rows.length) throw new DatabaseError("Some audience records could not be confirmed", 502);

      const existingKeys = await existingConsentKeys(workspace.id, token, [...fanIds.values()]);
      const consentRows = preview.valid.flatMap((lead) => lead.consent.channels.map((channel) => {
        const fanId = fanIds.get(lead.contactKey);
        return {
          workspace_id: workspace.id,
          fan_id: fanId,
          channel,
          purpose: "creator_updates",
          status: "granted",
          source: lead.consent.source,
          occurred_at: lead.consent.at,
        };
      })).filter((row) => !existingKeys.has(consentKey(row)));

      if (consentRows.length) {
        await request("/rest/v1/consents", token, {
          method: "POST",
          prefer: "return=minimal",
          body: consentRows,
        });
      }
      await request(`/rest/v1/import_runs?id=eq.${queryValue(importRunId)}`, token, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { accepted_count: rows.length, status: "completed" },
      });
      return {
        id: importRunId,
        source,
        received: preview.summary.received,
        accepted: rows.length,
        rejected: preview.summary.invalid,
        created: rows.filter((row) => !previous.has(row.contact_key)).length,
        updated: rows.filter((row) => previous.has(row.contact_key)).length,
        consentEventsAdded: consentRows.length,
        status: "completed",
      };
    } catch (error) {
      try {
        await request(`/rest/v1/import_runs?id=eq.${queryValue(importRunId)}`, token, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { status: "failed" },
        });
      } catch {
        // Preserve the original import failure.
      }
      throw error;
    }
  }

  async function commitPlatformIdentityImport(user, token, preview, { refreshSnapshot = true } = {}) {
    const workspace = await workspaceFor(user, token);
    const importedAt = new Date().toISOString();
    const source = preview.source;
    const runRows = await request("/rest/v1/import_runs", token, {
      method: "POST",
      prefer: "return=representation",
      body: [{
        workspace_id: workspace.id,
        created_by: user.id,
        source,
        received_count: preview.summary.received,
        accepted_count: 0,
        rejected_count: preview.summary.invalid,
        status: "processing",
      }],
    });
    const importRunId = runRows?.[0]?.id;
    if (!importRunId) throw new DatabaseError("Platform identity import could not be started", 502);

    try {
      const previous = await existingFans(workspace.id, token, preview.valid.map((identity) => identity.contactKey));
      const rows = preview.valid.map((identity) => platformIdentityFanRow(
        workspace.id,
        identity,
        previous.get(identity.contactKey),
        importedAt,
      ));
      const savedFans = rows.length ? await request(
        "/rest/v1/fans?on_conflict=workspace_id,contact_key&select=id,contact_key",
        token,
        { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: rows },
      ) : [];
      if ((savedFans || []).length !== rows.length) throw new DatabaseError("Some platform identities could not be confirmed", 502);
      await request(`/rest/v1/import_runs?id=eq.${queryValue(importRunId)}`, token, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { accepted_count: rows.length, status: "completed" },
      });
      if (refreshSnapshot) await refreshAudienceSnapshot(workspace, token);
      return {
        id: importRunId,
        source,
        platform: preview.platform,
        received: preview.summary.received,
        accepted: rows.length,
        rejected: preview.summary.invalid,
        created: rows.filter((row) => !previous.has(row.contact_key)).length,
        updated: rows.filter((row) => previous.has(row.contact_key)).length,
        consentEventsAdded: 0,
        directlyReachable: 0,
        status: "completed",
      };
    } catch (error) {
      try {
        await request(`/rest/v1/import_runs?id=eq.${queryValue(importRunId)}`, token, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { status: "failed" },
        });
      } catch {
        // Preserve the original import failure.
      }
      throw error;
    }
  }

  async function getSourceConnection(user, token, platform) {
    const workspace = await workspaceFor(user, token);
    const rows = await request(
      `/rest/v1/source_connections?select=platform,status,external_account_id,scopes,metadata,created_at,updated_at&workspace_id=eq.${queryValue(workspace.id)}&platform=eq.${queryValue(platform)}&limit=1`,
      token,
    );
    return rows?.[0] || null;
  }

  async function refreshAudienceSnapshot(workspace, token) {
    const workspaceId = queryValue(workspace.id);
    const [connections, identifiedFans, directConnections] = await Promise.all([
      request(`/rest/v1/source_connections?select=platform,status,metadata&workspace_id=eq.${workspaceId}`, token),
      countRows(`/rest/v1/fans?select=id&workspace_id=eq.${workspaceId}`, token),
      countRows(`/rest/v1/fans?select=id&workspace_id=eq.${workspaceId}&consented_channels=not.eq.%7B%7D`, token),
    ]);
    const connected = (connections || []).filter((row) => row.status === "connected");
    const totalFollowers = connected.reduce((sum, row) => sum + Math.max(0, Number(row.metadata?.metrics?.totalFollowers) || 0), 0);
    const averageViewsValues = connected
      .map((row) => Number(row.metadata?.metrics?.averageViews) || 0)
      .filter((value) => value > 0);
    const averageViews = averageViewsValues.length
      ? Math.round(averageViewsValues.reduce((sum, value) => sum + value, 0) / averageViewsValues.length)
      : 0;
    await request("/rest/v1/audience_snapshots", token, {
      method: "POST",
      prefer: "return=minimal",
      body: [{
        workspace_id: workspace.id,
        total_followers: totalFollowers,
        average_views: averageViews,
        identified_fans: identifiedFans,
        direct_connections: directConnections,
        connected_platforms: connected.length,
      }],
    });
  }

  async function saveSourceConnection(user, token, connection) {
    const workspace = await workspaceFor(user, token);
    const updatedAt = new Date().toISOString();
    const rows = await request(
      "/rest/v1/source_connections?on_conflict=workspace_id,platform&select=platform,status,external_account_id,scopes,metadata,updated_at",
      token,
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: [{
          workspace_id: workspace.id,
          platform: connection.platform,
          status: connection.status,
          external_account_id: connection.externalAccountId || null,
          scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
          metadata: connection.metadata || {},
          updated_at: updatedAt,
        }],
      },
    );
    await refreshAudienceSnapshot(workspace, token);
    return publicConnectionState(rows?.[0] || {
      status: connection.status,
      external_account_id: connection.externalAccountId,
      scopes: connection.scopes,
      metadata: connection.metadata,
      updated_at: updatedAt,
    });
  }

  async function saveProviderWebhook(user, token, webhook) {
    if (!adminKey) throw new DatabaseError("Set SUPABASE_SERVICE_ROLE_KEY before enabling live platform leads", 503);
    const workspace = await workspaceFor(user, token);
    const updatedAt = new Date().toISOString();
    const rows = await request(
      "/rest/v1/provider_webhooks?on_conflict=workspace_id,platform,external_form_id&select=id,workspace_id,platform,external_form_id,external_account_id,integration_id,path_key,status,consented_channels,received_count,last_received_at",
      token,
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: [{
          workspace_id: workspace.id,
          platform: webhook.platform,
          external_form_id: webhook.externalFormId,
          external_account_id: webhook.externalAccountId || null,
          integration_id: webhook.integrationId,
          path_key: webhook.pathKey,
          encrypted_secret: webhook.encryptedSecret,
          consented_channels: webhook.consentedChannels,
          status: webhook.status || "active",
          updated_at: updatedAt,
        }],
      },
    );
    if (!rows?.[0]?.id) throw new DatabaseError("Provider webhook could not be saved", 502);
    return rows[0];
  }

  async function getProviderWebhook(pathKey) {
    if (!adminKey) throw new DatabaseError("Live platform lead ingestion is not configured", 503);
    const rows = await request(
      `/rest/v1/provider_webhooks?select=id,workspace_id,platform,external_form_id,external_account_id,integration_id,encrypted_secret,consented_channels,status,received_count,last_received_at&path_key=eq.${queryValue(pathKey)}&status=eq.active&limit=1`,
      adminKey,
    );
    return rows?.[0] || null;
  }

  async function commitProviderLead(webhook, preview, { externalLeadId, metadata } = {}) {
    if (!adminKey) throw new DatabaseError("Live platform lead ingestion is not configured", 503);
    const leadId = shortText(externalLeadId, 160);
    if (!leadId) throw new DatabaseError("Provider lead identifier is missing", 400);
    const created = await request(
      "/rest/v1/provider_lead_events?on_conflict=webhook_id,external_lead_id&select=id",
      adminKey,
      {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=representation",
        body: [{
          webhook_id: webhook.id,
          workspace_id: webhook.workspace_id,
          external_lead_id: leadId,
          status: preview.summary.valid ? "processing" : "invalid",
          metadata: metadata || {},
          error: preview.summary.valid ? null : shortText(preview.invalid?.[0]?.reason, 240) || "Lead did not contain a permitted contact channel",
          processed_at: preview.summary.valid ? null : new Date().toISOString(),
        }],
      },
    );
    if (!created?.[0]?.id) return { duplicate: true, accepted: 0, created: 0, updated: 0 };
    const eventId = created[0].id;
    if (!preview.summary.valid) return { duplicate: false, accepted: 0, created: 0, updated: 0, invalid: 1 };

    try {
      const importedAt = new Date().toISOString();
      const previous = await existingFans(webhook.workspace_id, adminKey, preview.valid.map((lead) => lead.contactKey));
      const rows = preview.valid.map((lead) => fanRow(webhook.workspace_id, lead, previous.get(lead.contactKey), importedAt));
      const savedFans = await request(
        "/rest/v1/fans?on_conflict=workspace_id,contact_key&select=id,contact_key",
        adminKey,
        { method: "POST", prefer: "resolution=merge-duplicates,return=representation", body: rows },
      );
      const fanIds = new Map((savedFans || []).map((row) => [row.contact_key, row.id]));
      if (fanIds.size !== rows.length) throw new DatabaseError("Provider lead could not be confirmed", 502);
      const existingKeys = await existingConsentKeys(webhook.workspace_id, adminKey, [...fanIds.values()]);
      const consentRows = preview.valid.flatMap((lead) => lead.consent.channels.map((channel) => ({
        workspace_id: webhook.workspace_id,
        fan_id: fanIds.get(lead.contactKey),
        channel,
        purpose: "creator_updates",
        status: "granted",
        source: lead.consent.source,
        occurred_at: lead.consent.at,
      }))).filter((row) => !existingKeys.has(consentKey(row)));
      if (consentRows.length) {
        await request("/rest/v1/consents", adminKey, { method: "POST", prefer: "return=minimal", body: consentRows });
      }
      const fanId = fanIds.get(preview.valid[0].contactKey);
      await request(`/rest/v1/provider_lead_events?id=eq.${queryValue(eventId)}`, adminKey, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { status: "completed", fan_id: fanId, processed_at: importedAt },
      });
      await request(`/rest/v1/provider_webhooks?id=eq.${queryValue(webhook.id)}`, adminKey, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          received_count: Math.max(0, Number(webhook.received_count) || 0) + 1,
          last_received_at: importedAt,
          updated_at: importedAt,
        },
      });
      await refreshAudienceSnapshot({ id: webhook.workspace_id }, adminKey);
      return {
        duplicate: false,
        accepted: rows.length,
        created: rows.filter((row) => !previous.has(row.contact_key)).length,
        updated: rows.filter((row) => previous.has(row.contact_key)).length,
        consentEventsAdded: consentRows.length,
      };
    } catch (error) {
      try {
        await request(`/rest/v1/provider_lead_events?id=eq.${queryValue(eventId)}`, adminKey, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { status: "failed", error: shortText(error.message, 240), processed_at: new Date().toISOString() },
        });
      } catch {
        // Preserve the original processing failure.
      }
      throw error;
    }
  }

  return Object.freeze({
    commitLeadImport,
    commitProviderLead,
    commitPlatformIdentityImport,
    config,
    getActivationEligibility,
    getDashboard,
    getOutreachCandidates,
    getProviderWebhook,
    getSourceConnection,
    listActivations,
    listOutreachCampaigns,
    createOutreachCampaign,
    finishOutreachCampaign,
    saveExperiment,
    saveProviderWebhook,
    saveSourceConnection,
    workspaceFor,
  });
}
