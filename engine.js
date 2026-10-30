/* The Doorway v3 — engine. Plain JS (Safari 15 safe), defines window.DW.
 * API client, prompts, sim clock + vitals model, local result serving, grading,
 * storage, miss queue, export/import. Requires cases.js (window.DW_CASES) first.
 * Loads in Node with a tiny shim (window = globalThis, localStorage, fetch).
 */
(function (root) {
  "use strict";

  var CASES = root.DW_CASES;
  if (!CASES) throw new Error("cases.js must load before engine.js");
  var FACILITY = CASES.FACILITY;
  var T = FACILITY.timesMin;

  var MODEL = "claude-sonnet-5-5";
  var FALLBACK = "Not performed/not available";
  var VITAL_KEYS = ["HR", "SBP", "DBP", "RR", "SpO2", "Temp", "GCS"];
  var CONFIG = {
    backoffMs: 1500,
    timeouts: { "case": 120000, results: 120000, review: 120000, turn: 60000, grade: 90000 },
    endpoint: "/api/claude",
    // Per call kind. The proxy allows claude-sonnet-5-5 and claude-opus-5-5 and caps max_tokens by kind.
    models: { "case": MODEL, results: MODEL, review: MODEL, turn: MODEL, grade: MODEL },
    // How hard the model thinks before answering. Thinking tokens count against max_tokens.
    effort: { "case": "high", results: "medium", review: "high", turn: "medium", grade: "high" },
    maxTokens: { "case": 16000, results: 16000, review: 8000, turn: 6000, grade: 8000 },
    structured: false, // send a JSON schema with each call (output_config.format)
    cache: true,       // mark the static system blocks for prompt caching
    review: false,     // clinical review of each generated case by a second call, regenerate once on a blocking issue
    onCall: null       // function(info) called after every API exchange; used by the live harness
  };

  // ── Chips / dispositions ──────────────────────────────────────────────────
  var CHIPS = {
    History: ["When did this start?", "Describe the pain", "Associated symptoms?", "PMH/PSH?", "Medications?", "Allergies?", "Social history?", "Family history?", "Obstetric history?"],
    Exam: ["General appearance", "Auscultate lungs", "Auscultate heart", "Palpate abdomen", "Extremities", "Neuro exam", "HEENT", "Skin exam", "Pelvic exam", "Rectal exam"],
    Labs: ["CBC+BMP", "Troponin", "Lactate", "D-dimer", "VBG/ABG", "Coags/INR", "UA", "Blood cultures", "LFTs", "Lipase", "Tox screen", "Beta-HCG", "Type & screen"],
    Imaging: ["ECG", "CXR", "CT head", "CT chest/PE", "CT abd/pelvis", "Bedside FAST", "POCUS cardiac", "POCUS lung", "CT angio", "X-ray extremity"],
    Procedures: ["RSI/intubate", "Chest tube", "Needle decompression", "IO access", "CVAD/central line", "Arterial line", "Foley", "LP", "Cricothyrotomy", "Pericardiocentesis", "I&D", "Pelvic binder", "Splint/reduction"],
    Stabilize: ["IV access + fluids", "IV access only", "Blood transfusion", "Activate MTP", "TXA now", "Start pressors", "Norepinephrine", "Epinephrine", "Aspirin 324mg", "TPA/lytics", "Cardioversion", "Transcutaneous pacing", "Magnesium sulfate",
      "Broad-spectrum antibiotics", "BiPAP", "Nitroglycerin", "Calcium", "Insulin infusion", "Bicarbonate", "Albuterol neb", "D50/glucose", "Naloxone", "Reversal (PCC/vit K)", "Sedation/analgesia",
      "Adenosine", "Benzodiazepine", "Oxytocin", "Hypertonic saline"],
    Transfer: ["Call receiving facility", "Request flight", "Request ground ALS", "Send records/imaging", "Talk to family"],
    Time: ["Recheck vitals", "Observe 15 min", "Observe 30 min"]
  };
  var DISPOS = ["Discharge", "Discharge w/ f/u", "Admit inpatient", "Transfer", "Emergent transfer"];
  var GESTALT = ["spot-on", "close", "over", "under"];
  var WORKUP = ["lean", "appropriate", "shotgun", "insufficient"];
  var STAB = ["excellent", "adequate", "inadequate", "critical-error"];
  var RESULT_GROUPS = ["Exam", "Labs", "Imaging"];
  var ACTION_LABELS = CHIPS.Procedures.concat(CHIPS.Stabilize, CHIPS.Transfer);
  var LAB_POC = { "Troponin": 1, "Lactate": 1, "VBG/ABG": 1, "Beta-HCG": 1 };
  var BEDSIDE = { "ECG": 1, "Bedside FAST": 1, "POCUS cardiac": 1, "POCUS lung": 1 };

  // ── Age-based normals (A6) ────────────────────────────────────────────────
  // range: tile is "abnormal" outside [lo, hi]. alarm: event thresholds (newly crossed → event).
  var ADULT_N = {
    range: { HR: [60, 100], RR: [12, 20], SBP: [90, 180], SpO2: [94, 100], Temp: [96.8, 100.4], GCS: [15, 15] },
    alarm: { HRhi: 130, HRlo: 45, RRhi: 30, RRlo: 8, SBPlo: 90, MAPlo: 65, SpO2lo: 90 }
  };
  var NORMALS = {
    // PALS 2020 awake ranges (infant 1–12 mo: HR 100–180, RR 30–53, SBP 72–104; hypotension <70).
    // Child band spans 1–12 y, so ranges are a compromise; hypotension is <70 + 2×age (72 at 1 y, 90 at 10 y).
    infant: { range: { HR: [100, 180], RR: [30, 53], SBP: [72, 104], SpO2: [94, 100], Temp: [97, 100.4], GCS: [15, 15] },
      alarm: { HRhi: 200, HRlo: 90, RRhi: 70, RRlo: 20, SBPlo: 70, MAPlo: null, SpO2lo: 90 } },
    child: { range: { HR: [70, 140], RR: [18, 40], SBP: [80, 120], SpO2: [94, 100], Temp: [97, 100.4], GCS: [15, 15] },
      alarm: { HRhi: 170, HRlo: 60, RRhi: 50, RRlo: 12, SBPlo: 80, MAPlo: null, SpO2lo: 90 } },
    adolescent: { range: { HR: [60, 100], RR: [12, 20], SBP: [95, 140], SpO2: [94, 100], Temp: [97, 100.4], GCS: [15, 15] },
      alarm: { HRhi: 140, HRlo: 50, RRhi: 30, RRlo: 10, SBPlo: 90, MAPlo: 65, SpO2lo: 90 } },
    adult: ADULT_N,
    elderly: ADULT_N,
    nh: ADULT_N
  };
  function normalsFor(band) { return NORMALS[band] || ADULT_N; }

  // ── Small utils ───────────────────────────────────────────────────────────
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (has(s, k)) target[k] = s[k];
    }
    return target;
  }
  function num(v, d) {
    if (typeof v === "number" && isFinite(v)) return v;
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  }
  function str(v, d) { return typeof v === "string" && v.trim() ? v.trim() : d; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function slug(s) { return String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "x"; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function now() { return Date.now(); }
  var DAY = 86400000;

  // ── Storage (every access guarded; A11 quota fallback) ────────────────────
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function lsGet(k) { try { var s = ls(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function lsRemove(k) { try { var s = ls(); if (s) s.removeItem(k); } catch (e) { /* ignore */ } }
  function lsSet(k, v) {
    var s = ls();
    if (!s) return false;
    try { s.setItem(k, v); return true; } catch (e) {
      if (k === "dw_next") return false;
      try { s.removeItem("dw_next"); s.setItem(k, v); return true; } catch (e2) { /* fall through */ }
      // Still full: give up the oldest stored full results (dw_results) before failing a write that matters more.
      if (k === "dw_results") return false;
      var list = null;
      try { list = JSON.parse(s.getItem("dw_results") || "[]"); } catch (e3) { list = []; }
      while (Array.isArray(list) && list.length) {
        list = list.slice(Math.ceil(list.length / 2));
        try { if (list.length) s.setItem("dw_results", JSON.stringify(list)); else s.removeItem("dw_results"); } catch (e4) { /* keep trimming */ }
        try { s.setItem(k, v); return true; } catch (e5) { /* keep trimming */ }
      }
      return false;
    }
  }
  function lsJSON(k, d) { var raw = lsGet(k); if (!raw) return d; try { return JSON.parse(raw); } catch (e) { return d; } }
  function lsKeys() {
    var out = [], s = ls();
    if (!s) return out;
    try { for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k) out.push(k); } } catch (e) { /* ignore */ }
    return out;
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  var SETTINGS_DEFAULT = { apiKey: "", mode: "shift", timePressure: false };
  var settings = {
    get: function () {
      var s = lsJSON("dw_settings", null);
      if (!s) {
        s = {};
        var legacy = lsGet("doorway_api_key"); // v2 migration
        if (legacy) s.apiKey = legacy;
      }
      var out = assign({}, SETTINGS_DEFAULT, s);
      out.mode = out.mode === "drill" ? "drill" : "shift";
      out.timePressure = !!out.timePressure;
      out.apiKey = typeof out.apiKey === "string" ? out.apiKey.trim() : "";
      return out;
    },
    set: function (patch) {
      var next = assign(settings.get(), patch || {});
      lsSet("dw_settings", JSON.stringify(next));
      return settings.get();
    }
  };

  // ── JSON extraction (ported from v2, hardened) ────────────────────────────
  function extractJSON(raw) {
    if (!raw) throw new Error("Empty response");
    var s = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
    var first = s.indexOf("{");
    if (first === -1) throw new Error("No JSON in response");
    var depth = 0, end = -1, inStr = false, esc = false;
    for (var i = first; i < s.length; i++) {
      var ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error("Unbalanced JSON (response cut off?)");
    var c = s.slice(first, end + 1);
    try { return JSON.parse(c); } catch (e) { return JSON.parse(c.replace(/,(\s*[}\]])/g, "$1")); }
  }

  // ── API client ────────────────────────────────────────────────────────────
  function apiError(msg, extra) { var e = new Error(msg); if (extra) assign(e, extra); return e; }
  function readBody(r) {
    if (r && typeof r.text === "function") {
      return r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return { _raw: t }; } });
    }
    if (r && typeof r.json === "function") return r.json().catch(function () { return null; });
    return Promise.resolve(null);
  }
  function statusMessage(status, body) {
    var m = body && body.error && (typeof body.error === "string" ? body.error : body.error.message);
    if (m) return m; // proxy already wrote a readable message — pass it through verbatim
    if (status === 401) return "The API key was rejected. Check the key in Settings.";
    if (status === 413) return "The request was too large.";
    if (status === 429) return "The model is rate-limited right now. Wait a minute and try again.";
    if (status === 529) return "The model is overloaded right now. Try again in a moment.";
    if (status >= 500) return "The model service had an error (" + status + "). Try again.";
    return "Request failed (" + status + ").";
  }
  function isDailyLimit(status, body) {
    if (status !== 429 || !body) return false;
    if (body.code === "daily_limit") return true;
    var m = typeof body.error === "string" ? body.error : "";
    return /daily/i.test(m);
  }

  // System prompt as content blocks. The last block carries the cache marker, so the whole
  // prefix (static prompt, plus a per-case block for turns) is reused by later calls that share it.
  function sysBlocks(parts) {
    var blocks = parts.filter(Boolean).map(function (t) { return { type: "text", text: t }; });
    if (CONFIG.cache && blocks.length) blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
    return blocks;
  }

  // One HTTP exchange, with a single retry on 429 (not daily limit) / 5xx / 529 / network.
  // schema (optional) is sent as output_config.format when CONFIG.structured is on.
  function callClaude(kind, system, userContent, maxTokens, schema) {
    var fetchFn = root.fetch;
    if (typeof fetchFn !== "function") return Promise.reject(apiError("No network available in this browser."));
    var key = settings.get().apiKey;
    var headers = { "Content-Type": "application/json", "X-DW-Kind": kind };
    if (key) headers["X-User-API-Key"] = key;
    var model = CONFIG.models[kind] || MODEL;
    var payload = { model: model, max_tokens: maxTokens, system: system, messages: [{ role: "user", content: userContent }] };
    var oc = {};
    if (CONFIG.effort[kind]) oc.effort = CONFIG.effort[kind];
    if (schema && CONFIG.structured) oc.format = { type: "json_schema", schema: schema };
    if (oc.effort || oc.format) payload.output_config = oc;
    var body = JSON.stringify(payload);
    var timeoutMs = CONFIG.timeouts[kind] || 60000;

    function report(info) {
      if (typeof CONFIG.onCall !== "function") return;
      try { CONFIG.onCall(assign({ kind: kind, model: model, request: payload }, info)); } catch (e) { /* logging must never break a call */ }
    }

    function once(attempt) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = null, timedOut = false, t0 = now();
      if (ctrl) timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
      var opts = { method: "POST", headers: headers, body: body };
      if (ctrl) opts.signal = ctrl.signal;
      return Promise.resolve()
        .then(function () { return fetchFn.call(root, CONFIG.endpoint, opts); })
        .then(function (r) {
          return readBody(r).then(function (data) {
            if (timer) clearTimeout(timer);
            var ms = now() - t0;
            if (!r.ok) {
              var st = r.status || 0;
              report({ attempt: attempt, ms: ms, status: st, response: data, error: statusMessage(st, data) });
              throw apiError(statusMessage(st, data), {
                status: st,
                retryable: (st === 429 && !isDailyLimit(st, data)) || st >= 500,
                dailyLimit: isDailyLimit(st, data)
              });
            }
            report({ attempt: attempt, ms: ms, status: r.status || 200, response: data, usage: data && data.usage, stop_reason: data && data.stop_reason });
            var text = (data && Array.isArray(data.content) ? data.content : [])
              .filter(function (c) { return c && c.type === "text"; })
              .map(function (c) { return c.text; }).join("\n");
            if (!text && data && data._raw) text = data._raw;
            if (data && data.stop_reason === "refusal") {
              var cat = data.stop_details && data.stop_details.category;
              throw apiError("The model declined to write this " + kind + (cat ? " (" + cat + ")" : "") + ". Try another patient.", { refusal: true, category: cat || null, retryable: false });
            }
            if (data && data.stop_reason === "max_tokens") {
              throw apiError("The model ran out of room before finishing its " + kind + " (" + maxTokens + " tokens).", { truncated: true, badJson: true });
            }
            return text;
          });
        }, function (err) {
          if (timer) clearTimeout(timer);
          var ms = now() - t0;
          if (timedOut) {
            report({ attempt: attempt, ms: ms, status: 0, error: "timeout" });
            throw apiError("The model took too long to answer (" + Math.round(timeoutMs / 1000) + " s). Try again.", { timeout: true, retryable: false });
          }
          report({ attempt: attempt, ms: ms, status: 0, error: "network" });
          throw apiError("Could not reach the server. Check your connection and try again.", { network: true, retryable: true, cause: err });
        });
    }
    return once(0).catch(function (e) {
      if (!e.retryable) throw e;
      return sleep(CONFIG.backoffMs).then(function () { return once(1); });
    });
  }

  // Calls the model, parses JSON, validates. Bad JSON / failed validation → one more full attempt.
  function callJSON(kind, system, userContent, maxTokens, validate, label, schema) {
    function attempt(n) {
      return callClaude(kind, system, userContent, maxTokens, schema).then(function (text) {
        var parsed;
        try { parsed = extractJSON(text); } catch (e) { throw apiError("The model's " + label + " was not readable JSON (" + String(text || "").slice(0, 80).replace(/\s+/g, " ") + "...).", { badJson: true }); }
        return validate ? validate(parsed) : parsed;
      }).catch(function (e) {
        var again = e && (e.badJson || e.invalid);
        if (again && n === 0) return attempt(1);
        if (again) throw apiError("Couldn't build a usable " + label + " after two tries (" + e.message + "). Try again.");
        throw e;
      });
    }
    return attempt(0);
  }

  // ── Prompts ───────────────────────────────────────────────────────────────
  var DEREK_FRAMEWORK = [
    "DEREK'S ROLE CONTEXT (critical for realistic case generation):",
    "Derek is a solo rural emergency physician at a critical access hospital. His job is NOT to be a subspecialist or definitive surgeon. His excellence lies in: recognition, stabilization, and safe transition of care.",
    "",
    "Core domains to drill:",
    "1. RESUSCITATION: shock differentiation (septic/cardiogenic/obstructive/hemorrhagic), code management, post-ROSC, initial vent management, pressors/sedation",
    "2. AIRWAY: RSI decisions (including hemodynamically unstable), failed airway, surgical airway need",
    "3. VASCULAR ACCESS: when to do IO, central line, ultrasound-guided IV",
    "4. TRAUMA STABILIZATION: massive transfusion, chest tube vs needle decompression, pelvic binder, TXA timing, TBI management, FAST exam",
    "5. PEDIATRICS: weight-based dosing decisions, pediatric airway, pediatric septic shock, NRP basics",
    "6. OB EMERGENCIES: unplanned delivery, shoulder dystocia, PPH, eclampsia, neonatal resuscitation",
    "7. CARDIAC: STEMI recognition + lytics decision (no cath lab), cardiogenic shock, unstable arrhythmia, temporary pacing",
    "8. VENT MANAGEMENT: initial settings, ARDS basics, adjusting for acidosis while awaiting transfer",
    "9. POCUS: when to do FAST, cardiac tamponade recognition, pneumothorax on US, AAA screening, bilateral lung exam",
    "10. TRANSFER MEDICINE: recognizing who needs transfer EARLY, stabilization before transport (airway secure? blood hanging? pressor stable? sedation adequate?), calling receiving facility efficiently",
    "",
    "The key grading question for serious cases: \"Did Derek recognize early, stabilize correctly, and package safely for transfer?\""
  ].join("\n");

  function facilityText() {
    return [
      "FACILITY: " + FACILITY.name + ", " + FACILITY.beds + " beds, solo physician, 1–2 nurses.",
      "No ICU, no general surgery, no cath lab, no neurosurgery, no interventional radiology. Non-ICU inpatient unit only.",
      "CT staffed " + FACILITY.ctHours[0] + ":00–" + FACILITY.ctHours[1] + ":00; at night a tech may be in house, on call (~45 min), or unavailable.",
      "POCUS available. Point-of-care labs (i-STAT VBG/lactate/troponin, glucose, urine hCG) ~" + T.labsPoc + " min; send-out-style labs ~" + T.labsSend + " min; X-ray ~" + T.xray + " min; CT ~" + T.ct + " min when available.",
      "Blood: a few units of O-negative on hand; no in-house massive transfusion beyond that without a blood bank run (~" + T.bloodBank + " min).",
      "Telestroke consult available by video. Tertiary center: ground ALS 60–90 min, helicopter ~" + T.flightTransfer + " min when flying (weather-dependent).",
      "Procedures expected of Derek: RSI, surgical airway, chest tube, needle decompression, IO, central line, cardioversion, transcutaneous pacing, pericardiocentesis, pelvic binder, damage-control resuscitation before transfer."
    ].join("\n");
  }

  function conditionsText(c, transferTwist) {
    if (!c) return "CONDITIONS: unknown";
    var hh = (c.hour < 10 ? "0" : "") + c.hour + ":" + ((c.minute || 0) < 10 ? "0" : "") + (c.minute || 0);
    var ct = c.ctAvailable ? "CT available now" : c.ctOnCall ? "CT not staffed — tech can be called back (~45 min delay)" : "CT UNAVAILABLE for this case";
    var fl = c.flight === "available" ? "helicopter available" : c.flight === "weather" ? "helicopter grounded by weather" : "helicopter already in use";
    var lines = [
      "CONDITIONS FOR THIS CASE (binding):",
      "- Time of arrival " + hh + (CASES.isNight(c.hour) ? " (night)" : " (day)"),
      "- " + ct,
      "- " + fl + "; ground ALS ETA " + c.groundEta + " min",
      "- O-negative units on hand: " + c.obNegUnits,
      "- Nurses on shift: " + c.nurseCount,
      "- Usual tertiary center " + (c.tertiaryDiversion ? "IS ON DIVERSION (first transfer call is declined; a second call to another center is accepted)" : "accepting")
    ];
    if (transferTwist === "refuses") lines.push("- TWIST: the patient has decision-making capacity and refuses transfer.");
    if (transferTwist === "declined") lines.push("- TWIST: the accepting facility declines the first call (diversion); Derek must find another accepting center under EMTALA.");
    return lines.join("\n");
  }

  function chipListText(groups) {
    return groups.map(function (g) { return g + ": " + CHIPS[g].map(function (l) { return JSON.stringify(l); }).join(", "); }).join("\n");
  }

  var CLINICAL_ACCURACY = [
    "CLINICAL ACCURACY (non-negotiable): use standard doses and current practice. Examples:",
    "- Tenecteplase for ischemic stroke 0.25 mg/kg IV bolus, max 25 mg (alteplase 0.9 mg/kg, max 90 mg); within 4.5 h of last known well; BP must be <185/110 before lytics.",
    "- STEMI without timely PCI (first medical contact-to-device >120 min): fibrinolysis within 30 min of arrival unless contraindicated, then transfer.",
    "- Septic shock: 30 mL/kg crystalloid for hypotension or lactate ≥4, cultures then broad-spectrum antibiotics within 1 h, norepinephrine for MAP <65 despite fluids.",
    "- Trauma hemorrhage: TXA 1 g IV over 10 min within 3 h of injury (then 1 g over 8 h); balanced blood products early; permissive hypotension except in TBI.",
    "- Hyperkalemia with ECG changes: IV calcium first (calcium gluconate 3 g or calcium chloride 1 g), then insulin + glucose, albuterol; dialysis is definitive.",
    "- Acute ischemic stroke: no IV thrombolytic without a non-contrast CT (or MRI) excluding hemorrhage. If CT is unavailable, or a call-back tech cannot get the scan done inside the window, lytics are off the table here: the correct move is early transfer to a stroke center (telestroke can help triage), not TNK on clinical grounds.",
    "- Anaphylaxis: IM epinephrine 0.01 mg/kg (max 0.5 mg adult, 0.3 mg child) anterolateral thigh, repeat every 5–15 min.",
    "- Eclampsia: magnesium sulfate 4–6 g IV load then 1–2 g/h; treat severe hypertension.",
    "- Pediatric fluids: 10–20 mL/kg boluses with reassessment.",
    "- Warfarin bleed: 4-factor PCC + IV vitamin K 10 mg; DOAC: specific reversal agent or 4-factor PCC.",
    "Any drug or dose not listed above: use standard dosing from current references (weight-based for children). If you are not sure of a specific number, describe the action generally rather than inventing a figure."
  ].join("\n");

  var EFFECT_GUIDE = [
    "INTERVENTION EFFECTS (approximate, conservative; most treatments improve vitals partially, few normalize them):",
    "- Crystalloid bolus (1 L adult, 10–20 mL/kg child) in hypovolemia or sepsis: SBP +5 to +15, HR −5 to −15, onset 5–15 min. In ongoing hemorrhage the gain fades (durationMin 20–40). In pulmonary edema or cardiogenic shock: SpO2 falls.",
    "- Blood in hemorrhage: roughly SBP +5 to +10 per unit, onset ~10 min, transient while bleeding is uncontrolled.",
    "- Norepinephrine/epinephrine infusion: SBP +15 to +30, onset 2–5 min, lasts while running. Push-dose pressor: onset ~1 min, durationMin 5–10.",
    "- RSI in a hypotensive or under-resuscitated patient: SBP −20 to −40 within 5 min (the harm the case should punish).",
    "- Naloxone IV: RR and GCS recover in 1–3 min; with long-acting opioids durationMin 30–90 (re-sedation).",
    "- Dextrose: GCS recovers within minutes; with sulfonylureas or long-acting insulin it wears off (durationMin 30–60).",
    "- BiPAP in CHF or COPD: SpO2 +4 to +10 and RR down over 10–30 min. High-dose nitroglycerin in SCAPE: SBP −30 to −60 within 5 min.",
    "- Albuterol, magnesium, steroids: modest, gradual improvement over 15–30 min.",
    "- Antibiotics, aspirin, TXA, seizure-prophylaxis magnesium, lytics for STEMI: little or no immediate vital change; their value shows in the grade, not the monitor.",
    "ARREST MODE: mode \"arrest\" freezes the untreated decline at the minute it is done, and its effect then lifts the vitals. Use it only for definitive fixes of the cause: needle decompression or chest tube for tension pneumothorax, pericardiocentesis for tamponade, synchronized cardioversion for unstable SVT/VT/AF with RVR, adenosine for stable SVT, transcutaneous pacing with capture for heart block, IM epinephrine for anaphylaxis. Calcium for hyperkalemic arrhythmia is \"delta\" with durationMin 30–60 (it buys time; potassium still has to come down). Effects are immediate to 2 min (e.g. decompression: SpO2 +8 to +15, SBP +20 to +40; cardioversion: HR to 80–110). Never use arrest for temporizing measures while the cause continues (fluids or blood in active bleeding, pressors in sepsis, intubation)."
  ].join("\n");

  var CASE_SCHEMA = [
    "{",
    '  "persona": {"name":"","age":0,"sex":"M|F","ethnicity":"","occupation":"","chiefComplaint":"",',
    '    "arrivalMode":"walk-in|EMS|private vehicle|wheelchair","emsHandoff":"the EMS report if they came by EMS, else \\"\\"",',
    '    "doorwayImpression":"2 vivid sentences of what you see and sense from the doorway",',
    '    "voice":"how they talk: affect, vocabulary, reliability (or who speaks for them)",',
    '    "facts":"everything the patient/caregiver knows and will say if asked: HPI, PMH, meds, allergies, social, family, OB"},',
    '  "physicality": {"fitz":1-6,"hair":"#hex","rrRate":n,"pallor":0-3,"diaphoresis":0-3,"cyanosis":0-3,"jaundice":0-3,"guarding":0-3,',
    '    "eyeState":"open|half|closed","positioning":"supine|tripod|fetal|sitting","distressLevel":0-4,"age":n,"habitus":"cachectic|average|obese","rashNote":"short description, or \\"\\" if none"},',
    '  "vitals0": {"HR":0,"SBP":0,"DBP":0,"RR":0,"SpO2":0,"Temp":98.6,"GCS":15},',
    '  "trajectory": [{"t":0,"HR":0,"SBP":0,"DBP":0,"RR":0,"SpO2":0,"Temp":0,"GCS":15},{"t":15},{"t":30},{"t":60},{"t":120}],',
    '  "interventions": [{"id":"fluids","label":"30 mL/kg crystalloid","chips":["IV access + fluids"],"mode":"delta",',
    '     "effect":{"SBP":12,"HR":-10},"onsetMin":10,"durationMin":0,"critical":true,"windowMin":30,"maxApplications":1,',
    '     "response":"one-line nurse/clinical note shown when he does it"}],',
    '  "history": {"<every History chip label>": "answer in the patient\'s (or caregiver\'s) voice"},',
    '  "answerKey": {"trueDx":"","trueAcuity":"integer 1-5, ESI: 1 = resuscitation (sickest), 2 = emergent, 3 = urgent, 4 = less urgent, 5 = non-urgent","trueDispo":"Discharge|Discharge w/ f/u|Admit inpatient|Transfer|Emergent transfer",',
    '    "cantMiss":[""],"criticalActions":[{"id":"","action":"","windowMin":0}],',
    '    "idealSequence":[{"atMin":0,"action":""}],"transferPackaging":"what must be done before the patient leaves, or \\"\\"","teachingPoint":"","ruralTwist":""}',
    "}"
  ].join("\n");

  var CASE_SYSTEM = [
    "You write one realistic patient case for The Doorway, a training simulator for a solo rural emergency physician (Derek) at a critical access hospital. Return ONLY one JSON object — no prose, no markdown. Begin with { and end with }.",
    "",
    DEREK_FRAMEWORK,
    "",
    facilityText(),
    "",
    "THE SEED IS BINDING. The user message gives a seed: diagnosis, presentation variant, age band, exact age (years; infants as decimals, e.g. 0.25 = 3 months, 0 = newborn), sex, ethnicity, Fitzpatrick type, conditions, and any transfer twist. Do not change the diagnosis, age, sex or ethnicity. Write the presentation variant faithfully: an atypical or mimic presentation must genuinely look like the thing it mimics from the doorway. If the variant names an age or sex that conflicts with the seed (e.g. \"teen\" for a 40-year-old, \"postpartum\" for a male), keep the seed and write the closest equivalent that preserves the teaching point.",
    "",
    "RULES",
    "- doorwayImpression: what an experienced eye sees and senses in two seconds. Never name or strongly hint the diagnosis.",
    "- persona.facts holds everything the patient or caregiver would truthfully say if asked, including things they minimize. Infants/young children: a parent speaks. Nursing-home patients: the transfer sheet and staff phone report fill gaps. The patient never names the diagnosis or uses clinical terms they would not know (no \"I think it\u2019s my appendix\", no \"crushing substernal pain radiating to the left arm\" from a farmer); only a diagnosis a clinician already gave them (known AAA, prior PE) may be named. Include realistic noise: an unrelated chronic problem or two, a med list with irrelevant items, a plausible red herring the patient believes, and pertinent negatives that are truly negative.",
    "- vitals0 are the arrival vitals (numbers only). trajectory is the UNTREATED course: points at t = 0, 15, 30, 60, 120 minutes, every vital at every point; t=0 equals vitals0. Benign cases: a flat trajectory with realistic, mostly normal vitals.",
    "- interventions: 3–8 entries covering the stabilizing actions this case cares about AND tempting harmful or neutral ones (e.g. intubating a hypotensive patient before resuscitation: effect {\"SBP\":-25}; aggressive fluids in pulmonary edema: SpO2 down). Each has chips: an array of EXACT chip labels from the lists below that apply it (may be empty if only free text would). effect values are changes in vital units. mode \"arrest\" only for definitive fixes per ARREST MODE below; \"delta\" otherwise. durationMin: minutes until the effect fades back to nothing (bolus during ongoing hemorrhage, push-dose pressor, naloxone); 0 when it does not wear off. onsetMin and effect sizes per INTERVENTION EFFECTS below. critical:true only for must-do actions, with a realistic windowMin from arrival.",
    "- answerKey.criticalActions: each id must equal an interventions[].id when one exists for that action. windowMin in minutes from arrival.",
    "- history: one entry for EVERY History chip label below, answered in voice. If a question does not apply (e.g. obstetric history in a male), answer the way a real patient would.",
    "- Lab and imaging results are NOT part of this response (a second call writes them). Any results later written reflect the patient at time 0 (arrival).",
    "- answerKey.trueDispo must be correct for THIS facility under THESE conditions. \"Admit inpatient\" only for a patient safe on a non-ICU floor with 1\u20132 nurses overnight: no ventilator, no titrated vasoactive or antiarrhythmic drip, no ongoing transfusion need, not BiPAP-dependent, not post-ROSC, no need for a surgeon or specialist within hours. Anyone else is \"Transfer\" or \"Emergent transfer\", and the transfer call belongs early in idealSequence, in parallel with stabilization. transferPackaging: what must be done before the patient leaves (airway, access, blood, pressors, sedation, records, receiving call), or \"\" when no transfer is expected.",
    "- Respect the conditions: if CT is unavailable, a stroke or trauma case must be workable with exam, POCUS, telestroke and transfer; the teaching point should address that. Stroke with CT unavailable: no thrombolytic; the answer key is BP and glucose management, telestroke consult, and immediate transfer to a stroke center. With CT on call (~45 min), the answer key weighs call-back against the 4.5 h window and starts the transfer in parallel. If the helicopter is unavailable, the ground ETA matters. If O-negative units are few, the case should reflect it.",
    "- Transfer twists: \"refuses\" → the patient has decision-making capacity and declines transfer; put it in facts and voice; the answer key expects a capacity assessment, informed-refusal discussion, involving family, and the best possible local care. \"declined\" → the first receiving facility is on diversion; the answer key expects calling another center promptly and documenting EMTALA-appropriate transfer.",
    "",
    CLINICAL_ACCURACY,
    "",
    EFFECT_GUIDE,
    "",
    "CHIP LABELS (interventions[].chips must use these exact strings):",
    chipListText(["Procedures", "Stabilize", "Transfer"]),
    "",
    "HISTORY CHIP LABELS (history keys, exact strings):",
    chipListText(["History"]),
    "",
    "OUTPUT SCHEMA (JSON only, no results field):",
    CASE_SCHEMA
  ].join("\n");

  var RESULTS_SYSTEM = [
    "You write the results sheet for one patient case in The Doorway, a rural emergency medicine simulator. Return ONLY JSON: {\"results\":{...}}. No prose, no markdown.",
    "",
    "- Write one entry for EVERY label below (exact keys). Each value ≤30 words.",
    "- Every result reflects the patient at TIME 0 (arrival), before any treatment.",
    "- Labs: realistic values with units, abnormal values consistent with the diagnosis, vitals and trajectory; normal or incidental findings for tests that are irrelevant to it.",
    "- Keep findings realistically noisy, not textbook: include true pertinent negatives, one or two incidental abnormalities common for the age and history (mild anemia, old granuloma, chronic RBBB, nonspecific T-wave changes, trace hematuria), and early-course false reassurance where real (troponin negative at hour 0, normal lactate in early sepsis, normal Hgb in acute hemorrhage, normal CT in early ischemic stroke or SAH beyond 6 h). Not every test tied to the diagnosis is abnormal.",
    "- Exam: objective third-person findings consistent with the vitals and physicality. Pelvic/rectal exam in a patient where it does not apply: a brief realistic finding or 'Deferred — not indicated'.",
    "- Imaging: a brief preliminary read as a rural ED would get it (teleradiology prelim for CT, his own read for POCUS/ECG). ECG: rate, rhythm, intervals, ST changes.",
    "- Beta-HCG in a male or a pre-menarchal child: 'Not indicated'.",
    "- Do not name the diagnosis outright unless a test truly would (e.g. a CT read). Exam and POCUS lines describe findings, not conclusions (\"absent lung sliding left\", not \"pneumothorax\").",
    "- Clinical accuracy: standard reference ranges and current practice; if unsure, stay general.",
    "",
    "LABELS:",
    chipListText(RESULT_GROUPS)
  ].join("\n");

  var TURN_SYSTEM = [
    "You run a live rural ER encounter in The Doorway. The physician (Derek) acts; you answer as the patient (or caregiver) and as the clinical world (nurse, monitor, lab, imaging). Return ONLY JSON.",
    "",
    "Voice rules:",
    "- HISTORY questions → kind \"patient\", in character per the persona voice. Answer only what is asked, from persona.facts. Show affect; minimize or exaggerate as the persona would. The patient never states the diagnosis, never uses textbook phrasing or clinical terms a layperson would not use, and does not volunteer the key finding unless asked the question that would elicit it.",
    "- EXAM, LABS, IMAGING, PROCEDURES, STABILIZATION, TRANSFER → kind \"clinical\", brief and objective. Labs/imaging: realistic values with units, mono:true.",
    "- A lab or imaging test already resulted earlier is a REPEAT: give a time-appropriate value for the current sim minute, consistent with current vitals and the interventions applied so far.",
    "- A first-time test with a value on the results sheet: use that value (it reflects time 0).",
    "- Procedures: realistic outcome and any complication that the current state makes likely (failed first pass, post-intubation hypotension, misplaced line). Success is not guaranteed.",
    "- If he asks a free-text question about fluid status, plans, or other things, answer it; do not perform an action he did not order.",
    "- If his words clearly order an intervention from the INTERVENTIONS list, put its id in interventionsApplied. Only ids from that list. Do not apply anything he did not order.",
    "- timeCostMin: realistic minutes the requested items take at this facility (history ~" + T.history + ", exam ~" + T.exam + ", bedside test ~" + T.bedside + ", point-of-care lab ~" + T.labsPoc + ", main lab panel ~" + T.labsSend + ", X-ray ~" + T.xray + ", CT ~" + T.ct + ", procedure ~" + T.procedure + ", phone call ~" + T.callReceiving + "). For several items, the longest one (they run in parallel).",
    "- obs: a short string when something visibly changes in the patient, else \"\". physicality: an object of avatar changes, e.g. {\"diaphoresis\":2,\"distressLevel\":3}, or {} when nothing changed.",
    "- Report only what is observable at the current sim minute. Never narrate what happens later (\"twenty minutes later there are crackles\"); the clock and the vitals model handle the future.",
    "- Never reveal or hint the diagnosis beyond what the findings themselves show. Never coach him: the nurse, the lab and the receiving physician state facts, ask the questions real colleagues ask, and relay the receiving center's requirements, but they do not explain pathophysiology, suggest a diagnosis, or recommend a treatment he has not asked about.",
    "- Maximum 6 responses.",
    "",
    "Return exactly:",
    "{\"responses\":[{\"kind\":\"patient|clinical\",\"text\":\"1-3 sentences\",\"mono\":false,\"obs\":\"\"}],\"interventionsApplied\":[],\"timeCostMin\":0,\"physicality\":{}}"
  ].join("\n");

  var GRADE_SYSTEM = [
    "You are a senior rural emergency medicine attending grading a solo physician (Derek) at a critical access hospital after a simulated case. Be fair, specific and blunt. Return ONLY JSON.",
    "",
    DEREK_FRAMEWORK,
    "",
    facilityText(),
    "",
    "GRADE ON:",
    "1. Recognition: was the true diagnosis (or a clinically equivalent one) in his differential, and at what rank?",
    "2. Stabilization: right critical actions, in time, in the right order (e.g. resuscitate before intubating the hypotensive patient).",
    "3. Transfer medicine: correct disposition for THIS facility under THESE conditions; packaging before transport (airway, access, blood, pressors, sedation, records, receiving call). Reward an early transfer call made in parallel with stabilization, as soon as the need is clear. Penalize holding the call to finish a workup the receiving center will repeat or that will not change the decision (e.g. waiting on a CT or a send-out lab for a patient who is leaving regardless).",
    "4. Workup efficiency: lean for benign cases, sufficient for sick ones. Don't CT the sprained ankle; don't under-work the crashing patient.",
    "5. Gestalt calibration: his locked doorway read (sick/not sick, acuity, gut dispo) vs truth. Acuity is ESI: 1 = resuscitation (sickest), 2 = emergent, 3 = urgent, 4 = less urgent, 5 = non-urgent; a LOWER number means sicker. \"over\" = he called it sicker than it was; \"under\" = less sick.",
    "",
    "SCORE ANCHORS:",
    "- 90–100: what a strong rural EM attending would do — early recognition, right stabilization in time, right dispo, lean workup.",
    "- 75–89: safe and correct, with minor delays or inefficiency.",
    "- 60–74: safe outcome but a notable gap (late critical action, transfer call delayed by avoidable workup, shotgun workup, wrong rank of the true dx).",
    "- 41–59: a meaningful miss without a critical error.",
    "- 0–40: ANY critical error. A critical error caps the score at 40 no matter what else went well.",
    "",
    "CRITICAL ERRORS: admitting an unstable/ICU-level patient to the non-ICU unit (intubated, on a titrated pressor or antiarrhythmic drip, BiPAP-dependent, post-ROSC, ongoing transfusion need, or needing a surgeon or specialist within hours); leaving a deteriorating airway unsecured for transport; missing a can't-miss diagnosis entirely; under-treating hemorrhagic or septic shock before transfer; discharging a serious condition; a harmful intervention that caused deterioration; giving lytics with a clear contraindication, including thrombolysis for stroke without CT excluding hemorrhage.",
    "",
    "CRITICAL ACTIONS: the engine has already timed every critical action that matches an intervention (COMPUTED list) — those are fixed; do not change or repeat them. Judge ONLY the actions in TO_JUDGE from the transcript: status done|late|missed, atMin when done (sim minute) else null, and quote his exact words that did it, or null.",
    "",
    "carryForward: one rule he should carry into the next shift, ≤20 words, specific to what happened here.",
    "HIS RULES: the user message may list rules he wrote for himself after earlier cases (newest first). If one of them bears on this case, put it in ruleApplied.text and set followed to true or false; otherwise text is \"\" and followed is null.",
    "",
    "Return exactly:",
    "{\"score\":0,\"caughtInDdx\":false,\"rankOfTrueDx\":null,\"gestaltCal\":\"spot-on|close|over|under\",\"workup\":\"lean|appropriate|shotgun|insufficient\",\"dispoOk\":false,\"stabilizationGrade\":\"excellent|adequate|inadequate|critical-error\",\"transferPackagingOk\":null,\"criticalActions\":[{\"id\":\"\",\"action\":\"\",\"status\":\"done|late|missed\",\"atMin\":null,\"windowMin\":0,\"quote\":null}],\"divergences\":[{\"atMin\":0,\"did\":\"\",\"shouldHave\":\"\"}],\"wins\":[\"\"],\"misses\":[\"\"],\"carryForward\":\"\",\"teachingPoint\":\"\",\"criticalError\":null,\"ruleApplied\":{\"text\":\"\",\"followed\":null}}"
  ].join("\n");

  var REVIEW_SYSTEM = [
    "You are a senior emergency physician and a clinical pharmacist reviewing a machine-written training case before it is served to a learner (Derek, a solo rural emergency physician at a critical access hospital). You check the medicine, not the style. Return ONLY JSON.",
    "",
    facilityText(),
    "",
    "CHECK FOR, in this order:",
    "1. A wrong drug, dose, route or timing in the answer key, interventions or idealSequence. Compare against the reference below and current practice; weight-based for children.",
    "2. A contraindicated or harmful action presented as correct (lytics for stroke without CT excluding hemorrhage; intubating the hypotensive patient before resuscitation listed as a critical action).",
    "3. A windowMin that is unrealistic for the action at this facility.",
    "4. trueDispo wrong for THIS facility under THESE conditions (an unstable patient marked Admit inpatient; a benign case marked Transfer).",
    "5. A critical action that is not must-do, or a must-do action missing from criticalActions.",
    "6. Vitals, trajectory or intervention effects that are physiologically implausible for the diagnosis, age and presentation.",
    "7. Contradictions between persona.facts, vitals0, the trajectory and the answer key.",
    "",
    "severity \"block\" = would teach wrong medicine if served as is. \"warn\" = minor or debatable. Never block for wording. If the case is sound, return ok:true with an empty issues list.",
    "",
    CLINICAL_ACCURACY,
    "",
    "Return exactly: {\"ok\":true,\"issues\":[{\"field\":\"answerKey.criticalActions[1]\",\"problem\":\"\",\"fix\":\"\",\"severity\":\"block|warn\"}]}"
  ].join("\n");

  // ── JSON schemas for structured outputs (output_config.format) ───────────
  // Kept to what the API accepts: types, enum, required, additionalProperties:false, anyOf for null.
  function S(type) { return { type: type }; }
  function S_enum(vals) { return { type: "string", enum: vals }; }
  function S_arr(items) { return { type: "array", items: items }; }
  function S_null(s) { return { anyOf: [s, { type: "null" }] }; }
  function S_obj(props, optional) {
    optional = optional || [];
    var req = Object.keys(props).filter(function (k) { return optional.indexOf(k) < 0; });
    return { type: "object", properties: props, required: req, additionalProperties: false };
  }
  function S_labels(labels) { var p = {}; labels.forEach(function (l) { p[l] = S("string"); }); return S_obj(p); }
  var VITAL_PROPS = {};
  VITAL_KEYS.forEach(function (k) { VITAL_PROPS[k] = S("number"); });
  var PHYS_PROPS = {
    fitz: S("integer"), hair: S("string"), rrRate: S("number"), pallor: S("integer"), diaphoresis: S("integer"), cyanosis: S("integer"), jaundice: S("integer"), guarding: S("integer"),
    eyeState: S_enum(["open", "half", "closed"]), positioning: S_enum(["supine", "tripod", "fetal", "sitting"]), distressLevel: S("integer"), age: S("number"),
    habitus: S_enum(["cachectic", "average", "obese"]), rashNote: S("string")
  };
  var SCHEMAS = {
    "case": S_obj({
      persona: S_obj({ name: S("string"), age: S("number"), sex: S_enum(["M", "F"]), ethnicity: S("string"), occupation: S("string"), chiefComplaint: S("string"),
        arrivalMode: S("string"), emsHandoff: S("string"), doorwayImpression: S("string"), voice: S("string"), facts: S("string") }),
      physicality: S_obj(PHYS_PROPS),
      vitals0: S_obj(VITAL_PROPS),
      trajectory: S_arr(S_obj(assign({ t: S("number") }, VITAL_PROPS))),
      interventions: S_arr(S_obj({ id: S("string"), label: S("string"), chips: S_arr(S("string")), mode: S_enum(["delta", "arrest"]),
        effect: S_obj(VITAL_PROPS, VITAL_KEYS), onsetMin: S("number"), durationMin: S("number"), critical: S("boolean"), windowMin: S("number"),
        maxApplications: S("integer"), response: S("string") })),
      history: S_labels(CHIPS.History),
      answerKey: S_obj({ trueDx: S("string"), trueAcuity: S("integer"), trueDispo: S_enum(DISPOS), cantMiss: S_arr(S("string")),
        criticalActions: S_arr(S_obj({ id: S("string"), action: S("string"), windowMin: S("number") })),
        idealSequence: S_arr(S_obj({ atMin: S("number"), action: S("string") })),
        transferPackaging: S("string"), teachingPoint: S("string"), ruralTwist: S("string") })
    }),
    results: S_obj({ results: S_labels(CHIPS.Exam.concat(CHIPS.Labs, CHIPS.Imaging)) }),
    turn: S_obj({
      responses: S_arr(S_obj({ kind: S_enum(["patient", "clinical"]), text: S("string"), mono: S("boolean"), obs: S("string") })),
      interventionsApplied: S_arr(S("string")), timeCostMin: S("number"),
      physicality: S_obj(PHYS_PROPS, Object.keys(PHYS_PROPS))
    }),
    grade: S_obj({
      score: S("integer"), caughtInDdx: S("boolean"), rankOfTrueDx: S_null(S("integer")), gestaltCal: S_enum(GESTALT), workup: S_enum(WORKUP),
      dispoOk: S("boolean"), stabilizationGrade: S_enum(STAB), transferPackagingOk: S_null(S("boolean")),
      criticalActions: S_arr(S_obj({ id: S("string"), action: S("string"), status: S_enum(["done", "late", "missed"]), atMin: S_null(S("number")), windowMin: S("number"), quote: S_null(S("string")) })),
      divergences: S_arr(S_obj({ atMin: S("number"), did: S("string"), shouldHave: S("string") })),
      wins: S_arr(S("string")), misses: S_arr(S("string")), carryForward: S("string"), teachingPoint: S("string"), criticalError: S_null(S("string")),
      ruleApplied: S_obj({ text: S("string"), followed: S_null(S("boolean")) })
    }),
    review: S_obj({ ok: S("boolean"), issues: S_arr(S_obj({ field: S("string"), problem: S("string"), fix: S("string"), severity: S_enum(["block", "warn"]) })) })
  };

  // ── Case validation / defaults ────────────────────────────────────────────
  function invalid(msg) { var e = new Error(msg); e.invalid = true; return e; }

  function defaultVitals(band) {
    var n = normalsFor(band).range;
    return {
      HR: Math.round((n.HR[0] + n.HR[1]) / 2), SBP: Math.round((n.SBP[0] + Math.min(n.SBP[1], 140)) / 2),
      DBP: Math.round((n.SBP[0] + Math.min(n.SBP[1], 140)) / 3), RR: Math.round((n.RR[0] + n.RR[1]) / 2),
      SpO2: 98, Temp: 98.6, GCS: 15
    };
  }
  function normVitals(v, base) {
    v = v || {};
    var out = {};
    if (typeof v.BP === "string" && v.BP.indexOf("/") > 0) {
      var p = v.BP.split("/");
      if (v.SBP === undefined) v = assign({}, v, { SBP: p[0] });
      if (v.DBP === undefined) v = assign({}, v, { DBP: p[1] });
    }
    VITAL_KEYS.forEach(function (k) { out[k] = num(v[k], base ? base[k] : undefined); });
    if (out.Temp !== undefined && out.Temp < 50) out.Temp = Math.round((out.Temp * 9 / 5 + 32) * 10) / 10; // Celsius → F
    return out;
  }
  function clampVitals(v) {
    var o = {
      HR: Math.round(clamp(v.HR, 0, 250)),
      SBP: Math.round(clamp(v.SBP, 0, 280)),
      DBP: Math.round(clamp(v.DBP, 0, 180)),
      RR: Math.round(clamp(v.RR, 0, 80)),
      SpO2: Math.round(clamp(v.SpO2, 30, 100)),
      Temp: Math.round(clamp(v.Temp, 77, 110) * 10) / 10,
      GCS: Math.round(clamp(v.GCS, 3, 15))
    };
    if (o.DBP > o.SBP - 5) o.DBP = Math.max(0, o.SBP - 5);
    o.MAP = Math.round((o.SBP + 2 * o.DBP) / 3);
    return o;
  }

  var PHYS_DEFAULT = { fitz: 3, hair: "#3a2820", rrRate: 16, pallor: 0, diaphoresis: 0, cyanosis: 0, jaundice: 0, guarding: 0, eyeState: "open", positioning: "supine", distressLevel: 0, age: 40, habitus: "average", rashNote: null };

  function normalizeCaseA(raw, seed) {
    if (!raw || typeof raw !== "object") throw invalid("case is not an object");
    var p = raw.persona;
    if (!p || typeof p !== "object") throw invalid("missing persona");
    if (!str(p.chiefComplaint)) throw invalid("missing persona.chiefComplaint");
    if (!str(p.facts) && typeof p.facts !== "object") throw invalid("missing persona.facts");
    if (!raw.vitals0 || typeof raw.vitals0 !== "object") throw invalid("missing vitals0");
    if (!raw.answerKey || !str(raw.answerKey.trueDx)) throw invalid("missing answerKey.trueDx");

    seed = seed || {};
    var band = seed.ageBand || "adult";
    var persona = {
      name: str(p.name, "Unknown patient"),
      age: seed.age !== undefined ? seed.age : num(p.age, 40),
      sex: seed.sex || (p.sex === "F" ? "F" : "M"),
      ethnicity: seed.ethnicity || str(p.ethnicity, ""),
      occupation: str(p.occupation, ""),
      chiefComplaint: str(p.chiefComplaint),
      arrivalMode: str(p.arrivalMode, "walk-in"),
      emsHandoff: str(p.emsHandoff, null),
      doorwayImpression: str(p.doorwayImpression, "The patient is in the room."),
      voice: str(p.voice, "Plain-spoken, cooperative."),
      facts: typeof p.facts === "string" ? p.facts : JSON.stringify(p.facts)
    };

    var vitals0 = clampVitals(normVitals(raw.vitals0, defaultVitals(band)));
    delete vitals0.MAP;

    // trajectory: numeric, sorted, t=0 first and equal to vitals0, gaps filled from the previous point
    var pts = arr(raw.trajectory).filter(function (x) { return x && isFinite(num(x.t, NaN)) && num(x.t) >= 0; })
      .map(function (x) { return { t: num(x.t), v: x }; })
      .sort(function (a, b) { return a.t - b.t; });
    var traj = [assign({ t: 0 }, vitals0)];
    var prev = vitals0;
    pts.forEach(function (x) {
      if (x.t === 0) return;
      if (traj.length && traj[traj.length - 1].t === x.t) return;
      var v = clampVitals(normVitals(x.v, prev));
      delete v.MAP;
      traj.push(assign({ t: x.t }, v));
      prev = v;
    });

    var physIn = raw.physicality && typeof raw.physicality === "object" ? raw.physicality : {};
    var phys = assign({}, PHYS_DEFAULT, physIn);
    ["pallor", "diaphoresis", "cyanosis", "jaundice", "guarding"].forEach(function (k) { phys[k] = clamp(Math.round(num(phys[k], 0)), 0, 3); });
    phys.distressLevel = clamp(Math.round(num(phys.distressLevel, 0)), 0, 4);
    if (seed.fitz) phys.fitz = seed.fitz; else phys.fitz = clamp(Math.round(num(phys.fitz, 3)), 1, 6);
    phys.age = persona.age;
    phys.rrRate = vitals0.RR;
    if (["open", "half", "closed"].indexOf(phys.eyeState) < 0) phys.eyeState = "open";
    if (["supine", "tripod", "fetal", "sitting"].indexOf(phys.positioning) < 0) phys.positioning = "supine";
    if (["cachectic", "average", "obese"].indexOf(phys.habitus) < 0) phys.habitus = "average";

    // interventions
    var seen = {};
    var interventions = arr(raw.interventions).filter(function (x) { return x && typeof x === "object"; }).map(function (x) {
      var id = slug(x.id || x.label);
      while (seen[id]) id = id + "_2";
      seen[id] = true;
      var effect = {};
      var eff = x.effect && typeof x.effect === "object" ? x.effect : {};
      VITAL_KEYS.forEach(function (k) { var n = num(eff[k], NaN); if (isFinite(n) && n !== 0) effect[k] = n; });
      var chips = arr(x.chips).filter(function (c) { return typeof c === "string" && ACTION_LABELS.indexOf(c.trim()) >= 0; }).map(function (c) { return c.trim(); });
      var out = {
        id: id,
        label: str(x.label, id),
        chips: chips,
        mode: x.mode === "arrest" ? "arrest" : "delta",
        effect: effect,
        onsetMin: Math.max(0, num(x.onsetMin, 5)),
        critical: !!x.critical,
        windowMin: Math.max(0, num(x.windowMin, 30)),
        maxApplications: Math.max(1, Math.round(num(x.maxApplications, 1))),
        response: str(x.response, null)
      };
      var dur = num(x.durationMin, NaN);
      if (isFinite(dur) && dur > 0) out.durationMin = dur;
      return out;
    });

    // history: every History chip label
    var filled = [];
    var hist = raw.history && typeof raw.history === "object" ? raw.history : {};
    var history = {};
    CHIPS.History.forEach(function (l) {
      var v = hist[l];
      if (typeof v === "string" && v.trim()) history[l] = v.trim();
      else { history[l] = FALLBACK; filled.push(l); }
    });

    // answer key
    var ak = raw.answerKey;
    var dispo = DISPOS.indexOf(ak.trueDispo) >= 0 ? ak.trueDispo : (/emergent/i.test(ak.trueDispo || "") ? "Emergent transfer" : /transfer/i.test(ak.trueDispo || "") ? "Transfer" : /admit/i.test(ak.trueDispo || "") ? "Admit inpatient" : /f\/u|follow/i.test(ak.trueDispo || "") ? "Discharge w/ f/u" : seed.bucket === "serious" ? "Transfer" : "Discharge");
    var crit = arr(ak.criticalActions).filter(function (c) { return c && (c.id || c.action); }).map(function (c) {
      return { id: slug(c.id || c.action), action: str(c.action, String(c.id)), windowMin: Math.max(0, num(c.windowMin, 30)) };
    });
    var answerKey = {
      trueDx: str(ak.trueDx),
      trueAcuity: clamp(Math.round(num(typeof ak.trueAcuity === "string" ? (ak.trueAcuity.match(/[1-5]/) || [])[0] : ak.trueAcuity, 3)), 1, 5), // ESI: 1 sickest

      trueDispo: dispo,
      cantMiss: arr(ak.cantMiss).filter(function (s) { return typeof s === "string" && s; }),
      criticalActions: crit,
      idealSequence: arr(ak.idealSequence).filter(function (s) { return s && s.action; }).map(function (s) { return { atMin: Math.max(0, num(s.atMin, 0)), action: String(s.action) }; }),
      transferPackaging: str(ak.transferPackaging, null),
      teachingPoint: str(ak.teachingPoint, ""),
      ruralTwist: str(ak.ruralTwist, "")
    };

    return {
      persona: persona, physicality: phys, vitals0: vitals0, trajectory: traj,
      interventions: interventions, history: history, answerKey: answerKey, _filled: filled
    };
  }

  function normalizeResults(raw, caseA) {
    var res = raw && raw.results && typeof raw.results === "object" ? raw.results : (raw && typeof raw === "object" && !raw.results ? raw : {});
    var out = {};
    var filled = (caseA._filled || []).slice();
    RESULT_GROUPS.forEach(function (g) {
      CHIPS[g].forEach(function (l) {
        var v = res[l];
        if (typeof v === "number") v = String(v);
        if (typeof v === "string" && v.trim()) out[l] = v.trim();
        else { out[l] = FALLBACK; filled.push(l); }
      });
    });
    return { results: out, filled: filled };
  }

  // Full normalization of a combined case (used for prefetched / imported / fixture cases).
  function normalizeCase(raw, seed) {
    var a = normalizeCaseA(raw, seed);
    var r = normalizeResults({ results: raw.results || {} }, a);
    a.results = r.results;
    a._filled = r.filled;
    return a;
  }

  // ── Case generation ───────────────────────────────────────────────────────
  function seedForPrompt(seed) {
    var s = assign({}, seed);
    delete s.mode; delete s.seed;
    return s;
  }
  // Second-model check of the medicine in a generated case. Never blocks a case on its own failure.
  function reviewCase(seed, caseA) {
    var user = "SEED: " + JSON.stringify(seedForPrompt(seed)) + "\n\n" + conditionsText(seed.conditions, seed.transferTwist) +
      "\n\nCASE:\n" + JSON.stringify({ persona: caseA.persona, vitals0: caseA.vitals0, trajectory: caseA.trajectory, interventions: caseA.interventions, answerKey: caseA.answerKey }) +
      "\n\nReview now. JSON only.";
    return callJSON("review", sysBlocks([REVIEW_SYSTEM]), user, CONFIG.maxTokens.review, function (r) {
      if (!r || typeof r !== "object" || typeof r.ok !== "boolean") throw invalid("review missing ok");
      r.issues = arr(r.issues).filter(function (i) { return i && (i.problem || i.fix); }).map(function (i) {
        return { field: str(i.field, ""), problem: str(i.problem, ""), fix: str(i.fix, ""), severity: i.severity === "block" ? "block" : "warn" };
      });
      return r;
    }, "case review", SCHEMAS.review);
  }

  // onStage("case" | "review" | "results") fires as each call starts, so a screen can say what it is waiting for.
  function generateCase(seed, onStage) {
    var stage = function (s) { if (typeof onStage === "function") { try { onStage(s); } catch (e) { /* UI only */ } } };
    var seedText = "SEED:\n" + JSON.stringify(seedForPrompt(seed), null, 1) + "\n\n" + conditionsText(seed.conditions, seed.transferTwist);
    var userA = seedText + "\n\nWrite the case now. JSON only.";
    function writeCase(extra) {
      stage("case");
      return callJSON("case", sysBlocks([CASE_SYSTEM]), userA + (extra || ""), CONFIG.maxTokens["case"], function (raw) { return normalizeCaseA(raw, seed); }, "case", SCHEMAS["case"]);
    }
    function maybeReview(caseA) {
      if (!CONFIG.review) return Promise.resolve(caseA);
      stage("review");
      return reviewCase(seed, caseA).then(function (r1) {
        var blocking = r1.issues.filter(function (i) { return i.severity === "block"; });
        if (!blocking.length) { caseA.review = { first: r1, regenerated: false, second: null }; return caseA; }
        var note = "\n\nA clinical reviewer flagged these problems in a previous draft of this case. Fix every one of them:\n" +
          blocking.map(function (i) { return "- " + i.field + ": " + i.problem + " → " + i.fix; }).join("\n");
        return writeCase(note).then(function (caseB) {
          return reviewCase(seed, caseB).then(function (r2) {
            caseB.review = { first: r1, regenerated: true, second: r2 };
            return caseB;
          }, function () { caseB.review = { first: r1, regenerated: true, second: null }; return caseB; });
        });
      }, function (err) {
        if (err && (err.dailyLimit || err.refusal)) throw err;
        caseA.review = { first: null, regenerated: false, second: null, error: err && err.message };
        return caseA;
      });
    }
    return writeCase().then(maybeReview).then(function (caseA) {
      stage("results");
      var forB = { persona: caseA.persona, vitals0: caseA.vitals0, trajectory: caseA.trajectory, physicality: caseA.physicality, answerKey: { trueDx: caseA.answerKey.trueDx } };
      var userB = seedText + "\n\nCASE:\n" + JSON.stringify(forB) +
        "\n\nWrite {\"results\":{...}} for every label. Results reflect time 0. JSON only.";
      return callJSON("results", sysBlocks([RESULTS_SYSTEM]), userB, CONFIG.maxTokens.results, function (raw) {
        if (!raw || typeof raw.results !== "object") throw invalid("missing results");
        return raw;
      }, "results sheet", SCHEMAS.results).then(function (rawB) {
        return normalizeResults(rawB, caseA);
      }, function (err) {
        // Degrade rather than fail: every result goes to the model at order time.
        if (err && err.dailyLimit) throw err;
        return normalizeResults({ results: {} }, caseA);
      }).then(function (r) {
        var c = assign({}, caseA);
        c.results = r.results;
        c._filled = r.filled;
        c.seed = seed;
        c.startedAt = now();
        c.id = seed.caseId;
        return c;
      });
    });
  }

  var inflight = null, inflightSeed = null;
  function callOnSeed(onSeed, seed) {
    if (typeof onSeed !== "function" || !seed) return;
    try { onSeed(seed); } catch (e) { /* a UI callback must never break generation */ }
  }
  // Picks the seed, hands it to onSeed (so the UI can show conditions while the case is written), then generates.
  function newCaseFresh(mode, onSeed, beforeGenerate, onStage) {
    var seed;
    try { seed = CASES.pickCase(stats(), { mode: mode || settings.get().mode }); } catch (e) { return Promise.reject(e); }
    if (beforeGenerate) beforeGenerate(seed);
    callOnSeed(onSeed, seed);
    return generateCase(seed, onStage);
  }
  function readPrefetched() {
    var c = lsJSON("dw_next", null);
    return c && c.persona && c.seed ? c : null;
  }
  function hasPrefetched() { return !!readPrefetched(); }
  function takePrefetched() {
    var c = readPrefetched();
    lsRemove("dw_next");
    return c;
  }
  function prefetch(opts) {
    opts = opts || {};
    if (inflight) return inflight;
    var ready = readPrefetched();
    if (ready) return Promise.resolve(ready);
    var p = newCaseFresh(opts.mode, null, function (seed) { inflightSeed = seed; }).then(function (c) {
      lsSet("dw_next", JSON.stringify(c));
      if (inflight === p) { inflight = null; inflightSeed = null; }
      return c;
    }, function (e) {
      if (inflight === p) { inflight = null; inflightSeed = null; }
      throw e;
    });
    inflight = p;
    p.catch(function () { /* handled by whoever awaits; avoid unhandled-rejection noise */ });
    return p;
  }
  // newCase({mode, onSeed, onStage}): onSeed(seed) is called before generation starts (or at once for a
  // ready case); onStage names the call in progress when a case has to be written now.
  function newCase(opts) {
    opts = opts || {};
    if (inflight) {
      var waiting = inflight;
      callOnSeed(opts.onSeed, inflightSeed);
      if (typeof opts.onStage === "function") { try { opts.onStage("case"); } catch (e) { /* UI only */ } }
      return waiting.then(function () {
        return takePrefetched() || newCaseFresh(opts.mode, opts.onSeed, null, opts.onStage);
      }, function () { return newCaseFresh(opts.mode, opts.onSeed, null, opts.onStage); });
    }
    var ready = takePrefetched();
    if (ready) { callOnSeed(opts.onSeed, ready.seed); return Promise.resolve(ready); }
    return newCaseFresh(opts.mode, opts.onSeed, null, opts.onStage);
  }

  // ── Encounter ─────────────────────────────────────────────────────────────
  function startEncounter(c) {
    var enc = {
      case: c,
      simMin: 0,
      applied: [],
      log: [],
      vitalsHistory: [],
      gut: null,
      startedAt: now(),
      physicality: assign({}, c.physicality),
      resulted: {},
      pending: [],
      transport: null,
      receivingCalls: 0,
      accepted: false,
      ctTechIn: false,
      ctTechAt: null
    };
    var v = vitalsAt(enc, 0);
    enc.vitalsHistory = [{ t: 0, vitals: v }];
    enc.log = [{ k: "obs", t: c.persona.doorwayImpression, atMin: 0, vitals: v }];
    // A case left at the doorway can be resumed too. A new case replaces whatever was active.
    var sid = encCaseId(enc);
    if (sid) delete finishedIds[sid];
    var w = writeActive(enc, true);
    if (w === "failed") enc.saveFailed = true;
    return enc;
  }

  // Linear between points; past the last point the last segment's slope continues (clamped by the
  // caller), so an untreated patient keeps getting worse instead of stabilising at T+120.
  function interp(traj, m) {
    if (!traj || !traj.length) return {};
    if (m <= traj[0].t) return assign({}, traj[0]);
    for (var i = 1; i < traj.length; i++) {
      if (m <= traj[i].t) {
        var a = traj[i - 1], b = traj[i], f = (m - a.t) / (b.t - a.t || 1);
        var o = {};
        VITAL_KEYS.forEach(function (k) { o[k] = a[k] + (b[k] - a[k]) * f; });
        return o;
      }
    }
    var last = traj[traj.length - 1];
    if (traj.length < 2) return assign({}, last);
    var p = traj[traj.length - 2], dt = last.t - p.t || 1, ext = {};
    VITAL_KEYS.forEach(function (k) { ext[k] = last[k] + (last[k] - p[k]) * (m - last.t) / dt; });
    return ext;
  }

  // Effect multiplier at minute m for an intervention applied at `at` (A5).
  function effectFactor(iv, at, m) {
    var dt = m - at;
    if (dt < 0) return 0;
    var on = iv.onsetMin || 0;
    if (dt < on) return on > 0 ? dt / on : 1;
    if (iv.durationMin) return Math.max(0, 1 - (dt - on) / iv.durationMin); // fades to 0 at onset + duration
    return 1;
  }

  function vitalsAt(enc, min) {
    var c = enc.case;
    var m = Math.max(0, num(min, enc.simMin || 0));
    var byId = {};
    (c.interventions || []).forEach(function (iv) { byId[iv.id] = iv; });
    var applied = (enc.applied || []).filter(function (a) { return byId[a.id] && a.atMin <= m; });
    var freezeAt = null;
    applied.forEach(function (a) { if (byId[a.id].mode === "arrest" && (freezeAt === null || a.atMin < freezeAt)) freezeAt = a.atMin; });
    var base = interp(c.trajectory, freezeAt === null ? m : Math.min(m, freezeAt));
    var v = {};
    VITAL_KEYS.forEach(function (k) { v[k] = num(base[k], c.vitals0[k]); });
    applied.forEach(function (a) {
      var iv = byId[a.id];
      var f = effectFactor(iv, a.atMin, m);
      for (var k in iv.effect) if (has(iv.effect, k) && has(v, k)) v[k] += iv.effect[k] * f;
    });
    return clampVitals(v);
  }

  function lockGut(enc, g) {
    g = g || {};
    var gut = {
      sick: typeof g.sick === "boolean" ? g.sick : null,
      acuity: g.acuity >= 1 && g.acuity <= 5 ? Math.round(g.acuity) : null,
      gutDispo: g.gutDispo || null,
      timedOut: !!g.timedOut,
      lockedAt: now(),
      elapsedSec: Math.round((now() - (enc.startedAt || now())) / 1000)
    };
    var next = assign({}, enc, { gut: gut });
    delete next.saveFailed;
    // Sync API returns the enc; saveFailed:true rides on it (not persisted) when the write failed.
    if (writeActive(next, false) === "failed") next = assign({}, next, { saveFailed: true });
    return next;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function alarmFlags(v, band) {
    var a = normalsFor(band).alarm;
    return {
      BP: v.SBP < a.SBPlo || (a.MAPlo !== null && v.MAP < a.MAPlo),
      SpO2: v.SpO2 < a.SpO2lo,
      HRhi: v.HR > a.HRhi,
      HRlo: v.HR < a.HRlo,
      RRhi: v.RR > a.RRhi,
      RRlo: v.RR < a.RRlo
    };
  }
  function deteriorationEvents(prev, next, band) {
    var ev = [];
    var p = alarmFlags(prev, band), n = alarmFlags(next, band);
    function push(vital, from, to, text) { ev.push({ kind: "deteriorating", vital: vital, from: from, to: to, text: text }); }
    if (n.BP && !p.BP) push("BP", prev.SBP + "/" + prev.DBP, next.SBP + "/" + next.DBP, "BP " + next.SBP + "/" + next.DBP + " — falling");
    if (n.SpO2 && !p.SpO2) push("SpO2", prev.SpO2, next.SpO2, "SpO₂ " + next.SpO2 + "% — falling");
    if (n.HRhi && !p.HRhi) push("HR", prev.HR, next.HR, "HR " + next.HR + " — rising");
    if (n.HRlo && !p.HRlo) push("HR", prev.HR, next.HR, "HR " + next.HR + " — falling");
    if (n.RRhi && !p.RRhi) push("RR", prev.RR, next.RR, "RR " + next.RR + " — rising");
    if (n.RRlo && !p.RRlo) push("RR", prev.RR, next.RR, "RR " + next.RR + " — falling");
    if (prev.GCS - next.GCS >= 2) push("GCS", prev.GCS, next.GCS, "GCS " + next.GCS + " — falling");
    return ev;
  }

  // ── act() ─────────────────────────────────────────────────────────────────
  function chipGroupOf(label) {
    for (var g in CHIPS) if (has(CHIPS, g) && CHIPS[g].indexOf(label) >= 0) return g;
    return null;
  }
  function chipCost(group, label) {
    switch (group) {
      case "History": return T.history;
      case "Exam": return T.exam;
      case "Labs": return LAB_POC[label] ? T.labsPoc : T.labsSend;
      case "Imaging": return BEDSIDE[label] ? T.bedside : /^CT/.test(label) ? T.ct : T.xray;
      case "Procedures": return T.procedure;
      case "Stabilize": return label === "Activate MTP" ? T.bloodBank : T.stabilize;
      case "Transfer": return label === "Call receiving facility" ? T.callReceiving : label === "Send records/imaging" ? T.stabilize : 0;
      case "Time": return label === "Recheck vitals" ? 5 : label === "Observe 15 min" ? 15 : 30;
    }
    return T.history;
  }
  function fmtVitals(v) {
    return "HR " + v.HR + " BP " + v.SBP + "/" + v.DBP + " RR " + v.RR + " SpO2 " + v.SpO2 + " T " + v.Temp + " GCS " + v.GCS;
  }

  // What never changes during a case goes in the system blocks, where it is cached across the
  // case's turns; what changes turn to turn goes in the user message.
  function turnCaseBlock(c) {
    return [
      "PERSONA: " + JSON.stringify(c.persona),
      "PHYSICALITY AT ARRIVAL: " + JSON.stringify(c.physicality),
      conditionsText(c.seed && c.seed.conditions, null),
      "HISTORY SHEET (patient's answers): " + JSON.stringify(c.history),
      "INTERVENTIONS (id: label): " + JSON.stringify((c.interventions || []).map(function (iv) { return { id: iv.id, label: iv.label }; }))
    ].join("\n\n");
  }
  function buildTurnPrompt(enc, items, text, vitals) {
    var c = enc.case;
    // Only tests that have come back (or are ordered now) are on the sheet he sees; the rest stays hidden,
    // and a test that is still pending is named but its value withheld.
    var pend = {};
    (enc.pending || []).forEach(function (p) { pend[p.label] = true; });
    var want = {};
    Object.keys(enc.resulted || {}).forEach(function (l) { if (!pend[l]) want[l] = true; });
    items.forEach(function (i) { want[i.label] = true; });
    var sheet = {};
    Object.keys(c.results || {}).forEach(function (l) { if (want[l] && c.results[l] !== FALLBACK) sheet[l] = c.results[l]; });
    var lines = [];
    lines.push("PHYSICALITY NOW: " + JSON.stringify(enc.physicality || c.physicality));
    lines.push("SIM MINUTE: T+" + enc.simMin + " · CURRENT VITALS: " + fmtVitals(vitals));
    lines.push("RESULTS SHEET (time-0 values for tests that have come back or are ordered now; no other test has been done): " + JSON.stringify(sheet));
    lines.push("PENDING (ordered, not back yet — do not report or guess their values): " + JSON.stringify((enc.pending || []).map(function (p) { return p.label + " back ~T+" + p.readyAt; })));
    lines.push("ALREADY RESULTED (a new order for these is a repeat): " + JSON.stringify(Object.keys(enc.resulted || {}).filter(function (l) { return !pend[l]; })));
    lines.push("APPLIED SO FAR: " + JSON.stringify((enc.applied || []).map(function (a) { return { id: a.id, atMin: a.atMin }; })));
    if (enc.doneNow && enc.doneNow.length) lines.push("DONE THIS TURN BY BUTTON (already carried out and reported to him in the log; do not narrate these again, and do not list them in interventionsApplied): " + JSON.stringify(enc.doneNow));
    if (enc.transport) lines.push("TRANSPORT: " + JSON.stringify(enc.transport));
    if (enc.accepted) lines.push("RECEIVING FACILITY: accepted.");
    lines.push("LOG SO FAR:\n" + (enc.log || []).map(function (e) { return "[T+" + (e.atMin || 0) + "] " + e.k.toUpperCase() + ": " + e.t; }).join("\n"));
    var req = [];
    if (items.length) req.push("Ordered via buttons: " + items.map(function (i) { return i.group + " → " + i.label + (i.repeat ? " (REPEAT)" : ""); }).join("; "));
    if (text) req.push("He says/types: \"" + text + "\"");
    lines.push("NOW:\n" + req.join("\n"));
    lines.push("Respond to the items above only. JSON only.");
    return { system: sysBlocks([TURN_SYSTEM, turnCaseBlock(c)]), user: lines.join("\n\n") };
  }

  function act(enc, input) {
    input = input || {};
    if (!enc || !enc.case) return Promise.reject(new Error("No active patient."));
    if (!enc.gut) return Promise.reject(new Error("Lock your doorway read first."));
    var c = enc.case;
    var cond = (c.seed && c.seed.conditions) || {};
    var twist = c.seed && c.seed.transferTwist;
    var t0 = enc.simMin || 0;
    var text = typeof input.text === "string" ? input.text.trim() : "";
    var chips = arr(input.chips).filter(function (ch) { return ch && typeof ch.label === "string"; }).map(function (ch) {
      return { group: ch.group || chipGroupOf(ch.label) || "Other", label: ch.label };
    });
    if (!text && !chips.length) return Promise.reject(new Error("Nothing to send."));

    var vBefore = vitalsAt(enc, t0);
    var entries = [];
    var events = [];
    var costs = [];
    var modelItems = [];
    var applied = (enc.applied || []).slice();
    var resulted = assign({}, enc.resulted);
    var pending = (enc.pending || []).slice();
    var transport = enc.transport ? assign({}, enc.transport) : null;
    var receivingCalls = enc.receivingCalls || 0;
    var accepted = !!enc.accepted;
    var ctTechIn = !!enc.ctTechIn;
    var ctTechAt = enc.ctTechAt == null ? null : enc.ctTechAt;
    var filled = {};
    (c._filled || []).forEach(function (l) { filled[l] = true; });
    var ivs = c.interventions || [];

    var docText = chips.map(function (ch) { return ch.label; }).concat(text ? [text] : []).join(" · ");
    entries.push({ k: "doc", t: docText, atMin: t0, vitals: vBefore });

    function countApplied(id) { return applied.filter(function (a) { return a.id === id; }).length; }
    function applyIv(iv, source) {
      if (countApplied(iv.id) >= iv.maxApplications) {
        entries.push({ k: "clinical", t: iv.label + " — already done.", atMin: t0 });
        return false;
      }
      applied.push({ id: iv.id, atMin: t0, source: source });
      return true;
    }
    function eventEntry(kind, txt, at) {
      events.push({ kind: kind, text: txt, atMin: at });
      entries.push({ k: "event", t: txt, atMin: at });
    }

    chips.forEach(function (ch) {
      var g = ch.group, l = ch.label;
      var cost = chipCost(g, l);
      if (g === "History") {
        if (c.history && c.history[l] && !filled[l]) {
          entries.push({ k: "patient", t: c.history[l], atMin: t0 + cost });
          costs.push({ min: cost, label: l });
        } else modelItems.push(ch);
        return;
      }
      if (g === "Exam" || g === "Labs" || g === "Imaging") {
        var isCT = g === "Imaging" && /^CT/.test(l);
        if (isCT && !cond.ctAvailable) {
          if (!ctTechIn) {
            if (!cond.ctOnCall) { eventEntry("ct", "CT unavailable — no tech tonight", t0); return; }
            eventEntry("ct", "CT tech called back — ~45 min", t0);
            ctTechIn = true;
            ctTechAt = t0 + 45;
          }
          // no scan before the tech is in, whichever order it was placed in
          cost = Math.max(ctTechAt, t0) + T.ct - t0;
        }
        var repeat = g !== "Exam" && resulted[l];
        // Labs and send-out imaging are sent now and come back later: the clock moves by the time it takes
        // to order, and the result lands when the clock passes its ready minute (a later order, or a Time chip).
        // Bedside tests and the exam answer now. A repeat or a missing result still goes to the model and
        // costs its minutes up front.
        var deferred = g === "Labs" || (g === "Imaging" && !BEDSIDE[l]);
        if (!repeat && c.results && c.results[l] && !filled[l]) {
          if (deferred) {
            pending.push({ group: g, label: l, readyAt: t0 + cost, text: l + ": " + c.results[l] });
            entries.push({ k: "sent", t: l + " sent · back about T+" + (t0 + cost), atMin: t0 });
            resulted[l] = t0 + cost;
            costs.push({ min: T.history, label: l + " sent" });
          } else {
            entries.push({ k: "clinical", t: l + ": " + c.results[l], mono: g !== "Exam", atMin: t0 + cost });
            if (g !== "Exam") resulted[l] = t0 + cost;
            costs.push({ min: cost, label: l });
          }
        } else {
          modelItems.push({ group: g, label: l, repeat: !!repeat, cost: cost });
          if (g !== "Exam") resulted[l] = t0 + cost;
          costs.push({ min: cost, label: l });
        }
        return;
      }
      if (g === "Time") {
        // Letting time pass is a decision; it costs minutes and nothing else. The vitals line is
        // filled in once the batch's end minute is known.
        costs.push({ min: cost, label: l });
        entries.push({ k: "clinical", t: l === "Recheck vitals" ? "" : "You wait and watch.", mono: l === "Recheck vitals", atMin: t0 + cost, recheck: l === "Recheck vitals" });
        return;
      }
      if (g === "Transfer") {
        // A transfer chip also counts as the intervention the case writer tied to it (the early call,
        // the transport request), so the critical-action clock can see it.
        for (var ti = 0; ti < ivs.length; ti++) {
          if (ivs[ti].chips.indexOf(l) >= 0 && countApplied(ivs[ti].id) < ivs[ti].maxApplications) { applied.push({ id: ivs[ti].id, atMin: t0, source: "chip" }); break; }
        }
        if (l === "Request flight") {
          if (cond.flight !== "available") {
            eventEntry("transfer", cond.flight === "weather" ? "Flight declined: weather" : "Flight declined: aircraft in use", t0);
          } else {
            transport = { mode: "flight", etaMin: t0 + T.flightTransfer, status: "en route", requestedAt: t0 };
            entries.push({ k: "clinical", t: "Flight crew launched — ETA " + T.flightTransfer + " min.", atMin: t0 });
          }
          return;
        }
        if (l === "Request ground ALS") {
          transport = { mode: "ground", etaMin: t0 + cond.groundEta, status: "en route", requestedAt: t0 };
          entries.push({ k: "clinical", t: "Ground ALS dispatched — ETA " + cond.groundEta + " min.", atMin: t0 });
          return;
        }
        if (l === "Call receiving facility") {
          if (accepted) {
            entries.push({ k: "clinical", t: "Receiving facility already accepted; update given.", atMin: t0 + T.callReceiving });
            costs.push({ min: T.callReceiving, label: l });
            return;
          }
          receivingCalls += 1;
          var divert = (cond.tertiaryDiversion || twist === "declined") && receivingCalls === 1;
          if (divert) {
            eventEntry("transfer", "Accepting facility declined — on diversion", t0 + T.callReceiving);
            costs.push({ min: T.callReceiving, label: l });
          } else {
            accepted = true;
            var cm = receivingCalls > 1 ? 15 : T.callReceiving;
            entries.push({ k: "clinical", t: (receivingCalls > 1 ? "Second center" : "Receiving physician") + " accepts the patient.", atMin: t0 + cm });
            costs.push({ min: cm, label: l });
          }
          return;
        }
        modelItems.push({ group: g, label: l, cost: cost });
        costs.push({ min: cost, label: l });
        return;
      }
      // Procedures / Stabilize / other: exact chip match only (A2)
      var match = null;
      for (var i = 0; i < ivs.length; i++) if (ivs[i].chips.indexOf(l) >= 0) { match = ivs[i]; break; }
      if (match) {
        if (applyIv(match, "chip")) {
          entries.push({ k: "clinical", t: match.response || (match.label + " — done."), atMin: t0 + cost });
          costs.push({ min: cost, label: l });
        }
      } else {
        modelItems.push({ group: g, label: l, cost: cost });
        costs.push({ min: cost, label: l });
      }
    });

    var needModel = modelItems.length > 0 || !!text;
    var physicality = enc.physicality || c.physicality;
    var modelPromise = Promise.resolve(null);
    if (needModel) {
      var doneNow = applied.filter(function (a) { return a.atMin === t0 && a.source === "chip"; }).map(function (a) {
        for (var k = 0; k < ivs.length; k++) if (ivs[k].id === a.id) return ivs[k].label;
        return a.id;
      });
      var encForPrompt = assign({}, enc, { applied: applied, resulted: enc.resulted, pending: pending, transport: transport, accepted: accepted, doneNow: doneNow, log: (enc.log || []).concat(entries) });
      var p = buildTurnPrompt(encForPrompt, modelItems, text, vBefore);
      modelPromise = callJSON("turn", p.system, p.user, CONFIG.maxTokens.turn, function (r) {
        if (!r || typeof r !== "object") throw invalid("turn not an object");
        return r;
      }, "reply", SCHEMAS.turn);
    }

    return modelPromise.then(function (r) {
      var modelCost = 0;
      if (r) {
        var responses = Array.isArray(r.responses) ? r.responses : (r.text ? [r] : []);
        responses.slice(0, 6).forEach(function (resp) {
          if (!resp || !resp.text) return;
          entries.push({ k: resp.kind === "patient" ? "patient" : "clinical", t: String(resp.text), mono: !!resp.mono, atMin: t0 });
          if (resp.obs) entries.push({ k: "obs", t: String(resp.obs), atMin: t0 });
        });
        if (!responses.length) entries.push({ k: "clinical", t: "No response.", atMin: t0 });
        arr(r.interventionsApplied).forEach(function (id) {
          var iv = null;
          for (var i = 0; i < ivs.length; i++) if (ivs[i].id === id) { iv = ivs[i]; break; }
          if (iv) applyIv(iv, "model");
        });
        modelCost = clamp(Math.round(num(r.timeCostMin, 0)), 0, 180);
        if (text && modelCost > 0) costs.push({ min: modelCost, label: "your request" });
        if (r.physicality && typeof r.physicality === "object") physicality = assign({}, physicality, r.physicality);
      }

      var maxC = { min: 0, label: "" };
      costs.forEach(function (x) { if (x.min > maxC.min) maxC = x; });
      var t1 = t0 + maxC.min;

      // Results whose ready minute the clock has now passed land on the log at that minute.
      var still = [];
      pending.slice().sort(function (a, b) { return a.readyAt - b.readyAt; }).forEach(function (p) {
        if (p.readyAt <= t1) entries.push({ k: "clinical", t: p.text, mono: true, atMin: p.readyAt });
        else still.push(p);
      });

      var next = assign({}, enc, {
        simMin: t1, applied: applied, resulted: resulted, pending: still, transport: transport,
        receivingCalls: receivingCalls, accepted: accepted, ctTechIn: ctTechIn, ctTechAt: ctTechAt, physicality: physicality
      });
      var vAfter = vitalsAt(next, t1);
      entries.forEach(function (e) { if (e.recheck) { e.t = "Recheck: " + fmtVitals(vitalsAt(next, e.atMin)); delete e.recheck; } });
      if (maxC.min > 0) entries.push({ k: "time", t: "+" + maxC.min + " min — " + maxC.label, atMin: t1, from: t0, vitals: vAfter });

      // Events are stamped at the minute the vital crossed, found by stepping the model in
      // 5-minute increments through the batch, not at the end of the batch.
      var band = c.seed && c.seed.ageBand;
      var firedVital = {};
      var prevV = vBefore;
      for (var m = t0 + 5; m <= t1 + 4; m += 5) {
        var mm = Math.min(m, t1);
        var vm = mm === t1 ? vAfter : vitalsAt(next, mm);
        deteriorationEvents(prevV, vm, band).forEach(function (e) {
          if (firedVital[e.vital]) return;
          firedVital[e.vital] = true;
          e.atMin = mm;
          events.push(e);
          entries.push({ k: "event", t: e.text, atMin: mm });
        });
        prevV = vm;
        if (mm === t1) break;
      }
      if (!firedVital.GCS && vBefore.GCS - vAfter.GCS >= 2) {
        var ge = { kind: "deteriorating", vital: "GCS", from: vBefore.GCS, to: vAfter.GCS, text: "GCS " + vAfter.GCS + " — falling", atMin: t1 };
        events.push(ge);
        entries.push({ k: "event", t: ge.text, atMin: t1 });
      }

      if (transport && transport.status === "en route" && t1 >= transport.etaMin) {
        transport = assign({}, transport, { status: "at bedside" });
        next.transport = transport;
        var txt = (transport.mode === "flight" ? "Flight crew" : "Ground ALS crew") + " at bedside";
        events.push({ kind: "transport", text: txt, atMin: transport.etaMin });
        entries.push({ k: "event", t: txt, atMin: transport.etaMin });
      }

      next.log = (enc.log || []).concat(entries);
      next.vitalsHistory = (enc.vitalsHistory || []).concat([{ t: t1, vitals: vAfter }]);
      delete next.saveFailed;
      var saved = writeActive(next, false);
      return { enc: next, entries: entries, events: events, saveFailed: saved === "failed", stale: saved === "stale" };
    });
  }

  // ── Active encounter storage ──────────────────────────────────────────────
  // dw_active holds one encounter. A late reply for an old case must not overwrite a newer one, and a
  // case already graded in this session must not come back: only overwrite when the stored caseId
  // matches or the slot is empty. startEncounter (a new case) may replace it.
  var finishedIds = {};
  function encCaseId(enc) { var c = enc && enc.case; return (c && ((c.seed && c.seed.caseId) || c.id)) || null; }
  // -> "ok" | "stale" (another case is active, or this one is finished) | "failed" (storage write failed)
  function writeActive(enc, replace) {
    var id = encCaseId(enc);
    if (id && finishedIds[id]) return "stale";
    if (!replace) {
      var cur = lsJSON("dw_active", null);
      var curId = encCaseId(cur);
      if (cur && cur.case && curId !== id) return "stale";
    }
    return lsSet("dw_active", JSON.stringify(enc)) ? "ok" : "failed";
  }
  function saveActive(enc) { return writeActive(enc, false) === "ok"; }
  function loadActive() { var e = lsJSON("dw_active", null); return e && e.case ? e : null; }
  function clearActive() { lsRemove("dw_active"); }

  // ── Grading ───────────────────────────────────────────────────────────────
  function computeCritical(enc) {
    var c = enc.case;
    var ivIds = {};
    (c.interventions || []).forEach(function (iv) { ivIds[iv.id] = iv; });
    var computed = [], toJudge = [];
    (c.answerKey.criticalActions || []).forEach(function (ca) {
      if (ivIds[ca.id]) {
        var first = null;
        (enc.applied || []).forEach(function (a) { if (a.id === ca.id && (first === null || a.atMin < first)) first = a.atMin; });
        var status = first === null ? "missed" : first <= ca.windowMin ? "done" : "late";
        var quote = null;
        if (first !== null) {
          var docs = (enc.log || []).filter(function (e) { return e.k === "doc" && e.atMin === first; });
          if (docs.length) quote = docs[0].t;
        }
        computed.push({ id: ca.id, action: ca.action, status: status, atMin: first, windowMin: ca.windowMin, quote: quote, computed: true });
      } else toJudge.push(ca);
    });
    return { computed: computed, toJudge: toJudge };
  }

  function transcriptText(enc) {
    var c = enc.case;
    var out = [];
    (enc.log || []).forEach(function (e) {
      var line = "[T+" + (e.atMin || 0) + "] " + e.k.toUpperCase() + ": " + e.t;
      if (e.vitals) line += "   {vitals: " + fmtVitals(e.vitals) + "}";
      out.push(line);
    });
    out.push("APPLIED INTERVENTIONS: " + JSON.stringify((enc.applied || []).map(function (a) {
      var iv = null;
      (c.interventions || []).forEach(function (x) { if (x.id === a.id) iv = x; });
      return { id: a.id, label: iv ? iv.label : a.id, atMin: a.atMin };
    })));
    out.push("FINAL SIM MINUTE: T+" + enc.simMin + " · VITALS: " + fmtVitals(vitalsAt(enc, enc.simMin)));
    if (enc.pending && enc.pending.length) out.push("STILL PENDING WHEN HE COMMITTED (ordered, never came back): " + JSON.stringify(enc.pending.map(function (p) { return p.label + " ~T+" + p.readyAt; })));
    if (enc.transport) out.push("TRANSPORT: " + JSON.stringify(enc.transport));
    out.push("RECEIVING FACILITY CALLS: " + (enc.receivingCalls || 0) + (enc.accepted ? " (accepted)" : " (not accepted)"));
    return out.join("\n");
  }

  // The disposition plan (prescriptions, instructions, last orders) runs as his final orders before
  // grading, so the interventions it names can count. One model call; the clock moves by what it takes.
  function grade(enc, final) {
    final = final || {};
    if (!enc || !enc.case) return Promise.reject(new Error("No active patient."));
    var plan = str(final.plan, "");
    var ready = plan
      ? act(enc, { text: "At disposition, before the patient leaves or is discharged: " + plan }).then(function (r) { return r.enc; }, function () { return enc; })
      : Promise.resolve(enc);
    return ready.then(function (e2) { return gradeNow(e2, final, plan); });
  }
  // A second physician's reservations about this case's answer key, when a review ran: the grader
  // should not hold him to a key line the reviewer thought debatable.
  function reviewNotes(c) {
    var r = c.review && (c.review.second || c.review.first);
    var issues = r && arr(r.issues).filter(function (i) { return i && i.problem; });
    if (!issues || !issues.length) return "CASE REVIEWER NOTES: none.";
    return "CASE REVIEWER NOTES (a second physician's reservations about this answer key; do not penalize him for following them, and do not treat a key line they question as settled): " +
      JSON.stringify(issues.map(function (i) { return (i.field ? i.field + ": " : "") + i.problem + (i.fix ? " → " + i.fix : ""); }));
  }
  function gradeNow(enc, final, plan) {
    var c = enc.case;
    var crit = computeCritical(enc);
    var answers = {
      ddx: arr(final.ddx).map(function (s) { return String(s || "").trim(); }).filter(Boolean).slice(0, 3),
      confidence: clamp(Math.round(num(final.confidence, 50)), 0, 100),
      finalDispo: final.finalDispo || null,
      transferChecklist: final.transferChecklist || null,
      plan: plan
    };
    var user = [
      "ANSWER KEY: " + JSON.stringify(c.answerKey),
      "SEED: " + JSON.stringify({ dx: c.seed && c.seed.dx, presentation: c.seed && c.seed.presentation, ageBand: c.seed && c.seed.ageBand, bucket: c.seed && c.seed.bucket, transferTwist: c.seed && c.seed.transferTwist }),
      conditionsText(c.seed && c.seed.conditions, c.seed && c.seed.transferTwist),
      "PATIENT: " + JSON.stringify({ name: c.persona.name, age: c.persona.age, sex: c.persona.sex, chiefComplaint: c.persona.chiefComplaint, arrivalMode: c.persona.arrivalMode, vitals0: c.vitals0 }),
      "INTERVENTIONS AVAILABLE: " + JSON.stringify((c.interventions || []).map(function (iv) { return { id: iv.id, label: iv.label, effect: iv.effect, critical: iv.critical }; })),
      "LOCKED DOORWAY GUT (before any workup): " + JSON.stringify(enc.gut),
      "TRANSCRIPT:\n" + transcriptText(enc),
      "FINAL ANSWERS: " + JSON.stringify(answers),
      "HIS RULES FROM PAST DEBRIEFS (newest first): " + JSON.stringify(stats().rules.map(function (r) { return r.rule; })),
      reviewNotes(c),
      "COMPUTED (fixed, do not change): " + JSON.stringify(crit.computed),
      "TO_JUDGE (return only these in criticalActions): " + JSON.stringify(crit.toJudge),
      "Grade now. JSON only."
    ].join("\n\n");

    return callJSON("grade", sysBlocks([GRADE_SYSTEM]), user, CONFIG.maxTokens.grade, function (g) {
      if (!g || typeof g !== "object" || !isFinite(num(g.score, NaN))) throw invalid("grade missing score");
      return g;
    }, "grade", SCHEMAS.grade).then(function (g) {
      var out = finalizeGrade(g, enc, crit, answers);
      out.encAfter = enc; // the encounter as graded (includes the disposition plan turn)
      return out;
    });
  }

  // ── DDx matching (engine decides rank; the model only breaks ties) ────────
  var DX_ABBR = {
    pe: "pulmonary embolism", mi: "myocardial infarction", stemi: "st elevation myocardial infarction",
    nstemi: "non st elevation myocardial infarction", acs: "acute coronary syndrome", chf: "congestive heart failure",
    copd: "chronic obstructive pulmonary disease", dka: "diabetic ketoacidosis", hhs: "hyperosmolar hyperglycemic state",
    sah: "subarachnoid hemorrhage", ich: "intracerebral hemorrhage", tbi: "traumatic brain injury", cva: "stroke",
    aaa: "abdominal aortic aneurysm", uti: "urinary tract infection", gi: "gastrointestinal", ugib: "upper gastrointestinal bleed",
    lgib: "lower gastrointestinal bleed", ptx: "pneumothorax", dvt: "deep vein thrombosis", afib: "atrial fibrillation",
    svt: "supraventricular tachycardia", vt: "ventricular tachycardia", od: "overdose", ams: "altered mental status",
    nsti: "necrotizing soft tissue infection", nec: "necrotizing", pid: "pelvic inflammatory disease", sbo: "small bowel obstruction",
    rsv: "respiratory syncytial virus", bppv: "benign paroxysmal positional vertigo", hf: "heart failure", ards: "acute respiratory distress syndrome"
  };
  var DX_STOP = { a: 1, an: 1, the: 1, of: 1, with: 1, and: 1, or: 1, in: 1, on: 1, to: 1, from: 1, due: 1, acute: 1, possible: 1, likely: 1, r: 1, o: 1, rule: 1, out: 1, vs: 1, presenting: 1, as: 1, s: 1, p: 1, w: 1 };
  function dxTokens(s) {
    var words = String(s || "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ");
    var out = [];
    words.forEach(function (w) {
      if (!w) return;
      (DX_ABBR[w] || w).split(" ").forEach(function (x) {
        if (x.length > 3 && /s$/.test(x) && !/ss$|is$|us$/.test(x)) x = x.slice(0, -1); // crude singular
        if (!DX_STOP[x] && out.indexOf(x) < 0) out.push(x);
      });
    });
    return out;
  }
  // 2 = strong (one name's words all appear in the other, or ≥60% of the shorter name's words shared), 1 = weak (a shared word), 0 = none.
  function dxStrength(entry, truth) {
    var a = dxTokens(entry), b = dxTokens(truth);
    if (!a.length || !b.length) return 0;
    // words match exactly, or one (≥5 letters) is a prefix of the other: emboli/embolism, infarct/infarction
    function same(x, y) { if (x === y) return true; var s1 = x.length < y.length ? x : y, l1 = s1 === x ? y : x; return s1.length >= 5 && l1.indexOf(s1) === 0; }
    var shared = a.filter(function (x) { return b.some(function (y) { return same(x, y); }); }).length;
    if (!shared) return 0;
    var small = Math.min(a.length, b.length);
    if (shared === small || shared / small >= 0.6) return 2;
    return 1;
  }
  // -> {caught, rank}. Truth names: answerKey.trueDx plus the catalog dx for the case's dxId.
  function matchDdx(ddx, c, modelRank) {
    var truths = [c.answerKey && c.answerKey.trueDx];
    var entry = c.seed && c.seed.dxId && CASES.byId ? CASES.byId(c.seed.dxId) : null;
    if (entry) truths.push(entry.dx);
    if (entry) arr(entry.synonyms || entry.aliases).forEach(function (s) { truths.push(s); });
    truths = truths.filter(Boolean);
    var list = arr(ddx).slice(0, 3);
    var strength = list.map(function (d) { var best = 0; truths.forEach(function (t) { best = Math.max(best, dxStrength(d, t)); }); return best; });
    var strong = strength.indexOf(2);
    if (strong >= 0) return { caught: true, rank: strong + 1 };
    var mr = num(modelRank, NaN);
    if (mr >= 1 && mr <= list.length && strength[mr - 1] === 1) return { caught: true, rank: Math.round(mr) }; // tiebreak
    return { caught: false, rank: null };
  }

  function finalizeGrade(g, enc, crit, answers) {
    var c = enc.case;
    var judged = {};
    arr(g.criticalActions).forEach(function (x) { if (x && x.id) judged[slug(x.id)] = x; });
    var merged = crit.computed.slice();
    crit.toJudge.forEach(function (ca) {
      var j = judged[ca.id];
      merged.push({
        id: ca.id, action: ca.action,
        status: j && ["done", "late", "missed"].indexOf(j.status) >= 0 ? j.status : "missed",
        atMin: j && isFinite(num(j.atMin, NaN)) ? num(j.atMin) : null,
        windowMin: ca.windowMin,
        quote: j && typeof j.quote === "string" ? j.quote : null,
        computed: false
      });
    });
    var m = matchDdx((answers && answers.ddx) || [], c, g.caughtInDdx === false ? null : g.rankOfTrueDx);
    var out = {
      score: clamp(Math.round(num(g.score, 0)), 0, 100),
      caughtInDdx: m.caught,
      rankOfTrueDx: m.rank,
      gestaltCal: GESTALT.indexOf(g.gestaltCal) >= 0 ? g.gestaltCal : "close",
      workup: WORKUP.indexOf(g.workup) >= 0 ? g.workup : "appropriate",
      dispoOk: !!g.dispoOk,
      stabilizationGrade: STAB.indexOf(g.stabilizationGrade) >= 0 ? g.stabilizationGrade : "adequate",
      transferPackagingOk: typeof g.transferPackagingOk === "boolean" ? g.transferPackagingOk : null,
      criticalActions: merged,
      divergences: arr(g.divergences).filter(function (d) { return d && (d.did || d.shouldHave); }).map(function (d) { return { atMin: Math.max(0, num(d.atMin, 0)), did: String(d.did || ""), shouldHave: String(d.shouldHave || "") }; }),
      wins: arr(g.wins).filter(function (s) { return typeof s === "string" && s; }),
      misses: arr(g.misses).filter(function (s) { return typeof s === "string" && s; }),
      carryForward: str(g.carryForward, ""),
      teachingPoint: str(g.teachingPoint, c.answerKey.teachingPoint || ""),
      criticalError: str(g.criticalError, null),
      ruleApplied: g.ruleApplied && typeof g.ruleApplied === "object" && str(g.ruleApplied.text, "")
        ? { text: str(g.ruleApplied.text, ""), followed: typeof g.ruleApplied.followed === "boolean" ? g.ruleApplied.followed : null } : null,
      trueDx: c.answerKey.trueDx,
      trueAcuity: c.answerKey.trueAcuity,
      trueDispo: c.answerKey.trueDispo,
      final: answers
    };
    if (out.criticalError || out.stabilizationGrade === "critical-error") out.score = Math.min(out.score, 40);
    return out;
  }

  // ── Stats, history, miss queue ────────────────────────────────────────────
  var HISTORY_CAP = 500;
  function rawStats() {
    var s = lsJSON("dw_stats", null) || {};
    return { history: arr(s.history), missQueue: arr(s.missQueue), streak: num(s.streak, 0), last: s.last || null };
  }
  function writeStats(s) { return lsSet("dw_stats", JSON.stringify({ history: s.history, missQueue: s.missQueue, streak: s.streak, last: s.last })); }

  function dispoClass(d) {
    if (!d) return null;
    if (/transfer/i.test(d)) return "Transfer";
    if (/admit/i.test(d)) return "Admit";
    if (/discharge/i.test(d)) return "Discharge";
    return null;
  }

  function isShift(e) { return e.mode !== "drill"; }
  function passed(e) { return !!e.caught && !(e.critMissed || []).length; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
  }
  function maeOf(list) {
    var n = 0, sum = 0;
    list.forEach(function (e) { if (e.gutAcuity >= 1 && e.gutAcuity <= 5 && e.trueAcuity >= 1 && e.trueAcuity <= 5) { sum += Math.abs(e.gutAcuity - e.trueAcuity); n++; } });
    return { n: n, mae: n ? Math.round((sum / n) * 100) / 100 : null };
  }
  function avgScore(list) { return list.length ? Math.round(list.reduce(function (x, e) { return x + num(e.score, 0); }, 0) / list.length) : null; }

  // Calibration (the grid, acuity error, gut-vs-final, read speed, confidence) counts Shift cases
  // only: in Drill seven in ten are serious, so "sick" is right by default. Drill reports speed.
  function stats() {
    var s = rawStats();
    var h = s.history.filter(Boolean);
    var byDomain = {};
    CASES.DOMAINS.forEach(function (d) { byDomain[d] = { n: 0, avg: 0 }; });
    var grid = [];
    for (var i = 0; i < 5; i++) grid.push([0, 0, 0, 0, 0]);
    var gvf = { rr: 0, rw: 0, wr: 0, ww: 0 };
    var sums = {}, total = 0;
    var shift = h.filter(isShift), drill = h.filter(function (e) { return !isShift(e); });
    h.forEach(function (e) {
      total += num(e.score, 0);
      if (e.domain) {
        if (!byDomain[e.domain]) byDomain[e.domain] = { n: 0, avg: 0 };
        sums[e.domain] = (sums[e.domain] || 0) + num(e.score, 0);
        byDomain[e.domain].n += 1;
      }
    });
    shift.forEach(function (e) {
      if (e.gutAcuity >= 1 && e.gutAcuity <= 5 && e.trueAcuity >= 1 && e.trueAcuity <= 5) grid[e.gutAcuity - 1][e.trueAcuity - 1] += 1;
      var tc = dispoClass(e.trueDispo);
      if (tc && e.gutDispo && e.finalDispo) {
        var gr = dispoClass(e.gutDispo) === tc;
        var fr = typeof e.dispoOk === "boolean" ? e.dispoOk : dispoClass(e.finalDispo) === tc;
        gvf[(gr ? "r" : "w") + (fr ? "r" : "w")] += 1;
      }
    });
    for (var d in sums) if (has(sums, d)) byDomain[d].avg = Math.round(sums[d] / byDomain[d].n);
    var t = now();
    var mq = s.missQueue.map(function (m) { return assign({}, m, { isDue: m.stage < (m.due || []).length && m.due[m.stage] <= t }); });
    var rules = [];
    for (var ri = h.length - 1; ri >= 0 && rules.length < 10; ri--) {
      if (h[ri].carryForward) rules.push({ caseId: h[ri].caseId, date: h[ri].date, dx: h[ri].dx, rule: h[ri].carryForward });
    }
    // Movement: the last ten Shift cases against the ten before; domains whose second half beat (or lost to) their first.
    var recent = maeOf(shift.slice(-10)), previous = maeOf(shift.slice(-20, -10));
    var moved = [];
    CASES.DOMAINS.forEach(function (dn) {
      var all = h.filter(function (e) { return e.domain === dn; });
      if (all.length < 6) return;
      var half = Math.floor(all.length / 2), a = avgScore(all.slice(0, half)), b = avgScore(all.slice(half));
      if (Math.abs(b - a) >= 8) moved.push({ domain: dn, from: a, to: b, n: all.length });
    });
    var serious = h.filter(function (e) { return e.trueSerious === true || e.bucket === "serious"; });
    var re = h.filter(function (e) { return e.reexposureOf; });
    var reMonth = re.filter(function (e) { return e.date >= t - 30 * DAY; });
    var fast = shift.filter(function (e) { return e.lockSec != null && e.lockSec <= 15; });
    var slow = shift.filter(function (e) { return e.lockSec != null && e.lockSec > 30; });
    var conf = [{ label: "76–100", lo: 76, hi: 100 }, { label: "51–75", lo: 51, hi: 75 }, { label: "0–50", lo: 0, hi: 50 }].map(function (b) {
      var in_ = shift.filter(function (e) { return e.confidence != null && e.confidence >= b.lo && e.confidence <= b.hi && e.ddx && e.ddx.length; });
      return { label: b.label, n: in_.length, right: in_.filter(function (e) { return e.rankOfTrueDx === 1; }).length };
    });
    var drillSerious = drill.filter(function (e) { return (e.trueSerious === true || e.bucket === "serious") && e.firstCritMin != null; });
    return {
      rules: rules,
      cases: h.length,
      history: h,
      streak: s.streak,
      last: s.last,
      avg: h.length ? Math.round(total / h.length) : 0,
      byDomain: byDomain,
      acuityGrid: grid,
      acuityMAE: maeOf(shift).mae,
      calibration: { shiftCases: shift.length, recent: recent, previous: previous },
      movedDomains: moved,
      gutVsFinal: gvf,
      cantMiss: { serious: serious.length, caught: serious.filter(function (e) { return e.caught; }).length },
      reexposures: { total: re.length, caught: re.filter(passed).length, month: reMonth.length, monthCaught: reMonth.filter(passed).length },
      readSpeed: { fast: maeOf(fast), slow: maeOf(slow) },
      confidence: conf,
      drill: { n: drill.length, firstCritMedian: median(drillSerious.map(function (e) { return e.firstCritMin; })), firstCritRecent: median(drillSerious.slice(-5).map(function (e) { return e.firstCritMin; })) },
      benignMedianMin: median(shift.filter(function (e) { return e.trueSerious === false || e.bucket === "benign"; }).map(function (e) { return num(e.simMin, 0); })),
      missQueue: mq,
      missDue: mq.filter(function (m) { return m.isDue; }).length
    };
  }

  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }

  function recordResult(enc, g, extras) {
    extras = extras || {};
    var c = enc.case;
    var seed = c.seed || {};
    var final = assign({}, g.final || {}, extras);
    var crits = g.criticalActions || [];
    var critMissed = crits.filter(function (x) { return x.status === "missed"; }).map(function (x) { return x.id; });
    var critLate = crits.filter(function (x) { return x.status === "late"; }).map(function (x) { return x.id; });
    var firstCrit = null;
    crits.forEach(function (x) { if (x.status !== "missed" && x.atMin !== null && x.atMin !== undefined && (firstCrit === null || x.atMin < firstCrit)) firstCrit = x.atMin; });
    var t = now();
    var entry = {
      caseId: seed.caseId || c.id, date: t, dxId: seed.dxId, dx: seed.dx || c.answerKey.trueDx, domain: seed.domain, bucket: seed.bucket,
      presentation: seed.presentation, ageBand: seed.ageBand,
      reexposureOf: seed.reexposure ? seed.reexposure.originalCaseId : null,
      gutSick: enc.gut ? enc.gut.sick : null, gutAcuity: enc.gut ? enc.gut.acuity : null, gutTimedOut: enc.gut ? !!enc.gut.timedOut : false,
      lockSec: enc.gut && isFinite(num(enc.gut.elapsedSec, NaN)) ? num(enc.gut.elapsedSec) : null,
      trueSerious: seed.bucket ? seed.bucket === "serious" : null, simMin: enc.simMin || 0,
      mode: seed.mode === "drill" ? "drill" : "shift",
      ruleApplied: g.ruleApplied || null,
      trueAcuity: c.answerKey.trueAcuity, gutDispo: enc.gut ? enc.gut.gutDispo : null,
      finalDispo: final.finalDispo || null, trueDispo: c.answerKey.trueDispo, dispoOk: !!g.dispoOk,
      ddx: final.ddx || [], confidence: final.confidence === undefined ? null : final.confidence,
      caught: !!g.caughtInDdx, rankOfTrueDx: g.rankOfTrueDx === undefined ? null : g.rankOfTrueDx,
      score: g.score, critMissed: critMissed, critLate: critLate, firstCritMin: firstCrit,
      carryForward: str(g.carryForward, ""),
      reflection: extras.reflection || "", flagged: false, flagNote: ""
    };
    var s = rawStats();
    s.history = s.history.concat([entry]).slice(-HISTORY_CAP);

    // streak by calendar day
    var today = dayKey(t), yday = dayKey(t - DAY);
    s.streak = s.last === today ? Math.max(1, s.streak) : s.last === yday ? s.streak + 1 : 1;
    s.last = today;

    // miss queue
    var failed = !entry.caught || critMissed.length > 0;
    var dueFrom = function (base) { return [base + 3 * DAY, base + 14 * DAY, base + 42 * DAY]; };
    var mq = s.missQueue.slice();
    if (seed.reexposure) {
      var idx = -1;
      mq.forEach(function (m, i) { if (m.originalCaseId === seed.reexposure.originalCaseId) idx = i; });
      if (idx >= 0) {
        var item = assign({}, mq[idx]);
        if (failed) { item.stage = 0; item.due = dueFrom(t); }
        else item.stage += 1;
        if (item.stage >= 3) mq.splice(idx, 1); else mq[idx] = item;
      } else if (failed) {
        mq.push({ dxId: seed.dxId, dx: entry.dx, domain: entry.domain, originalCaseId: entry.caseId, presentation: entry.presentation, ageBand: entry.ageBand, due: dueFrom(t), stage: 0 });
      }
    } else if (failed && seed.dxId) {
      var ex = -1;
      mq.forEach(function (m, i) { if (m.dxId === seed.dxId) ex = i; });
      var fresh = { dxId: seed.dxId, dx: entry.dx, domain: entry.domain, originalCaseId: entry.caseId, presentation: entry.presentation, ageBand: entry.ageBand, due: dueFrom(t), stage: 0 };
      if (ex >= 0) mq[ex] = fresh; else mq.push(fresh);
    }
    s.missQueue = mq;
    writeStats(s);
    storeResult(enc, g, final);
    var fid = encCaseId(enc);
    if (fid) finishedIds[fid] = true;
    if (encCaseId(loadActive()) === fid) clearActive(); // never clear a newer case's encounter
    return stats();
  }

  // ── Full results for the recent-cases debrief (separate from the 500-entry history) ──
  var RESULTS_KEY = "dw_results", RESULTS_CAP = 30;
  function slimEnc(enc) {
    var c = enc.case || {};
    return {
      case: { id: c.id, seed: c.seed, persona: c.persona, physicality: c.physicality, vitals0: c.vitals0, answerKey: c.answerKey,
        interventions: (c.interventions || []).map(function (iv) { return { id: iv.id, label: iv.label }; }) },
      simMin: enc.simMin || 0, gut: enc.gut || null, log: enc.log || [], applied: enc.applied || [],
      vitalsHistory: enc.vitalsHistory || [], physicality: enc.physicality || null, transport: enc.transport || null,
      receivingCalls: enc.receivingCalls || 0, accepted: !!enc.accepted, startedAt: enc.startedAt || null
    };
  }
  function readResults() { return arr(lsJSON(RESULTS_KEY, [])).filter(function (r) { return r && r.caseId; }); }
  // Writes the list, dropping the oldest results until it fits (never touches dw_next or other keys).
  function writeResults(list) {
    var s = ls();
    if (!s) return false;
    list = list.slice(-RESULTS_CAP);
    while (true) {
      try { s.setItem(RESULTS_KEY, JSON.stringify(list)); return true; } catch (e) {
        if (!list.length) { try { s.removeItem(RESULTS_KEY); } catch (e2) { /* ignore */ } return false; }
        list = list.slice(1);
      }
    }
  }
  function storeResult(enc, g, answers) {
    var c = enc.case || {};
    var caseId = (c.seed && c.seed.caseId) || c.id;
    if (!caseId) return false;
    var list = readResults().filter(function (r) { return r.caseId !== caseId; });
    var gs = assign({}, g);
    delete gs.encAfter;
    list.push({ caseId: caseId, savedAt: now(), enc: slimEnc(enc), grade: gs, answers: answers || {} });
    return writeResults(list);
  }
  function historyEntry(caseId) {
    var h = rawStats().history, found = null;
    h.forEach(function (e) { if (e && e.caseId === caseId) found = e; });
    return found;
  }
  // -> {enc, grade, answers, entry} for one of the last ~30 cases, or null.
  function getResult(caseId) {
    var hit = null;
    readResults().forEach(function (r) { if (r.caseId === caseId) hit = r; });
    if (!hit || !hit.enc || !hit.grade) return null;
    return { caseId: caseId, enc: hit.enc, grade: hit.grade, answers: hit.answers || {}, entry: historyEntry(caseId) };
  }
  function saveReflection(caseId, text) {
    var s = rawStats();
    var idx = -1;
    s.history.forEach(function (e, i) { if (e && e.caseId === caseId) idx = i; });
    if (idx < 0) return false;
    s.history[idx] = assign({}, s.history[idx], { reflection: String(text || "") });
    return writeStats(s);
  }

  function flagGrade(caseId, note) {
    var s = rawStats();
    var found = false;
    s.history = s.history.map(function (e) {
      if (e && e.caseId === caseId) { found = true; return assign({}, e, { flagged: true, flagNote: String(note || "") }); }
      return e;
    });
    if (found) writeStats(s);
    return found;
  }

  // ── Export / import ───────────────────────────────────────────────────────
  function exportData() {
    var data = {};
    lsKeys().forEach(function (k) {
      if (k.indexOf("dw_") !== 0) return;
      var v = lsGet(k);
      if (k === "dw_settings") {
        try { var o = JSON.parse(v); if (o) { o.apiKey = ""; v = JSON.stringify(o); } } catch (e) { /* keep raw */ }
      }
      data[k] = v;
    });
    return JSON.stringify({ app: "the-doorway", version: 3, exportedAt: new Date().toISOString(), data: data });
  }
  function importData(json) {
    var parsed;
    try { parsed = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { return { ok: false, count: 0, error: "That file isn't valid JSON." }; }
    if (!parsed || typeof parsed !== "object") return { ok: false, count: 0, error: "Nothing to import." };
    var data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    var count = 0, failed = 0;
    for (var k in data) {
      if (!has(data, k) || k.indexOf("dw_") !== 0) continue;
      var v = data[k];
      if (typeof v !== "string") v = JSON.stringify(v);
      if (k === "dw_settings") {
        // keep the key already stored on this device
        try { var inc = JSON.parse(v), cur = settings.get(); inc.apiKey = cur.apiKey; v = JSON.stringify(inc); } catch (e) { /* raw */ }
      }
      if (lsSet(k, v)) count++; else failed++;
    }
    if (!count) return { ok: false, count: 0, error: failed ? "Storage is full or blocked." : "No Doorway data found in that file." };
    return { ok: failed === 0, count: count };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.DW = {
    MODEL: MODEL,
    CHIPS: CHIPS,
    DISPOS: DISPOS,
    NORMALS: NORMALS,
    chipCost: chipCost,
    newCase: newCase,
    prefetch: prefetch,
    takePrefetched: takePrefetched,
    startEncounter: startEncounter,
    vitalsAt: vitalsAt,
    lockGut: lockGut,
    act: act,
    saveActive: saveActive,
    loadActive: loadActive,
    clearActive: clearActive,
    grade: grade,
    recordResult: recordResult,
    flagGrade: flagGrade,
    saveReflection: saveReflection,
    getResult: getResult,
    findHistory: historyEntry,
    hasPrefetched: hasPrefetched,
    stats: stats,
    exportData: exportData,
    importData: importData,
    settings: settings,
    // internals for tests and fixtures — not part of the UI contract
    _: {
      CONFIG: CONFIG, CASE_SYSTEM: CASE_SYSTEM, RESULTS_SYSTEM: RESULTS_SYSTEM, TURN_SYSTEM: TURN_SYSTEM, GRADE_SYSTEM: GRADE_SYSTEM, REVIEW_SYSTEM: REVIEW_SYSTEM,
      SCHEMAS: SCHEMAS, sysBlocks: sysBlocks, buildTurnPrompt: buildTurnPrompt, transcriptText: transcriptText,
      FALLBACK: FALLBACK, extractJSON: extractJSON, normalizeCase: normalizeCase, normalizeCaseA: normalizeCaseA,
      computeCritical: computeCritical, finalizeGrade: finalizeGrade, matchDdx: matchDdx, dxTokens: dxTokens, deteriorationEvents: deteriorationEvents,
      callClaude: callClaude, generateCase: generateCase, reviewCase: reviewCase, resetInflight: function () { inflight = null; }
    }
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
