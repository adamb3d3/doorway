/* Node test for cases.js + engine.js. Run: node test/engine.test.js */
"use strict";
var assert = require("assert");
var path = require("path");

// ── Shims ───────────────────────────────────────────────────────────────────
global.window = globalThis;
function makeStorage() {
  var m = new Map();
  return {
    quotaBytes: Infinity,
    get length() { return m.size; },
    key: function (i) { return Array.from(m.keys())[i] || null; },
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) {
      var size = 0; m.forEach(function (val, key) { if (key !== k) size += val.length; });
      if (size + String(v).length > this.quotaBytes) { var e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      m.set(k, String(v));
    },
    removeItem: function (k) { m.delete(k); },
    clear: function () { m.clear(); }
  };
}
global.localStorage = makeStorage();

var calls = [];
var overrides = []; // queue of functions (kind, body) -> {status, body} | undefined
global.fetch = function (url, opts) {
  var kind = opts.headers["X-DW-Kind"];
  var body = JSON.parse(opts.body);
  calls.push({ url: url, kind: kind, headers: opts.headers, body: body });
  var o = overrides.length ? overrides.shift()(kind, body) : null;
  var status = o ? o.status : 200;
  var payload = o ? o.body : DW_FIXTURES.respond(kind, body);
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(JSON.stringify(payload)); } });
};

require(path.join(__dirname, "..", "cases.js"));
require(path.join(__dirname, "..", "engine.js"));
require(path.join(__dirname, "fixtures.js"));
var C = global.DW_CASES, DW = global.DW, FX = global.DW_FIXTURES;
DW._.CONFIG.backoffMs = 0;

// ── Harness ─────────────────────────────────────────────────────────────────
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function reset() { localStorage.clear(); calls = []; overrides = []; DW._.resetInflight(); }

// A normalized case for a seed with optional tweaks.
function makeCase(seedOpts, tweak) {
  var seed = C.pickCase({}, { seed: (seedOpts && seedOpts.seed) || 42 });
  if (seedOpts) for (var k in seedOpts) if (k !== "seed") seed[k] = seedOpts[k];
  var raw = FX.fakeCase(seed);
  if (tweak) tweak(raw, seed);
  var c = DW._.normalizeCase(raw, seed);
  c.seed = seed; c.id = seed.caseId; c.startedAt = Date.now();
  return c;
}
var DAY_COND = { hour: 10, minute: 0, ctAvailable: true, ctOnCall: false, flight: "available", groundEta: 75, obNegUnits: 2, tertiaryDiversion: false, nurseCount: 2 };
function cond(patch) { return Object.assign({}, DAY_COND, patch || {}); }
function readyEnc(c) { return DW.lockGut(DW.startEncounter(c), { sick: true, acuity: 2, gutDispo: "Transfer" }); }

// ── Selection ───────────────────────────────────────────────────────────────
test("catalog integrity: ids unique, lookalikes resolve, domains exact", function () {
  var ids = {};
  C.CATALOG.forEach(function (e) { assert(!ids[e.id], "dup " + e.id); ids[e.id] = 1; });
  C.CATALOG.forEach(function (e) {
    assert(C.DOMAINS.indexOf(e.domain) >= 0, e.id + " domain");
    e.lookalikes.forEach(function (l) { assert(ids[l], e.id + " → " + l); });
    assert(e.presentations.length > 0 && e.ages.length > 0);
  });
  C.DOMAINS.forEach(function (d) { assert(C.CATALOG.some(function (e) { return e.domain === d; }), "no entries for " + d); });
  assert(C.CATALOG.length >= 110, "catalog size " + C.CATALOG.length);
});

test("pickCase distribution: shift ≈25% serious, drill ≈70%", function () {
  ["shift", "drill"].forEach(function (mode) {
    var serious = 0;
    for (var i = 0; i < 2000; i++) if (C.pickCase({}, { mode: mode, seed: i * 7919 + 13 }).bucket === "serious") serious++;
    var pct = serious / 20;
    var target = mode === "shift" ? 25 : 70;
    assert(Math.abs(pct - target) <= 3, mode + " serious " + pct + "%");
  });
});

test("pickCase demographics: Black → Fitzpatrick ≥5, sex respects entry, age within band", function () {
  for (var i = 0; i < 1500; i++) {
    var s = C.pickCase({}, { seed: i + 1, mode: "drill" });
    if (s.ethnicity === "Black/African American") assert(s.fitz >= 5);
    var e = C.byId(s.dxId);
    if (e.sex) assert.strictEqual(s.sex, e.sex, s.dxId);
    assert(e.ages.indexOf(s.ageBand) >= 0);
    var b = C.AGE_BANDS[s.ageBand];
    if (!e.ageRange) assert(s.age >= b.min - 0.01 && s.age <= b.max, s.dxId + " age " + s.age);
  }
});

test("weak-domain weighting raises Airway share", function () {
  function share(stats) {
    var n = 0;
    for (var i = 0; i < 2000; i++) if (C.pickCase(stats, { mode: "drill", seed: i * 31 + 7 }).domain === "Airway") n++;
    return n;
  }
  var base = share({});
  var byDomain = {};
  C.DOMAINS.forEach(function (d) { byDomain[d] = { n: 5, avg: 90 }; });
  byDomain.Airway = { n: 5, avg: 20 };
  var weak = share({ byDomain: byDomain });
  assert(weak > base * 2, "base " + base + " weak " + weak);
});

test("recent dx excluded from last 10 cases", function () {
  var hist = [];
  var serious = C.CATALOG.filter(function (e) { return e.bucket === "benign"; });
  for (var i = 0; i < 10; i++) hist.push({ dxId: serious[i].id, bucket: "benign" });
  for (var j = 0; j < 400; j++) {
    var s = C.pickCase({ history: hist }, { seed: j + 100 });
    assert(!hist.some(function (h) { return h.dxId === s.dxId; }), "picked recent " + s.dxId);
  }
});

