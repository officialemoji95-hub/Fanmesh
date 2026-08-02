import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { activationEligibilityFromFans, prepareFanActivation } from "./activation.js";
import { AuthError, createAuthService } from "./auth.js";
import { createWorkspaceStore, DatabaseError } from "./database.js";
import { audienceSnapshot, demoFans } from "./demo-data.js";
import { buildInsights, recommendCampaign } from "./insights.js";
import { createOAuthService } from "./oauth.js";
import { buildContentMesh, buildOrganicQueue, prepareOrganicPulse } from "./organic.js";
import { openApiDocument } from "./openapi.js";
import { createOutreachService, normalizeOutreachInput, publicOutreachPlan, selectOutreachCohort } from "./outreach.js";
import { applyReleaseCheckpoint, buildReleasePlan, publicReleasePlan } from "./release.js";
import { getConnectionCatalog, planSocialExperiment, previewLeadImport, previewPlatformIdentityImport } from "./social.js";
import { scoreAudience, scoreFan } from "./scoring.js";
import {
  normalizeSnapchatWebhookLead,
  publicSnapchatLeadMetadata,
  SnapchatWebhookError,
  verifySnapchatWebhookSignature,
} from "./snapchat.js";

const APP_VERSION = "0.18.1";
const port = Number(process.env.PORT || 3000);
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const maxBodyBytes = 2 * 1024 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

function cookieHeaders(cookies = []) {
  return cookies.length ? { "set-cookie": cookies } : {};
}

function sendError(response, error, extraHeaders = {}) {
  const statusCode = error instanceof AuthError || error instanceof DatabaseError
    ? error.statusCode
    : error.statusCode || 400;
  sendJson(response, statusCode, { error: { message: error.message || "Request failed" } }, extraHeaders);
}

function sendRedirect(response, location, cookies = []) {
  response.writeHead(302, {
    location,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(cookies.length ? { "set-cookie": cookies } : {}),
  });
  response.end();
}

async function readRawBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }
  return body;
}

async function readJson(request) {
  const body = await readRawBody(request);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must contain valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function safeStaticPath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const relative = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
  const resolved = join(publicDirectory, relative);
  return resolved.startsWith(publicDirectory) ? resolved : null;
}

async function serveStatic(pathname, response) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const contents = await readFile(filePath);
    const extension = extname(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": [".html", ".js", ".css"].includes(extension) ? "no-cache" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    response.end(contents);
    return true;
  } catch {
    return false;
  }
}

function publicSession(session) {
  const { accessToken, ...data } = session.data;
  return { data, cookies: session.cookies };
}

function publicMetaLeadPreview(batch, preview) {
  return {
    source: batch.source,
    forms: batch.forms,
    fetchedAt: batch.fetchedAt,
    limit: batch.limit,
    invalid: preview.invalid.slice(0, 20),
    summary: preview.summary,
  };
}

function publicPlatformIdentityPreview(preview) {
  return {
    source: preview.source,
    platform: preview.platform,
    invalid: preview.invalid.slice(0, 20),
    summary: preview.summary,
  };
}

