# The Doorway

An ER clinical gestalt trainer for rural emergency physicians.

Every ER doctor develops a sixth sense — the read from the hallway, the hunch before the labs come back. This is the place you practice it.

## What it is

A phone-first web app where you meet a rural-ED patient, work the case in natural conversation (history, exam, labs, imaging, disposition), commit to a diagnosis, and get graded by a senior attending. Weighted toward the high-yield misses rural docs actually make — aortic dissection as MI, SAH as resolved headache, septic shock with normal BP, mesenteric ischemia as vague abdominal pain. Over reps, the tool learns your blind spots.

Built with plain HTML + React via CDN + one Vercel serverless function. No build step. No framework overhead. Open source, MIT.

## Architecture

- `index.html` — the entire frontend, React loaded from CDN, JSX compiled in-browser via Babel. Landing page + trainer + scoring.
- `api/claude.js` — Vercel serverless proxy to the Anthropic API. Rate-limits to 10 cases per IP per day. Supports bring-your-own-key via `X-User-API-Key` header.
- `manifest.json` — PWA manifest so users can add it to their phone home screen.

That's the whole app. Three files.

## Deploy

1. Create a GitHub repo and upload these three files (plus this README and LICENSE).
2. Import the repo into Vercel.
3. Add environment variable: `ANTHROPIC_API_KEY=sk-ant-api03-...`
4. Deploy.

## Models

- Case generation and patient Q&A: Claude Haiku 4.5 (fast, cheap)
- Grading: Claude Sonnet 4 (reasoning quality matters)

Expected cost at typical usage: ~$5-10/month with a $20 cap set at Anthropic.

## Contributing

PRs welcome, especially:
- More rural-ED case patterns
- Decision rule integrations (HEART, Wells, PERC, Ottawa)
- Accessibility improvements
- Clinical accuracy fixes from practicing physicians

## License

MIT. See LICENSE.

## Author

Ted Delicath · [adambede.org](https://adambede.org)