test("interleave picks a lookalike ~30% after a serious case", function () {
  var hist = [{ dxId: "aortic_dissection", bucket: "serious" }];
  var looks = C.byId("aortic_dissection").lookalikes;
  var n = 0;
  for (var i = 0; i < 2000; i++) if (looks.indexOf(C.pickCase({ history: hist }, { seed: i + 5 }).dxId) >= 0) n++;
  assert(n / 2000 > 0.25 && n / 2000 < 0.4, "lookalike share " + n / 2000);
});

test("miss-queue re-exposure: due item wins, different presentation and age band", function () {
  var item = { dxId: "stemi_lytics", dx: "STEMI", domain: "Cardiac", originalCaseId: "orig1", presentation: "classic crushing pain", ageBand: "adult", due: [Date.now() - 1000, Date.now() + 1e9, Date.now() + 2e9], stage: 0 };
  for (var i = 0; i < 50; i++) {
    var s = C.pickCase({ missQueue: [item] }, { seed: i + 1 });
    assert.strictEqual(s.dxId, "stemi_lytics");
    assert.notStrictEqual(s.presentation, item.presentation);
    assert.notStrictEqual(s.ageBand, item.ageBand);
    assert.strictEqual(s.reexposure.originalCaseId, "orig1");
  }
  var notDue = Object.assign({}, item, { due: [Date.now() + 1e9, 0, 0] });
  var s2 = C.pickCase({ missQueue: [notDue] }, { seed: 3 });
  assert.strictEqual(s2.reexposure, null);
});

test("conditions roll: night share ≈40%, flight mix, CT logic", function () {
  var rng = C.mulberry32(99), night = 0, wx = 0, ctNightUp = 0, nights = 0;
  for (var i = 0; i < 4000; i++) {
    var c = C.rollConditions(rng);
    if (c.hour >= 19 || c.hour < 7) { night++; nights++; if (c.ctAvailable) ctNightUp++; } else assert(c.ctAvailable);
    if (c.flight === "weather") wx++;
    assert(c.groundEta >= 60 && c.groundEta <= 90 && c.obNegUnits >= 0 && c.obNegUnits <= 4);
  }
  assert(Math.abs(night / 4000 - 0.4) < 0.03, "night " + night / 4000);
  assert(Math.abs(wx / 4000 - 0.2) < 0.03);
  assert(Math.abs(ctNightUp / nights - 0.25) < 0.04);
  assert(/CT/.test(C.conditionsLabel(C.rollConditions(rng))));
});

// ── Validation ──────────────────────────────────────────────────────────────
test("validation fills missing labels, sorts trajectory, filters chips, coerces numbers", function () {
  var c = makeCase({ seed: 7 }, function (raw) {
    delete raw.history["Allergies?"];
    delete raw.results["Lipase"];
    raw.vitals0.HR = "112";
    raw.trajectory = [{ t: 60, HR: 140 }, { t: 0, HR: 1 }, { t: 30, HR: 125 }];
    raw.interventions[0].chips = ["IV access + fluids", "Not a chip"];
    raw.answerKey.trueDispo = "transfer to tertiary";
  });
  assert.strictEqual(c.history["Allergies?"], DW._.FALLBACK);
  assert.strictEqual(c.results["Lipase"], DW._.FALLBACK);
  assert(c._filled.indexOf("Lipase") >= 0 && c._filled.indexOf("Allergies?") >= 0);
  assert.strictEqual(c.vitals0.HR, 112);
  assert.deepStrictEqual(c.trajectory.map(function (p) { return p.t; }), [0, 30, 60]);
  assert.strictEqual(c.trajectory[0].HR, 112, "t=0 equals vitals0");
  assert.strictEqual(c.trajectory[1].SBP, c.vitals0.SBP, "gap filled from previous point");
  assert.deepStrictEqual(c.interventions[0].chips, ["IV access + fluids"]);
  assert.strictEqual(c.answerKey.trueDispo, "Transfer");
  ["Exam", "Labs", "Imaging"].forEach(function (g) { DW.CHIPS[g].forEach(function (l) { assert(typeof c.results[l] === "string"); }); });
  assert.throws(function () { DW._.normalizeCaseA({ persona: {} }, {}); }, /chiefComplaint/);
});

// ── Vitals model ────────────────────────────────────────────────────────────
function vcase(ivs, traj) {
  return makeCase({ seed: 11, ageBand: "adult", conditions: cond() }, function (raw) {
    raw.vitals0 = { HR: 100, SBP: 100, DBP: 60, RR: 20, SpO2: 96, Temp: 98.6, GCS: 15 };
    raw.trajectory = traj || [{ t: 0, HR: 100, SBP: 100, DBP: 60, RR: 20, SpO2: 96, Temp: 98.6, GCS: 15 }, { t: 30, HR: 130, SBP: 70, DBP: 40, RR: 20, SpO2: 96, Temp: 98.6, GCS: 15 }];
    raw.interventions = ivs || [];
  });
}

test("vitalsAt: linear interpolation and hold past last point", function () {
  var enc = DW.startEncounter(vcase());
  assert.strictEqual(DW.vitalsAt(enc, 15).HR, 115);
  assert.strictEqual(DW.vitalsAt(enc, 15).SBP, 85);
  assert.strictEqual(DW.vitalsAt(enc, 90).HR, 130);
  assert.strictEqual(DW.vitalsAt(enc, 0).MAP, Math.round((100 + 120) / 3));
});

test("vitalsAt: delta ramps over onset", function () {
  var c = vcase([{ id: "f", label: "f", chips: [], effect: { HR: -10 }, onsetMin: 10 }]);
  var enc = Object.assign(DW.startEncounter(c), { applied: [{ id: "f", atMin: 0 }] });
  assert.strictEqual(DW.vitalsAt(enc, 5).HR, 105 - 5);   // traj 105, half of -10
  assert.strictEqual(DW.vitalsAt(enc, 10).HR, 110 - 10);
  assert.strictEqual(DW.vitalsAt(enc, 20).HR, 120 - 10);
});

test("vitalsAt: arrest freezes trajectory at appliedAt then applies effect", function () {
  var c = vcase([{ id: "nd", label: "needle", chips: [], mode: "arrest", effect: { SBP: 10 }, onsetMin: 0 }]);
  var enc = Object.assign(DW.startEncounter(c), { applied: [{ id: "nd", atMin: 15 }] });
  assert.strictEqual(DW.vitalsAt(enc, 10).SBP, 90); // before arrest, unaffected
  assert.strictEqual(DW.vitalsAt(enc, 30).SBP, 85 + 10);
  assert.strictEqual(DW.vitalsAt(enc, 120).SBP, 85 + 10);
});