export function createRequestHandler({
  authService = createAuthService(),
  workspaceStore = createWorkspaceStore(),
  oauthService: providedOAuthService,
  outreachService: providedOutreachService,
} = {}) {
  const oauthService = providedOAuthService || createOAuthService({ workspaceStore });
  const outreachService = providedOutreachService || createOutreachService();

  async function authenticatedSession(request) {
    const session = await authService.session(request);
    if (!session.data.authenticated) throw new AuthError("Sign in to access this workspace", 401);
    return session;
  }

  async function dashboardFor(request, limit = 20) {
    if (!authService.config.configured) {
      const fans = scoreAudience(demoFans).slice(0, limit);
      return {
        data: {
          workspace: { name: "Demo workspace", role: "demo" },
          insights: buildInsights(demoFans),
          fans,
          connections: getConnectionCatalog({}, oauthService.catalog({}, { providerWebhookSchemaReady: false })),
          organic: buildOrganicQueue({}),
          contentMesh: buildContentMesh({}),
        },
        meta: { demo: true, authenticated: false, count: fans.length },
        cookies: [],
      };
    }
    const session = await authenticatedSession(request);
    const state = await workspaceStore.getDashboard(
      session.data.user,
      session.data.accessToken,
      limit,
    );
    const fans = scoreAudience(state.fans);
    const organic = buildOrganicQueue(state.connectionStatuses);
    const contentMesh = buildContentMesh(state.connectionStatuses);
    return {
      data: {
        workspace: state.workspace,
        insights: buildInsights(state.fans, state.snapshot),
        fans,
        connections: getConnectionCatalog(
          state.connectionStatuses,
          oauthService.catalog(state.connectionStatuses, state.readiness),
        ),
        organic,
        contentMesh,
      },
      meta: { demo: false, authenticated: true, count: fans.length },
      cookies: session.cookies,
    };
  }

  return async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const { pathname, searchParams } = url;

    if (request.method === "GET" && pathname === "/api/health") {
      return sendJson(response, 200, {
        status: "ok",
        service: "fanmesh",
        version: APP_VERSION,
        database: authService.config.configured ? "configured" : "demo",
      });
    }

    if (request.method === "GET" && pathname === "/api/v1/openapi.json") {
      return sendJson(response, 200, openApiDocument);
    }

    if (request.method === "GET" && pathname === "/api/v1/auth/session") {
      const session = publicSession(await authService.session(request));
      return sendJson(response, 200, { data: session.data }, cookieHeaders(session.cookies));
    }

    if (request.method === "POST" && pathname === "/api/v1/auth/signup") {
      try {
        const result = await authService.signUp(await readJson(request));
        return sendJson(response, 201, { data: result.data }, cookieHeaders(result.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/auth/signin") {
      try {
        const result = await authService.signIn(await readJson(request));
        return sendJson(response, 200, { data: result.data }, cookieHeaders(result.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/auth/signout") {
      const result = await authService.signOut(request);
      return sendJson(response, 200, { data: result.data }, cookieHeaders(result.cookies));
    }

    if (request.method === "GET" && pathname === "/api/v1/dashboard") {
      try {
        const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
        const dashboard = await dashboardFor(request, limit);
        return sendJson(response, 200, { data: dashboard.data, meta: dashboard.meta }, cookieHeaders(dashboard.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/workspace") {
      try {
        const dashboard = await dashboardFor(request, 1);
        return sendJson(response, 200, { data: dashboard.data.workspace, meta: dashboard.meta }, cookieHeaders(dashboard.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/fans") {
      try {
        const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
        const dashboard = await dashboardFor(request, limit);
        return sendJson(response, 200, { data: dashboard.data.fans, meta: dashboard.meta }, cookieHeaders(dashboard.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/insights") {
      try {
        const dashboard = await dashboardFor(request, 100);
        return sendJson(response, 200, { data: dashboard.data.insights, meta: dashboard.meta }, cookieHeaders(dashboard.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/connections") {
      try {
        const dashboard = await dashboardFor(request, 1);
        return sendJson(response, 200, { data: dashboard.data.connections, meta: dashboard.meta }, cookieHeaders(dashboard.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    const snapchatWebhookRoute = pathname.match(/^\/api\/v1\/webhooks\/snapchat\/leads\/([A-Za-z0-9_-]{20,80})$/);
    if (request.method === "POST" && snapchatWebhookRoute) {
      try {
        const rawBody = await readRawBody(request);
        const webhook = await workspaceStore.getProviderWebhook(snapchatWebhookRoute[1]);
        if (!webhook) throw new SnapchatWebhookError("Snapchat webhook is not active", 404);
        const secret = oauthService.vault.open(webhook.encrypted_secret)?.hmacSecret;
        const verified = verifySnapchatWebhookSignature({
          secret,
          signature: request.headers?.signature,
          timestampHeader: request.headers?.t,
          rawBody,
        });
        if (!verified) throw new SnapchatWebhookError("Snapchat webhook signature is invalid or expired", 401);
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          throw new SnapchatWebhookError("Snapchat webhook body must contain valid JSON", 400);
        }
        if (String(payload.form_id || "") !== webhook.external_form_id) {
          throw new SnapchatWebhookError("Snapchat lead form does not match this webhook", 403);
        }
        if (webhook.external_account_id && String(payload.ad_account_id || "") !== webhook.external_account_id) {
          throw new SnapchatWebhookError("Snapchat ad account does not match this webhook", 403);
        }
        const preview = previewLeadImport({
          source: "snapchat_ads",
          rows: [normalizeSnapchatWebhookLead(payload, webhook.consented_channels)],
        });
        const saved = await workspaceStore.commitProviderLead(webhook, preview, {
          externalLeadId: payload.lead_id,
          metadata: publicSnapchatLeadMetadata(payload),
        });
        return sendJson(response, 202, {
          data: { received: true, accepted: saved.accepted || 0, duplicate: Boolean(saved.duplicate) },
          meta: { persisted: Boolean(saved.accepted), contactFieldsReturned: false, source: "snapchat_ads" },
        });
      } catch (error) {
        return sendError(response, error);
      }
    }

    const threadsComplianceRoute = pathname.match(/^\/api\/v1\/oauth\/threads\/(deauthorize|delete)$/);
    if (request.method === "POST" && threadsComplianceRoute) {
      try {
        const rawBody = await readRawBody(request);
        const input = Object.fromEntries(new URLSearchParams(rawBody));
        const result = await oauthService.handleThreadsCompliance(threadsComplianceRoute[1], input);
        return sendJson(response, 200, result);
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/oauth/threads/delete/status") {
      const confirmationCode = String(searchParams.get("code") || "");
      if (!/^[A-Za-z0-9_-]{20,80}$/.test(confirmationCode)) {
        const error = new Error("Deletion confirmation code is invalid");
        error.statusCode = 400;
        return sendError(response, error);
      }
      return sendJson(response, 200, { status: "completed", confirmation_code: confirmationCode });
    }

    const oauthRoute = pathname.match(/^\/api\/v1\/oauth\/([a-z_]+)\/(start|callback|sync|disconnect)$/);
    if (oauthRoute) {
      const [, provider, action] = oauthRoute;
      if (["GET", "POST"].includes(request.method) && action === "start") {
        try {
          const session = await authenticatedSession(request);
          const result = await oauthService.begin(provider, session.data);
          if (request.method === "POST") {
            return sendJson(response, 200, {
              data: { provider, redirectUrl: result.redirectUrl },
            }, cookieHeaders([...session.cookies, ...result.cookies]));
          }
          return sendRedirect(response, result.redirectUrl, [...session.cookies, ...result.cookies]);
        } catch (error) {
          return sendError(response, error);
        }
      }

      if (request.method === "GET" && action === "callback") {
        let session;
        try {
          session = await authenticatedSession(request);
          const result = await oauthService.callback(provider, session.data, url, request);
          const query = new URLSearchParams({ oauth: "connected", provider, account: result.account });
          return sendRedirect(response, `/?${query}`, [...session.cookies, ...result.cookies]);
        } catch (error) {
          const query = new URLSearchParams({
            oauth: "error",
            provider,
            message: String(error.message || "Connection failed").slice(0, 180),
          });
          return sendRedirect(response, `/?${query}`, session?.cookies || []);
        }
      }

      if (request.method === "POST" && action === "sync") {
        try {
          const session = await authenticatedSession(request);
          const result = await oauthService.sync(provider, session.data);
          return sendJson(response, 200, { data: result }, cookieHeaders(session.cookies));
        } catch (error) {
          return sendError(response, error);
        }
      }

      if (request.method === "DELETE" && action === "disconnect") {
        try {
          const session = await authenticatedSession(request);
          const result = await oauthService.disconnect(provider, session.data);
          return sendJson(response, 200, { data: result }, cookieHeaders(session.cookies));
        } catch (error) {
          return sendError(response, error);
        }
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/oauth/meta/leads/preview") {
      try {
        const session = await authenticatedSession(request);
        const batch = await oauthService.fetchMetaLeadImport(session.data, await readJson(request));
        const preview = previewLeadImport(batch);
        return sendJson(response, 200, {
          data: publicMetaLeadPreview(batch, preview),
          meta: { persisted: false, contactFieldsReturned: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/oauth/meta/leads/commit") {
      try {
        const session = await authenticatedSession(request);
        const batch = await oauthService.fetchMetaLeadImport(session.data, await readJson(request));
        const preview = previewLeadImport(batch);
        if (preview.summary.valid === 0) {
          const error = new Error("No valid consented Meta lead records are available to commit");
          error.statusCode = 400;
          throw error;
        }
        const saved = await workspaceStore.commitLeadImport(session.data.user, session.data.accessToken, preview);
        return sendJson(response, 201, {
          data: { ...saved, forms: batch.forms, fetchedAt: batch.fetchedAt },
          meta: { persisted: true },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/oauth/snapchat/leads/webhooks") {
      try {
        const session = await authenticatedSession(request);
        const configured = await oauthService.configureSnapchatLeadWebhooks(session.data, await readJson(request));
        return sendJson(response, 201, {
          data: configured,
          meta: { persisted: true, liveCapture: true, historicalLeadsImported: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/score") {
      try {
        return sendJson(response, 200, { data: scoreFan(await readJson(request)) });
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/activations") {
      try {
        if (!authService.config.configured) {
          return sendJson(response, 200, { data: [], meta: { demo: true, persisted: false } });
        }
        const session = await authenticatedSession(request);
        const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 5));
        const activations = await workspaceStore.listActivations(session.data.user, session.data.accessToken, limit);
        return sendJson(response, 200, {
          data: activations,
          meta: { demo: false, persisted: true },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/outreach/readiness") {
      try {
        let cookies = [];
        if (authService.config.configured) cookies = (await authenticatedSession(request)).cookies;
        return sendJson(response, 200, { data: outreachService.readiness }, cookieHeaders(cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/outreach/campaigns") {
      try {
        if (!authService.config.configured) return sendJson(response, 200, { data: [], meta: { demo: true } });
        const session = await authenticatedSession(request);
        const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 10));
        const campaigns = await workspaceStore.listOutreachCampaigns(session.data.user, session.data.accessToken, limit);
        return sendJson(response, 200, { data: campaigns, meta: { demo: false } }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/outreach/preview") {
      try {
        if (!authService.config.configured) throw new DatabaseError("Sign in to preview your consented lead pool", 503);
        const session = await authenticatedSession(request);
        const input = normalizeOutreachInput(await readJson(request));
        const state = await workspaceStore.getOutreachCandidates(session.data.user, session.data.accessToken, { frequencyHours: 48 });
        const cohort = selectOutreachCohort(state.candidates, input, { limit: 100 });
        const plan = publicOutreachPlan(input, cohort, outreachService.readiness);
        return sendJson(response, 200, {
          data: plan,
          meta: { demo: false, persisted: false, messagesSent: 0, contactFieldsReturned: false, frequencyHours: state.frequencyHours },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/outreach/send") {
      try {
        if (!authService.config.configured) throw new DatabaseError("Sign in before launching lead outreach", 503);
        const session = await authenticatedSession(request);
        const rawInput = await readJson(request);
        const input = normalizeOutreachInput(rawInput, { requireSendConfirmation: true });
        const state = await workspaceStore.getOutreachCandidates(session.data.user, session.data.accessToken, { frequencyHours: 48 });
        const campaignId = typeof rawInput.campaignId === "string" && /^out_[a-f0-9]{16}$/.test(rawInput.campaignId)
          ? rawInput.campaignId
          : undefined;
        const cohort = selectOutreachCohort(state.candidates, input, { limit: 100 });
        const plan = publicOutreachPlan(input, cohort, outreachService.readiness, { id: campaignId });
        if (!plan.launchable) {
          const missing = plan.channels.filter((channel) => plan.audience.channels?.[channel] > 0 && !plan.providers[channel]?.configured);
          const error = new Error(missing.length
            ? `Configure the ${missing.join(" and ").toUpperCase()} delivery provider before launch`
            : "No eligible consented leads are available for this launch");
          error.statusCode = 409;
          throw error;
        }
        const created = await workspaceStore.createOutreachCampaign(session.data.user, session.data.accessToken, plan);
        const deliveries = await outreachService.deliver(plan, cohort.recipients);
        const result = await workspaceStore.finishOutreachCampaign(
          session.data.user,
          session.data.accessToken,
          created.campaign.id,
          deliveries,
          cohort.summary,
        );
        return sendJson(response, 201, {
          data: { ...plan, status: result.status, audience: { ...plan.audience, sent: result.sent, failed: result.failed } },
          meta: { demo: false, persisted: true, messagesSent: result.sent, contactFieldsReturned: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/organic/posts") {
      try {
        if (!authService.config.configured) {
          return sendJson(response, 200, { data: buildOrganicQueue({}), meta: { demo: true, synced: false } });
        }
        const session = await authenticatedSession(request);
        const state = await workspaceStore.getDashboard(session.data.user, session.data.accessToken, 1);
        return sendJson(response, 200, {
          data: buildOrganicQueue(state.connectionStatuses),
          meta: { demo: false, synced: true },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/content-mesh") {
      try {
        if (!authService.config.configured) {
          return sendJson(response, 200, { data: buildContentMesh({}), meta: { demo: true, synced: false, paidIncluded: false } });
        }
        const session = await authenticatedSession(request);
        const state = await workspaceStore.getDashboard(session.data.user, session.data.accessToken, 1);
        return sendJson(response, 200, {
          data: buildContentMesh(state.connectionStatuses),
          meta: { demo: false, synced: true, paidIncluded: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && pathname === "/api/v1/releases") {
      try {
        const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit")) || 10));
        if (!authService.config.configured) {
          return sendJson(response, 200, { data: [], meta: { demo: true, persisted: false } });
        }
        const session = await authenticatedSession(request);
        const plans = await workspaceStore.listReleasePlans(session.data.user, session.data.accessToken, limit);
        return sendJson(response, 200, {
          data: plans.map(publicReleasePlan),
          meta: { demo: false, persisted: true, contactFieldsReturned: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/releases/plan") {
      try {
        if (!authService.config.configured) {
          throw new DatabaseError("Sign in and sync an authorized creator platform before saving a release plan", 503);
        }
        const session = await authenticatedSession(request);
        const input = await readJson(request);
        const state = await workspaceStore.getDashboard(session.data.user, session.data.accessToken, 1);
        const mesh = buildContentMesh(state.connectionStatuses);
        const content = mesh.content.find((item) => item.id === input.meshId);
        if (!content) {
          const error = new Error("That content idea is no longer available. Sync the connected platforms and try again");
          error.statusCode = 404;
          throw error;
        }
        const eligibility = await workspaceStore.getActivationEligibility(session.data.user, session.data.accessToken);
        const plan = buildReleasePlan(content, input, eligibility);
        const saved = await workspaceStore.saveExperiment(session.data.user, session.data.accessToken, plan);
        return sendJson(response, 201, {
          data: publicReleasePlan({ ...saved, status: "draft", persistenceStatus: "saved" }),
          meta: {
            demo: false,
            persisted: true,
            messagesSent: 0,
            platformPostsPublished: 0,
            paidIncluded: false,
          },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    const releaseCheckpointMatch = pathname.match(/^\/api\/v1\/releases\/([^/]+)\/checkpoints$/);
    if (request.method === "POST" && releaseCheckpointMatch) {
      try {
        if (!authService.config.configured) throw new DatabaseError("Sign in before recording a release checkpoint", 503);
        const databaseId = decodeURIComponent(releaseCheckpointMatch[1]);
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(databaseId)) {
          const error = new Error("Release plan identifier is invalid");
          error.statusCode = 400;
          throw error;
        }
        const session = await authenticatedSession(request);
        const existing = await workspaceStore.getReleasePlan(session.data.user, session.data.accessToken, databaseId);
        const { databaseId: ignoredDatabaseId, ...storedPlan } = existing;
        void ignoredDatabaseId;
        const updated = applyReleaseCheckpoint(storedPlan, await readJson(request));
        const saved = await workspaceStore.updateReleasePlan(
          session.data.user,
          session.data.accessToken,
          databaseId,
          updated,
        );
        return sendJson(response, 200, {
          data: publicReleasePlan(saved),
          meta: { demo: false, persisted: true, paidIncluded: false, contactFieldsReturned: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/organic/activate") {
      try {
        if (!authService.config.configured) {
          const error = new Error("Connect and sync an authorized creator platform before starting an organic pulse");
          error.statusCode = 409;
          throw error;
        }
        const session = await authenticatedSession(request);
        const input = await readJson(request);
        const state = await workspaceStore.getDashboard(session.data.user, session.data.accessToken, 1);
        const queue = buildOrganicQueue(state.connectionStatuses);
        const post = queue.posts.find((item) => item.key === input.postKey);
        if (!post) {
          const error = new Error("That recent post is no longer available. Sync the platform and try again");
          error.statusCode = 404;
          throw error;
        }
        const eligibility = await workspaceStore.getActivationEligibility(
          session.data.user,
          session.data.accessToken,
        );
        const plan = prepareOrganicPulse(post, input, eligibility);
        const saved = await workspaceStore.saveExperiment(session.data.user, session.data.accessToken, plan);
        return sendJson(response, 201, {
          data: saved,
          meta: { demo: false, persisted: true, messagesSent: 0, organicBaselineCaptured: true },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/activations/prepare") {
      try {
        const input = await readJson(request);
        if (!authService.config.configured) {
          const plan = prepareFanActivation(input, activationEligibilityFromFans(demoFans));
          return sendJson(response, 200, { data: plan, meta: { demo: true, persisted: false } });
        }
        const session = await authenticatedSession(request);
        const eligibility = await workspaceStore.getActivationEligibility(
          session.data.user,
          session.data.accessToken,
        );
        const plan = prepareFanActivation(input, eligibility);
        const saved = await workspaceStore.saveExperiment(session.data.user, session.data.accessToken, plan);
        return sendJson(response, 201, {
          data: saved,
          meta: { demo: false, persisted: true, messagesSent: 0 },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/campaigns/recommend") {
      try {
        return sendJson(response, 200, { data: recommendCampaign(await readJson(request)), meta: { demo: true } });
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/imports/leads/preview") {
      try {
        let cookies = [];
        if (authService.config.configured) cookies = (await authenticatedSession(request)).cookies;
        return sendJson(response, 200, { data: previewLeadImport(await readJson(request)), meta: { persisted: false } }, cookieHeaders(cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/imports/leads/commit") {
      try {
        if (!authService.config.configured) {
          throw new DatabaseError("Configure Supabase before committing audience records", 503);
        }
        const session = await authenticatedSession(request);
        const input = await readJson(request);
        if (input.confirmedAuthorized !== true) {
          const error = new Error("Confirm that this is your authorized, consented audience data");
          error.statusCode = 400;
          throw error;
        }
        const preview = previewLeadImport(input);
        if (preview.summary.valid === 0) {
          const error = new Error("No valid consented records are available to commit");
          error.statusCode = 400;
          throw error;
        }
        const saved = await workspaceStore.commitLeadImport(
          session.data.user,
          session.data.accessToken,
          preview,
        );
        return sendJson(response, 201, { data: saved, meta: { demo: false, persisted: true } }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/imports/identities/preview") {
      try {
        let cookies = [];
        if (authService.config.configured) cookies = (await authenticatedSession(request)).cookies;
        const preview = previewPlatformIdentityImport(await readJson(request));
        return sendJson(response, 200, {
          data: publicPlatformIdentityPreview(preview),
          meta: { persisted: false, directContactConsentGranted: false },
        }, cookieHeaders(cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/imports/identities/commit") {
      try {
        if (!authService.config.configured) {
          throw new DatabaseError("Configure Supabase before committing platform identities", 503);
        }
        const session = await authenticatedSession(request);
        const input = await readJson(request);
        if (input.confirmedAuthorized !== true || input.confirmedOfficialExport !== true) {
          const error = new Error("Confirm that this file is your official platform data export");
          error.statusCode = 400;
          throw error;
        }
        const preview = previewPlatformIdentityImport(input);
        if (preview.summary.valid === 0) {
          const error = new Error("No valid platform identities are available to commit");
          error.statusCode = 400;
          throw error;
        }
        const saved = await workspaceStore.commitPlatformIdentityImport(
          session.data.user,
          session.data.accessToken,
          preview,
          { refreshSnapshot: input.finalBatch !== false },
        );
        return sendJson(response, 201, {
          data: saved,
          meta: { demo: false, persisted: true, directContactConsentGranted: false },
        }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "POST" && pathname === "/api/v1/experiments/social") {
      try {
        const plan = planSocialExperiment(await readJson(request));
        if (!authService.config.configured) {
          return sendJson(response, 200, { data: plan, meta: { demo: true, persisted: false } });
        }
        const session = await authenticatedSession(request);
        const saved = await workspaceStore.saveExperiment(session.data.user, session.data.accessToken, plan);
        return sendJson(response, 201, { data: saved, meta: { demo: false, persisted: true } }, cookieHeaders(session.cookies));
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method === "GET" && await serveStatic(pathname, response)) return;
    sendJson(response, 404, { error: { message: "Not found" } });
  };
}

export const handleRequest = createRequestHandler();

export function createAppServer() {
  return createServer(handleRequest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, "0.0.0.0", () => {
    console.log(`FanMesh is listening on http://0.0.0.0:${port}`);
  });
}

export { APP_VERSION, audienceSnapshot };
