import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthError, createAuthService } from "./auth.js";
import { createWorkspaceStore, DatabaseError } from "./database.js";
import { audienceSnapshot, demoFans } from "./demo-data.js";
import { buildInsights, recommendCampaign } from "./insights.js";
import { openApiDocument } from "./openapi.js";
import { getConnectionCatalog, planSocialExperiment, previewLeadImport } from "./social.js";
import { scoreAudience, scoreFan } from "./scoring.js";

const APP_VERSION = "0.3.0";
const port = Number(process.env.PORT || 3000);
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const maxBodyBytes = 2 * 1024 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }
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
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
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

export function createRequestHandler({
  authService = createAuthService(),
  workspaceStore = createWorkspaceStore(),
} = {}) {
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
          connections: getConnectionCatalog(),
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
    return {
      data: {
        workspace: state.workspace,
        insights: buildInsights(state.fans, state.snapshot),
        fans,
        connections: getConnectionCatalog(state.connectionStatuses),
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

    if (request.method === "POST" && pathname === "/api/v1/score") {
      try {
        return sendJson(response, 200, { data: scoreFan(await readJson(request)) });
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
