import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  clearSessionCookies,
  createAuthService,
  getSupabaseConfig,
  parseCookies,
  sessionCookies,
  validateAuthInput,
} from "../src/auth.js";

test("Supabase configuration uses only project URL and public key", () => {
  const configured = getSupabaseConfig({
    NODE_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used",
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.url, "https://example.supabase.co");
  assert.equal(configured.key, "sb_publishable_example");
  assert.equal("serviceRoleKey" in configured, false);
});

test("auth input normalizes email and rejects weak passwords", () => {
  assert.deepEqual(
    validateAuthInput({ email: " Creator@Example.com ", password: "strong-pass", displayName: "Creator" }, { signUp: true }),
    { email: "creator@example.com", password: "strong-pass", displayName: "Creator" },
  );
  assert.throws(
    () => validateAuthInput({ email: "creator@example.com", password: "short" }),
    (error) => error instanceof AuthError && /8 and 128/.test(error.message),
  );
});

test("session cookies are HTTP-only, same-site, and secure in production", () => {
  const cookies = sessionCookies({ access_token: "access", refresh_token: "refresh", expires_in: 600 }, { NODE_ENV: "production" });
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((value) => value.includes("HttpOnly") && value.includes("SameSite=Lax") && value.includes("Secure")));
  assert.deepEqual(parseCookies("fanmesh_access=access; fanmesh_refresh=refresh"), {
    fanmesh_access: "access",
    fanmesh_refresh: "refresh",
  });
  assert.ok(clearSessionCookies({ NODE_ENV: "production" }).every((value) => value.includes("Max-Age=0")));
});

test("sign in returns a safe public user and server-only cookies", async () => {
  const requests = [];
  const service = createAuthService({
    environment: {
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public-key",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            user: { id: "user-1", email: "creator@example.com", email_confirmed_at: "2026-07-29", user_metadata: { display_name: "Creator" } },
          });
        },
      };
    },
  });
  const result = await service.signIn({ email: "creator@example.com", password: "strong-pass" });
  assert.equal(result.data.user.displayName, "Creator");
  assert.equal(JSON.stringify(result.data).includes("strong-pass"), false);
  assert.equal(JSON.stringify(result.data).includes("access-token"), false);
  assert.equal(result.cookies.length, 2);
  assert.match(requests[0].url, /grant_type=password/);
});

test("unconfigured session stays in explicit demo mode", async () => {
  const service = createAuthService({ environment: {}, fetchImpl: async () => assert.fail("network should not be called") });
  const result = await service.session({ headers: {} });
  assert.deepEqual(result.data, { configured: false, authenticated: false, mode: "demo" });
});