test("vitalsAt: durationMin fades delta to 0 after onset + duration", function () {
  var flat = [{ t: 0, HR: 100, SBP: 100, DBP: 60, RR: 20, SpO2: 96, Temp: 98.6, GCS: 15 }];
  var c = vcase([{ id: "b", label: "bolus", chips: [], effect: { SBP: 20 }, onsetMin: 10, durationMin: 20 }], flat);
  var enc = Object.assign(DW.startEncounter(c), { applied: [{ id: "b", atMin: 0 }] });
  assert.strictEqual(DW.vitalsAt(enc, 10).SBP, 120);
  assert.strictEqual(DW.vitalsAt(enc, 20).SBP, 110);
  assert.strictEqual(DW.vitalsAt(enc, 30).SBP, 100);
  assert.strictEqual(DW.vitalsAt(enc, 60).SBP, 100);
});

test("vitalsAt clamps physiologic ranges", function () {
  var c = vcase([{ id: "x", label: "x", chips: [], effect: { SpO2: 30, GCS: -20 }, onsetMin: 0 }]);
  var enc = Object.assign(DW.startEncounter(c), { applied: [{ id: "x", atMin: 0 }] });
  var v = DW.vitalsAt(enc, 5);
  assert.strictEqual(v.SpO2, 100);
  assert.strictEqual(v.GCS, 3);
});

// ── act(): clock, chips, transfer, CT, events ───────────────────────────────
test("act requires locked gut; never mutates enc", async function () {
  reset();
  var enc = DW.startEncounter(vcase());
  await assert.rejects(DW.act(enc, { chips: [{ group: "Labs", label: "CBC+BMP" }] }), /Lock/);
  var locked = readyEnc(vcase());
  var snapshot = JSON.stringify(locked);
  var r = await DW.act(locked, { chips: [{ group: "Labs", label: "CBC+BMP" }] });
  assert.strictEqual(JSON.stringify(locked), snapshot);
  assert.notStrictEqual(r.enc, locked);
  assert(DW.loadActive().simMin === r.enc.simMin, "act saved active");
});

test("clock advances by MAX cost in a batch; local results need no model call", async function () {
  reset();
  var enc = readyEnc(vcase());
  var r = await DW.act(enc, { chips: [{ group: "Labs", label: "CBC+BMP" }, { group: "Imaging", label: "ECG" }, { group: "History", label: "Allergies?" }] });
  assert.strictEqual(r.enc.simMin, 45);
  assert.strictEqual(calls.length, 0);
  assert(r.entries.some(function (e) { return e.k === "time" && /\+45 min/.test(e.t); }));
  assert(r.entries.every(function (e) { return typeof e.atMin === "number"; }));
  assert(r.entries[0].k === "doc" && r.entries[0].vitals, "doc entry carries vitals snapshot");
});

test("repeat lab goes to the model; first-time lab served locally", async function () {
  reset();
  var enc = readyEnc(vcase());
  var r1 = await DW.act(enc, { chips: [{ group: "Labs", label: "Lactate" }] });
  assert.strictEqual(calls.length, 0);
  assert(r1.entries.some(function (e) { return /Lactate 4.6/.test(e.t); }));
  await DW.act(r1.enc, { chips: [{ group: "Labs", label: "Lactate" }] });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, "turn");
  assert(/REPEAT/.test(calls[0].body.messages[0].content));
});

test("chip exact matching applies intervention; free text never applies locally", async function () {
  reset();
  var ivs = [{ id: "fluids", label: "fluids", chips: ["IV access + fluids"], effect: { SBP: 10 }, onsetMin: 5, critical: true, windowMin: 30 }];
  var enc = readyEnc(vcase(ivs));
  var r = await DW.act(enc, { text: "fluid status?" });
  assert.strictEqual(r.enc.applied.length, 0);
  assert.strictEqual(calls.length, 1);
  var r2 = await DW.act(r.enc, { chips: [{ group: "Stabilize", label: "IV access + fluids" }] });
  assert.strictEqual(r2.enc.applied.length, 1);
  assert.strictEqual(r2.enc.applied[0].id, "fluids");
  assert.strictEqual(calls.length, 1, "matched chip needs no model call");
  var r3 = await DW.act(r2.enc, { chips: [{ group: "Stabilize", label: "IV access + fluids" }] });
  assert.strictEqual(r3.enc.applied.length, 1);
  assert(r3.entries.some(function (e) { return /already done/.test(e.t); }));
  assert.strictEqual(r3.enc.simMin, r2.enc.simMin, "re-apply costs no time");
});

test("model interventionsApplied: only known ids applied", async function () {
  reset();
  var ivs = [{ id: "abx", label: "abx", chips: ["Broad-spectrum antibiotics"], effect: {}, onsetMin: 30 }];
  var enc = readyEnc(vcase(ivs));
  overrides.push(function () { return { status: 200, body: FX.wrap({ responses: [{ kind: "clinical", text: "Hung." }], interventionsApplied: ["abx", "made_up"], timeCostMin: 5 }) }; });
  var r = await DW.act(enc, { text: "give pip-tazo and vanc" });
  assert.deepStrictEqual(r.enc.applied.map(function (a) { return a.id; }), ["abx"]);
  assert.strictEqual(r.enc.simMin, 5);
});

