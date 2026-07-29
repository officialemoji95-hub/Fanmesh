const ACCESS_COOKIE = "fanmesh_access";
const REFRESH_COOKIE = "fanmesh_refresh";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function getSupabaseConfig(environment = process.env) {
  const url = clean(environment.SUPABASE_URL, 500).replace(/\/+$/, "");
  const key = clean(environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY, 4000);
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === "https:" || (environment.NODE_ENV !== "production" && parsed.protocol === "http:");
  } catch {
    validUrl = false;
  }
  return Object.freeze({ url, key, configured: Boolean(validUrl && key) });
}

export function validateAuthInput(input = {}, { signUp = false } = {}) {
  const email = clean(input.email, 254).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  const displayName = clean(input.displayName, 80);
  if (!EMAIL_PATTERN.test(email)) throw new AuthError("Enter a valid email address");
  if (password.length < 8 || password.length > 128) {
    throw new AuthError("Password must be between 8 and 128 characters");
  }
  if (signUp && displayName.length < 2) throw new AuthError("Display name must contain at least 2 characters");
  return { email, password, displayName };
}

export function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      return [key, decodeURIComponent(value)];
    } catch {
      return [key, ""];
    }
  }).filter(([key]) => key));
}

function cookie(name, value, { maxAge, secure = false } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    Number.isFinite(maxAge) ? `Max-Age=${Math.max(0, Math.floor(maxAge))}` : "",
  ].filter(Boolean).join("; ");
}

export function sessionCookies(session, environment = process.env) {
  const secure = environment.NODE_ENV === "production";
  const expiresIn = Math.max(60, Number(session?.expires_in) || 3600);
  return [
    cookie(ACCESS_COOKIE, session.access_token, { maxAge: expiresIn, secure }),
    cookie(REFRESH_COOKIE, session.refresh_token, { maxAge: 60 * 60 * 24 * 30, secure }),
  ];
}

export function clearSessionCookies(environment = process.env) {
  const secure = environment.NODE_ENV === "production";
  return [
    cookie(ACCESS_COOKIE, "", { maxAge: 0, secure }),
    cookie(REFRESH_COOKIE, "", { maxAge: 0, secure }),
  ];
}

function publicUser(user = {}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name || user.email?.split("@")[0] || "Creator",
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function createAuthService({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getSupabaseConfig(environment);

  async function request(path, { method = "GET", body, token } = {}) {
    if (!config.configured) throw new AuthError("Supabase is not configured", 503);
    let response;
    try {
      response = await fetchImpl(`${config.url}/auth/v1${path}`, {
        method,
        headers: {
          apikey: config.key,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AuthError("Authentication service is temporarily unavailable", 502);
    }
    const payload = await responseBody(response);
    if (!response.ok) {
      const message = payload.msg || payload.message || payload.error_description || "Authentication request failed";
      throw new AuthError(message, response.status === 429 ? 429 : response.status === 401 ? 401 : 400);
    }
    return payload;
  }

  async function signUp(input) {
    const { email, password, displayName } = validateAuthInput(input, { signUp: true });
    const payload = await request("/signup", {
      method: "POST",
      body: { email, password, data: { display_name: displayName } },
    });
    const session = payload.session || (payload.access_token ? payload : null);
    return {
      data: {
        configured: true,
        authenticated: Boolean(session),
        verificationRequired: !session,
        user: publicUser(payload.user || session?.user),
      },
      cookies: session ? sessionCookies(session, environment) : [],
    };
  }

  async function signIn(input) {
    const { email, password } = validateAuthInput(input);
    const session = await request("/token?grant_type=password", { method: "POST", body: { email, password } });
    return {
      data: { configured: true, authenticated: true, user: publicUser(session.user) },
      cookies: sessionCookies(session, environment),
    };
  }

  async function session(requestObject = {}) {
    if (!config.configured) return { data: { configured: false, authenticated: false, mode: "demo" }, cookies: [] };
    const cookies = parseCookies(requestObject.headers?.cookie);
    const accessToken = cookies[ACCESS_COOKIE];
    const refreshToken = cookies[REFRESH_COOKIE];
    if (!accessToken && !refreshToken) {
      return { data: { configured: true, authenticated: false, mode: "supabase" }, cookies: [] };
    }
    if (accessToken) {
      try {
        const user = await request("/user", { token: accessToken });
        return { data: { configured: true, authenticated: true, mode: "supabase", user: publicUser(user), accessToken }, cookies: [] };
      } catch (error) {
        if (error.statusCode !== 401 || !refreshToken) {
          return { data: { configured: true, authenticated: false, mode: "supabase" }, cookies: clearSessionCookies(environment) };
        }
      }
    }
    try {
      const refreshed = await request("/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: refreshToken },
      });
      return {
        data: {
          configured: true,
          authenticated: true,
          mode: "supabase",
          user: publicUser(refreshed.user),
          accessToken: refreshed.access_token,
        },
        cookies: sessionCookies(refreshed, environment),
      };
    } catch {
      return { data: { configured: true, authenticated: false, mode: "supabase" }, cookies: clearSessionCookies(environment) };
    }
  }

  async function signOut(requestObject = {}) {
    const cookies = parseCookies(requestObject.headers?.cookie);
    if (config.configured && cookies[ACCESS_COOKIE]) {
      try {
        await request("/logout", { method: "POST", token: cookies[ACCESS_COOKIE] });
      } catch {
        // Local cookies are still cleared if the upstream session already expired.
      }
    }
    return {
      data: { configured: config.configured, authenticated: false, mode: config.configured ? "supabase" : "demo" },
      cookies: clearSessionCookies(environment),
    };
  }

  return Object.freeze({ config, signUp, signIn, signOut, session });
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
