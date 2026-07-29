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

function queryValue(value) {
  return encodeURIComponent(String(value));
}

export function createWorkspaceStore({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getSupabaseConfig(environment);

  async function request(path, token, { method = "GET", body, prefer } = {}) {
    if (!config.configured) throw new DatabaseError("Supabase is not configured", 503);
    let response;
    try {
      response = await fetchImpl(`${config.url}${path}`, {
        method,
        headers: {
          apikey: config.key,
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
      request(`/rest/v1/source_connections?select=platform,status,updated_at&workspace_id=eq.${workspaceId}`, token),
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
    return {
      workspace,
      fans,
      snapshot,
      connectionStatuses: Object.fromEntries((connectionRows || []).map((row) => [row.platform, row.status])),
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

  return Object.freeze({ config, getDashboard, saveExperiment, workspaceFor });
}
