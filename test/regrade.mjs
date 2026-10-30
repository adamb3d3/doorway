#!/usr/bin/env node
// Grader consistency: regrade saved transcripts several times, on one or more models, and
// report the spread. If the same transcript's scores spread more than ±5, the number is noise.
//
//   node test/regrade.mjs runs/<dir> --cases 1,3,5 --models sonnet,opus --n 3
//   node test/regrade.mjs runs/<dir> --stub          # plumbing check with the fake API
//
// Reads case-NN/{enc,answers}.json from the run and writes regrade-<stamp>.{json,md} beside them.
import fs from "node:fs";
import path from "node:path";
import { ROOT, boot, modelId, costOf, stamp, writeJSON, parseArgs, mean, sd, round } from "./live-common.mjs";

const args = parseArgs(process.argv.slice(2));
const RUN = path.resolve(ROOT, args._[0] || "");
if (!args._[0] || !fs.existsSync(RUN)) { console.error("usage: node test/regrade.mjs runs/<dir> [--cases 1,2] [--models sonnet,opus] [--n 3] [--effort high]"); process.exit(2); }
const STUB = !!args.stub;
const N = Number(args.n || 3);
const MODELS = String(args.models || "sonnet,opus").split(",").map((s) => modelId(s.trim()));
const EFFORT = args.effort || "high";
const dirs = fs.readdirSync(RUN).filter((d) => /^case-\d+$/.test(d)).sort();
const want = args.cases ? String(args.cases).split(",").map((s) => "case-" + String(s.trim()).padStart(2, "0")) : dirs;
const cases = want.filter((d) => fs.existsSync(path.join(RUN, d, "enc.json")) && fs.existsSync(path.join(RUN, d, "answers.json")));
if (!cases.length) { console.error("no case-NN/enc.json + answers.json under", RUN); process.exit(2); }

const { DW } = await boot({ stub: STUB });
const CFG = DW._.CONFIG;
CFG.effort.grade = EFFORT;
if (args.structured) CFG.structured = true;

const out = { run: RUN, n: N, models: MODELS, effort: EFFORT, structured: CFG.structured, cases: [] };
const md = [`# Regrade ${path.basename(RUN)} · ${N}× per model · effort ${EFFORT} · structured ${CFG.structured}`, ""];
md.push("| case | dx | first score | model | scores | mean | spread | sd | caught | stab | dispoOk | crit statuses stable | avg s | $ |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");

for (const d of cases) {
  const enc = JSON.parse(fs.readFileSync(path.join(RUN, d, "enc.json"), "utf8"));
  const answers = JSON.parse(fs.readFileSync(path.join(RUN, d, "answers.json"), "utf8"));
  let first = null; try { first = JSON.parse(fs.readFileSync(path.join(RUN, d, "grade.json"), "utf8")); } catch (e) { /* none */ }
  const rec = { case: d, dx: enc.case.answerKey.trueDx, firstScore: first ? first.score : null, byModel: {} };
  for (const model of MODELS) {
    CFG.models.grade = model;
    const grades = [], ms = [];
    let cost = 0;
    CFG.onCall = (info) => { if (info.usage) cost += costOf(info.model, info.usage); };
    process.stdout.write(`${d} ${model} `);
    for (let i = 0; i < N; i++) {
      const t0 = Date.now();
      try { grades.push(await DW.grade(enc, answers)); process.stdout.write("."); }
      catch (e) { grades.push({ error: e.message }); process.stdout.write("x"); }
      ms.push(Date.now() - t0);
    }
    process.stdout.write("\n");
    const good = grades.filter((g) => !g.error);
    const scores = good.map((g) => g.score);
    const critSig = good.map((g) => g.criticalActions.map((a) => a.id + ":" + a.status).join(","));
    const row = {
      scores, mean: round(mean(scores)), spread: scores.length ? Math.max(...scores) - Math.min(...scores) : null, sd: round(sd(scores), 1),
      caught: good.map((g) => g.caughtInDdx), stab: good.map((g) => g.stabilizationGrade), dispoOk: good.map((g) => g.dispoOk),
      critStable: new Set(critSig).size <= 1, carryForward: good.map((g) => g.carryForward), criticalError: good.map((g) => g.criticalError),
      errors: grades.filter((g) => g.error).map((g) => g.error), msAvg: Math.round(mean(ms)), cost: round(cost, 3), grades: good,
    };
    rec.byModel[model] = row;
    md.push(`| ${d} | ${rec.dx} | ${rec.firstScore ?? "—"} | ${model} | ${scores.join(" / ")} | ${row.mean} | ${row.spread ?? "—"} | ${row.sd} | ${row.caught.map((x) => (x ? "y" : "n")).join("")} | ${row.stab.map((s) => s[0]).join("")} | ${row.dispoOk.map((x) => (x ? "y" : "n")).join("")} | ${row.critStable ? "yes" : "NO"} | ${round(row.msAvg / 1000)} | ${row.cost} |`);
  }
  out.cases.push(rec);
}
CFG.onCall = null;

md.push("");
for (const model of MODELS) {
  const spreads = out.cases.map((c) => c.byModel[model].spread).filter((x) => x != null);
  const sds = out.cases.map((c) => c.byModel[model].sd);
  md.push(`**${model}**: mean spread ${round(mean(spreads))} (max ${spreads.length ? Math.max(...spreads) : "—"}) · mean sd ${round(mean(sds), 1)} · ${spreads.filter((s) => s > 10).length}/${spreads.length} transcripts spread beyond ±5`);
}
md.push("", "A transcript whose scores spread more than 10 points (±5) has a grade that is mostly noise; the debrief should then show the band, not the number.");
const s = stamp();
writeJSON(path.join(RUN, `regrade-${s}.json`), out);
fs.writeFileSync(path.join(RUN, `regrade-${s}.md`), md.join("\n"));
console.log("\n" + md.join("\n"));
