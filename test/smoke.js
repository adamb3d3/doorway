// Playwright smoke test for The Doorway v3. Run from the repo root:
//   node test/smoke.js
// Needs: node 18+, the `playwright` package with Chromium, python3, and network
// access to unpkg.com (React/Babel). Google Fonts are stubbed out.
//
// It serves the repo with `python3 -m http.server` on a free port (checking that
// the page it gets back is this repo's index.html), answers POST /api/claude from
// test/stub.js by X-DW-Kind, and walks at 390x844:
//   loop 1: first-run landing -> enter -> Next patient -> doorway lock -> History
//           chip (local) -> Stabilize + Transfer chips (local) -> free text (turn
//           call) -> commit -> debrief (timeline order, DDx rank) -> home ->
//           recent case (read-only full debrief)
//   loop 2: Next patient (prefetched) -> lock -> order -> RELOAD -> Resume banner
//           restores the encounter -> commit -> debrief -> home
// It fails unless case, results, turn and grade calls all reached the stub.
// Screenshots go to shots/v3/. Any console error or page error fails the run.
//
// Selectors are role/text based so the UI needs no test ids. See the
// `expect` notes next to each step for the labels the UI must expose.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { fakeResponse } = require("./stub");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { console.error("Install Playwright first: npm i -D playwright && npx playwright install chromium"); process.exit(2); }

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots", "v3");
let PORT = Number(process.env.PORT || 0); // 0 = pick a free one
let BASE = "";
const STEP_TIMEOUT = 20000;

fs.mkdirSync(SHOTS, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require("net").createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve(d)); }).on("error", reject);
  });
}

function waitForServer(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function poll() {
      http.get(url, (r) => { r.resume(); resolve(); }).on("error", () => {
        if (Date.now() > end) reject(new Error("server did not start")); else setTimeout(poll, 150);
      });
    })();
  });
}

// Click the first candidate locator that becomes visible. Candidates are tried
// in order, polling until the timeout, so labels can vary slightly.
async function clickFirst(page, label, candidates, timeout = STEP_TIMEOUT) {
  const loc = await findFirst(page, label, candidates, timeout);
  await loc.click();
  return loc;
}

