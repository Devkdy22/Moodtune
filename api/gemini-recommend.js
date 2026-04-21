// Free-tier safety: only these models are allowed to prevent accidental paid usage.
const FREE_TIER_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];
const API_VERSIONS = ["v1beta", "v1"];

function resolveCandidateModels() {
  const requested = String(process.env.GEMINI_MODEL || "").trim();
  const base = requested
    ? [requested, ...FREE_TIER_MODELS]
    : [...FREE_TIER_MODELS];
  return Array.from(new Set(base.filter(model => FREE_TIER_MODELS.includes(model))));
}

const CANDIDATE_MODELS = resolveCandidateModels();

const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = Math.max(
  1,
  Number.parseInt(process.env.GEMINI_PROXY_RATE_LIMIT_PER_MINUTE || "20", 10),
);
// Hard daily cap to reduce accidental paid usage when billing is enabled.
const REQUESTS_PER_DAY_CAP = Math.max(
  1,
  Number.parseInt(process.env.GEMINI_PROXY_MAX_RPD || "180", 10),
);
const IP_WINDOW = new Map();
const USER_WINDOW = new Map();
const GLOBAL_DAY_WINDOW = { dayKey: "", count: 0 };
const USER_DAY_WINDOW = new Map();
let upstreamCooldownUntil = 0;
const REQUIRE_SPOTIFY_AUTH =
  String(process.env.GEMINI_PROXY_REQUIRE_SPOTIFY_AUTH ?? "true").trim().toLowerCase() !== "false";