test("transfer requests set ETA and do not move the clock", async function () {
  reset();
  var c = vcase(); c.seed.conditions = cond({ groundEta: 80 });
  var enc = readyEnc(c);
  var r = await DW.act(enc, { chips: [{ group: "Transfer", label: "Request ground ALS" }] });
  assert.strictEqual(r.enc.simMin, 0);
  assert.deepStrictEqual([r.enc.transport.mode, r.enc.transport.etaMin], ["ground", 80]);
  var c2 = vcase(); c2.seed.conditions = cond({ flight: "weather" });
  var r2 = await DW.act(readyEnc(c2), { chips: [{ group: "Transfer", label: "Request flight" }] });
  assert.strictEqual(r2.enc.transport, null);
  assert(r2.events.some(function (e) { return e.text === "Flight declined: weather"; }));
  var c3 = vcase(); c3.seed.conditions = cond();
  var r3 = await DW.act(readyEnc(c3), { chips: [{ group: "Transfer", label: "Request flight" }] });
  assert.strictEqual(r3.enc.transport.etaMin, C.FACILITY.timesMin.flightTransfer);
  assert.strictEqual(r3.enc.simMin, 0);
  var r4 = await DW.act(r3.enc, { chips: [{ group: "Labs", label: "CBC+BMP" }] });
  assert(r4.events.some(function (e) { return e.kind === "transport"; }), "crew arrives once clock passes ETA");
  assert.strictEqual(calls.length, 0);
});

test("diversion: first call declined, second accepted at +15", async function () {
  reset();
  var c = vcase(); c.seed.conditions = cond({ tertiaryDiversion: true });
  var r1 = await DW.act(readyEnc(c), { chips: [{ group: "Transfer", label: "Call receiving facility" }] });
  assert(r1.events.some(function (e) { return e.text === "Accepting facility declined — on diversion"; }));
  assert.strictEqual(r1.enc.accepted, false);
  assert.strictEqual(r1.enc.simMin, C.FACILITY.timesMin.callReceiving);
  var r2 = await DW.act(r1.enc, { chips: [{ group: "Transfer", label: "Call receiving facility" }] });
  assert.strictEqual(r2.enc.accepted, true);
  assert.strictEqual(r2.enc.simMin, r1.enc.simMin + 15);
  var c2 = vcase(); c2.seed.conditions = cond(); c2.seed.transferTwist = "declined";
  var r3 = await DW.act(readyEnc(c2), { chips: [{ group: "Transfer", label: "Call receiving facility" }] });
  assert.strictEqual(r3.enc.accepted, false);
  var c3 = vcase(); c3.seed.conditions = cond();
  var r4 = await DW.act(readyEnc(c3), { chips: [{ group: "Transfer", label: "Call receiving facility" }] });
  assert.strictEqual(r4.enc.accepted, true);
});

test("CT down: on-call tech callback event and +45+CT; not on call → unavailable", async function () {
  reset();
  var c = vcase(); c.seed.conditions = cond({ hour: 2, ctAvailable: false, ctOnCall: true });
  var r = await DW.act(readyEnc(c), { chips: [{ group: "Imaging", label: "CT head" }] });
  assert(r.events.some(function (e) { return e.text === "CT tech called back — ~45 min"; }));
  assert.strictEqual(r.enc.simMin, 45 + C.FACILITY.timesMin.ct);
  assert(r.entries.some(function (e) { return /^CT head:/.test(e.t); }));
  var r2 = await DW.act(r.enc, { chips: [{ group: "Imaging", label: "CT abd/pelvis" }] });
  assert.strictEqual(r2.enc.simMin - r.enc.simMin, C.FACILITY.timesMin.ct, "tech already in");
  var c2 = vcase(); c2.seed.conditions = cond({ hour: 2, ctAvailable: false, ctOnCall: false });
  var r3 = await DW.act(readyEnc(c2), { chips: [{ group: "Imaging", label: "CT head" }] });
  assert(r3.events.some(function (e) { return /CT unavailable/.test(e.text); }));
  assert(!r3.entries.some(function (e) { return /^CT head:/.test(e.t); }));
  assert.strictEqual(r3.enc.simMin, 0);
});

test("events: adult crossing SBP<90 fires; infant HR 160 does not alarm", async function () {
  reset();
  var enc = readyEnc(vcase()); // SBP 100 → 70 over 30 min
  var r = await DW.act(enc, { chips: [{ group: "Labs", label: "CBC+BMP" }] }); // +45
  assert(r.events.some(function (e) { return e.kind === "deteriorating" && e.vital === "BP"; }), JSON.stringify(r.events));
  var r2 = await DW.act(r.enc, { chips: [{ group: "Labs", label: "UA" }] });
  assert(!r2.events.some(function (e) { return e.vital === "BP"; }), "only on new crossing");

  var inf = makeCase({ seed: 12, ageBand: "infant", conditions: cond() }, function (raw) {
    raw.vitals0 = { HR: 150, SBP: 85, DBP: 50, RR: 40, SpO2: 97, Temp: 99, GCS: 15 };
    raw.trajectory = [{ t: 0, HR: 150, SBP: 85, DBP: 50, RR: 40, SpO2: 97, Temp: 99, GCS: 15 }, { t: 45, HR: 160, SBP: 85, DBP: 50, RR: 50, SpO2: 97, Temp: 99, GCS: 15 }];
  });
  var ri = await DW.act(readyEnc(inf), { chips: [{ group: "Labs", label: "CBC+BMP" }] });
  assert.strictEqual(ri.enc.vitalsHistory[ri.enc.vitalsHistory.length - 1].vitals.HR, 160);
  assert.strictEqual(ri.events.length, 0, JSON.stringify(ri.events));
  // the same HR in an adult does alarm
  var ev = DW._.deteriorationEvents({ HR: 100, SBP: 120, DBP: 70, MAP: 87, RR: 16, SpO2: 98, GCS: 15 }, { HR: 160, SBP: 120, DBP: 70, MAP: 87, RR: 16, SpO2: 98, GCS: 15 }, "adult");
  assert.strictEqual(ev[0].vital, "HR");
  var gcs = DW._.deteriorationEvents({ HR: 90, SBP: 120, DBP: 70, MAP: 87, RR: 16, SpO2: 98, GCS: 15 }, { HR: 90, SBP: 120, DBP: 70, MAP: 87, RR: 16, SpO2: 98, GCS: 13 }, "adult");
  assert.strictEqual(gcs[0].vital, "GCS");
});

