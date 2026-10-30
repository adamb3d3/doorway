#!/usr/bin/env node
// Live harness: a model plays Derek through real cases against the real API, through the
// real proxy handler, with every exchange saved. Nothing here touches the deployed app.
//
//   node test/live.mjs --n 5 --mode drill
//   node test/live.mjs --n 20 --models case=opus,grade=opus,review=opus --review --structured
//   node test/live.mjs --dx stroke_tnk,bh_boarding,apap_od          # force diagnoses
//   node test/live.mjs --n 2 --stub                                   # plumbing check, no key, no cost
//
// Flags: --n N (cases), --mode shift|drill, --seed N (base seed, cases use seed+i*7919),
//        --models case=opus,... (per kind: case results review turn grade), --effort case=high,...
//        --structured (JSON schemas on), --review (clinical review pass on), --cache 0 (caching off),
//        --max-turns N (Derek commits by then, default 10), --derek sonnet|opus, --out DIR.
// Output: runs/<stamp>/case-NN/{seed,case,enc,answers,grade,summary}.json, calls.jsonl,
//         derek.jsonl, transcript.txt; runs/<stamp>/{config,summary}.json and summary.md.
import fs from "node:fs";
import path from "node:path";
import { ROOT, boot, anthropic, textOf, modelId, costOf, stamp, writeJSON, appendJSONL, parseArgs, parseModels, mean, round } from "./live-common.mjs";

const args = parseArgs(process.argv.slice(2));
const N = Number(args.n || (args.dx ? String(args.dx).split(",").length : 5));
const MODE = args.mode === "shift" ? "shift" : "drill";
const BASE_SEED = Number(args.seed || 20261030);
const MAX_TURNS = Number(args["max-turns"] || 10);
const DEREK_MODEL = modelId(args.derek || "sonnet");
const STUB = !!args.stub;
const OUT = path.resolve(ROOT, args.out || path.join("runs", stamp()));

const { DW, CASES, realFetch } = await boot({ stub: STUB });
const CFG = DW._.CONFIG;
Object.assign(CFG.models, parseModels(args.models));
for (const [k, v] of Object.entries(parseModels(args.effort))) CFG.effort[k] = v.replace("claude-", "");
if (args.structured) CFG.structured = true;
if (args.review) CFG.review = true;
if (args.cache === "0" || args.cache === "false") CFG.cache = false;

const GROUPS = Object.keys(DW.CHIPS);
const config = { startedAt: new Date().toISOString(), n: N, mode: MODE, baseSeed: BASE_SEED, maxTurns: MAX_TURNS, derekModel: DEREK_MODEL, stub: STUB,
  models: { ...CFG.models }, effort: { ...CFG.effort }, maxTokens: { ...CFG.maxTokens }, structured: CFG.structured, review: CFG.review, cache: CFG.cache,
  forcedDx: args.dx ? String(args.dx).split(",") : null };
fs.mkdirSync(OUT, { recursive: true });
writeJSON(path.join(OUT, "config.json"), config);
console.log("run:", OUT);
console.log("models:", JSON.stringify(CFG.models), "structured:", CFG.structured, "review:", CFG.review, "cache:", CFG.cache);

// ── Derek, the player ───────────────────────────────────────────────────────
const DEREK_SYSTEM = [
  "You are Derek, a careful mid-career emergency physician working alone tonight at a 25-bed critical access hospital: no ICU, no surgeon, no cath lab, no neurosurgery; POCUS and point-of-care labs in house; CT sometimes down at night; the helicopter sometimes grounded; the nearest tertiary center 60–90 minutes by ground. You are playing a training simulation on your phone. You do NOT know the diagnosis. Work it out the way you would on shift.",
  "",
  "How you work: recognize early; stabilize what is killing them; package safely; call the receiving facility EARLY when transfer looks likely, in parallel with the workup rather than after it. Order what changes the decision, not everything. Reassess the vitals after each step. Use the ORDER MENU first (exact labels, they are instant); use free text for things not on it or to ask the patient something specific. One to four orders per turn. Commit when you have enough to decide: three differentials most-likely first, your confidence in #1, the disposition correct for THIS facility, and the transfer checklist if you are transferring. Commit by the turn limit at the latest.",
  "",
  "Return ONLY JSON matching the requested shape.",
].join("\n");