const MAX_PROMPT_CHARS = Math.max(
  200,
  Number.parseInt(process.env.GEMINI_PROXY_MAX_PROMPT_CHARS || "4000", 10),
);
const ALLOWED_ORIGINS = String(process.env.GEMINI_PROXY_ALLOWED_ORIGINS || "")
  .split(",")
  .map(v => v.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function json(res, status, payload) {
  res.status(status)
    .setHeader("content-type", "application/json; charset=utf-8")
    .setHeader("cache-control", "no-store")
    .setHeader("x-content-type-options", "nosniff")
    .setHeader("referrer-policy", "no-referrer");
  res.end(JSON.stringify(payload));
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function hitRateLimit(ip) {
  const now = Date.now();
  const entry = IP_WINDOW.get(ip);
  if (!entry || now >= entry.resetAt) {
    IP_WINDOW.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= REQUESTS_PER_WINDOW) {
    return true;
  }
  entry.count += 1;
  return false;
}

function hitUserRateLimit(userId) {
  const now = Date.now();
  const entry = USER_WINDOW.get(userId);
  if (!entry || now >= entry.resetAt) {
    USER_WINDOW.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= REQUESTS_PER_WINDOW) {
    return true;
  }
  entry.count += 1;
  return false;
}

function hitDailyCap() {
  const now = new Date();
  const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  if (GLOBAL_DAY_WINDOW.dayKey !== dayKey) {
    GLOBAL_DAY_WINDOW.dayKey = dayKey;
    GLOBAL_DAY_WINDOW.count = 1;
    return false;
  }
  if (GLOBAL_DAY_WINDOW.count >= REQUESTS_PER_DAY_CAP) {
    return true;
  }
  GLOBAL_DAY_WINDOW.count += 1;
  return false;
}

function hitUserDailyCap(userId) {
  const now = new Date();
  const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  const entry = USER_DAY_WINDOW.get(userId);
  if (!entry || entry.dayKey !== dayKey) {
    USER_DAY_WINDOW.set(userId, { dayKey, count: 1 });
    return false;
  }
  if (entry.count >= REQUESTS_PER_DAY_CAP) {
    return true;
  }
  entry.count += 1;
  return false;
}

function stripCodeFence(text) {
  return String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

function isOriginAllowed(req) {
  if (!ALLOWED_ORIGINS.length) return true;
  const origin = String(req.headers.origin || "").trim().replace(/\/+$/, "");
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function checkProxyAccess(req) {
  if (!isOriginAllowed(req)) {
    return {
      ok: false,
      status: 403,
      code: "forbidden_origin",
      message: "Request origin is not allowed",
    };
  }
  return { ok: true };
}

function extractBearerToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return "";
  return String(match[1] || "").trim();
}

async function verifySpotifyAccessToken(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, userId: "" };
  }
  const data = await res.json().catch(() => null);
  const userId = String(data?.id || "").trim();
  if (!userId) return { ok: false, status: 401, userId: "" };
  return { ok: true, status: 200, userId };
}

async function callGemini(prompt, apiKey) {
  if (!CANDIDATE_MODELS.length) {
    throw {
      status: 500,
      message: "[GeminiProxy] no allowed free-tier models configured",
    };
  }
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    for (const version of API_VERSIONS) {
      const endpoint =
        `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = String(data?.error?.message || "");
        const isModelNotFound =
          res.status === 404 &&
          (message.includes("is not found") ||
            message.includes("not supported for generateContent"));
        lastError = {
          status: res.status,
          message: `[GeminiProxy] request failed (${res.status}) [${model}] [${version}]`,
          body: data,
        };
        const isQuotaExceeded = res.status === 429;
        const isTransient = res.status >= 500 || res.status === 408 || res.status === 503;
        // 모델/버전 자체가 없거나 쿼터 문제면 다음 후보로 진행
        if (isModelNotFound || isQuotaExceeded) break;
        // 일시 장애는 다른 API 버전/다음 모델로 우회 시도
        if (isTransient) continue;
        throw lastError;
      }

      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
      if (!text) {
        lastError = {
          status: 502,
          message: `[GeminiProxy] empty response text [${model}] [${version}]`,
          body: data,
        };
        continue;
      }

      try {
        return {
          playlist: JSON.parse(stripCodeFence(text)),
          model,
        };
      } catch (err) {
        lastError = {
          status: 502,
          message: `[GeminiProxy] invalid JSON from model [${model}] [${version}]`,
          body: { text, parseError: String(err?.message || err) },
        };
      }
    }
  }
  throw lastError || { status: 500, message: "[GeminiProxy] model fallback exhausted" };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).setHeader("cache-control", "no-store");
    return res.end();
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      endpoint: "gemini-recommend",
      methods: ["POST"],
      freeTierOnly: true,
      allowedModels: CANDIDATE_MODELS,
      apiVersions: API_VERSIONS,
      originAllowListEnabled: ALLOWED_ORIGINS.length > 0,
      spotifyAuthRequired: REQUIRE_SPOTIFY_AUTH,
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: { code: "method_not_allowed", message: "POST only" } });
  }

  const access = checkProxyAccess(req);
  if (!access.ok) {
    return json(res, access.status, {
      error: {
        code: access.code,
        message: access.message,
      },
    });
  }

  const now = Date.now();
  if (upstreamCooldownUntil > now) {
    return json(res, 429, {
      error: {
        code: "quota_exceeded",
        message: "Gemini quota cooling down",
        retryAfterMs: upstreamCooldownUntil - now,
      },
    });
  }

  const ip = getClientIp(req);
  if (hitRateLimit(ip)) {
    return json(res, 429, {
      error: {
        code: "rate_limited",
        message: "Too many requests to Gemini proxy",
      },
    });
  }
  if (hitDailyCap()) {
    return json(res, 429, {
      error: {
        code: "free_tier_daily_cap",
        message: "Daily request cap reached to avoid paid usage",
      },
    });
  }

  let spotifyUserId = "";
  if (REQUIRE_SPOTIFY_AUTH) {
    const bearer = extractBearerToken(req);
    if (!bearer) {
      return json(res, 401, {
        error: {
          code: "unauthorized",
          message: "Missing Spotify Bearer token",
        },
      });
    }
    const verified = await verifySpotifyAccessToken(bearer);
    if (!verified.ok) {
      return json(res, 401, {
        error: {
          code: "invalid_spotify_token",
          message: `Spotify token validation failed (${verified.status})`,
        },
      });
    }
    spotifyUserId = verified.userId;
    if (hitUserRateLimit(spotifyUserId)) {
      return json(res, 429, {
        error: {
          code: "rate_limited_user",
          message: "Too many requests for this Spotify user",
        },
      });
    }
    if (hitUserDailyCap(spotifyUserId)) {
      return json(res, 429, {
        error: {
          code: "free_tier_daily_cap_user",
          message: "Daily request cap reached for this Spotify user",
        },
      });
    }
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return json(res, 500, {
      error: {
        code: "server_misconfigured",
        message: "Missing GEMINI_API_KEY",
      },
    });
  }

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    return json(res, 400, { error: { code: "invalid_request", message: "prompt is required" } });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json(res, 413, {
      error: {
        code: "prompt_too_large",
        message: `prompt too large (max ${MAX_PROMPT_CHARS} chars)`,
      },
    });
  }

  try {
    const result = await callGemini(prompt, apiKey);
    return json(res, 200, result);
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 429) {
      upstreamCooldownUntil = Date.now() + 60_000;
    }
    return json(res, status, {
      error: {
        code: status === 429 ? "quota_exceeded" : "upstream_error",
        message: String(err?.message || "Gemini proxy failed"),
        details: err?.body || null,
      },
    });
  }
}
