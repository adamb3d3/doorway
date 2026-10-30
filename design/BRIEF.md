# The Doorway — v3.2 design brief

30 Oct 2026. Three independent reviewers (mobile UX, game design, visual design) read the v3.1 code; the visual reviewer also rendered every screen at 390×844 against the stub. Full reports: `review-ux.md`, `review-game.md`, `review-visual.md`. This brief keeps what two or more of them reached on their own, plus the single-source findings that change what the app measures.

## What they agreed on

1. **The clock is modelled and hidden.** The engine stamps each result with its own return minute and moves vitals between orders; the Workup shows none of it. Chips carry no cost, "Send 3" never says it will cost 45 minutes, results from a batch look identical whether they came back at 5 or 45, the "+45 min" divider trails as a caption, and the only way to let time pass is to spend a model call. All three reviewers; the UX and game reviewers both called it the biggest gap. Fix: cost printed on every chip and on Send; a T+ stamp on every result; the divider at the head of the batch ("T+38 → T+83 · waited on CT"); tick rows with vitals for jumps of 15 minutes or more; events stamped at the minute the vital crossed, not at the end of the batch; "Recheck vitals" (+5) and "Observe" (+15/+30) chips handled in the engine with no model call; the header clock counts up over 600 ms.

2. **Two owner rules are broken throughout.** `.display` forces italic, so the doorway impression, the "You see" bubbles, the EMS line and the carry-forward rule are italic body text. Section and sheet titles are 12px red captions above larger content. UX and visual reviewers. Fix: `.display{font-style:normal}`; titles become 22px upright Source Serif; captions demoted.

3. **Red means nothing because it means everything.** Eighteen uses: primary buttons, selected chips, sheet titles, kickers, the slider, the Commit outline, then the tiles, banner and misses. After one lab order the visual reviewer counted nine red elements on screen. The abnormal-tile pulse runs forever and devalues the one-shot flash for a new crossing. UX and visual. Fix: red only for physiology crossing a limit and for a wrong call on the debrief; selected state is bone on black; primary buttons bone with black text (the Landing already does this); the infinite pulse goes; alarming state is a 900 ms solid fill that settles.

4. **Contrast.** `#d14b4b` measures 4.46:1 on the abnormal tile and 4.30:1 on the event bubble, failing AA in the two places it carries meaning. The `#8B0000` primary fill is 1.98:1 against the page; disabled at 40% opacity is a smudge. Visual reviewer, measured. Fix: red text `#e05a5a`; faint `#9a9488`; dim at 0.75; disabled is the line style with dim text, never opacity.

5. **The doorway is a form.** A 112px figure thumbnail beside metadata, the impression fifth in the column, Sick/Not sick at the small size. UX and visual (and the game reviewer on the italic impression). Fix: figure full width, name and chief complaint over its lower edge, impression at 20px upright beneath, Sick/Not sick at 64px, ESI as numerals only, the lock button naming what is still missing. Set piece: the figure first, the monitor sliding up 600 ms later, in the order a doctor perceives a doorway.

6. **The debrief never draws the ideal sequence.** The answer key's `idealSequence` is validated and discarded. UX and visual both proposed the same thing: a centre spine of T+ stamps, his orders on one side, the ideal on the other, critical-action windows as bands, lateness as a line whose length is the delay. The game reviewer adds a faint vitals column, since every order already carries a snapshot.

7. **The rule should ride along.** The carry-forward line is the most personal thing the app produces and it vanishes into storage. Visual and game. Fix: store it in the history entry; pin the last one at the top of the next doorway; list the last five on Home; pass the last ten to the grader and ask whether he followed them.

8. **The patient figure contradicts the text.** Rendered: Ruth, HR 124, BP 88/50, "slumped, mottling at the knees," drawn upright and smiling; diaphoresis as blue dots over the hair; tripod as an 8° tilt. The colour engine (pallor, cyanosis, jaundice) is the asset. Visual reviewer, from pixels. Recommendation: a posture silhouette, five outlines (upright, slumped, tripod, fetal, supine), no face, filled by the existing skin engine, keeping the breathing animation.

## Single-source findings that change what the app measures (game reviewer)

- **Re-exposure is announced.** The doorway prints "Pattern re-exposure", Home prints "1 pattern due", and a due item always comes next. He knows the next patient is a serious diagnosis he missed. That invalidates the one measurement spaced re-exposure exists to take. Fix: delete the label; roll the due item one-in-three per pick; Home reports history ("2 came back this month, 1 caught"); the debrief names the original miss by date, age and presentation.
- **Drill poisons calibration.** At a 70% serious base rate, "sick" is right seven times in ten, and the acuity grid pools both modes. Fix: only Shift feeds the grid and gut-vs-final; Drill trains speed (timer on, hostile conditions, lookalikes at 100%) and reports time-to-first-critical-action, which is already stored and shown nowhere. Label them "Shift: calibration" and "Drill: speed".
- **The Home list prints a score per case**, which re-promotes the number the research says to bury. Fix: caught/missed dot and the carried rule.
- **Collected, never shown:** seconds to lock the read (store it; "locked in 11 s" on the debrief; fast reads vs slow reads on Home), confidence vs whether #1 was right, time to first critical action.
- **After 120 simulated minutes the untreated trajectory flattens**, so an ignored patient stops dying. Fix: extrapolate the last segment with clamps.

## Decisions for Ted

Each is a taste or a policy call. My recommendation in brackets.

1. Replace the avatar with a posture silhouette, no face. [Yes. The face lies; the shape can't.]
2. Take red out of the interface chrome; bone primary buttons. [Yes.]
3. The staged doorway reveal and the "door closes" lock transition. [Yes, both under reduced-motion guards.]
4. The two-column debrief timeline with the ideal sequence drawn. [Yes. Biggest teaching gain per hour.]
5. Blind re-exposure. [Yes. Without it the re-exposure metric is fiction.]
6. Shift = calibration, Drill = speed; only Shift feeds the grid. [Yes.]
7. Drop the per-case score from the Home list. [Yes.]
8. Pin the last rule on the next doorway, and tell the grader his rules. [Yes.]

## Build order

**Now, without waiting (foundation; no taste calls):** cost on chips and Send; T+ stamps and the divider at the head; tick rows; events at the crossing minute; Recheck/Observe chips; `.display` upright; title scale; contrast hexes; pulse removed; disabled state; store lock seconds, carry-forward and first-critical minute in the history entry; trajectory extrapolation; prefetch on cold start; `enterKeyHint`; interim dictation; emoji to inline SVG.

**After the decisions above:** silhouette; red removal and button language; doorway restructure and reveal; patient sheet from the Workup header; composer with tokens instead of the tray; event banner as overlay; vitals tiles to the new spec; debrief ruler; rules on Home and the doorway; blind re-exposure; Shift/Drill split; Home under ten cases.

**Not doing** (game reviewer's list, agreed): no real-time clock or idle penalty; no score where he looks most; no streaks, badges or difficulty ladder; nothing on the doorway that describes the case.
