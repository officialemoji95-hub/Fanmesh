import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { demoFans } from "./demo-data.js";
import { buildInsights, recommendCampaign } from "./insights.js";
import { openApiDocument } from "./openapi.js";
import { getConnectionCatalog, planSocialExperiment, previewLeadImport } from "./social.js";
import { scoreAudience, scoreFan } from "./scoring.js";

const port = Number(process.env.PORT || 3000);
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const maxBodyBytes = 128 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
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
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    response.end(contents);
    return true;
  } catch {
    return false;
  }
}

export async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const { pathname, searchParams } = url;

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", service: "fanmesh", version: "0.1.0" });
  }

  if (request.method === "GET" && pathname === "/api/v1/openapi.json") {
    return sendJson(response, 200, openApiDocument);
  }

  if (request.method === "GET" && pathname === "/api/v1/fans") {
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
    const data = scoreAudience(demoFans).slice(0, limit);
    return sendJson(response, 200, { data, meta: { count: data.length, demo: true } });
  }

  if (request.method === "GET" && pathname === "/api/v1/insights") {
    return sendJson(response, 200, { data: buildInsights(demoFans), meta: { demo: true } });
  }

  if (request.method === "GET" && pathname === "/api/v1/connections") {
    return sendJson(response, 200, {
      data: getConnectionCatalog(),
      meta: { demo: true, note: "Connection metadata only; OAuth and persistence are required for production." },
    });
  }

  if (request.method === "POST" && pathname === "/api/v1/score") {
    try {
      const metrics = await readJson(request);
      return sendJson(response, 200, { data: scoreFan(metrics) });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { error: { message: error.message } });
    }
  }

  if (request.method === "POST" && pathname === "/api/v1/campaigns/recommend") {
    try {
      const input = await readJson(request);
      return sendJson(response, 200, { data: recommendCampaign(input), meta: { demo: true } });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { error: { message: error.message } });
    }
  }

  if (request.method === "POST" && pathname === "/api/v1/imports/leads/preview") {
    try {
      const input = await readJson(request);
      return sendJson(response, 200, { data: previewLeadImport(input), meta: { demo: true } });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { error: { message: error.message } });
    }
  }

  if (request.method === "POST" && pathname === "/api/v1/experiments/social") {
    try {
      const input = await readJson(request);
      return sendJson(response, 200, { data: planSocialExperiment(input), meta: { demo: true } });
    } catch (error) {
      return sendJson(response, error.statusCode || 400, { error: { message: error.message } });
    }
  }

  if (request.method === "GET" && await serveStatic(pathname, response)) return;
  sendJson(response, 404, { error: { message: "Not found" } });
}

export function createAppServer() {
  return createServer(handleRequest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, "0.0.0.0", () => {
    console.log(`FanMesh is listening on http://0.0.0.0:${port}`);
  });
}
