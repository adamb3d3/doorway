// Vercel serverless function: proxies The Doorway's calls to the Anthropic
// Messages API so the server key never reaches the browser.
//
// Hardening:
// - POST only; request body capped at 200 KB.
// - X-DW-Kind must be one of case | results | turn | grade (else 400).
// - Model allowlist: only claude-sonnet-5-5.
// - The upstream body is rebuilt from {model, max_tokens, system, messages};
//   anything else the client sends is dropped. max_tokens is capped by kind
//   (case/results 8000, turn/grade 1500).
// - Origin check: if the request carries Origin (or, failing that, Referer), its
//   host must be the request's own host, VERCEL_URL, or one listed in
//   ALLOWED_ORIGIN (comma-separated). Requests with neither header pass.
// - Rate limit on the server key, per IP per 24 h, by kind: case 12,
//   results 12, turn 400, grade 15. IP comes from x-vercel-forwarded-for, then
//   x-real-ip, then x-forwarded-for. A request carrying X-User-API-Key uses that
//   key and skips the limit.
// - A counted slot is refunded when the upstream call fails or the client
//   disconnects before the response is sent (the upstream call is aborted too).
// - Errors come back as {error: "<readable message>"} with the upstream status.
//
// The rate limit lives in this instance's memory. It is best effort: it resets
// on every cold start and is not shared between concurrent instances. The real
// cost ceiling is the monthly spend limit on the Anthropic Console workspace
// that holds ANTHROPIC_API_KEY (see README).

const ALLOWED_MODELS = ["claude-sonnet-5-5"];
const KINDS = {
  case: { limit: 12, maxTokens: 8000, noun: "new cases" },
  results: { limit: 12, maxTokens: 8000, noun: "results sheets" },
  turn: { limit: 400, maxTokens: 1500, noun: "patient turns" },
  grade: { limit: 15, maxTokens: 1500, noun: "grades" },
};
const MAX_BODY_BYTES = 200 * 1024;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const UPSTREAM = "https://api.anthropic.com/v1/messages";

const rateLimitMap = new Map(); // "ip|kind" -> {count, reset}

export function __resetRateLimit() { rateLimitMap.clear(); }
export const __KINDS = KINDS;

function header(req, name) {
  const v = req.headers ? req.headers[name] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

function firstIp(v) { return v ? String(v).split(",")[0].trim() : ""; }

function clientIp(req) {
  return firstIp(header(req, "x-vercel-forwarded-for"))
    || firstIp(header(req, "x-real-ip"))
    || firstIp(header(req, "x-forwarded-for"))
    || (req.socket && req.socket.remoteAddress) || "unknown";
}

function hostOf(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s).host.toLowerCase(); } catch (e) { return null; }
}

// true when there is no Origin/Referer, or when it names this deployment.
function originAllowed(req) {
  const raw = header(req, "origin") || header(req, "referer");
  if (!raw || raw === "null") return !raw; // "Origin: null" (sandboxed/file) is refused
  const from = hostOf(raw);
  if (!from) return false;
  const allowed = new Set();
  const self = hostOf(header(req, "x-forwarded-host") || header(req, "host"));
  if (self) allowed.add(self);
  if (process.env.VERCEL_URL) allowed.add(hostOf(process.env.VERCEL_URL));
  String(process.env.ALLOWED_ORIGIN || "").split(",").forEach((o) => { const h = hostOf(o); if (h) allowed.add(h); });
  return allowed.has(from);
}

function send(res, status, payload) {
  res.setHeader && res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

// Returns {ok:true} after counting, or {ok:false, retryAfterSec}.
function takeSlot(ip, kind, now) {
  const key = ip + "|" + kind;
  let rec = rateLimitMap.get(key);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + WINDOW_MS };
  if (rec.count >= KINDS[kind].limit) {
    rateLimitMap.set(key, rec);
    return { ok: false, retryAfterSec: Math.ceil((rec.reset - now) / 1000) };
  }
  rec.count += 1;
  rateLimitMap.set(key, rec);
  return { ok: true };
}

function refundSlot(ip, kind) {
  const rec = rateLimitMap.get(ip + "|" + kind);
  if (rec && rec.count > 0) rec.count -= 1;
}