// ── Grading ─────────────────────────────────────────────────────────────────
test("critical actions done/late/missed computed in code; grader cannot override", async function () {
  reset();
  var c = makeCase({ seed: 21, conditions: cond(), bucket: "serious" });
  var enc = readyEnc(c);
  var r = await DW.act(enc, { chips: [{ group: "Stabilize", label: "IV access + fluids" }] }); // fluids at 0 → done
  var r2 = await DW.act(r.enc, { chips: [{ group: "Labs", label: "CBC+BMP" }] });          // +45
  var r3 = await DW.act(r2.enc, { chips: [{ group: "Labs", label: "UA" }] });              // +45 → 95
  var r4 = await DW.act(r3.enc, { chips: [{ group: "Stabilize", label: "Broad-spectrum antibiotics" }] }); // abx at 95 → late
  var crit = DW._.computeCritical(r4.enc);
  var byId = {}; crit.computed.forEach(function (x) { byId[x.id] = x; });
  assert.strictEqual(byId.fluids.status, "done");
  assert.strictEqual(byId.abx.status, "late");
  assert.strictEqual(byId.abx.atMin, 95); // fluids chip itself costs 5 min
  assert.deepStrictEqual(crit.toJudge.map(function (x) { return x.id; }), ["call_receiving"]);
  var missed = DW._.computeCritical(readyEnc(c)).computed;
  assert(missed.every(function (x) { return x.status === "missed"; }));

  overrides.push(function (kind, body) {
    var g = FX.fakeGrade(85);
    g.criticalActions.push({ id: "abx", status: "done", atMin: 1 }); // attempt to override
    return { status: 200, body: FX.wrap(g) };
  });
  var g = await DW.grade(r4.enc, { ddx: ["Septic shock", "PE", "CHF"], confidence: 70, finalDispo: "Emergent transfer" });
  var gb = {}; g.criticalActions.forEach(function (x) { gb[x.id] = x; });
  assert.strictEqual(gb.abx.status, "late");
  assert.strictEqual(gb.call_receiving.status, "done");
  assert.strictEqual(g.criticalActions.length, 3);
  var prompt = calls[calls.length - 1].body.messages[0].content;
  assert(/ANSWER KEY/.test(prompt) && /LOCKED DOORWAY GUT/.test(prompt) && /FINAL ANSWERS/.test(prompt) && /\[T\+95\]/.test(prompt) && /vitals: HR/.test(prompt));
});

test("turn prompt never contains the answer key", async function () {
  reset();
  var c = makeCase({ seed: 22, conditions: cond() });
  c.answerKey.teachingPoint = "SECRET-TEACHING-XYZ";
  await DW.act(readyEnc(c), { text: "how are you feeling?" });
  var sent = JSON.stringify(calls[0].body);
  assert(sent.indexOf("SECRET-TEACHING-XYZ") < 0);
  assert(sent.indexOf("answerKey") < 0);
  assert.strictEqual(calls[0].body.model, "claude-sonnet-5-5");
});

test("score capped at 40 on critical error or critical-error stabilization", async function () {
  reset();
  var enc = readyEnc(makeCase({ seed: 23, conditions: cond() }));
  overrides.push(function () { var g = FX.fakeGrade(92); g.criticalError = "Intubated before resuscitation"; return { status: 200, body: FX.wrap(g) }; });
  var g1 = await DW.grade(enc, { ddx: ["x"], confidence: 50, finalDispo: "Transfer" });
  assert.strictEqual(g1.score, 40);
  overrides.push(function () { var g = FX.fakeGrade(88); g.stabilizationGrade = "critical-error"; return { status: 200, body: FX.wrap(g) }; });
  var g2 = await DW.grade(enc, { ddx: ["x"], confidence: 50, finalDispo: "Transfer" });
  assert.strictEqual(g2.score, 40);
  var g3 = await DW.grade(enc, { ddx: ["x"], confidence: 50, finalDispo: "Transfer" });
  assert.strictEqual(g3.score, 78);
});

// ── Results, stats, miss queue ──────────────────────────────────────────────
test("recordResult: history entry, miss queue push and advance, active cleared", async function () {
  reset();
  var c = makeCase({ seed: 31, conditions: cond(), bucket: "serious" });
  var enc = readyEnc(c);
  assert(DW.loadActive());
  var g = DW._.finalizeGrade(Object.assign(FX.fakeGrade(50), { caughtInDdx: false, rankOfTrueDx: null }), enc, DW._.computeCritical(enc), { ddx: ["a"], confidence: 40, finalDispo: "Discharge" });
  var st = DW.recordResult(enc, g, { reflection: "missed it" });
  assert.strictEqual(DW.loadActive(), null);
  assert.strictEqual(st.cases, 1);
  var h = st.history[0];
  assert.strictEqual(h.caught, false);
  assert.deepStrictEqual(h.critMissed.sort(), ["abx", "fluids"]);
  assert.strictEqual(h.reflection, "missed it");
  assert.strictEqual(st.missQueue.length, 1);
  assert.strictEqual(st.missQueue[0].due.length, 3);
  assert(st.byDomain[c.seed.domain].n === 1);
  assert.strictEqual(st.acuityGrid[1][c.answerKey.trueAcuity - 1], 1);

  // pass a re-exposure → stage advances
  var re = makeCase({ seed: 32, conditions: cond(), dxId: c.seed.dxId, reexposure: { originalCaseId: c.seed.caseId } });
  var enc2 = readyEnc(re);
  var r = await DW.act(enc2, { chips: [{ group: "Stabilize", label: "IV access + fluids" }, { group: "Stabilize", label: "Broad-spectrum antibiotics" }] });
  var g2 = DW._.finalizeGrade(FX.fakeGrade(90), r.enc, DW._.computeCritical(r.enc), { ddx: [re.answerKey.trueDx], confidence: 80, finalDispo: "Transfer" });
  var st2 = DW.recordResult(r.enc, g2, {});
  assert.strictEqual(st2.missQueue[0].stage, 1);
  assert.strictEqual(st2.history[1].reexposureOf, c.seed.caseId);
  assert(DW.flagGrade(c.seed.caseId, "grader too harsh"));
  assert.strictEqual(DW.stats().history[0].flagNote, "grader too harsh");
});

