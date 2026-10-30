// Fake Anthropic API for offline tests.
//
//   const { fakeResponse } = require("./stub");
//   fakeResponse("case", requestBody) -> Anthropic Messages API response object
//
// Kinds (X-DW-Kind): "case" (call A), "results" (call B), "turn", "grade".
// If test/fixtures.js exists and defines window.DW_FIXTURES, its entries win.
// Each DW_FIXTURES[kind] may be:
//   - a plain object/array: the JSON the model should "write" (stringified into content[0].text)
//   - a string: used verbatim as the model's text
//   - a function (body) -> either of the above
//   - an array of the above under DW_FIXTURES[kind + "List"]: served in rotation
//   - a full Messages response ({content:[...]}) : returned unchanged
// Without fixtures, the minimal defaults below are used. They follow SPEC.md
// schemas (generated case, results, turn, grade) and the v2 chip labels.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MODEL = "claude-sonnet-5-5";

function loadFixtures() {
  const file = path.join(__dirname, "fixtures.js");
  if (!fs.existsSync(file)) return null;
  try {
    const sandbox = { window: {}, console };
    sandbox.self = sandbox.window;
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
    return sandbox.window.DW_FIXTURES || sandbox.DW_FIXTURES || null;
  } catch (e) {
    console.warn("[stub] fixtures.js failed to load, using defaults:", e.message);
    return null;
  }
}

const HISTORY = {
  "When did this start?": "Since yesterday afternoon. Got worse overnight.",
  "Describe the pain": "Burning when I pee, and now my back hurts on the right.",
  "Associated symptoms?": "Chills, threw up twice. I feel weak.",
  "PMH/PSH?": "Diabetes. Gallbladder out years ago.",
  "Medications?": "Metformin. Lisinopril.",
  "Allergies?": "Sulfa. Rash.",
  "Social history?": "Retired from the grain elevator. No smoking. A beer on Sundays.",
  "Family history?": "Mom had sugar too.",
  "Obstetric history?": "Not applicable."
};

const RESULTS = {
  "General appearance": "Ill-appearing, flushed, mottled knees.",
  "Auscultate lungs": "Clear bilaterally.",
  "Auscultate heart": "Tachycardic, regular, no murmur.",
  "Palpate abdomen": "Soft, mild suprapubic tenderness.",
  "Extremities": "Warm hands, mottled knees, cap refill 4 s.",
  "Neuro exam": "Oriented x3, slow to answer, no focal deficit.",
  "HEENT": "Dry mucous membranes.",
  "Skin exam": "No rash. Mottling at knees.",
  "Pelvic exam": "Deferred.",
  "Rectal exam": "Deferred.",
  "CBC+BMP": "WBC 19.4, Hgb 13.1, Plt 142; Na 133, K 4.9, Cr 2.1, HCO3 17, glucose 312.",
  "Troponin": "0.02 ng/mL (normal).",
  "Lactate": "4.6 mmol/L.",
  "D-dimer": "Not indicated; 0.9 mcg/mL FEU.",
  "VBG/ABG": "pH 7.29, pCO2 30, HCO3 15.",
  "Coags/INR": "INR 1.3.",
  "UA": "Large leukocyte esterase, nitrite positive, >50 WBC.",
  "Blood cultures": "Drawn x2, pending.",
  "LFTs": "Mildly elevated alk phos 160.",
  "Lipase": "32 U/L (normal).",
  "Tox screen": "Negative.",
  "Beta-HCG": "Not applicable.",
  "Type & screen": "O positive, antibody screen negative.",
  "ECG": "Sinus tachycardia 124, no ST changes.",
  "CXR": "No infiltrate.",
  "CT head": "No acute findings.",
  "CT chest/PE": "No PE.",
  "CT abd/pelvis": "Right perinephric stranding, no obstructing stone.",
  "Bedside FAST": "No free fluid.",
  "POCUS cardiac": "Hyperdynamic LV, no effusion, IVC flat.",
  "POCUS lung": "A-lines bilaterally.",
  "CT angio": "No dissection.",
  "X-ray extremity": "Not indicated."
};

