// Free-tier safety: only these models are allowed to prevent accidental paid usage.
const FREE_TIER_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
];

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
const IP_WINDOW = new Map();
let upstreamCooldownUntil = 0;
const ALLOWED_ORIGINS = String(process.env.GEMINI_PROXY_ALLOWED_ORIGINS || "")
  .split(",")
  .map(v => v.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function json(res, status, payload) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
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

async function callGemini(prompt, apiKey) {
  if (!CANDIDATE_MODELS.length) {
    throw {
      status: 500,
      message: "[GeminiProxy] no allowed free-tier models configured",
    };
  }
  let lastError = null;
  for (const model of CANDIDATE_MODELS) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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
        (message.includes("is not found") || message.includes("not supported for generateContent"));
      lastError = {
        status: res.status,
        message: `[GeminiProxy] request failed (${res.status}) [${model}]`,
        body: data,
      };
      const isQuotaExceeded = res.status === 429;
      if (isModelNotFound || isQuotaExceeded) continue;
      throw lastError;
    }

    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
    if (!text) {
      lastError = {
        status: 502,
        message: `[GeminiProxy] empty response text [${model}]`,
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
        message: `[GeminiProxy] invalid JSON from model [${model}]`,
        body: { text, parseError: String(err?.message || err) },
      };
    }
  }
  throw lastError || { status: 500, message: "[GeminiProxy] model fallback exhausted" };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      endpoint: "gemini-recommend",
      methods: ["POST"],
      freeTierOnly: true,
      allowedModels: CANDIDATE_MODELS,
      originAllowListEnabled: ALLOWED_ORIGINS.length > 0,
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
