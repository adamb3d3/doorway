// Unit tests for api/claude.js. Run: node --test test/api.test.mjs
// (Node 18+; no dependencies. fetch is mocked.)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler, { __resetRateLimit } from "../api/claude.js";

let calls;
function mockFetch(status = 200, payload = { content: [{ type: "text", text: "{}" }] }) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
}

function makeReq({ method = "POST", body, headers = {} } = {}) {
  return {
    method,
    body: body === undefined ? { model: "claude-sonnet-5-5", max_tokens: 1000, system: "s", messages: [{ role: "user", content: "hi" }] } : body,
    headers: { "x-forwarded-for": "1.2.3.4", "x-dw-kind": "turn", host: "doorway.example", ...headers },
  };
}

function makeRes() {
  const res = { statusCode: null, payload: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.payload = p; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  return res;
}

async function call(opts) { const res = makeRes(); await handler(makeReq(opts), res); return res; }

beforeEach(() => {
  __resetRateLimit();
  process.env.ANTHROPIC_API_KEY = "server-key";
  mockFetch();
});

test("rejects non-POST", async () => {
  const res = await call({ method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(calls.length, 0);
});

test("model allowlist: rejects other models with 400", async () => {
  const res = await call({ body: { model: "claude-opus-4", max_tokens: 10, messages: [{ role: "user", content: "x" }] } });
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /not allowed/i);
  assert.equal(calls.length, 0);
});

test("model allowlist: accepts claude-sonnet-5-5 and sets headers", async () => {
  const res = await call({});
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].opts.headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[0].opts.headers["x-api-key"], "server-key");
});

test("max_tokens capped by kind and body rebuilt from allowed keys only", async () => {
  await call({ headers: { "x-dw-kind": "case" }, body: { model: "claude-sonnet-5-5", max_tokens: 64000, system: "sys", messages: [{ role: "user", content: "x" }], tools: [{}], temperature: 2, stream: true } });
  const b = calls[0].body;
  assert.equal(b.max_tokens, 4000);
  assert.deepEqual(Object.keys(b).sort(), ["max_tokens", "messages", "model", "system"]);
  for (const [kind, cap] of [["results", 4000], ["turn", 1500], ["grade", 1500]]) {
    await call({ headers: { "x-dw-kind": kind }, body: { model: "claude-sonnet-5-5", max_tokens: 9000, messages: [{ role: "user", content: "x" }] } });
    assert.equal(calls.at(-1).body.max_tokens, cap, kind);
  }
});

test("max_tokens under the cap passes through", async () => {
  await call({ headers: { "x-dw-kind": "case" }, body: { model: "claude-sonnet-5-5", max_tokens: 3000, messages: [{ role: "user", content: "x" }] } });
  assert.equal(calls[0].body.max_tokens, 3000);
});

test("missing or unknown X-DW-Kind is a 400", async () => {
  assert.equal((await call({ headers: { "x-dw-kind": undefined } })).statusCode, 400);
  assert.equal((await call({ headers: { "x-dw-kind": "chat" } })).statusCode, 400);
  assert.equal(calls.length, 0);
});

test("rejects bodies over 200 KB with 413", async () => {
  const big = "x".repeat(210 * 1024);
  const res = await call({ body: { model: "claude-sonnet-5-5", max_tokens: 10, messages: [{ role: "user", content: big }] } });
  assert.equal(res.statusCode, 413);
  assert.equal(calls.length, 0);
});

test("rate limit per IP per day by kind: case 12, results 12, turn 400, grade 15", async () => {
  for (const [kind, limit] of [["case", 12], ["results", 12], ["grade", 15], ["turn", 400]]) {
    for (let i = 0; i < limit; i++) {
      const r = await call({ headers: { "x-dw-kind": kind } });
      assert.equal(r.statusCode, 200, `${kind} ${i + 1} should pass`);
    }
    const blocked = await call({ headers: { "x-dw-kind": kind } });
    assert.equal(blocked.statusCode, 429, `${kind} over limit`);
    assert.match(blocked.payload.error, /daily limit/i);
    assert.equal(blocked.payload.code, "daily_limit");
  }
  const otherIp = await call({ headers: { "x-dw-kind": "case", "x-forwarded-for": "9.9.9.9" } });
  assert.equal(otherIp.statusCode, 200, "limit is per IP");
});