test("history cap 500", function () {
  reset();
  var enc = readyEnc(makeCase({ seed: 41, conditions: cond() }));
  var g = DW._.finalizeGrade(FX.fakeGrade(80), enc, DW._.computeCritical(enc), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" });
  g.criticalActions = [];
  for (var i = 0; i < 510; i++) DW.recordResult(enc, g, {});
  var st = DW.stats();
  assert.strictEqual(st.history.length, 500);
  assert.strictEqual(st.cases, 500);
});

test("export/import round trip (API key not exported, kept on import)", function () {
  reset();
  DW.settings.set({ apiKey: "sk-secret", mode: "drill" });
  var enc = readyEnc(makeCase({ seed: 51, conditions: cond() }));
  var g = DW._.finalizeGrade(FX.fakeGrade(70), enc, DW._.computeCritical(enc), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" });
  DW.recordResult(enc, g, {});
  localStorage.setItem("other_app", "x");
  var dump = DW.exportData();
  assert(dump.indexOf("sk-secret") < 0);
  assert(dump.indexOf("other_app") < 0);
  var before = DW.stats();
  localStorage.clear();
  DW.settings.set({ apiKey: "sk-device" });
  var res = DW.importData(dump);
  assert(res.ok && res.count >= 2, JSON.stringify(res));
  var after = DW.stats();
  assert.deepStrictEqual(after.history, before.history);
  assert.strictEqual(DW.settings.get().mode, "drill");
  assert.strictEqual(DW.settings.get().apiKey, "sk-device");
  assert.strictEqual(DW.importData("not json").ok, false);
});

test("quota fallback: setItem failure drops dw_next and retries", function () {
  reset();
  localStorage.setItem("dw_next", new Array(5000).join("x"));
  localStorage.quotaBytes = 6000;
  var ok = DW.saveActive({ case: { big: new Array(3000).join("y") } });
  localStorage.quotaBytes = Infinity;
  assert.strictEqual(ok, true);
  assert.strictEqual(localStorage.getItem("dw_next"), null);
});

// ── API client, generation, prefetch ────────────────────────────────────────
test("newCase: two calls (case, results) with right headers, tokens and model", async function () {
  reset();
  DW.settings.set({ apiKey: "sk-user" });
  var c = await DW.newCase({ mode: "drill" });
  assert.deepStrictEqual(calls.map(function (x) { return x.kind; }), ["case", "results"]);
  assert.strictEqual(calls[0].headers["X-User-API-Key"], "sk-user");
  assert.strictEqual(calls[0].headers["Content-Type"], "application/json");
  assert.strictEqual(calls[0].body.max_tokens, 4000);
  assert.strictEqual(calls[0].url, "/api/claude");
  assert(/time 0/i.test(calls[0].body.system) && /CONDITIONS FOR THIS CASE/.test(calls[0].body.messages[0].content));
  assert(c.seed && c.persona && c.results && c.startedAt);
  assert.strictEqual(c.physicality.fitz, c.seed.fitz);
  DW.settings.set({ apiKey: "" });
  calls = [];
  await DW.newCase({});
  assert.strictEqual(calls[0].headers["X-User-API-Key"], undefined);
});

test("newCase retries once on invalid JSON, then fails readably", async function () {
  reset();
  overrides.push(function () { return { status: 200, body: { content: [{ type: "text", text: "sorry, no json" }] } }; });
  var c = await DW.newCase({});
  assert(c.persona);
  assert.strictEqual(calls.filter(function (x) { return x.kind === "case"; }).length, 2);
  reset();
  var bad = function () { return { status: 200, body: FX.wrap({ persona: { name: "x" } }) }; };
  overrides.push(bad, bad);
  await assert.rejects(DW.newCase({}), /after two tries/);
});

test("429 daily limit passes message verbatim with no retry; 529 retries once", async function () {
  reset();
  var msg = "Daily limit reached (12 cases per day). Add your own API key in Settings for unlimited cases.";
  overrides.push(function () { return { status: 429, body: { error: msg, code: "daily_limit" } }; });
  await assert.rejects(DW.newCase({}), function (e) { return e.message === msg && e.dailyLimit === true; });
  assert.strictEqual(calls.length, 1);
  reset();
  overrides.push(function () { return { status: 529, body: { error: "The model is overloaded right now. Try again in a moment." } }; });
  var c = await DW.newCase({});
  assert(c.persona);
  assert.strictEqual(calls.filter(function (x) { return x.kind === "case"; }).length, 2);
  reset();
  overrides.push(function () { return { status: 500, body: {} }; }, function () { return { status: 500, body: {} }; });
  await assert.rejects(DW.newCase({}), /error \(500\)/);
});

test("network error retries once; results-call failure degrades to model-served results", async function () {
  reset();
  var realFetch = global.fetch, n = 0;
  global.fetch = function (u, o) { n++; if (n === 1) return Promise.reject(new TypeError("Failed to fetch")); return realFetch(u, o); };
  var c = await DW.newCase({});
  assert(c.persona);
  global.fetch = realFetch;
  reset();
  overrides.push(function (k) { return k === "case" ? undefined : { status: 200, body: { content: [{ type: "text", text: "nope" }] } }; });
  overrides.push(function () { return { status: 200, body: { content: [{ type: "text", text: "nope" }] } }; });
  overrides.push(function () { return { status: 200, body: { content: [{ type: "text", text: "nope" }] } }; });
  var c2 = await DW.newCase({});
  assert.strictEqual(c2._filled.length >= DW.CHIPS.Labs.length, true);
});

test("prefetch stores dw_next, shares in-flight promise; newCase awaits it", async function () {
  reset();
  var p1 = DW.prefetch({ mode: "shift" });
  var p2 = DW.prefetch({ mode: "shift" });
  assert.strictEqual(p1, p2);
  var nc = DW.newCase({});
  var c = await nc;
  assert.strictEqual(calls.length, 2, "only one generation");
  assert.strictEqual(localStorage.getItem("dw_next"), null, "taken");
  assert((await p1).id === c.id);
  await DW.prefetch({});
  assert(localStorage.getItem("dw_next"));
  var t = DW.takePrefetched();
  assert(t && t.persona);
  assert.strictEqual(DW.takePrefetched(), null);
});

test("fixtures: fakeCase is schema-valid for many seeds", function () {
  for (var i = 1; i < 200; i++) {
    var raw = FX.fakeCase(i);
    var c = DW._.normalizeCase(raw, C.pickCase({}, { seed: i }));
    assert.strictEqual(c._filled.length, 0, "seed " + i + " filled " + c._filled);
    assert(c.interventions.every(function (iv) { return iv.chips.length > 0; }));
  }
});

test("extractJSON tolerates fences, prose and trailing commas", function () {
  assert.deepStrictEqual(DW._.extractJSON("Here:\n```json\n{\"a\":[1,2,],}\n``` done"), { a: [1, 2] });
  assert.deepStrictEqual(DW._.extractJSON("x {\"s\":\"a } b\"} y"), { s: "a } b" });
});

// ── UI helpers: onSeed, hasPrefetched, saveReflection, getResult ────────────
test("newCase calls onSeed(seed) before the first API call; also for prefetched and in-flight cases", async function () {
  reset();
  var seen = null, callsAtSeed = -1;
  var c = await DW.newCase({ mode: "drill", onSeed: function (s) { seen = s; callsAtSeed = calls.length; } });
  assert(seen && seen.conditions && seen.caseId === c.seed.caseId);
  assert.strictEqual(callsAtSeed, 0, "onSeed fires before generation");
  // a throwing callback does not break generation
  await DW.newCase({ onSeed: function () { throw new Error("ui bug"); } });
  // in flight
  reset();
  var p = DW.prefetch({});
  var inflightSeed = null;
  var c2 = await DW.newCase({ onSeed: function (s) { inflightSeed = s; } });
  assert(inflightSeed && inflightSeed.caseId === c2.seed.caseId);
  await p;
  // ready in storage
  reset();
  await DW.prefetch({});
  assert.strictEqual(DW.hasPrefetched(), true);
  var readySeed = null;
  var c3 = await DW.newCase({ onSeed: function (s) { readySeed = s; } });
  assert.strictEqual(readySeed.caseId, c3.seed.caseId);
  assert.strictEqual(DW.hasPrefetched(), false);
  localStorage.setItem("dw_next", "{not json");
  assert.strictEqual(DW.hasPrefetched(), false);
});

test("startEncounter saves the encounter so the doorway can be resumed", function () {
  reset();
  var c = makeCase({ seed: 61, conditions: cond() });
  var enc = DW.startEncounter(c);
  var a = DW.loadActive();
  assert(a && a.case.id === c.id && a.gut === null && a.physicality);
  assert.deepStrictEqual(a.log, enc.log);
});

test("saveReflection updates the history entry", function () {
  reset();
  var enc = readyEnc(makeCase({ seed: 71, conditions: cond() }));
  var g = DW._.finalizeGrade(FX.fakeGrade(60), enc, DW._.computeCritical(enc), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" });
  DW.recordResult(enc, g, {});
  var id = enc.case.seed.caseId;
  assert.strictEqual(DW.saveReflection(id, "the lactate argued against it"), true);
  assert.strictEqual(DW.stats().history[0].reflection, "the lactate argued against it");
  assert.strictEqual(DW.getResult(id).entry.reflection, "the lactate argued against it");
  assert.strictEqual(DW.saveReflection("nope", "x"), false);
});

test("getResult returns the full debrief for recent cases; 30 kept apart from history; trims on quota", async function () {
  reset();
  var c = makeCase({ seed: 81, conditions: cond() });
  var r = await DW.act(readyEnc(c), { chips: [{ group: "Stabilize", label: "IV access + fluids" }] });
  var g = DW._.finalizeGrade(FX.fakeGrade(66), r.enc, DW._.computeCritical(r.enc), { ddx: ["Sepsis"], confidence: 70, finalDispo: "Transfer" });
  DW.recordResult(r.enc, g, { ddx: ["Sepsis"], confidence: 70, finalDispo: "Transfer" });
  var full = DW.getResult(c.seed.caseId);
  assert(full && full.enc && full.grade && full.entry);
  assert.strictEqual(full.grade.score, 66);
  assert.strictEqual(full.answers.finalDispo, "Transfer");
  assert.strictEqual(full.enc.simMin, r.enc.simMin);
  assert(full.enc.log.some(function (e) { return e.k === "doc"; }));
  assert.strictEqual(full.enc.case.answerKey.trueDx, c.answerKey.trueDx);
  assert.strictEqual(full.enc.case.results, undefined, "results sheet not stored");
  assert.strictEqual(DW.getResult("missing"), null);

  // 35 cases → 30 full results, 36 history entries
  for (var i = 0; i < 35; i++) {
    var ci = makeCase({ seed: 1000 + i, conditions: cond() });
    var ei = readyEnc(ci);
    DW.recordResult(ei, DW._.finalizeGrade(FX.fakeGrade(70), ei, DW._.computeCritical(ei), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" }), {});
  }
  var stored = JSON.parse(localStorage.getItem("dw_results"));
  assert.strictEqual(stored.length, 30);
  assert.strictEqual(DW.stats().history.length, 36);
  assert.strictEqual(DW.getResult(c.seed.caseId), null, "oldest dropped");

  // quota: the history write wins over stored full results; results trim oldest-first and keep the newest
  localStorage.setItem("dw_next", "x");
  var cq = makeCase({ seed: 2000, conditions: cond() });
  var eq = readyEnc(cq); // writes dw_active (cleared again by recordResult)
  var used = 0; for (var k = 0; k < localStorage.length; k++) { var key = localStorage.key(k); if (key !== "dw_results") used += localStorage.getItem(key).length; }
  var one = localStorage.getItem("dw_results").length / 30;
  localStorage.quotaBytes = used + Math.round(one * 4.5); // no room for the history entry until results shrink
  DW.recordResult(eq, DW._.finalizeGrade(FX.fakeGrade(70), eq, DW._.computeCritical(eq), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" }), {});
  localStorage.quotaBytes = Infinity;
  assert.strictEqual(DW.stats().history.length, 37, "history written");
  var after = JSON.parse(localStorage.getItem("dw_results"));
  assert(after.length >= 1 && after.length < 30, "trimmed to " + after.length);
  assert.strictEqual(after[after.length - 1].caseId, cq.seed.caseId, "newest kept");
  assert(DW.getResult(cq.seed.caseId));
});

// ── Review fixes: DDx matching, save guards, save failures ──────────────────
test("engine computes rankOfTrueDx/caughtInDdx with fuzzy matching; model only breaks ties", function () {
  var c = makeCase({ seed: 91, conditions: cond() });
  c.answerKey.trueDx = "Pulmonary embolism with right heart strain";
  c.seed.dxId = "__none__";
  function m(ddx, modelRank) { return DW._.matchDdx(ddx, c, modelRank); }
  assert.deepStrictEqual(m(["Pneumonia", "PE", "ACS"]), { caught: true, rank: 2 }, "abbreviation");
  assert.deepStrictEqual(m(["pulmonary emboli"]), { caught: true, rank: 1 }, "plural");
  assert.deepStrictEqual(m(["massive PE w/ RV strain", "x"], 2), { caught: true, rank: 1 }, "model rank ignored when engine is sure");
  assert.deepStrictEqual(m(["Pneumonia", "Pneumothorax"], 1), { caught: false, rank: null }, "model cannot invent a match");
  c.answerKey.trueDx = "Urosepsis with septic shock";
  assert.deepStrictEqual(m(["Cardiogenic shock"], null), { caught: false, rank: null }, "one shared generic word is not enough");
  assert.deepStrictEqual(m(["Cardiogenic shock", "Pyelonephritis"], 1), { caught: true, rank: 1 }, "weak match accepted on the model's tiebreak");
  // catalog name for the dxId counts as a truth name
  var entry = C.CATALOG.filter(function (e) { return e.dx.split(" ").length >= 2; })[0];
  c.seed.dxId = entry.id; c.answerKey.trueDx = "something the writer phrased differently";
  assert.deepStrictEqual(m(["zzz", entry.dx.toUpperCase()]), { caught: true, rank: 2 });
  // finalizeGrade uses it and overrides the model's claim
  var enc = readyEnc(makeCase({ seed: 92, conditions: cond() }));
  var g = DW._.finalizeGrade(FX.fakeGrade(80), enc, DW._.computeCritical(enc), { ddx: ["Totally unrelated"], confidence: 50, finalDispo: "Transfer" });
  assert.strictEqual(g.caughtInDdx, false);
  assert.strictEqual(g.rankOfTrueDx, null);
  var g2 = DW._.finalizeGrade(Object.assign(FX.fakeGrade(80), { caughtInDdx: false, rankOfTrueDx: null }), enc, DW._.computeCritical(enc), { ddx: ["x", enc.case.answerKey.trueDx], confidence: 50, finalDispo: "Transfer" });
  assert.strictEqual(g2.caughtInDdx, true);
  assert.strictEqual(g2.rankOfTrueDx, 2);
});

test("trueAcuity is ESI 1–5 and string answers are parsed", function () {
  assert(/ESI: 1 = resuscitation/.test(DW._.CASE_SYSTEM) && /ESI: 1 = resuscitation/.test(DW._.GRADE_SYSTEM));
  var c = makeCase({ seed: 93, conditions: cond() }, function (raw) { raw.answerKey.trueAcuity = "ESI 2 (emergent)"; });
  assert.strictEqual(c.answerKey.trueAcuity, 2);
});

test("dw_active: stale reply for an old case never overwrites the new one or revives a graded case", async function () {
  reset();
  var a = readyEnc(makeCase({ seed: 94, conditions: cond() }));
  var pending = DW.act(a, { text: "how are you feeling?" }); // model call in flight
  var b = readyEnc(makeCase({ seed: 95, conditions: cond() })); // he moved on
  var r = await pending;
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.saveFailed, false);
  assert.strictEqual(DW.loadActive().case.id, b.case.id, "new case kept");
  // same case: saves
  var r2 = await DW.act(b, { chips: [{ group: "History", label: "Allergies?" }] });
  assert.strictEqual(r2.stale, false);
  assert.strictEqual(DW.loadActive().simMin, r2.enc.simMin);
  // graded case: a late reply does not bring it back
  var late = DW.act(r2.enc, { text: "anything else?" });
  var g = DW._.finalizeGrade(FX.fakeGrade(70), r2.enc, DW._.computeCritical(r2.enc), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" });
  DW.recordResult(r2.enc, g, {});
  assert.strictEqual(DW.loadActive(), null);
  await late;
  assert.strictEqual(DW.loadActive(), null, "graded case not revived");
  // recordResult of an old case leaves a newer active encounter alone
  var c1 = readyEnc(makeCase({ seed: 96, conditions: cond() }));
  var c2 = DW.startEncounter(makeCase({ seed: 97, conditions: cond() }));
  DW.recordResult(c1, DW._.finalizeGrade(FX.fakeGrade(70), c1, DW._.computeCritical(c1), { ddx: ["a"], confidence: 50, finalDispo: "Transfer" }), {});
  assert.strictEqual(DW.loadActive().case.id, c2.case.id);
});

test("act/lockGut report saveFailed when storage refuses the write", async function () {
  reset();
  var enc = DW.startEncounter(makeCase({ seed: 98, conditions: cond() }));
  assert.strictEqual(enc.saveFailed, undefined);
  localStorage.quotaBytes = 10;
  var locked = DW.lockGut(enc, { sick: true, acuity: 2, gutDispo: "Admit" });
  assert.strictEqual(locked.saveFailed, true);
  var r = await DW.act(locked, { chips: [{ group: "History", label: "Allergies?" }] });
  assert.strictEqual(r.saveFailed, true);
  assert.strictEqual(r.enc.saveFailed, undefined, "flag is not part of the encounter");
  localStorage.quotaBytes = Infinity;
  var r2 = await DW.act(r.enc, { chips: [{ group: "History", label: "Medications?" }] });
  assert.strictEqual(r2.saveFailed, false);
  assert.strictEqual(DW.lockGut(r2.enc, { sick: true }).saveFailed, undefined);
});

// ── Run ─────────────────────────────────────────────────────────────────────
(async function () {
  var pass = 0, fail = 0;
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i].fn(); pass++; console.log("ok   " + tests[i].name); }
    catch (e) { fail++; console.log("FAIL " + tests[i].name + "\n     " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n     ") : e)); }
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
