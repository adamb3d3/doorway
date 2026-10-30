/* Test-only fixtures: schema-valid fake model output for any seed.
 * Defines window.DW_FIXTURES. Not shipped by index.html.
 * Usage (Playwright route stub or Node): DW_FIXTURES.respond(kind, requestBody) → Anthropic-shaped
 * response JSON ({content:[{type:"text",text}]}) for X-DW-Kind case|results|turn|grade.
 */
(function (root) {
  "use strict";

  var FALLBACK_CHIPS = {
    History: ["When did this start?", "Describe the pain", "Associated symptoms?", "PMH/PSH?", "Medications?", "Allergies?", "Social history?", "Family history?", "Obstetric history?"],
    Exam: ["General appearance", "Auscultate lungs", "Auscultate heart", "Palpate abdomen", "Extremities", "Neuro exam", "HEENT", "Skin exam", "Pelvic exam", "Rectal exam"],
    Labs: ["CBC+BMP", "Troponin", "Lactate", "D-dimer", "VBG/ABG", "Coags/INR", "UA", "Blood cultures", "LFTs", "Lipase", "Tox screen", "Beta-HCG", "Type & screen"],
    Imaging: ["ECG", "CXR", "CT head", "CT chest/PE", "CT abd/pelvis", "Bedside FAST", "POCUS cardiac", "POCUS lung", "CT angio", "X-ray extremity"]
  };
  function chips() { return (root.DW && root.DW.CHIPS) || FALLBACK_CHIPS; }

  function seedObj(seed) {
    if (seed && typeof seed === "object") return seed;
    var n = typeof seed === "number" ? seed : 1;
    if (root.DW_CASES) return root.DW_CASES.pickCase({}, { seed: n, mode: "shift" });
    return { caseId: "fixture-" + n, dxId: "septic_shock_nh", dx: "Septic shock", domain: "Resuscitation", bucket: "serious", presentation: "typical",
      ageBand: "adult", age: 58, sex: "F", ethnicity: "White", fitz: 2, conditions: { hour: 2, minute: 40, ctAvailable: false, ctOnCall: true, flight: "available", groundEta: 75, obNegUnits: 2, tertiaryDiversion: false, nurseCount: 1 }, reexposure: null, transferTwist: null };
  }

  function baseVitals(band) {
    if (band === "infant") return { HR: 150, SBP: 85, DBP: 50, RR: 40, SpO2: 97, Temp: 99.5, GCS: 15 };
    if (band === "child") return { HR: 110, SBP: 100, DBP: 62, RR: 24, SpO2: 98, Temp: 99.1, GCS: 15 };
    return { HR: 104, SBP: 104, DBP: 64, RR: 22, SpO2: 95, Temp: 100.9, GCS: 15 };
  }

  function fakeCaseA(seed) {
    var s = seedObj(seed);
    var v0 = baseVitals(s.ageBand);
    var serious = s.bucket === "serious";
    function at(t, d) {
      var o = { t: t };
      for (var k in v0) o[k] = v0[k] + (serious ? (d[k] || 0) : 0);
      return o;
    }
    var history = {};
    chips().History.forEach(function (l) { history[l] = "Fixture answer to '" + l + "'."; });
    return {
      persona: {
        name: s.sex === "F" ? "Dana Fixture" : "Dale Fixture", age: s.age, sex: s.sex, ethnicity: s.ethnicity, occupation: "farmer",
        chiefComplaint: "Feeling weak and short of breath", arrivalMode: "private vehicle", emsHandoff: null,
        doorwayImpression: "Pale and quiet in the wheelchair, breathing a little fast. Answers slowly.",
        voice: "Understated, apologetic, minimizes.",
        facts: "Two days of fever and cough. PMH diabetes, hypertension. Meds metformin, lisinopril. NKDA. Lives on a farm with spouse."
      },
      physicality: { fitz: s.fitz, hair: "#5a4a3d", rrRate: v0.RR, pallor: 1, diaphoresis: 1, cyanosis: 0, jaundice: 0, guarding: 0, eyeState: "open", positioning: "sitting", distressLevel: serious ? 2 : 0, age: s.age, habitus: "average", rashNote: null },
      vitals0: v0,
      trajectory: [at(0, {}), at(15, { HR: 6, SBP: -6, DBP: -4 }), at(30, { HR: 12, SBP: -14, DBP: -8, SpO2: -2 }), at(60, { HR: 22, SBP: -26, DBP: -16, SpO2: -4, RR: 6 }), at(120, { HR: 30, SBP: -36, DBP: -22, SpO2: -6, RR: 10, GCS: -2 })],
      interventions: [
        { id: "fluids", label: "30 mL/kg crystalloid", chips: ["IV access + fluids"], mode: "delta", effect: { SBP: 15, DBP: 8, HR: -12 }, onsetMin: 10, critical: true, windowMin: 30, maxApplications: 1, response: "Two large-bore IVs; LR running wide open." },
        { id: "abx", label: "Broad-spectrum antibiotics", chips: ["Broad-spectrum antibiotics"], mode: "delta", effect: {}, onsetMin: 30, critical: true, windowMin: 60, maxApplications: 1, response: "Pip-tazo and vancomycin hung." },
        { id: "norepi", label: "Norepinephrine infusion", chips: ["Norepinephrine", "Start pressors"], mode: "delta", effect: { SBP: 20, DBP: 10 }, onsetMin: 5, critical: false, windowMin: 60, maxApplications: 1, response: "Norepinephrine started peripherally at 0.05 mcg/kg/min." },
        { id: "rsi_early", label: "RSI before resuscitation", chips: ["RSI/intubate"], mode: "delta", effect: { SBP: -25, DBP: -12 }, onsetMin: 2, durationMin: 20, critical: false, windowMin: 0, maxApplications: 1, response: "Tube through the cords; pressure sags after induction." }
      ],
      history: history,
      answerKey: {
        trueDx: s.dx, trueAcuity: serious ? 2 : 4, trueDispo: serious ? "Emergent transfer" : "Discharge w/ f/u",
        cantMiss: [s.dx],
        criticalActions: [
          { id: "fluids", action: "30 mL/kg crystalloid", windowMin: 30 },
          { id: "abx", action: "Broad-spectrum antibiotics", windowMin: 60 },
          { id: "call_receiving", action: "Call receiving facility early", windowMin: 45 }
        ],
        idealSequence: [{ atMin: 0, action: "IV, fluids, cultures" }, { atMin: 10, action: "Antibiotics" }, { atMin: 20, action: "Call receiving facility" }],
        transferPackaging: serious ? "Two IVs, fluids in, pressor ready, antibiotics given, records sent." : null,
        teachingPoint: "Fixture teaching point.", ruralTwist: "Fixture rural twist."
      }
    };
  }

  function fakeResults(seed) {
    var s = seedObj(seed);
    var out = {};
    var c = chips();
    ["Exam", "Labs", "Imaging"].forEach(function (g) {
      c[g].forEach(function (l) { out[l] = "Fixture " + l + " result at time 0 for " + s.ageBand + "."; });
    });
    out["Lactate"] = "Lactate 4.6 mmol/L";
    out["CBC+BMP"] = "WBC 18.2, Hgb 12.1, plt 210; Na 134, K 4.1, Cr 1.6, glucose 212";
    return { results: out };
  }

  function fakeCase(seed) {
    var a = fakeCaseA(seed);
    a.results = fakeResults(seed).results;
    return a;
  }

  function fakeTurn() {
    return { responses: [{ kind: "clinical", text: "Fixture reply.", mono: false, obs: null }], interventionsApplied: [], timeCostMin: 2, physicality: null };
  }

  function fakeGrade(score) {
    return {
      score: score === undefined ? 78 : score, caughtInDdx: true, rankOfTrueDx: 1, gestaltCal: "close", workup: "appropriate", dispoOk: true,
      stabilizationGrade: "adequate", transferPackagingOk: true,
      criticalActions: [{ id: "call_receiving", action: "Call receiving facility early", status: "done", atMin: 20, windowMin: 45, quote: "Call receiving facility" }],
      divergences: [{ atMin: 12, did: "Ordered CT first", shouldHave: "Fluids first" }],
      wins: ["Early fluids"], misses: ["Late antibiotics"], carryForward: "Hang antibiotics before imaging in septic shock.",
      teachingPoint: "Fixture teaching point.", criticalError: null
    };
  }

  function parseSeedFromBody(body) {
    try {
      var b = typeof body === "string" ? JSON.parse(body) : body;
      var txt = b.messages[0].content;
      var i = txt.indexOf("SEED:\n");
      if (i < 0) return null;
      var rest = txt.slice(i + 6);
      var end = rest.indexOf("\n\n");
      return JSON.parse(end >= 0 ? rest.slice(0, end) : rest);
    } catch (e) { return null; }
  }

  function wrap(obj) { return { id: "msg_fixture", type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify(obj) }] }; }

  function respond(kind, body) {
    var seed = parseSeedFromBody(body) || 1;
    if (kind === "case") return wrap(fakeCaseA(seed));
    if (kind === "results") return wrap(fakeResults(seed));
    if (kind === "grade") return wrap(fakeGrade());
    return wrap(fakeTurn());
  }

  root.DW_FIXTURES = {
    fakeCase: fakeCase, fakeCaseA: fakeCaseA, fakeResults: fakeResults, fakeTurn: fakeTurn, fakeGrade: fakeGrade,
    respond: respond, wrap: wrap, parseSeedFromBody: parseSeedFromBody
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
