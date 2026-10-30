// Shared bootstrap for the live harnesses (live.mjs, regrade.mjs): reads .env, shims
// window/localStorage for cases.js + engine.js, and routes the engine's /api/claude calls
// through the real proxy handler in-process so the live run exercises the same code path
// as the phone. With {stub:true} the fake API from test/stub.js answers instead (no key).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export const MODELS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
export function modelId(s) { return MODELS[s] || s; }

// $ per million tokens. Cache write = 1.25x input, cache read per the current price list.
export const PRICE = {
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
};
export function costOf(model, u) {
  const p = PRICE[model];
  if (!p || !u) return 0;
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out +
    (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
}

export function loadEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return false;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return true;
}

export function makeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] || null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

export async function boot({ stub = false } = {}) {
  loadEnv();
  globalThis.window = globalThis;
  globalThis.localStorage = makeStorage();
  const realFetch = globalThis.fetch;
  const { default: handler, __resetRateLimit } = await import("../api/claude.js");
  const stubMod = stub ? require("./stub.js") : null;

  globalThis.fetch = async function (url, opts) {
    if (url !== "/api/claude") return realFetch(url, opts);
    const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    if (stub) {
      const payload = stubMod.fakeResponse(headers["x-dw-kind"], opts.body);
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }
    headers.host = "live.local";
    const req = { method: "POST", headers, body: opts.body };
    const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, setHeader() {} };
    await handler(req, res);
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => JSON.stringify(res.payload) };
  };

  require("../cases.js");
  require("../engine.js");
  const DW = globalThis.DW, CASES = globalThis.DW_CASES;
  DW._.CONFIG.backoffMs = 1500;
  if (!stub && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Put one line in " + path.join(ROOT, ".env") + ": ANTHROPIC_API_KEY=sk-ant-...");
  }
  return { DW, CASES, realFetch, resetRateLimit: __resetRateLimit, stub };
}

// Direct Messages API call (used by the Derek player). Returns the parsed response body.
export async function anthropic(realFetch, body) {
  const r = await realFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error("anthropic " + r.status + ": " + ((data && data.error && data.error.message) || "error"));
    e.status = r.status; e.data = data;
    throw e;
  }
  return data;
}
export function textOf(data) { return (data && data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"); }

export function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
export function writeJSON(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
export function appendJSONL(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + "\n"); }

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// --models case=opus,grade=opus → {case:"claude-opus-5-5", grade:"claude-opus-5-5"}
export function parseModels(s) {
  const out = {};
  if (!s || s === true) return out;
  for (const part of String(s).split(",")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.trim()] = modelId(v.trim());
  }
  return out;
}

export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function sd(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
export function round(x, d = 1) { const f = Math.pow(10, d); return Math.round(x * f) / f; }
