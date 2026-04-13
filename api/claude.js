// Vercel serverless function. Proxies to Anthropic so the API key stays server-side.
// Simple in-memory rate limit (10 cases/IP/day). Resets with each cold start — fine for our scale.

const rateLimitMap = new Map();
const LIMIT = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.headers["x-real-ip"] || "unknown";
  const userKey = req.headers["x-user-api-key"];
  const apiKey = userKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "No API key configured" });

  // Rate limit only applies when using the server's key
  if (!userKey) {
    const now = Date.now();
    const rec = rateLimitMap.get(ip) || { count: 0, reset: now + WINDOW_MS };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
    if (rec.count >= LIMIT) {
      return res.status(429).json({ error: `Daily limit reached (${LIMIT} cases). Add your own API key in Settings for unlimited.` });
    }
    rec.count += 1;
    rateLimitMap.set(ip, rec);
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