const S = (type) => ({ type });
const S_enum = (vals) => ({ type: "string", enum: vals });
const S_arr = (items) => ({ type: "array", items });
const S_obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const GUT_SCHEMA = S_obj({ why: S("string"), sick: S("boolean"), acuity: S("integer"), gutDispo: S_enum(["Discharge", "Admit", "Transfer"]) });
const TURN_SCHEMA = S_obj({
  note: S("string"),
  chips: S_arr(S_obj({ group: S_enum(GROUPS), label: S("string") })),
  text: S("string"),
  commit: S("boolean"),
  ddx: S_arr(S("string")),
  confidence: S("integer"),
  finalDispo: S_enum(DW.DISPOS),
  transferChecklist: S_obj({ airway: S("boolean"), access: S("boolean"), blood: S("boolean"), pressors: S("boolean"), sedation: S("boolean"), receivingCall: S("boolean") }),
});

function fmtV(v) { return v ? `HR ${v.HR} BP ${v.SBP}/${v.DBP} RR ${v.RR} SpO2 ${v.SpO2}% T ${v.Temp} GCS ${v.GCS}` : "—"; }
function menuText() { return GROUPS.map((g) => g + ": " + DW.CHIPS[g].map((l) => JSON.stringify(l)).join(", ")).join("\n"); }
function logText(enc) {
  const name = (enc.case.persona.name || "Patient").split(" ")[0];
  return (enc.log || []).map((e) => {
    const who = { doc: "YOU", patient: name.toUpperCase(), clinical: "CLINICAL", obs: "YOU SEE", event: "EVENT", time: "TIME" }[e.k] || e.k.toUpperCase();
    return `[T+${e.atMin || 0}] ${who}: ${e.t}`;
  }).join("\n");
}
function doorwayText(enc) {
  const c = enc.case, p = c.persona, s = c.seed || {};
  return [
    "CONDITIONS: " + CASES.conditionsLabel(s.conditions),
    `PATIENT: ${p.name}, ${s.ageLabel || p.age} ${p.sex}, ${p.occupation || ""}. Arrived ${p.arrivalMode}.` + (p.emsHandoff ? ` EMS: "${p.emsHandoff}"` : ""),
    "CHIEF COMPLAINT: " + p.chiefComplaint,
    "VITALS: " + fmtV(DW.vitalsAt(enc, 0)),
    "WHAT YOU SEE FROM THE DOORWAY: " + p.doorwayImpression,
  ].join("\n");
}

async function derekCall(kind, user, schema, log) {
  const body = { model: DEREK_MODEL, max_tokens: 4000, system: DEREK_SYSTEM, messages: [{ role: "user", content: user }], output_config: { effort: "medium", format: { type: "json_schema", schema } } };
  const t0 = Date.now();
  let data, err = null;
  try { data = await anthropic(realFetch, body); }
  catch (e) {
    // A schema the API will not compile should not kill the run: retry without the format.
    if (e.status === 400 && /schema|format|output_config/i.test(e.message)) { delete body.output_config.format; data = await anthropic(realFetch, body); err = "schema rejected: " + e.message; }
    else throw e;
  }
  const ms = Date.now() - t0;
  const text = textOf(data);
  let parsed = null;
  try { parsed = DW._.extractJSON(text); } catch (e) { err = (err ? err + "; " : "") + "unparsable: " + e.message; }
  log({ kind, ms, model: DEREK_MODEL, usage: data.usage, stop_reason: data.stop_reason, request: body, response: data, error: err });
  if (!parsed) throw new Error("Derek's " + kind + " was not JSON: " + text.slice(0, 120));
  return parsed;
}

// Scripted Derek for --stub: exercises every path without a model.
function stubDerek(enc, turn) {
  if (turn === 0) return { why: "looks sick", sick: true, acuity: 2, gutDispo: "Transfer" };
  const plan = [
    { chips: [{ group: "History", label: "When did this start?" }, { group: "Exam", label: "General appearance" }], text: "" },
    { chips: [{ group: "Labs", label: "Lactate" }, { group: "Labs", label: "CBC+BMP" }, { group: "Imaging", label: "ECG" }], text: "" },
    { chips: [{ group: "Stabilize", label: "IV access + fluids" }], text: "How are you feeling now?" },
    { chips: [{ group: "Transfer", label: "Call receiving facility" }, { group: "Transfer", label: "Request ground ALS" }], text: "" },
  ];
  if (turn <= plan.length) return { note: "scripted", commit: false, ddx: [], confidence: 0, finalDispo: "Transfer", transferChecklist: tc(false), ...plan[turn - 1] };
  return { note: "commit", chips: [], text: "", commit: true, ddx: [enc.case.answerKey.trueDx, "Pneumonia", "PE"], confidence: 70, finalDispo: "Emergent transfer", transferChecklist: tc(true) };
}
function tc(v) { return { airway: v, access: v, blood: v, pressors: v, sedation: v, receivingCall: v }; }

