# The Doorway — game design review

Read-only pass over README, SPEC, app.jsx (958 lines), cases.js (459) and engine.js (1,691), as of 11:11 on 30 Oct 2026. engine.js was being edited during the review (prompt caching and schemas; the mechanics discussed here are unchanged). Every proposal is buildable in the current stack and respects the owner's UX and copy rules.

## 1. Verdict

The loop is sound and better than most training simulators I review. The locked doorway read is the right core mechanic, the debrief puts the score last, and under the chat UI sits a real simulation engine. What it does not yet do is make him feel the patient. Sim time moves only when he taps, it jumps by the longest order in a batch, and the deterioration that happened inside the jump is reported afterwards as a line item (engine.js:1212–1226). He loses nothing by thinking, he has no way to deliberately wait, and the consequence of an order arrives as a receipt rather than as something he watched. That is the gap between a form with a timer and a simulation you feel, and it closes without a real-time clock, which would be the wrong fix for a man playing at 4 a.m. between interruptions.

## 2. Loop analysis

**Doorway** (app.jsx:554–595). Now: a card with everything visible at once. The 20-second ring is off by default (app.jsx:515), so most reads are considered rather than fast; the seconds he took are measured at lock (engine.js:960) and then dropped, unseen by the history entry (engine.js:1497–1520) or the debrief. The impression and the EMS handoff are set in the italic display face (app.jsx:582, 584). On a return visit the screen announces "Pattern re-exposure" (app.jsx:571). Should: a hallway read, made fast and scored as fast. Change: store `elapsedSec` in the history entry, print "locked in 11 s" on the Read row of the debrief, set the impression upright, and delete the re-exposure label (§4).

**Workup** (app.jsx:643–758; engine.js:1052–1243). Now: chips carry no cost (app.jsx:741) and "Send 3" (app.jsx:755) never says what the batch costs, though the engine knows it (engine.js:1212). Results land instantly, stamped t0+cost, so the wait for a lab never exists. Doing nothing costs nothing; the only way to see the untreated trajectory is to order something. After 120 minutes `interp` returns the last point (engine.js:909–922), so a patient ignored for two hours stops dying. Should: every tap is minutes traded for information, felt before, during and after. Change: §3.

**Event interrupt** (engine.js:981–994, 1222–1226; app.jsx:681, 718–722). Now: a red banner with a haptic, stamped at the end of the batch and cleared by a tap; nothing is asked of him. The chip panel closes after every send (app.jsx:671), so when the BP falls he is looking at closed groups. "Flight crew at bedside" (engine.js:1230–1234) is also just a line; he can keep ordering CTs with the crew standing there. Should: a nurse at his elbow, with a when and a cost. Change: step `vitalsAt` in 5-minute increments between t0 and t1 to find the crossing minute and stamp the event there ("T+58, while the CT was running"); on any deterioration event open the Stabilize tab rather than closing the panel; once transport is at bedside, every later time entry reads "+45 min — crew waiting".

**Commit** (app.jsx:609–637). Now: a form. The confidence slider (app.jsx:625) is stored (engine.js:1515) and never fed back. The packaging checklist is self-report; nothing checks it against `applied`. Should: the handoff call, plus a second reading of acuity so the app can tell whether the workup improved or degraded the gut. Change: ask ESI once more at commit (one tap) so Home can show gut, final and truth for acuity, which today exists only for dispo (app.jsx:429); flag any checklist toggle that contradicts `applied` as a divergence.

**Debrief** (app.jsx:809–897). The strongest screen: pairs, a timeline with missed actions inserted at their window and late ones stamped "+12 min late" (app.jsx:804), one rule, reflection on misses, score last and small. Gap: the timeline shows what he did and what he should have done, never what the patient was doing in between, though every doc entry carries a vitals snapshot (engine.js:1082). Change: a faint vitals column on timeline rows, and the lock time on the Read row.

**Return visit** (cases.js:358–389; app.jsx:470, 571). Now: a due miss item always goes first, Home prints "1 pattern due for re-exposure", and the doorway prints the label. When he taps Next under that line he knows the next patient is a serious diagnosis he missed before. That invalidates the one measurement the re-exposure exists to take. Should: the pattern arrives as a stranger and is named in the debrief. Change: §4.

## 3. The clock and the deteriorating patient

No real-time clock: the phone goes in a pocket mid-case, so sim time should move only on his actions, and time pressure comes from making each action's cost legible three times.

Before: export `chipCost` (engine.js:1000; the `DW` object at 1657 omits it) and print "+35" in faint mono on every chip. The Send button reads "Send 3 · +45 min", the batch maximum.

During: when a batch costs 15 minutes or more, insert tick rows at 15-minute intervals with the vitals `vitalsAt` gives at each (a pure function, engine.js:933). Three rows of falling SBP read as a slide; one banner reads as a notification. The existing time entry (app.jsx:310) becomes the loudest line in the log for long jumps: "T+38 → T+73 · BP 102/64 → 84/50".

