# The Doorway

An ER clinical gestalt trainer for rural emergency physicians.

Every ER doctor develops a sixth sense — the read from the hallway, the hunch before the labs come back. This is the place you practice it.

## What it is

A phone-first web app. You see a patient from the doorway and commit to sick or not sick, an acuity and a likely disposition before you touch anything. Then you work the case on a running clock in a critical access hospital: history, exam, labs, imaging, procedures, stabilization, transfer. Vitals drift if you do nothing and respond to what you do. You commit to a differential and a disposition, and a senior-attending grader walks you through where your timeline diverged from the ideal one.

## What changed in v3

- The doorway call is locked and timestamped before the workup starts, and scored against the truth.
- A simulated clock and vitals model. Orders cost time; CT may be down at night; flight may be weathered out.
- Chip results come from a sheet written with the case, so most orders answer instantly with no model call.
- Critical-action timing is computed in code, not judged by the model.
- Case selection weights your weak domains and brings missed patterns back at 3, 14 and 42 days with a different presentation.
- New cases: telestroke tenecteplase, psych boarding, hyperkalemia, DKA, COPD and CHF needing BiPAP, anticoagulated GI bleed, refused transfer, accepting facility on diversion.
- One model everywhere: Claude Sonnet 5.5 (`claude-sonnet-5-5`).
- Installable on a phone home screen and loads on a weak connection once cached.

## Architecture

No build step, no database, no login. Files are uploaded to GitHub and Vercel serves them.

| File | What it does |
|---|---|
| `index.html` | Shell: phone and home-screen tags, fonts, pinned React 18.3.1 and Babel 7.29.12 from unpkg, a fallback message if the app fails to start. |
| `cases.js` | Case catalog, facility profile, conditions roll, case selection. |
| `engine.js` | API client, prompts, clock and vitals model, grading, storage, miss queue, export and import. |
| `app.jsx` | The React UI, compiled in the browser. |
| `api/claude.js` | Serverless proxy to the Anthropic API. Allows only Sonnet 5.5, caps output tokens by call kind, limits each IP per day, refuses calls from other sites, and accepts a user's own key. |
| `sw.js` | Service worker: app files network-first with a 3 s fallback to the cached copy, fonts and CDN scripts cache-first, `/api/` never cached. |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | Home-screen install. |
| `vercel.json` | Gives the proxy 120 s (case generation is slow) and stops `index.html` and `sw.js` from being cached. |
| `test/` | Proxy unit tests, a fake API, and a browser smoke test. |

## Deploy

1. In the [Anthropic Console](https://console.anthropic.com), create a separate workspace for The Doorway, set a monthly spend limit on it, and create an API key inside that workspace. The proxy's per-IP limit is best effort (it resets when the function restarts); the workspace limit is the real ceiling on what the server key can spend.
2. Create a GitHub repo and upload every file in this folder except `v2/`, `shots/` and `SPEC.md` if you don't want them public.
3. Import the repo into Vercel. No build settings are needed.
4. Add the environment variable `ANTHROPIC_API_KEY` with the key from step 1.
5. Deploy. To update, upload the changed files to GitHub; Vercel redeploys.

**On each deploy, bump `VERSION` in `index.html`.** It is the app's one version number: the three app files load as `cases.js?v=VERSION` etc., so phones fetch the new code, and `sw.js` is registered as `sw.js?v=VERSION` and reads its cache name from that, so a new value installs a new service worker and deletes the old cache. `sw.js` has no version of its own to edit.

### Proxy limits

The server key is rate-limited per IP per day, by call kind:

| Kind (`X-DW-Kind`) | Per IP per day | Max output tokens |
|---|---|---|
| `case` | 12 | 4000 |
| `results` | 12 | 4000 |
| `turn` | 400 | 1500 |
| `grade` | 15 | 1500 |

A missing or unknown kind is refused (400). A call that fails upstream, or whose browser disconnects before the answer, gives its slot back. Users with their own key skip the limits. The client IP is read from `x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`. The limits live in one function instance's memory and reset on a cold start, so treat them as a brake, not a ceiling; the Console spend limit is the ceiling.

### Allowed origins

When a request carries an `Origin` (or, failing that, a `Referer`) header, its host must be the request's own host; anything else gets a 403. Requests with neither header pass. To allow other hosts (a custom domain that proxies to Vercel, a staging site), set `ALLOWED_ORIGIN` to a comma-separated list such as `https://doorway.org,staging.doorway.org`. Vercel's `VERCEL_URL` for the current deployment is allowed automatically.

## Model

Claude Sonnet 5.5 for case writing, patient conversation and grading. Each new case is two calls (the case, then its results sheet), and each free-text turn and each grade is one more. Most chip orders cost nothing because results are served from the sheet. Users who add their own API key in Settings skip the daily case limit and pay for their own use.

## Privacy

Your history, stats and settings stay in your browser's local storage. Nothing is stored on a server. Case text passes through the proxy to Anthropic and is not logged by the app. Browsers can clear local storage (Safari does this to sites you haven't opened in a while), so use Settings → Export now and then and keep the file. Import restores it on any device.

## Editing the facility

The hospital you train in is described by `FACILITY` near the top of `cases.js`: bed count, which services exist, CT hours, how many simulated minutes each kind of order takes, and default O-negative units. The current values are placeholders. Edit them to match your own hospital and redeploy.

## Tests

From the repo root, with Node 18 or later:

```
node test/engine.test.js          # engine: vitals model, act/grade contracts, storage, DDx matching
node --test test/api.test.mjs     # proxy: kinds, token caps, per-kind limits, origin check, refunds
node test/smoke.js                # full loop in Chromium at 390x844, fake API, screenshots in shots/v3/
```

The smoke test needs Playwright (`npm i -D playwright && npx playwright install chromium`), Python 3 for the local server, and network access to unpkg.com. It fails on any console error.

## Contributing

PRs welcome, especially:
- More rural-ED case patterns
- Decision rule integrations (HEART, Wells, PERC, Ottawa)
- Accessibility improvements
- Clinical accuracy fixes from practicing physicians

The Doorway is a training tool, not medical advice.

## License

MIT. See LICENSE.

## Author

Ted Delicath · [adambede.org](https://adambede.org)
