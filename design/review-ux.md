# The Doorway v3 — mobile UX review

The repo has no `shots/` folder, so everything here is read from code; section 5 lists what needs a device. Line numbers are `app.jsx` unless marked `engine`.

## 1. Verdict

The bones are right for a physician with ten minutes: one screen and three taps to lock a gut call, chip orders that answer without a network trip, vitals pinned above the log, a debrief that puts the teaching before the score. Derek would open it. Whether he opens it a third time depends on the Workup screen, where the product's whole idea, that orders cost minutes and the patient moves while you wait, is modelled by the engine and hidden by the UI: results lose their return times, the "+45 min" divider trails them as a caption, and about half of the 844px is bottom chrome. The single biggest problem is that the clock is a number in the header and he never feels it move.

## 2. Ranked findings

**1. Workup flattens the time model.** (`LogEntry` 309–321; log 729–737; `engine` `act()` 913–1058.) The engine stamps each local result with its own return minute (ECG +5, troponin +15, CBC +45) and pushes the "+45 min" divider after all of them; the UI prints `atMin` only on his own bubbles (318), so the ECG that was back at five minutes looks identical to the CBC that took forty-five, and the rural lesson, act on the bedside test instead of waiting on the send-out, is invisible. Proposal: split `log` at each `doc` entry; within a segment, stable-sort by `atMin` and give every entry a 52px gutter stamp (`T+5`, `T+15`, `T+45`) in 12px mono. Move the `time` divider to the head of the segment, reworded "Clock → T+45 · waited on CBC+BMP". Show the speaker label only when the speaker changes; a four-result batch now carries four "CLINICAL" captions.

**2. Bottom chrome squeezes the log.** (744–757.) Seven tabs in 12px uppercase mono need about 540px, so at 390px they wrap to two rows; the tray adds 52px; the chip panel caps at 156px, so Stabilize's 27 chips scroll inside a three-row box inside a pinned bar. With a group open and a tray showing, the log keeps about 290px. Proposal: delete the tray; selected chips become 36px tokens inside the composer box ahead of the text input (flex-wrap, tap removes), so the order being built lives in one place and dictated text lands beside it. Let an open panel grow to 45dvh, since he is choosing rather than reading, and keep closing it on send. Keep both tab rows; abbreviations fail at 4 a.m.

**3. The doorway is laid out as a form.** (`Doorway` 565–596.) The figure is a 112×132 thumbnail beside metadata; the two-sentence impression, the only text that is the gestalt, sits fifth in the column at 16px italic. Sick/Not sick uses the 48px variant though `big` (64px) exists. The ESI buttons carry 12px sub-labels that overflow their ~62px cells. The disabled lock button reads "Sick · acuity · dispo" whatever he has tapped. Proposal: figure full width at 200px with name, age and chief complaint over its lower edge; impression beneath at 20px upright display; EMS line and vitals next; `big` on Sick/Not sick; numerals only on ESI at 20px mono, the word echoed in the existing caption (586); lock label naming only what is missing ("acuity · dispo", then "dispo", then "Lock and start →").

**4. Workup forgets who is on the bed.** (header 706–727.) The header holds the clock, transport, the locked gut and Commit, with no name or chief complaint; the impression is the first log entry (`engine` 744) and scrolls off, so resuming two days later lands him at T+38 beside a stranger. Proposal: make the 36×42 avatar a 44px button opening a `Sheet` titled with the name: figure, age/sex, arrival, chief complaint, EMS handoff, impression, locked gut with its timestamp. Put "Mabel R, 74 · chest pain" on the line that now holds the lock (713–714) and move the lock badge into the sheet.

**5. Vitals tiles: too much motion, the wrong second number.** (`VitalTiles` 248–269.) Every abnormal tile runs `vital-bad` forever (a 1.5s box-shadow pulse); on a crashing patient four tiles pulse at the edge of vision, which devalues the one-shot `flash-once` for a crossing. The second line shows the previous value with an arrow ("↑118" under 132), which asks for subtraction. Proposal: abnormal is a static red number and border; `flash-once` only on a newly crossed alarm; second line is the signed delta ("+14", "−9") in `C.dim`, blank under threshold. In `TrendSheet` (271–300), sample `DW.vitalsAt(enc, m)` every 5 simulated minutes from 0 to `simMin` instead of one point per turn; `vitalsAt` is pure (`engine` 777–794), so a 45-minute CT becomes a curve.

**6. The event banner does three jobs at once.** (720–723, 681–682.) Several events join into one bold mono line ("BP 84/50 — falling · SpO₂ 88% — falling · CT tech called back — ~45 min") that wraps to three lines; it lives inside the header, so the log jumps 50px; it stays until tapped. Proposal: overlay it on the log wrapper (729 is already `position:relative`) so nothing shifts; show the first deteriorating-vital event only, with "+2 more in log", since every event is also a log entry (`engine` 1057); auto-clear on his next send and keep tap-to-dismiss.