async function findFirst(page, label, candidates, timeout = STEP_TIMEOUT) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const make of candidates) {
      const loc = make(page).first();
      try { if (await loc.isVisible()) return loc; } catch (e) { /* not there yet */ }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Step "${label}": none of the expected controls appeared`);
}

const btn = (name) => (p) => p.getByRole("button", { name });
const anyRole = (name) => (p) => p.getByRole("button", { name }).or(p.getByRole("radio", { name })).or(p.getByRole("tab", { name }));

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
  console.log("  shot", name);
}

// Doorway: Sick / acuity 2 / Admit -> Lock and start.
async function lockDoorway(page, shotPrefix) {
  // expect: buttons "Sick" and "Not sick"; acuity buttons/radios whose name is or contains the digit;
  // gut dispo "Discharge" / "Admit" / "Transfer"; a "Lock and start" button.
  const sick = await findFirst(page, "doorway", [anyRole(/^sick$/i)], 60000);
  if (shotPrefix) await shot(page, shotPrefix + "-doorway");
  await sick.click();
  await clickFirst(page, "acuity 2", [anyRole(/^(acuity|esi)?\s*2$/i), anyRole(/^(acuity|esi)\s*2\b/i), anyRole(/^2\b/)]);
  await clickFirst(page, "gut dispo", [anyRole(/^admit$/i), anyRole(/^admit\b/i)]);
  const lock = await findFirst(page, "lock", [btn(/lock and start/i), btn(/^lock\b/i)]);
  if (!(await lock.isEnabled())) throw new Error('"Lock and start" is still disabled after sick + acuity + dispo');
  if (shotPrefix) {
    await shot(page, shotPrefix + "-doorway-set");
    // Fit at 390×844: every read control sits above the lock bar with no scrolling.
    const fit = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("button")].find((b) => /lock and start/i.test(b.textContent)).parentElement.getBoundingClientRect();
      const radios = [...document.querySelectorAll("[role=radio]")].map((r) => r.getBoundingClientRect());
      return { scrollY: window.scrollY, barTop: bar.top, barBottom: bar.bottom, lowest: Math.max(...radios.map((r) => r.bottom)), n: radios.length, vh: window.innerHeight,
        barBg: getComputedStyle([...document.querySelectorAll("button")].find((b) => /lock and start/i.test(b.textContent)).parentElement).backgroundColor };
    });
    if (fit.n !== 10 || fit.scrollY !== 0 || fit.lowest > fit.barTop || fit.barBottom > fit.vh + 1) throw new Error("doorway does not fit 390×844: " + JSON.stringify(fit));
    if (!/rgb\(10, 10, 10\)/.test(fit.barBg)) throw new Error("lock bar is not solid: " + fit.barBg);
  }
  await lock.click();
  await findFirst(page, "workup", [btn(/^commit$/i)]);
}

// Opens a chip group tab (if its chips are not showing) and taps the chips.
async function pickChips(page, group, labels) {
  for (const label of labels) {
    const chip = page.getByRole("button", { name: label, exact: true }).first();
    if (!(await chip.isVisible().catch(() => false))) await clickFirst(page, group + " group", [(p) => p.locator(`button[aria-controls="dw-chip-panel"]`, { hasText: new RegExp("^" + group, "i") })]);
    await chip.click();
  }
}

async function sendAndWait(page, waitText) {
  await clickFirst(page, "send", [btn(/^send( \d+ orders?)?$/i)]); // not the "Send records/imaging" chip
  await page.getByText(waitText).first().waitFor({ timeout: STEP_TIMEOUT });
  // busy clears when the Send button stops showing "…"
  await page.waitForFunction(() => !document.querySelector("input[aria-label='Free text order or question']").disabled
    && ![...document.querySelectorAll("button")].some((b) => b.textContent === "…"), null, { timeout: STEP_TIMEOUT });
}

const active = (page) => page.evaluate(() => { const a = window.DW.loadActive(); return a && { simMin: a.simMin, trueDx: a.case.answerKey.trueDx, caseId: a.case.seed.caseId, logLen: a.log.length, gut: a.gut }; });

async function commitAndCheckDebrief(page, trueDx, simMin, shotPrefix) {
  await clickFirst(page, "commit", [btn(/^commit$/i)]);
  // expect: DDx inputs labelled "Diagnosis 1..3"; final dispo as buttons/radios or a <select>; a submit button.
  const ddx1 = await findFirst(page, "ddx #1", [(p) => p.getByLabel(/(ddx|diagnosis|dx)\s*#?\s*1/i), (p) => p.locator("input[list]")]);
  await ddx1.fill("Zz not a real diagnosis");
  await page.getByLabel(/(ddx|diagnosis|dx)\s*#?\s*2/i).first().fill(trueDx);
  const select = page.locator("select").filter({ has: page.locator("option", { hasText: "Admit inpatient" }) });
  if (await select.count()) await select.first().selectOption({ label: "Admit inpatient" });
  else await clickFirst(page, "final dispo", [anyRole(/^admit inpatient$/i)]);
  if (shotPrefix) await shot(page, shotPrefix + "-commit");
  await clickFirst(page, "submit", [btn(/^submit\b/i), btn(/^grade\b/i)]);

  // expect: the "Carry forward" card, the DDx rank the stub derived from what was typed, a sorted timeline.
  await page.getByText(/carry forward/i).first().waitFor({ timeout: 60000 });
  await page.getByText(/true dx at #2/i).first().waitFor({ timeout: STEP_TIMEOUT });
  await checkTimeline(page, simMin, "debrief");
  await page.waitForTimeout(400);
  if (shotPrefix) {
    await shot(page, shotPrefix + "-debrief");
    await page.screenshot({ path: path.join(SHOTS, shotPrefix + "b-debrief-full.png"), fullPage: true });
  }
}

async function checkTimeline(page, simMin, where) {
  const tl = await page.evaluate(() => [...document.querySelectorAll("[data-tl-min]")].map((e) => [Number(e.dataset.tlMin), e.dataset.tlKind]));
  if (!tl.length) throw new Error(where + ": no timeline rendered");
  for (let i = 1; i < tl.length; i++) if (tl[i][0] < tl[i - 1][0]) throw new Error(where + ": timeline out of order: " + JSON.stringify(tl));
  const last = tl[tl.length - 1];
  if (last[1] !== "commit" || last[0] !== simMin) throw new Error(where + `: commit should be last at T+${simMin}: ` + JSON.stringify(tl));
}

(async () => {
  if (!PORT) PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  let serverExit = null;
  server.on("exit", (code) => { serverExit = code; });
  const errors = [];
  const apiCalls = [];
  let browser;
  let failed = false;

  try {
    await waitForServer(BASE + "/index.html", 10000);
    if (serverExit !== null) throw new Error(`http.server exited (${serverExit}); is port ${PORT} taken?`);
    const served = await fetchText(BASE + "/index.html");
    if (!/engine\.js\?v=/.test(served) || !/app\.jsx\?v=/.test(served)) throw new Error(`${BASE} is not serving this repo's index.html`);
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      serviceWorkers: "block", // so page.route sees every request
    });
    const page = await context.newPage();

    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });

    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }));

    await page.route("**/api/claude", async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fulfill({ status: 405, contentType: "application/json", body: '{"error":"POST only."}' });
      const kind = req.headers()["x-dw-kind"];
      let body = null;
      try { body = req.postDataJSON(); } catch (e) { /* ignore */ }
      apiCalls.push(kind);
      const ALLOWED = ["claude-sonnet-5-5", "claude-opus-5-5"];
      if (!body || !ALLOWED.includes(body.model)) errors.push(`api: wrong model "${body && body.model}" for kind ${kind}`);
      try {
        const data = fakeResponse(kind, body);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      } catch (e) {
        errors.push("stub: " + e.message);
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: e.message }) });
      }
    });

    // ── Loop 1 ──────────────────────────────────────────────────────────────
    console.log("1 landing");
    await page.goto(BASE + "/");
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload();
    await page.waitForFunction(() => window.__dwMounted === true, null, { timeout: STEP_TIMEOUT });
    await shot(page, "01-landing");
    await clickFirst(page, "enter from landing", [
      btn(/walk through the doorway/i), btn(/accept your first patient/i), btn(/^enter\b/i), btn(/get started|begin/i),
    ]);

    console.log("2 home");
    const next = await findFirst(page, "home", [btn(/next patient/i)]);
    await shot(page, "02-home");
    await next.click();

    console.log("3 doorway");
    await lockDoorway(page, "03");
    if (!apiCalls.includes("case") || !apiCalls.includes("results")) throw new Error("the case did not come from the API: " + apiCalls.join(","));

    console.log("4 workup");
    await pickChips(page, "History", ["When did this start?"]);
    await shot(page, "05-chip-tray");
    await sendAndWait(page, /since yesterday/i);
    const groupsVisible = await page.evaluate(() => [...document.querySelectorAll('button[aria-controls="dw-chip-panel"]')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
    if (!groupsVisible) throw new Error("an order group is off-screen");
    await pickChips(page, "Stabilize", ["IV access + fluids"]);
    await pickChips(page, "Transfer", ["Call receiving facility"]);
    await sendAndWait(page, /LR running wide open/i);
    const before = apiCalls.filter((k) => k === "turn").length;
    await page.getByLabel("Free text order or question").fill("Hang broad-spectrum antibiotics now");
    await sendAndWait(page, /antibiotics started/i);
    if (apiCalls.filter((k) => k === "turn").length !== before + 1) throw new Error("free text did not make exactly one turn call");
    // live avatar state: the turn set diaphoresis 3 → the header silhouette carries it
    const dia = await page.locator("header svg[data-pose]").first().getAttribute("data-diaphoresis");
    if (dia !== "3") throw new Error(`workup avatar is not drawn from enc.physicality (diaphoresis ${dia}, want 3)`);
    await shot(page, "06-workup-after-send");

    console.log("5 commit + debrief");
    const a1 = await active(page);
    await commitAndCheckDebrief(page, a1.trueDx, a1.simMin, "07");
    if (await page.evaluate(() => window.DW.loadActive())) throw new Error("active encounter not cleared after grading");
    await clickFirst(page, "home", [btn(/^home$/i)]);

    console.log("6 recent case (read-only)");
    await findFirst(page, "home after debrief", [btn(/next patient/i)]);
    await shot(page, "09-home-after");
    await page.getByRole("button", { name: new RegExp(a1.trueDx.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
    await page.getByText(/past case/i).first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText(/carry forward/i).first().waitFor({ timeout: STEP_TIMEOUT });
    await checkTimeline(page, a1.simMin, "recent case");
    if (await page.getByRole("button", { name: /save reflection/i }).count()) throw new Error("read-only debrief offers editing");
    await shot(page, "10-recent-case");
    await clickFirst(page, "home", [btn(/^home$/i)]);

    // ── Loop 2: resume after reload ─────────────────────────────────────────
    console.log("7 loop 2: next patient");
    await page.waitForFunction(() => window.DW.hasPrefetched(), null, { timeout: STEP_TIMEOUT });
    const caseCalls = apiCalls.filter((k) => k === "case").length;
    await clickFirst(page, "next patient", [btn(/next patient/i)]);
    await lockDoorway(page, null);
    if (apiCalls.filter((k) => k === "case").length !== caseCalls) throw new Error("prefetched case was not used");
    await pickChips(page, "Stabilize", ["IV access + fluids"]);
    await sendAndWait(page, /LR running wide open/i);
    const a2 = await active(page);
    if (!a2 || !a2.gut || a2.simMin <= 0) throw new Error("no active encounter mid-workup: " + JSON.stringify(a2));

    console.log("8 reload → resume");
    await page.reload();
    await page.waitForFunction(() => window.__dwMounted === true, null, { timeout: STEP_TIMEOUT });
    const banner = await findFirst(page, "resume banner", [btn(new RegExp(`patient in progress · T\\+${a2.simMin} min`, "i"))]);
    await shot(page, "11-resume-banner");
    await banner.click();
    await findFirst(page, "resumed workup", [btn(/^commit$/i)]);
    await page.getByText(new RegExp(`^T\\+${a2.simMin}`)).first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText(/LR running wide open/i).first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText(/Sick · ESI 2 · Admit/).first().waitFor({ timeout: STEP_TIMEOUT });
    const a3 = await active(page);
    if (a3.caseId !== a2.caseId || a3.logLen !== a2.logLen) throw new Error("resume restored a different encounter");
    await shot(page, "12-resumed");
    await pickChips(page, "Labs", ["Lactate"]);
    await sendAndWait(page, /Lactate sent/);
    await pickChips(page, "Time", ["Observe 15 min"]);
    await sendAndWait(page, /Lactate:/);
    const a4 = await active(page);
    await commitAndCheckDebrief(page, a4.trueDx, a4.simMin, null);
    await clickFirst(page, "home", [btn(/^home$/i)]);
    await findFirst(page, "home after loop 2", [btn(/next patient/i)]);
    const n = await page.evaluate(() => window.DW.stats().cases);
    if (n !== 2) throw new Error("expected 2 cases in history, got " + n);
    if (await page.getByText(/patient in progress/i).count()) throw new Error("resume banner still showing after grading");

    for (const k of ["case", "results", "turn", "grade"]) {
      if (!apiCalls.includes(k)) errors.push(`api: expected at least one "${k}" call, saw [${apiCalls.join(", ")}]`);
    }
  } catch (e) {
    failed = true;
    console.error("FAIL:", e.message);
    try { const pages = browser && browser.contexts()[0] && browser.contexts()[0].pages(); if (pages && pages[0]) await shot(pages[0], "99-failure"); } catch (_) {}
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log("API calls:", apiCalls.join(", ") || "(none)");
  if (errors.length) {
    console.error("Errors:\n  " + errors.join("\n  "));
    failed = true;
  }
  console.log(failed ? "SMOKE: FAIL" : "SMOKE: PASS");
  process.exit(failed ? 1 : 0);
})();
