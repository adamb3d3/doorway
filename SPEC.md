# The Doorway v3 — build spec

Source of truth for the v3 builders. The v2 code is in `v2/index.html` (read it; keep its look, palette `C`, fonts, the patient figure/avatar renderer, the Landing page and its copy unless told otherwise). Plan doc that motivates every item: "The Doorway — v3 overhaul plan" (summarised here).

## Hard constraints (do not break)
- No build step. No database. No auth. Nothing to maintain. MIT. Deploys by uploading files to GitHub → Vercel.
- React 18.3.1 + ReactDOM 18.3.1 UMD and `@babel/standalone@7.29.12`, all pinned exact, from unpkg. Fonts from Google Fonts as in v2.
- All user state in localStorage (wrap every access in try/catch).
- Phone first: 390×844 is the design target. 100dvh shell. Tap targets ≥44px. No text <11px. Red text uses `#d14b4b` (C.redText); `#8B0000` only for fills/borders. Respect `prefers-reduced-motion`. `aria-label` on icon buttons.
- **One model everywhere: `claude-sonnet-5-5`.** (Ted's decision: step up from Haiku.) Constant `MODEL` in engine.js.

## Files
| File | Owner | What |
|---|---|---|
| `index.html` | infra | Shell: meta/PWA tags, fonts, pinned CDN scripts, `<script src="cases.js">`, `<script src="engine.js">`, `<script type="text/babel" data-presets="react" src="app.jsx">`, service-worker registration, a no-JS / load-failure fallback message. |
| `cases.js` | data+engine | Plain JS (no JSX), defines `window.DW_CASES`. Case catalog, facility profile, seeded RNG, case selection. |
| `engine.js` | data+engine | Plain JS, defines `window.DW`. API client, prompts, sim clock + vitals model, local result serving, grading, storage, miss queue, export/import. |
| `app.jsx` | UI | All React UI. Uses only `window.DW` and `window.DW_CASES` public APIs below. |
| `api/claude.js` | infra | Hardened proxy. |
| `sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png` | infra | PWA. |
| `README.md` | infra | Updated. |
| `test/` | infra | Playwright smoke test + a fake API (route stub) that returns schema-valid case/turn/grade JSON so the full loop runs offline. |

Plain-JS files must parse in Safari 15+ (no `??=`, no top-level await, no modules).

## Facility profile (cases.js `FACILITY`, editable placeholders — Derek will correct)
```js
FACILITY = {
  name: "Critical access hospital",
  beds: 25, icu: false, surgery: false, cathLab: false, neurosurgery: false, ir: false,
  ctHours: [7, 19],            // CT staffed 07:00–19:00; outside: CT unavailable unless "ctOnCall" roll
  timesMin: {                  // simulated minutes each order costs (PLACEHOLDERS)
    history: 2, exam: 2, bedside: 5 /*ECG, POCUS, FAST*/, labsPoc: 15 /*VBG, glucose, troponin iStat*/,
    labsSend: 45 /*CBC, BMP, LFT, lipase, coags, UA, cultures*/, xray: 20, ct: 35,
    procedure: 10, stabilize: 5, bloodBank: 20, callReceiving: 15,
    groundTransfer: 70, flightTransfer: 35
  },
  obNegUnitsDefault: 2
};
```

## Conditions roll (per case, in code)
`rollConditions(rng)` → `{hour (0–23, weighted ~40% night 19–07), ctAvailable (bool, from hour; night 25% "on call" true), flight: "available"|"weather"|"in use" (≈ 65/20/15), groundEta (min, 60–90), obNegUnits (0–4), tertiaryDiversion (≈10%), nurseCount (1–2)}`. These are shown on the doorway screen (small strip: "02:40 · CT down · Flight weathered out · 2 units O-neg") and passed to the case writer and the grader.

## Case catalog (cases.js `CATALOG`)
Array of entries `{id, dx, domain, bucket: "benign"|"serious", ages: ["infant","child","adolescent","adult","elderly","nh"], sex?: "M"|"F", presentations: ["typical","atypical","mimic of X"...], cantMiss: bool, lookalikes: [ids]}`.
- Port every diagnosis listed in v2's `buildMenu` (benign and serious) into entries.
- Add: acute ischemic stroke with telestroke tenecteplase decision; behavioural health crisis boarding with no psych bed; hyperkalemia (dialysis patient, missed session); adult DKA; COPD exacerbation needing BiPAP; acute CHF/SCAPE needing BiPAP + nitro; anticoagulated GI bleed needing reversal (warfarin/DOAC); patient with capacity refusing transfer (any serious dx); accepting facility declines / on diversion (EMTALA call; implemented as a condition + a flag on a serious case, `transferTwist: "declined"`).
- Domains (exact strings, used for stats): `Resuscitation, Airway, Vascular access, Trauma, Pediatrics, OB, Cardiac, Ventilation, POCUS, Transfer, Neuro, Tox/Environmental, Medical, Minor care`.

## Selection (cases.js `pickCase(stats, opts)`)
- `opts.mode`: `"shift"` (75% benign / 25% serious) or `"drill"` (30/70).
- Order of precedence: (1) a due miss-queue item → re-exposure of that dx with a *different* presentation and age band than the one missed; (2) bucket roll; (3) within bucket, weight each entry by its domain: `w = clamp(1 + (70 − domainAvg)/50, 0.5, 2.5)` (domains with <3 cases use avg 60); exclude dx seen in last 10 cases; (4) interleave: 30% chance, if the last case was serious, pick one of its `lookalikes`.
- Demographics rolled in code: age band per v2 mix (adjusted to what the entry allows), ethnicity per v2 mix, Fitzpatrick per v2 mapping (Black ≥5), sex.
- Seeded RNG: mulberry32, seed = Date.now() unless `opts.seed` given (tests use a fixed seed).
- Returns `seed` object: `{caseId, dxId, dx, domain, bucket, presentation, ageBand, age, sex, ethnicity, fitz, conditions, reexposure: null | {originalCaseId, originalPresentation}, transferTwist: null|"declined"|"refuses"}`.

## Generated case schema (Sonnet writes it from the seed; engine validates + fills defaults)
```json
{
  "persona": {"name":"","age":0,"sex":"M|F","ethnicity":"","occupation":"","chiefComplaint":"",
    "arrivalMode":"walk-in|EMS|private vehicle|wheelchair","emsHandoff":null,
    "doorwayImpression":"2 vivid sentences of what you see and sense from the doorway",
    "voice":"how they talk: affect, vocabulary, reliability",
    "facts":"everything the patient knows and will say if asked: HPI, PMH, meds, allergies, social, family, OB"},
  "physicality": { ...exact v2 physicality keys... },
  "vitals0": {"HR":0,"SBP":0,"DBP":0,"RR":0,"SpO2":0,"Temp":98.6,"GCS":15},
  "trajectory": [{"t":0,"HR":..},{"t":15,..},{"t":30,..},{"t":60,..},{"t":120,..}],
  "interventions": [{"id":"fluids","label":"30 mL/kg crystalloid","match":["fluid","bolus","lr","saline","ns","iv access + fluids"],
                     "effect":{"SBP":12,"HR":-10},"onsetMin":10,"critical":true,"windowMin":30}],
  "results": {"<every Exam/Labs/Imaging chip label>": "result text with units", "...": "..."},
  "history": {"<every History chip label>": "patient's answer in voice"},
  "answerKey": {"trueDx":"","trueAcuity":1,"trueDispo":"Discharge|Discharge w/ f/u|Admit inpatient|Transfer|Emergent transfer",
    "cantMiss":[""],"criticalActions":[{"id":"","action":"","windowMin":0}],
    "idealSequence":[{"atMin":0,"action":""}],"transferPackaging":null,
    "teachingPoint":"","ruralTwist":""}
}
```
- `trajectory` = vitals if nothing is done. Benign cases: flat.
- Vitals at sim minute m = linear interpolation of trajectory at m, plus for each applied intervention: `effect × min(1, (m − appliedAt)/onsetMin)`; clamp to physiologic ranges (SpO2 ≤100, GCS 3–15, etc.).
- `interventions` cover both stabilisation and harmful/neutral options the case cares about (e.g. intubating without resuscitating first: `effect: {SBP:-25}`).
- `criticalActions[].id` should match an `interventions[].id` where one exists.
- Generation prompt: `CASE_SYSTEM` (static: Derek's framework from v2 DEREK_FRAMEWORK, facility profile, schema, rules) + user message with the seed JSON. Ask for JSON only. Max tokens ~6000. Engine validates required keys; on failure retry once; on second failure throw with a readable message.

## Engine public API (`window.DW`)
```
DW.MODEL, DW.CHIPS (same groups as v2 + "Transfer": ["Call receiving facility","Request flight","Request ground ALS","Send records/imaging","Talk to family"]), DW.DISPOS (v2 list)
DW.newCase({mode}) -> Promise<Case>      // pickCase + generate; Case = generated JSON + {seed, startedAt}
DW.prefetch({mode}) / DW.takePrefetched() // keeps one ready case in localStorage "dw_next" (survives reload)
DW.startEncounter(case) -> Encounter     // {case, simMin:0, applied:[{id,atMin}], log:[], vitalsHistory:[{t,vitals}], gut:null, startedAt}
DW.vitalsAt(enc, min) -> vitals
DW.lockGut(enc, {sick:bool, acuity:1-5, gutDispo}) -> enc   // timestamped; required before act()
DW.act(enc, text, {chip?: {group,label}}) -> Promise<{enc, entries:[{k:"doc"|"patient"|"clinical"|"obs"|"event"|"time", t, mono?, atMin}], events:[{kind:"deteriorating", vital, from, to}]}>
   - chip with a known result (History/Exam/Labs/Imaging) → served locally, no model call, clock += cost by group/label
   - chip or free text matching an intervention.match (case-insensitive substring) → applied locally, plus a model call only if free text also asks things that are not covered
   - otherwise → one Sonnet call with persona, facts, results sheet (NOT answerKey), current vitals, full log, applied interventions list; model returns {"responses":[{"kind":"patient|clinical","text":"","mono":false,"obs":null}],"interventionsApplied":["id"],"timeCostMin":n}
   - clock advances by summed cost; vitals recomputed; event raised when a vital newly crosses: SBP<90, MAP<65, SpO2<90, HR>130 or <45, RR>30, GCS drop ≥2
   - the log entry for every turn carries atMin and the vitals snapshot
DW.saveActive(enc) / DW.loadActive() / DW.clearActive()   // "dw_active", saved after every act and lockGut
DW.grade(enc, {ddx:[s1,s2,s3], confidence:0-100, finalDispo, transferChecklist:{airway,access,blood,pressors,sedation,receivingCall} }) -> Promise<Grade>
   Grade = {"score":0-100,"caughtInDdx":bool,"rankOfTrueDx":1|2|3|null,"gestaltCal":"spot-on|close|over|under","workup":"lean|appropriate|shotgun|insufficient",
            "dispoOk":bool,"stabilizationGrade":"excellent|adequate|inadequate|critical-error","transferPackagingOk":bool|null,
            "criticalActions":[{"id":"","action":"","status":"done|late|missed","atMin":null,"windowMin":0,"quote":"his exact words or null"}],
            "divergences":[{"atMin":0,"did":"","shouldHave":""}],"wins":[""],"misses":[""],"carryForward":"one rule, ≤20 words","teachingPoint":"","criticalError":null|""}
   - grader gets answerKey, conditions, full transcript with atMin and vitals, locked gut, final answers
   - engine enforces: if criticalError or stabilizationGrade==="critical-error" → score = min(score, 40)
DW.recordResult(enc, grade, extras) -> stats   // history entry below; updates miss queue; clears active
DW.flagGrade(caseId, note)
DW.stats() -> {cases, history[], streak, last, byDomain:{[domain]:{n,avg}}, acuityGrid:5x5 counts (row=his gut acuity, col=true), gutVsFinal:{rr,rw,wr,ww}, missQueue[]}
DW.exportData() -> JSON string (all dw_* keys) ; DW.importData(json) -> {ok, count}
DW.settings get/set: {apiKey, mode:"shift"|"drill", timePressure:bool}
```
History entry (cap 500): `{caseId, date, dx, domain, bucket, presentation, reexposureOf, gutSick, gutAcuity, trueAcuity, gutDispo, finalDispo, trueDispo, ddx, confidence, caught, rankOfTrueDx, score, critMissed:[ids], critLate:[ids], firstCritMin, reflection, flagged, flagNote}`.
Miss queue: when `caught===false` or any critical action missed → push `{dxId, dx, domain, originalCaseId, presentation, ageBand, due:[+3d,+14d,+42d], stage:0}`; a re-exposure that passes (caught and no crit missed) advances stage; fail resets to stage 0; done after stage 3.
API client: POST `/api/claude` with header `X-DW-Kind: case|turn|grade` and `X-User-API-Key` if set; body `{model, max_tokens, system, messages}`. 60 s AbortController timeout, one retry on 429/5xx/529/network with 1.5 s backoff (not on 429 "daily limit"). Robust JSON extraction (port v2 `extractJSON`). Errors surface as `Error` with a user-readable message.

## Proxy (`api/claude.js`)
- POST only. Allowlist model `claude-sonnet-5-5`; reject others (400).
- Rebuild body: `{model, max_tokens: min(req, 8000), system, messages}` only.
- Rate limit: only `X-DW-Kind: case` counts; 12 cases / IP / 24 h (in-memory, documented as best effort); BYOK bypasses.
- Comment in README: put the server key in its own Anthropic Console workspace with a monthly spend limit.

## UI flow (app.jsx)
Views: `landing` (v2 Landing, first run only; reachable from Settings → "About") → `home` → `doorway` → `workup` → `commit` (sheet) → `debrief` → `home`/next.
1. **Home**: Resume banner if `DW.loadActive()`; big "Next patient" (uses prefetched case if ready, shows "ready" dot); mode toggle Shift/Drill; weak-spots strip (3 lowest-avg domains with ≥3 cases, else "not enough cases yet"); acuity grid 5×5 (his call vs true, diagonal highlighted) with mean absolute error; gut-vs-final 2×2 counts; miss queue count ("2 patterns due"); recent cases list (tap → read-only debrief); Settings (API key, export, import, time pressure, About).
2. **Doorway**: conditions strip; large patient figure; name/age/sex; chief complaint; arrival + EMS handoff; vitals tiles; impression. Below: Sick / Not sick (two big buttons), acuity 1–5 (no default selection), gut dispo (Discharge / Admit / Transfer). "Lock and start" enabled only when all three set. If time pressure on: 20 s countdown ring.
3. **Workup**: sticky header: sim clock `T+38 min`, conditions mini, vitals tiles each with previous value + ↑/↓ arrow, red when abnormal; tap tile → small trend sparkline sheet. Middle: log (v2 bubble styles + `event` style red banner + `time` style faint "+35 min — CT"). Bottom pinned: chip groups (44px chips, horizontally scrollable group tabs incl. Stabilize and Transfer), multi-select into a tray, "Send N"; text field; mic (transcript lands in field, not auto-sent); "Commit" button. Locked gut badge in header. Busy state disables send. Errors show inline with Retry.
4. **Event interrupt**: when `events` non-empty, red banner over log "BP 84/50 — falling" and tile flashes once (no flash under reduced motion).
5. **Commit sheet**: DDx #1–#3 (datalist autocomplete from catalog dx names), confidence slider for #1 (0–100), final dispo (DW.DISPOS), if Transfer/Emergent transfer → transfer checklist toggles. Submit.
6. **Debrief**: top: you-vs-true pairs (acuity, sick, dispo, dx with rank). Then timeline: his orders at their atMin, with missed critical actions inserted (red) at their windowMin and late ones marked "+12 min late"; divergences inline. "Carry forward" card (grader's rule). Reflection box shown when caught===false or crit missed: "What supported your diagnosis, what argued against it, what else explains it?" (optional, saved). Wins/misses collapsed. Score last, small. "Flag this grade" link → note → DW.flagGrade. Buttons: Next patient / Home. Not medical advice disclaimer line at bottom.
7. Loading: during case gen show conditions + "Patient arriving…" with a slow pulse (static under reduced motion); never a bare spinner line. Prefetch next case when the debrief opens.

## Look
Keep v2's editorial-clinical look: near-black, bone text, Instrument Serif display, Source Serif body, JetBrains Mono for numbers/labels. Motion restrained. Reuse v2 avatar/figure component as-is (move into app.jsx).

---
# AMENDMENTS (from spec review — these OVERRIDE anything above that conflicts)

A1. **Two-call generation.** Call A (`X-DW-Kind: case`, max_tokens 4000) returns everything except `results`. Call B (`X-DW-Kind: results`, max_tokens 4000, not rate-limited) receives seed + Call A output and returns `{"results":{...}}` only, each value ≤30 words. Timeouts: 120 s for case/results calls, 60 s for turn/grade. Add `vercel.json` with `{"functions":{"api/claude.js":{"maxDuration":120}}}`. Lab/imaging results reflect time 0; CASE_SYSTEM says so. A repeat of an already-resulted lab/imaging chip goes to the model (so it can return a time-appropriate repeat value), not to the local sheet.

A2. **Intervention matching.** Each intervention has `chips:[exact chip labels]` (replaces `match`). A chip applies an intervention only on exact label match. Free text never applies anything locally: it always goes to the model, and the engine applies only `interventionsApplied` ids that exist in `interventions`. `maxApplications` default 1; re-applying logs "already done" with no time cost.

A3. **act() contract.** `DW.act(enc, {text?, chips?:[{group,label}]}) -> Promise<{enc, entries, events}>`. Each chip handled locally if possible; everything without a local result (missing results key, Procedures chip with no matching intervention, Transfer chips, repeat labs) plus the text goes into ONE model call. Never mutates `enc`; returns a new object. `lockGut` is sync and returns a new enc. `vitalsAt` is sync. `act` and `lockGut` call `saveActive` themselves; app.jsx never calls `saveActive`.

A4. **Clock.** Clock advances by the MAX cost in a batch, not the sum. Transfer requests ("Request flight", "Request ground ALS") do not move the clock; they set `enc.transport = {mode, etaMin: simMin + ETA, status}` using conditions (flight "weather"/"in use" → event "Flight declined: weather", no ETA). Header shows a countdown. "Call receiving facility" costs callReceiving; if `tertiaryDiversion` or seed.transferTwist==="declined", the first call returns an event "Accepting facility declined — on diversion" and he must call again (second call accepted, +15 min).

A5. **Effect model.** Intervention `mode: "delta"|"arrest"`. `arrest` freezes the trajectory at `appliedAt` (vitals stop worsening) and then applies `effect`. Optional `durationMin` makes a delta fade linearly to 0 after onset+duration (bolus in ongoing hemorrhage, push-dose pressor).

A6. **Age-based normals.** Thresholds and abnormal tile colour come from `DW.NORMALS[ageBand]` (PALS-style for infant/child/adolescent; adult values for adult/elderly/nh). Events fire on newly crossing those limits, plus GCS drop ≥2.

A7. **Critical-action timing computed in code.** Engine computes `status`/`atMin` for every critical action whose id matches an applied intervention (done if applied by windowMin, late if after, missed if never). Grader judges only critical actions with no matching intervention and may not override computed ones; engine merges them into Grade.criticalActions.

A8. **Stabilize chips** append: "Broad-spectrum antibiotics", "BiPAP", "Nitroglycerin", "Calcium", "Insulin infusion", "Bicarbonate", "Albuterol neb", "D50/glucose", "Naloxone", "Reversal (PCC/vit K)", "Sedation/analgesia". Transfer group: "Call receiving facility", "Request flight", "Request ground ALS", "Send records/imaging", "Talk to family". (Move "Call receiving facility"/"Prep for transfer" out of Stabilize.)

A9. **Prefetch race.** `prefetch` stores and returns its in-flight promise; `newCase` awaits it if present. App calls `recordResult` before `prefetch`.

A10. **CT down.** If `!ctAvailable`: on-call (night default ~75%) → CT chip returns event "CT tech called back — ~45 min" and the result arrives with clock +45+ct; not on call → event "CT unavailable" with no result. Stroke/trauma case writer is told CT status.

A11. **Safari storage.** Home shows a one-time "Add to Home Screen and export your data" tip. If a setItem throws (quota), delete `dw_next` and retry once.

A12. **Load safety.** app.jsx sets `window.__dwMounted = true` on mount; index.html shows the fallback message if not set within 10 s. Service worker: network-first for `*.html`, `*.js`, `*.jsx`; cache-first for fonts/CDN.

A13. **Time pressure end.** At 0 the doorway locks whatever is selected (unselected acuity → null) and records `gutTimedOut:true`.

A14. Model ID `claude-sonnet-5-5` is verified against Anthropic's models overview (30 Oct 2026).