// ── Leak check ──────────────────────────────────────────────────────────────
const GENERIC = new Set(["acute", "syndrome", "with", "needing", "presenting", "decision", "adult", "pediatric", "elderly", "patient", "severe", "mild", "chronic",
  "stable", "unstable", "hemodynamically", "primary", "secondary", "uncomplicated", "outpatient", "appropriate", "nursing", "home", "new", "onset", "missed",
  "session", "no", "bed", "after", "without", "transfer", "center", "crisis", "care", "level", "simple", "major", "minor", "infant", "child", "toddler", "newborn"]);
function dxWords(c) {
  const names = [c.answerKey.trueDx];
  const entry = c.seed && CASES.byId(c.seed.dxId);
  if (entry) names.push(entry.dx);
  const words = new Set();
  names.forEach((n) => DW._.dxTokens(n).forEach((w) => { if (!GENERIC.has(w) && w.length > 3) words.add(w); }));
  return { names: names.map((n) => n.toLowerCase()), words: Array.from(words) };
}
function leakScan(text, dx) {
  const t = String(text || "").toLowerCase();
  const hitsName = dx.names.filter((n) => n && t.indexOf(n) >= 0);
  const hitWords = dx.words.filter((w) => new RegExp("\\b" + w.replace(/[^a-z0-9]/g, "") + "\\w*", "i").test(t));
  if (hitsName.length || hitWords.length >= 2) return { name: hitsName[0] || null, words: hitWords };
  return null;
}

// ── One case ────────────────────────────────────────────────────────────────
function seedFor(i) {
  const seed = CASES.pickCase({}, { seed: BASE_SEED + i * 7919, mode: MODE });
  if (config.forcedDx) {
    const entry = CASES.byId(config.forcedDx[i % config.forcedDx.length]);
    if (!entry) throw new Error("unknown --dx " + config.forcedDx[i % config.forcedDx.length]);
    Object.assign(seed, { dxId: entry.id, dx: entry.dx, domain: entry.domain, bucket: entry.bucket, cantMiss: entry.cantMiss, presentation: entry.presentations[0] });
    if (entry.sex) seed.sex = entry.sex;
    if (entry.ages.indexOf(seed.ageBand) < 0) {
      seed.ageBand = entry.ages[0];
      const b = CASES.AGE_BANDS[seed.ageBand];
      seed.age = Math.round((b.min + b.max) / 2);
      seed.ageLabel = CASES.ageLabel(seed.age);
    }
    if (entry.ageRange) { seed.age = Math.round((entry.ageRange[0] + entry.ageRange[1]) / 2 * 100) / 100; seed.ageLabel = CASES.ageLabel(seed.age); }
    seed.transferTwist = null;
    seed.reexposure = null;
  }
  return seed;
}