**7. Two of the owner's typography rules are broken throughout.** `.display` is italic by definition (33), so the impression (584), observation bubbles (319), EMS line (582), true diagnosis (838) and carry-forward (854) are italic serif body text; the rule allows italics for a word. Set `.display{font-style:normal}`; the upright cut is loaded. Second, section headers are 12px uppercase captions above larger content: Home's four section labels (472–483), every `Sheet` title (158), "True diagnosis" over the 30px dx (837), "Carry forward" (853). Make section titles 18px upright serif in `C.text` and demote or drop the captions; on the debrief, cut the caption and let the 30px diagnosis and the "Dx" pair row carry it. The Landing's four "Not a…" blocks (393) are the definitional negatives the copy law bans; first-run only.

**8. No way to let time pass.** (`engine` CHIPS 20–30.) The clock moves only when an order costs minutes. The most basic ED move, give the bolus and recheck in fifteen, has no control; he has to type it and spend a model call. Proposal: a "+15 min" button beside the mic (44px, mono) that sends "Wait 15 minutes, then reassess vitals and appearance." through the existing free-text path, which returns `timeCostMin` and recomputes vitals. An engine-local handler for that phrase would cost nothing.

**9. Commit relies on `<datalist>` for the differential.** (619–624.) On iOS Safari, datalist suggestions appear in the QuickType bar if at all. Proposal: under the focused DDx field, render up to five catalog names containing the typed text as 44px chips; a tap fills the field. The slider, dispo grid and transfer toggles are fine.

**10. Cold start waits a minute.** (`startPrefetch` fires only at 931.) Prefetch runs when a debrief opens, so first use, a session that ended mid-case, or a Safari storage wipe means a tap and then up to sixty seconds of "Patient arriving…". Proposal: on Home mount, if `!prefetchReady()` and no active case, call `startPrefetch(mode)`; the dot turns green while he reads his weak spots. Trade-off: one of twelve daily case slots per cold open; `dw_next` persists, so at most one case is wasted.

**11. Composer and glyph craft.** (751–756, 687–695.) Add `enterKeyHint="send"`; replace the placeholder "ask · examine · order · stabilize" with "Type an order or a question". Dictation runs with `interimResults=false`, so in a dark room he speaks into silence until the final transcript lands; set it true and show interim text grey in the field. The 🎤 ✈ 🚑 🔒 ⚠ ⚙ emoji are the only full-colour objects on a monochrome page; replace them with 1.5px-stroke inline SVGs in `C.dim`.

## 3. Three set pieces

**The look, then the monitor.** When the case lands, the Doorway opens on the figure alone, full width, name and chief complaint over its lower edge and the impression beneath, and holds for 600ms. Then the vitals tiles slide up from under the figure, the monitor catching up with his eyes, with the three choice rows already waiting below. Under reduced motion everything appears at once. It is the order in which a doctor perceives a doorway, the patient before the numbers.

**The clock as a ruler.** Each "+45 min" divider becomes a thin ruler across the log with ticks every 5 minutes, and over it three hairlines (SBP, HR, SpO₂) sampled with `DW.vitalsAt` at each tick, red where outside the band. He watches the pressure fall across the CT he ordered. In the header the clock rolls from T+38 to T+83 over 500ms as the reply lands, so the jump is seen when it happens. Static ruler and instant number under reduced motion.

**Two timelines, one clock.** The answer key's `idealSequence` is validated (`engine` 600) and never drawn. In the debrief, run a centre spine of T+ stamps with his orders on the left and the ideal sequence on the right at their minutes. A critical-action window is a faint band on the right from 0 to `windowMin`; a late action on the left connects to its band with a thin amber line whose length is the lateness. The divergence prose then has a picture to stand on.

## 4. Keep

1. The gut lock: one screen, three taps, immutable afterwards, badge in the Workup header (713–714, 924).
2. Chip results served locally and the max-cost clock rule.
3. The debrief order with the score last and small (884–887), and the de-duplication of wins and misses against the timeline (832–834).
4. Conditions shown during loading via `onSeed` (919) and in red on the doorway.
5. The accessibility floor: 44px targets, a 12px minimum, `#d14b4b` at 4.5:1, the reduced-motion kill switch (55), Retry on every error, the stale-reply guard (674–675).

## 5. Needs a device

- Whether the Doorway fits 844px without scrolling with impression, EMS handoff and tags all present.
- The iOS keyboard against the `100dvh` + `overflow:hidden` Workup shell (705): whether the composer stays visible and the log keeps its scroll.
- `webkitSpeechRecognition` inside a home-screen (standalone) Safari session.
- Whether `vital-bad` on three tiles reads as alarm or noise.
- 16px Instrument Serif on an OLED at minimum brightness.
- The two-row tab wrap at a real 390px.
- `navigator.vibrate` is not implemented in iOS Safari, so on an iPhone every `haptic()` call, including the event buzz (681), is silent and the banner carries the whole interrupt.
- Red text on the red-tinted tile background is about 4.4:1, borderline AA.