function upstreamMessage(status, data) {
  const m = data && data.error && (typeof data.error === "string" ? data.error : data.error.message);
  if (status === 401) return "The API key was rejected. Check the key in Settings, or the server's ANTHROPIC_API_KEY.";
  if (status === 429) return "The model is rate-limited right now. Wait a minute and try again.";
  if (status === 529) return "The model is overloaded right now. Try again in a moment.";
  return m ? `Model error (${status}): ${m}` : `Model error (${status}).`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader && res.setHeader("Allow", "POST");
    return send(res, 405, { error: "POST only." });
  }

  const kind = String(header(req, "x-dw-kind") || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
    return send(res, 400, { error: "Missing or unknown X-DW-Kind (case, results, turn or grade)." });
  }
  if (!originAllowed(req)) return send(res, 403, { error: "Requests from other sites are not allowed." });

  const declared = Number(header(req, "content-length") || 0);
  if (declared > MAX_BODY_BYTES) return send(res, 413, { error: "Request too large (200 KB max)." });

  let body = req.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return send(res, 413, { error: "Request too large (200 KB max)." });
    try { body = JSON.parse(body); } catch (e) { return send(res, 400, { error: "Body must be JSON." }); }
  } else if (body && typeof body === "object") {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return send(res, 413, { error: "Request too large (200 KB max)." });
  }
  if (!body || typeof body !== "object") return send(res, 400, { error: "Body must be JSON." });

  const { model, max_tokens, system, messages } = body;
  if (!ALLOWED_MODELS.includes(model)) {
    return send(res, 400, { error: `Model not allowed. Use ${ALLOWED_MODELS.join(", ")}.` });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return send(res, 400, { error: "messages must be a non-empty array." });
  }
  const cap = KINDS[kind].maxTokens;
  const requested = Number(max_tokens);
  const cappedTokens = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1024, cap);

  const upstreamBody = { model, max_tokens: cappedTokens, messages };
  if (system !== undefined && system !== null && system !== "") upstreamBody.system = system;

  const userKey = header(req, "x-user-api-key");
  const apiKey = userKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return send(res, 500, { error: "No API key configured on the server. Add your own key in Settings." });

  const ip = clientIp(req);
  let counted = false;
  if (!userKey) {
    const slot = takeSlot(ip, kind, Date.now());
    if (!slot.ok) {
      res.setHeader && res.setHeader("Retry-After", String(slot.retryAfterSec));
      return send(res, 429, {
        error: `Daily limit reached (${KINDS[kind].limit} ${KINDS[kind].noun} per day). Add your own API key in Settings for unlimited use.`,
        code: "daily_limit",
      });
    }
    counted = true;
  }

  // Refund at most once, whatever path gives the slot back.
  let refunded = false;
  const refund = () => { if (counted && !refunded) { refunded = true; refundSlot(ip, kind); } };

  // Client gone before we answered → abort upstream and give the slot back.
  let responded = false, disconnected = false;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const onGone = () => {
    if (responded || disconnected) return;
    disconnected = true;
    refund();
    if (ctrl) ctrl.abort();
  };
  if (req && typeof req.on === "function") {
    req.on("aborted", onGone);
    // Node fires req 'close' once the body is read, too; only treat it as a disconnect if the socket died.
    req.on("close", () => { if (req.aborted || (req.socket && req.socket.destroyed)) onGone(); });
  }
  if (res && typeof res.on === "function") res.on("close", () => { if (!res.writableEnded) onGone(); });
  const reply = (status, payload) => { if (disconnected) return; responded = true; return send(res, status, payload); };

  let r, data;
  try {
    r = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(upstreamBody),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    refund();
    return reply(502, { error: "Could not reach the model. Check your connection and try again." });
  }

  try { data = await r.json(); } catch (e) { data = null; }
  if (disconnected) return;

  if (!r.ok) {
    refund(); // failed calls don't use up the allowance
    return reply(r.status, { error: upstreamMessage(r.status, data) });
  }
  if (!data) {
    refund();
    return reply(502, { error: "The model returned an unreadable response. Try again." });
  }
  return reply(200, data);
}