After: the event stamped at the crossing minute rather than t1 (engine.js:1224).

Waiting has to be a decision. Add "Recheck vitals" (+5) and "Observe" (+30) chips. Rechecking vitals is the most common act in an ED and the app has no word for it.

Benign cases are 75% of Shift, and there the clock has no teeth because nothing deteriorates. The felt cost of a shotgun workup in a 25-bed hospital with one nurse is everyone else in the building. Do not build a waiting room. Print on the benign debrief "T+95 for a case the key finishes at T+20", from `idealSequence`'s last `atMin`, and track median minutes per benign case on Home.

Fix the flatline at 120 minutes: ask the case writer for a t=240 point (engine.js:413) or extrapolate the last segment with clamping.

When transport arrives, make Commit the single obvious next action and dim the order groups.

## 4. Progression and return

Week 8 is about 24 cases against a catalog of 149 entries (83 serious, 66 benign) with several presentations each, so variety is not what runs out. What brings him back is evidence that his read is moving, and Home shows level, never movement: the grid is cumulative, `byDomain` is a lifetime average, and the streak (engine.js:1525) counts calendar days, so for a three-a-week player it is permanently 1 and is, correctly, never displayed.

Home at 4 cases is a wall of empty instruments under the Next button: a grid of dots and "Not enough cases yet" (app.jsx:475). Under ten cases show the button, the mode toggle and one sentence: "Your calibration appears after ten cases."

Home at 40 cases: the grid plus movement. "Last 10: acuity error 0.5, was 0.9." Domains that moved, by name: "Cardiac 48 → 71 over 8 cases." A can't-miss catch rate, since every serious entry is can't-miss by default (cases.js:83) and nothing on Home reports it. And his own rules: the `carryForward` lines (engine.js:1421) are the most personal thing the app produces and they vanish into `dw_results`. List the last five under "Rules you are carrying".

Miss queue: surprise at the doorway, named at the debrief. Delete app.jsx:571. Change `dueMissItem` from always-first to a one-in-three roll per pick once due, so "due" never predicts the next case. Replace the Home line (app.jsx:470) with history: "2 patterns came back this month, 1 caught." The debrief then names it: "You missed this on Oct 3 as a 62-year-old with back pain; today it was a 34-year-old with syncope."

Drill mode is today the same game at a 70% serious base rate (cases.js:405). That poisons the calibration grid, because in Drill calling everyone sick is right seven times in ten. Let only Shift feed the acuity grid and gut-vs-final. Make Drill differ in what it trains: timer on, lookalike interleave at 100% instead of 30% (cases.js:397), conditions rolled hostile (night, CT down, flight weathered), and its stat is time-to-first-critical-action, stored (`firstCritMin`, engine.js:1517) and shown nowhere. Label the toggle "Shift: calibration" and "Drill: speed".

## 5. Five changes, ranked

1. **Cost legible before, during and after.** Cost on chips and on Send; tick rows with vitals for jumps of 15 minutes or more; events stamped at the crossing minute; "Recheck vitals" and "Observe" chips. Both `chipCost` and `vitalsAt` already exist. Outcome: time-to-first-critical-action, because he sees the minutes leaving before he spends them.

2. **Blind re-exposure.** Delete the doorway label, roll the due item one-in-three per pick, make the Home count historical, and have the debrief name the original miss by date, age and presentation. Outcome: can't-miss catch rate, measured honestly.

3. **Read-speed split.** Store `elapsedSec` in the history entry; the debrief prints "locked in 11 s"; Home prints "Reads under 15 s: error 0.6. Over 30 s: 0.9." Outcome: calibration, and the answer he actually wants: whether to trust the fast read.

4. **His rulebook, cited by the grader.** Store `carryForward` in the history entry; Home lists the last five. Pass the last ten rules into the grade user message and ask for `ruleApplied: {text, followed}`; the debrief prints "Your rule from Oct 3: 'Lactate before the CT in any hypotensive belly.' You followed it." Outcome: can't-miss catch rate on return visits, in his own words.

5. **Confidence line.** From history alone: bucket `confidence` (50 and under, 51–75, 76–100) against `rankOfTrueDx === 1`. Home: "When you said 80% or more, your #1 was right 6 of 11 times." Outcome: calibration; no new data.

## 6. Three things not to do

1. **No real-time clock, no idle penalty.** A patient who dies because he answered a page teaches him to avoid the app. Sim time moves on action only.

2. **No score where he looks most.** The Home list prints a score per case (app.jsx:488). Kluger and DeNisi's finding bites the moment the number is the most-seen thing on the screen; replace it with the caught/missed dot and the carried rule. No averages in large type, no personal best.

3. **No streaks, badges or difficulty ladder.** Delete the streak code rather than surface it. Drill trains a different target and must never be presented as a harder level. Nothing on the doorway may describe the case (re-exposure, domain, "weak spot"), because every label there is a prior he did not earn.