async function runCase(i) {
  const dir = path.join(OUT, "case-" + String(i + 1).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  const calls = [];
  CFG.onCall = (info) => { calls.push(info); appendJSONL(path.join(dir, "calls.jsonl"), info); };
  const derekLog = (info) => appendJSONL(path.join(dir, "derek.jsonl"), info);
  const seed = seedFor(i);
  writeJSON(path.join(dir, "seed.json"), seed);
  const summary = { n: i + 1, dxId: seed.dxId, dx: seed.dx, bucket: seed.bucket, domain: seed.domain, ageBand: seed.ageBand, presentation: seed.presentation, conditions: CASES.conditionsLabel(seed.conditions), transferTwist: seed.transferTwist };
  const t0 = Date.now();
  process.stdout.write(`\n[${i + 1}/${N}] ${seed.dx} (${seed.bucket}, ${seed.ageBand}, ${summary.conditions}) … `);
  try {
    const c = await DW._.generateCase(seed);
    summary.genMs = Date.now() - t0;
    writeJSON(path.join(dir, "case.json"), c);
    const dx = dxWords(c);
    const leaks = [];
    const scan = (where, text) => { const h = leakScan(text, dx); if (h) leaks.push({ where, hit: h, text: String(text).slice(0, 200) }); };
    scan("doorwayImpression", c.persona.doorwayImpression);
    Object.entries(c.history || {}).forEach(([k, v]) => scan("history:" + k, v));
    summary.filled = (c._filled || []).length;
    summary.review = c.review ? { ok: c.review.first && c.review.first.ok, issues: c.review.first ? c.review.first.issues.length : null, blocking: c.review.first ? c.review.first.issues.filter((x) => x.severity === "block").length : null, regenerated: c.review.regenerated } : null;

    let enc = DW.startEncounter(c);
    const gutIn = STUB ? stubDerek(enc, 0) : await derekCall("gut", doorwayText(enc) + "\n\nLock your doorway read now. Return JSON: {\"why\":\"one line\",\"sick\":bool,\"acuity\":1-5 (ESI, 1 = resuscitation),\"gutDispo\":\"Discharge|Admit|Transfer\"}", GUT_SCHEMA, derekLog);
    enc = DW.lockGut(enc, { sick: !!gutIn.sick, acuity: Number(gutIn.acuity), gutDispo: gutIn.gutDispo });
    summary.gut = enc.gut;
    summary.gutWhy = gutIn.why;

    let answers = null, turns = 0, events = [], unknownChips = [];
    const turnMs = [];
    for (let t = 1; t <= MAX_TURNS + 1; t++) {
      const v = DW.vitalsAt(enc, enc.simMin);
      const prev = enc.vitalsHistory.length > 1 ? enc.vitalsHistory[enc.vitalsHistory.length - 2].vitals : null;
      const must = t > MAX_TURNS;
      const user = [
        doorwayText(enc),
        `\nT+${enc.simMin} min · turn ${Math.min(t, MAX_TURNS)} of ${MAX_TURNS}${must ? " · TURN LIMIT REACHED: you must commit now" : ""}.`,
        "VITALS NOW: " + fmtV(v) + (prev ? "   (before: " + fmtV(prev) + ")" : ""),
        "YOUR LOCKED READ: " + (enc.gut.sick ? "sick" : "not sick") + ", ESI " + enc.gut.acuity + ", " + enc.gut.gutDispo,
        "DONE SO FAR: " + (enc.applied.length ? enc.applied.map((a) => { const iv = c.interventions.find((x) => x.id === a.id); return (iv ? iv.label : a.id) + " @T+" + a.atMin; }).join("; ") : "nothing yet"),
        enc.transport ? "TRANSPORT: " + enc.transport.mode + " " + enc.transport.status + (enc.transport.etaMin != null ? " ETA T+" + enc.transport.etaMin : "") : "TRANSPORT: none requested",
        "RECEIVING FACILITY: " + (enc.accepted ? "accepted" : enc.receivingCalls ? "declined so far" : "not called"),
        events.length ? "EVENTS LAST TURN: " + events.map((e) => e.text).join(" · ") : "",
        unknownChips.length ? "IGNORED (not on the menu): " + unknownChips.join(", ") + ". Use exact labels or free text." : "",
        "\nLOG:\n" + logText(enc),
        "\nORDER MENU (exact labels):\n" + menuText(),
        must ? "\nCommit now: JSON with commit:true, ddx (3, most likely first), confidence 0-100, finalDispo, transferChecklist."
          : "\nYour move. JSON: {\"note\":\"one line of reasoning\",\"chips\":[{\"group\":\"\",\"label\":\"\"}],\"text\":\"free text or empty\",\"commit\":false,\"ddx\":[],\"confidence\":0,\"finalDispo\":\"your current leaning\",\"transferChecklist\":{...all false}} — or commit:true with ddx (3, most likely first), confidence 0-100, finalDispo for THIS facility, and transferChecklist.",
      ].filter(Boolean).join("\n");
      const d = STUB ? stubDerek(enc, t) : await derekCall("turn", user, TURN_SCHEMA, derekLog);
      if (d.commit || must) {
        answers = { ddx: (d.ddx || []).map(String).filter(Boolean).slice(0, 3), confidence: Number(d.confidence) || 50, finalDispo: DW.DISPOS.includes(d.finalDispo) ? d.finalDispo : "Transfer", transferChecklist: d.transferChecklist || null };
        if (!answers.ddx.length) answers.ddx = ["Unsure"];
        break;
      }
      unknownChips = [];
      const chips = (d.chips || []).filter((ch) => { const ok = ch && DW.CHIPS[ch.group] && DW.CHIPS[ch.group].includes(ch.label); if (!ok && ch) unknownChips.push(ch.label); return ok; });
      const text = String(d.text || "").trim();
      if (!chips.length && !text) { events = []; continue; }
      const tt = Date.now();
      const r = await DW.act(enc, { chips, text: text || undefined });
      turnMs.push(Date.now() - tt);
      enc = r.enc;
      events = r.events || [];
      turns++;
    }
    summary.turns = turns;
    summary.turnMsAvg = Math.round(mean(turnMs));
    summary.simMin = enc.simMin;
    writeJSON(path.join(dir, "enc.json"), enc);
    writeJSON(path.join(dir, "answers.json"), answers);

    // model-authored turn text, for the leak scan
    calls.filter((x) => x.kind === "turn" && x.response).forEach((x, k) => {
      let r = null; try { r = DW._.extractJSON(textOf(x.response)); } catch (e) { /* counted below */ }
      (r && r.responses || []).forEach((resp) => scan("turn" + (k + 1) + ":" + resp.kind, resp.text));
    });

    const tg = Date.now();
    const grade = await DW.grade(enc, answers);
    summary.gradeMs = Date.now() - tg;
    writeJSON(path.join(dir, "grade.json"), grade);
    fs.writeFileSync(path.join(dir, "transcript.txt"), [doorwayText(enc), "", "GUT: " + JSON.stringify(enc.gut) + " — " + summary.gutWhy, "", DW._.transcriptText(enc), "", "ANSWERS: " + JSON.stringify(answers), "", "TRUTH: " + JSON.stringify(c.answerKey), "", "GRADE: " + JSON.stringify(grade, null, 1)].join("\n"));
    DW.recordResult(enc, grade, {});

    summary.score = grade.score;
    summary.caught = grade.caughtInDdx;
    summary.rank = grade.rankOfTrueDx;
    summary.trueAcuity = c.answerKey.trueAcuity;
    summary.acuityError = Math.abs(enc.gut.acuity - c.answerKey.trueAcuity);
    summary.trueDispo = c.answerKey.trueDispo;
    summary.finalDispo = answers.finalDispo;
    summary.dispoOk = grade.dispoOk;
    summary.critical = grade.criticalActions.map((a) => a.id + ":" + a.status + (a.atMin != null ? "@" + a.atMin : ""));
    summary.firstCritMin = grade.criticalActions.filter((a) => a.status !== "missed" && a.atMin != null).map((a) => a.atMin).sort((a, b) => a - b)[0] ?? null;
    summary.criticalError = grade.criticalError;
    summary.leaks = leaks;
  } catch (e) {
    summary.error = e.message;
    summary.refusal = !!e.refusal;
    summary.category = e.category || null;
    process.stdout.write("ERROR: " + e.message);
  }
  summary.totalMs = Date.now() - t0;

  // per-kind call stats
  const byKind = {};
  for (const x of calls) {
    const b = byKind[x.kind] || (byKind[x.kind] = { calls: 0, retries: 0, ms: [], in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, maxTokens: 0, refusals: 0, errors: 0 });
    b.calls++; if (x.attempt) b.retries++;
    b.ms.push(x.ms);
    if (x.usage) { b.in += x.usage.input_tokens || 0; b.out += x.usage.output_tokens || 0; b.cacheRead += x.usage.cache_read_input_tokens || 0; b.cacheWrite += x.usage.cache_creation_input_tokens || 0; b.cost += costOf(x.model, x.usage); }
    if (x.stop_reason === "max_tokens") b.maxTokens++;
    if (x.stop_reason === "refusal") b.refusals++;
    if (x.error) b.errors++;
  }
  const expected = { case: 1, results: 1, review: CFG.review ? 1 : 0, grade: 1 };
  summary.calls = {};
  let cost = 0;
  for (const [k, b] of Object.entries(byKind)) {
    summary.calls[k] = { calls: b.calls, retries: b.retries, extra: Math.max(0, b.calls - (expected[k] ?? b.calls)), msAvg: Math.round(mean(b.ms)), msMax: Math.max(...b.ms), in: b.in, out: b.out, cacheRead: b.cacheRead, cacheWrite: b.cacheWrite, maxTokens: b.maxTokens, refusals: b.refusals, errors: b.errors, cost: round(b.cost, 3) };
    cost += b.cost;
  }
  summary.cost = round(cost, 3);
  writeJSON(path.join(dir, "summary.json"), summary);
  process.stdout.write(summary.error ? "" : ` score ${summary.score} caught ${summary.caught} gen ${Math.round(summary.genMs / 1000)}s turns ${summary.turns} leaks ${summary.leaks.length} $${summary.cost}\n`);
  CFG.onCall = null;
  return summary;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const results = [];
for (let i = 0; i < N; i++) results.push(await runCase(i));
writeJSON(path.join(OUT, "summary.json"), { config, results });

const ok = results.filter((r) => !r.error);
const md = [];
md.push(`# Live run ${path.basename(OUT)}`, "", `${N} cases · mode ${MODE} · Derek ${DEREK_MODEL} · models ${JSON.stringify(CFG.models)} · structured ${CFG.structured} · review ${CFG.review} · cache ${CFG.cache}`, "");
md.push("| # | dx | bucket | cond | gen s | turns | sim min | gut→true ESI | score | caught | crit | leaks | extra calls | max_tok | refusal | $ |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  const extra = Object.values(r.calls || {}).reduce((s, b) => s + b.extra, 0);
  const mt = Object.values(r.calls || {}).reduce((s, b) => s + b.maxTokens, 0);
  const crit = (r.critical || []).map((x) => x.split(":")[1][0]).join("") || "—";
  md.push(`| ${r.n} | ${r.dx} | ${r.bucket} | ${r.conditions} | ${r.genMs ? Math.round(r.genMs / 1000) : "—"} | ${r.turns ?? "—"} | ${r.simMin ?? "—"} | ${r.gut ? r.gut.acuity : "—"}→${r.trueAcuity ?? "—"} | ${r.score ?? (r.error ? "ERR" : "—")} | ${r.caught == null ? "—" : r.caught ? "yes" : "no"} | ${crit} | ${(r.leaks || []).length} | ${extra} | ${mt} | ${r.refusal ? r.category || "yes" : ""} | ${r.cost ?? ""} |`);
}
md.push("");
if (ok.length) {
  md.push(`**${ok.length}/${N} completed.** mean score ${round(mean(ok.map((r) => r.score)))} · caught ${ok.filter((r) => r.caught).length}/${ok.length} · mean acuity error ${round(mean(ok.map((r) => r.acuityError)), 2)} · mean gen ${round(mean(ok.map((r) => r.genMs)) / 1000)} s · mean grade ${round(mean(ok.map((r) => r.gradeMs)) / 1000)} s · mean cost $${round(mean(results.map((r) => r.cost || 0)), 3)} · total $${round(results.reduce((s, r) => s + (r.cost || 0), 0), 2)}`, "");
  const kinds = {};
  for (const r of results) for (const [k, b] of Object.entries(r.calls || {})) { const t = kinds[k] || (kinds[k] = { calls: 0, retries: 0, ms: [], in: 0, out: 0, cr: 0, cw: 0, mt: 0, ref: 0 }); t.calls += b.calls; t.retries += b.retries; t.ms.push(b.msAvg); t.in += b.in; t.out += b.out; t.cr += b.cacheRead; t.cw += b.cacheWrite; t.mt += b.maxTokens; t.ref += b.refusals; }
  md.push("| kind | model | calls | retries | avg s | in tok | out tok | cache read | cache write | max_tokens hits | refusals |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [k, t] of Object.entries(kinds)) md.push(`| ${k} | ${CFG.models[k]} | ${t.calls} | ${t.retries} | ${round(mean(t.ms) / 1000)} | ${t.in} | ${t.out} | ${t.cr} | ${t.cw} | ${t.mt} | ${t.ref} |`);
  md.push("");
}
const errs = results.filter((r) => r.error);
if (errs.length) { md.push("## Errors", ""); errs.forEach((r) => md.push(`- case ${r.n} (${r.dx}): ${r.error}`)); md.push(""); }
const leaked = results.filter((r) => (r.leaks || []).length);
if (leaked.length) { md.push("## Leak flags (read each; the scan is deliberately eager)", ""); leaked.forEach((r) => r.leaks.forEach((l) => md.push(`- case ${r.n} (${r.dx}) · ${l.where} · ${l.hit.name ? "names the dx" : "words: " + l.hit.words.join(", ")} — "${l.text}"`))); md.push(""); }
const reviewed = results.filter((r) => r.review);
if (reviewed.length) { md.push("## Clinical review", ""); reviewed.forEach((r) => md.push(`- case ${r.n} (${r.dx}): ok ${r.review.ok} · issues ${r.review.issues} · blocking ${r.review.blocking} · regenerated ${r.review.regenerated}`)); md.push(""); }
fs.writeFileSync(path.join(OUT, "summary.md"), md.join("\n"));
console.log("\n" + md.join("\n"));