test("client IP: x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", async () => {
  for (let i = 0; i < 12; i++) await call({ headers: { "x-dw-kind": "case", "x-vercel-forwarded-for": "5.5.5.5", "x-real-ip": "6.6.6.6" } });
  // same vercel IP, different spoofable x-forwarded-for → still blocked
  assert.equal((await call({ headers: { "x-dw-kind": "case", "x-vercel-forwarded-for": "5.5.5.5, 1.1.1.1", "x-forwarded-for": "7.7.7.7" } })).statusCode, 429);
  // x-real-ip used when the vercel header is absent
  assert.equal((await call({ headers: { "x-dw-kind": "case", "x-real-ip": "6.6.6.6" } })).statusCode, 200);
});

test("origin check: same host and no-origin pass; other sites 403; VERCEL_URL / ALLOWED_ORIGIN allowed", async () => {
  assert.equal((await call({})).statusCode, 200, "no Origin/Referer");
  assert.equal((await call({ headers: { origin: "https://doorway.example" } })).statusCode, 200);
  assert.equal((await call({ headers: { referer: "https://doorway.example/index.html" } })).statusCode, 200);
  const bad = await call({ headers: { origin: "https://evil.example" } });
  assert.equal(bad.statusCode, 403);
  assert.equal((await call({ headers: { referer: "https://evil.example/x" } })).statusCode, 403);
  assert.equal((await call({ headers: { origin: "null" } })).statusCode, 403);
  process.env.VERCEL_URL = "doorway-abc.vercel.app";
  process.env.ALLOWED_ORIGIN = "https://doorway.org, staging.doorway.org";
  try {
    assert.equal((await call({ headers: { origin: "https://doorway-abc.vercel.app" } })).statusCode, 200);
    assert.equal((await call({ headers: { origin: "https://doorway.org" } })).statusCode, 200);
    assert.equal((await call({ headers: { origin: "https://staging.doorway.org" } })).statusCode, 200);
  } finally { delete process.env.VERCEL_URL; delete process.env.ALLOWED_ORIGIN; }
  assert.equal(calls.length, 6, "403s never reach upstream");
});

test("client disconnect before the response refunds the slot and aborts upstream", async () => {
  let signal;
  for (let i = 0; i < 12; i++) {
    const req = Object.assign(new EventEmitter(), makeReq({ headers: { "x-dw-kind": "case" } }));
    const res = Object.assign(new EventEmitter(), makeRes(), { writableEnded: false });
    let release;
    globalThis.fetch = (url, opts) => { signal = opts.signal; return new Promise((resolve, reject) => { release = resolve; opts.signal.addEventListener("abort", () => reject(new Error("aborted"))); }); };
    const p = handler(req, res);
    await new Promise((r) => setImmediate(r));
    req.aborted = true;
    req.emit("aborted");
    await p;
    assert.equal(signal.aborted, true);
    assert.equal(res.statusCode, null, "nothing written to a gone client");
  }
  mockFetch();
  assert.equal((await call({ headers: { "x-dw-kind": "case" } })).statusCode, 200, "all 12 slots were refunded");
});

test("BYOK bypasses the case limit and uses the user's key", async () => {
  for (let i = 0; i < 12; i++) await call({ headers: { "x-dw-kind": "case" } });
  assert.equal((await call({ headers: { "x-dw-kind": "case" } })).statusCode, 429);
  for (let i = 0; i < 20; i++) assert.equal((await call({ headers: { "x-dw-kind": "grade", "x-user-api-key": "user-key" } })).statusCode, 200);
  const r = await call({ headers: { "x-dw-kind": "case", "x-user-api-key": "user-key" } });
  assert.equal(r.statusCode, 200);
  assert.equal(calls.at(-1).opts.headers["x-api-key"], "user-key");
});

test("failed upstream calls do not use up a slot", async () => {
  mockFetch(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
  for (let i = 0; i < 15; i++) {
    const r = await call({ headers: { "x-dw-kind": "case" } });
    assert.equal(r.statusCode, 529);
  }
  mockFetch();
  assert.equal((await call({ headers: { "x-dw-kind": "case" } })).statusCode, 200);
});

test("upstream errors pass status through with a readable string error", async () => {
  mockFetch(400, { type: "error", error: { type: "invalid_request_error", message: "messages: bad" } });
  const r = await call({});
  assert.equal(r.statusCode, 400);
  assert.equal(typeof r.payload.error, "string");
  assert.match(r.payload.error, /messages: bad/);
});

test("network failure returns 502 with a readable error", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  const r = await call({});
  assert.equal(r.statusCode, 502);
  assert.equal(typeof r.payload.error, "string");
});

test("no server key and no BYOK returns 500", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await call({});
  assert.equal(r.statusCode, 500);
});

test("string body is parsed", async () => {
  const r = await call({ body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 9999, messages: [{ role: "user", content: "x" }] }) });
  assert.equal(r.statusCode, 200);
  assert.equal(calls[0].body.max_tokens, 1500);
});