// ── Reading the engine's request bodies ─────────────────────────────────────
// The stub answers from what the engine actually sent, so the fake model stays
// consistent with the seed, the orders and the final answers.
function userText(body) {
  try { const m = body && body.messages && body.messages[0]; return typeof m.content === "string" ? m.content : ""; } catch (e) { return ""; }
}
function seedOf(body) {
  const t = userText(body);
  const i = t.indexOf("SEED:\n");
  if (i < 0) return null;
  const rest = t.slice(i + 6);
  const end = rest.indexOf("\n\n");
  try { return JSON.parse(end >= 0 ? rest.slice(0, end) : rest); } catch (e) { return null; }
}
// One-line "LABEL: <json>" sections of the grade / turn prompts.
function section(body, label) {
  const t = userText(body);
  const re = new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*?: ([\\[{].*)$", "m");
  const m = t.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dispoFamily = (d) => !d ? null : /transfer/i.test(d) ? "Transfer" : /admit/i.test(d) ? "Admit" : "Discharge";

// Acuity is ESI: 1 = resuscitation (sickest) … 5 = non-urgent.
function defaultCase(body) {
  const seed = seedOf(body) || {};
  const serious = seed.bucket ? seed.bucket === "serious" : true;
  return {
    persona: {
      name: seed.sex === "M" ? "Walter Vandermeer" : "Ruth Vandermeer", age: seed.age != null ? seed.age : 71, sex: seed.sex || "F",
      ethnicity: seed.ethnicity || "White", occupation: "Retired bookkeeper",
      chiefComplaint: "Weak and feverish", arrivalMode: "private vehicle", emsHandoff: null,
      doorwayImpression: "Flushed, slumped in a wheelchair, answering slowly. A lace of mottling shows at the knees.",
      voice: "Plain-spoken, minimizes, apologises for the trouble.",
      facts: "Dysuria for 2 days, right flank pain since yesterday, chills, vomiting x2. PMH diabetes, cholecystectomy. Meds metformin, lisinopril. Allergy sulfa (rash)."
    },
    physicality: {
      fitz: seed.fitz || 2, hair: "#b9b4ab", rrRate: 26, pallor: 1, diaphoresis: 0, cyanosis: 0, jaundice: 0, guarding: 1,
      eyeState: "half", positioning: "sitting", distressLevel: 2, age: seed.age != null ? seed.age : 71, habitus: "average", rashNote: null
    },
    vitals0: { HR: 124, SBP: 88, DBP: 50, RR: 26, SpO2: 95, Temp: 102.4, GCS: 14 },
    trajectory: [
      { t: 0, HR: 124, SBP: 88, DBP: 50, RR: 26, SpO2: 95, Temp: 102.4, GCS: 14 },
      { t: 15, HR: 128, SBP: 84, DBP: 48, RR: 27, SpO2: 95, Temp: 102.6, GCS: 14 },
      { t: 30, HR: 132, SBP: 80, DBP: 45, RR: 28, SpO2: 94, Temp: 102.8, GCS: 13 },
      { t: 60, HR: 138, SBP: 74, DBP: 40, RR: 30, SpO2: 93, Temp: 103.0, GCS: 12 },
      { t: 120, HR: 145, SBP: 66, DBP: 36, RR: 32, SpO2: 91, Temp: 103.1, GCS: 10 }
    ],
    interventions: [
      { id: "fluids", label: "30 mL/kg crystalloid", chips: ["IV access + fluids"], mode: "delta",
        effect: { SBP: 12, DBP: 6, HR: -10 }, onsetMin: 10, critical: true, windowMin: 30, response: "Two large-bore IVs; LR running wide open." },
      { id: "abx", label: "Broad-spectrum antibiotics", chips: ["Broad-spectrum antibiotics"], mode: "arrest",
        effect: { HR: -4 }, onsetMin: 30, critical: true, windowMin: 60 },
      { id: "pressors", label: "Norepinephrine", chips: ["Norepinephrine", "Start pressors"], mode: "delta",
        effect: { SBP: 18, DBP: 10 }, onsetMin: 5, critical: false, windowMin: 90 }
    ],
    history: HISTORY,
    answerKey: {
      trueDx: seed.dx || "Urosepsis with septic shock", trueAcuity: serious ? 1 : 4,
      trueDispo: serious ? "Transfer" : "Discharge w/ f/u",
      cantMiss: [seed.dx || "Septic shock"],
      criticalActions: [
        { id: "fluids", action: "30 mL/kg crystalloid", windowMin: 30 },
        { id: "abx", action: "Broad-spectrum antibiotics", windowMin: 60 },
        { id: "call_receiving", action: "Call receiving facility", windowMin: 45 }
      ],
      idealSequence: [
        { atMin: 0, action: "IV access + fluids" }, { atMin: 5, action: "Lactate, cultures" },
        { atMin: 15, action: "Broad-spectrum antibiotics" }, { atMin: 30, action: "Call receiving facility" }
      ],
      transferPackaging: serious ? "Two large-bore IVs, pressor running if MAP <65 after fluids, cultures sent with patient." : null,
      teachingPoint: "Mottled knees and a lactate over 4 mean shock even before the BP drops further.",
      ruralTwist: "No ICU: the transfer call starts once the fluids are running, not after the CT."
    }
  };
}

function defaultResults() { return { results: RESULTS }; }

// Answers what was asked; applies an intervention only when his words name it.
function defaultTurn(body) {
  const t = userText(body);
  const ivs = section(body, "INTERVENTIONS") || [];
  const nowIdx = t.indexOf("NOW:\n");
  const now = nowIdx >= 0 ? t.slice(nowIdx + 5) : "";
  const said = (now.match(/He says\/types: "([^"]*)"/) || [])[1] || "";
  const ordered = (now.match(/Ordered via buttons: (.*)/) || [])[1] || "";
  const lower = norm(said);
  const applied = ivs.filter((iv) => {
    const words = norm(iv.label).split(" ").filter((w) => w.length > 5);
    return words.length && words.some((w) => lower.includes(w));
  }).map((iv) => iv.id);
  const responses = [];
  if (said) responses.push({ kind: "patient", text: "I just feel so tired. Is something wrong?", mono: false, obs: null });
  if (ordered) responses.push({ kind: "clinical", text: "Nurse: done — " + ordered.replace(/\w+ → /g, ""), mono: true, obs: null });
  if (applied.length) responses.push({ kind: "clinical", text: "Nurse: " + applied.map((id) => (ivs.find((x) => x.id === id) || {}).label).join(", ") + " started.", mono: false, obs: "She is sweating through the gown now." });
  if (!responses.length) responses.push({ kind: "clinical", text: "Nurse: noted.", mono: false, obs: null });
  return {
    responses, interventionsApplied: applied, timeCostMin: 5,
    physicality: applied.length ? { diaphoresis: 3, distressLevel: 3 } : null
  };
}

// Derived from the request: answer key vs his final answers and transcript.
function defaultGrade(body) {
  const ak = section(body, "ANSWER KEY") || {};
  const fin = section(body, "FINAL ANSWERS") || {};
  const gut = section(body, "LOCKED DOORWAY GUT") || {};
  const toJudge = section(body, "TO_JUDGE") || [];
  const t = userText(body);
  const transcript = t.slice(t.indexOf("TRANSCRIPT:"), t.indexOf("FINAL ANSWERS:"));
  const simEnd = Number((t.match(/FINAL SIM MINUTE: T\+(\d+)/) || [])[1] || 0);
  const truth = norm(ak.trueDx);
  const ddx = (fin.ddx || []).map(norm);
  const idx = ddx.findIndex((d) => d && truth && (truth.includes(d) || d.includes(truth)));
  const caught = idx >= 0;
  const rank = caught ? idx + 1 : null;
  const dispoOk = !!fin.finalDispo && dispoFamily(fin.finalDispo) === dispoFamily(ak.trueDispo);
  const diff = gut.acuity != null && ak.trueAcuity != null ? gut.acuity - ak.trueAcuity : null;
  const gestaltCal = diff === null ? "close" : diff === 0 ? "spot-on" : Math.abs(diff) === 1 ? "close" : diff < 0 ? "over" : "under"; // ESI: lower = sicker
  const criticalActions = toJudge.map((ca) => {
    const re = new RegExp("\\[T\\+(\\d+)\\] DOC: [^\\n]*" + String(ca.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const m = transcript.match(re);
    const atMin = m ? Number(m[1]) : null;
    return { id: ca.id, action: ca.action, status: atMin === null ? "missed" : atMin <= ca.windowMin ? "done" : "late", atMin, windowMin: ca.windowMin, quote: m ? ca.action : null };
  });
  const score = Math.max(0, Math.min(100, 40 + (caught ? (rank === 1 ? 30 : 18) : 0) + (dispoOk ? 15 : 0) + (gestaltCal === "spot-on" ? 10 : gestaltCal === "close" ? 5 : 0)
    - 8 * criticalActions.filter((c) => c.status === "missed").length));
  return {
    score, caughtInDdx: caught, rankOfTrueDx: rank, gestaltCal, workup: "appropriate",
    dispoOk, stabilizationGrade: "adequate", transferPackagingOk: /transfer/i.test(fin.finalDispo || "") ? !!(fin.transferChecklist && fin.transferChecklist.receivingCall) : null,
    criticalActions,
    divergences: [{ atMin: Math.min(5, simEnd), did: "Took a history first", shouldHave: "Started fluids at the door" }],
    wins: caught ? ["Had " + ak.trueDx + " in the differential"] : [],
    misses: caught ? [] : [ak.trueDx + " was not in the differential"],
    carryForward: "Mottling plus hypotension: fluids and antibiotics before the history.",
    teachingPoint: ak.teachingPoint || "Septic shock in the elderly can look like fatigue.",
    criticalError: null
  };
}

const DEFAULTS = { case: defaultCase, results: defaultResults, turn: defaultTurn, grade: defaultGrade };
const counters = {};

function wrap(text) {
  return {
    id: "msg_stub_" + Math.random().toString(36).slice(2, 10),
    type: "message", role: "assistant", model: MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  };
}

function toResponse(value) {
  if (value && typeof value === "object" && Array.isArray(value.content)) return value; // already a Messages response
  return wrap(typeof value === "string" ? value : JSON.stringify(value));
}

function fakeResponse(kind, body) {
  const k = String(kind || "").toLowerCase();
  const fx = loadFixtures();
  if (fx) {
    const list = fx[k + "List"];
    if (Array.isArray(list) && list.length) {
      const i = counters[k] = ((counters[k] === undefined ? -1 : counters[k]) + 1);
      const item = list[i % list.length];
      return toResponse(typeof item === "function" ? item(body) : item);
    }
    if (fx[k] !== undefined) {
      const v = fx[k];
      return toResponse(typeof v === "function" ? v(body) : v);
    }
  }
  const def = DEFAULTS[k];
  if (!def) throw new Error("[stub] unknown X-DW-Kind: " + kind);
  return toResponse(def(body));
}

module.exports = { fakeResponse, DEFAULTS, MODEL, seedOf, section };
