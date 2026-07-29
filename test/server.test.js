import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.js";

async function dispatch({ method = "GET", url = "/", body = "" } = {}) {
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
  await handleRequest(request, response);
  return response;
}

test("health endpoint reports an operational service", async () => {
  const response = await dispatch({ url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", service: "fanmesh", version: "0.1.0" });
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
  assert.ok(body.data.social.some((source) => source.platform === "instagram"));
  assert.ok(body.data.imports.some((source) => source.platform === "csv"));
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
