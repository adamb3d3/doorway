# The Doorway — visual design review

Reviewed from source and from the live screens at 390×844, driven by the repo's own `test/stub.js` (Landing through Debrief), plus the Avatar rendered at three sizes across six physiology states. Contrast ratios are computed WCAG values on the resolved colours. Line numbers refer to `app.jsx`.

## 1. Verdict

Assembled. The parts are good (the palette, the three typefaces, the bubble-with-a-voice idea, the T+ rail), but the same four moves (12px tracked mono caps, a 1px hairline, a red fill, an italic sentence) do every job until none of them means anything. On the Workup, after one lab order, five tiles, the banner, the event bubble, the Commit outline and the Send button were all red at once. The one decision that would change the feel most: take red away from the interface. Buttons, selected states, sheet titles, kickers and the slider go bone; red is left to mean "this patient is getting worse" or "you were wrong." Runner-up: make 17px upright Source Serif the app's default voice instead of 12px mono caps.

## 2. Type system

In use: three families (L6–8), with `.display` forcing italic on every Instrument Serif use (L33). Sixteen sizes from 12 to 42 plus the Landing clamps: a continuum, not a scale. `fontSize:12` appears about forty times. Ten tracking values from 0.02em to 0.32em.

Inverted hierarchy:
- Every sheet title is a 12px red `Label` (L158) above 16px inputs; on Commit the title is the smallest text on the sheet (L618–620).
- The Landing kicker, 12px at 0.32em, sits above the 124px title (L363–364); the eye lands on the smallest thing first.
- Debrief: 13px dim "True diagnosis" above the 30px diagnosis (L837–838).
- Section heads on Home and Debrief are 12px Labels (L472–483, L843, L862), smaller than the body they head.

Italic for body-length text: the doorway impression, two sentences at 16px (L584); the EMS handoff (L582); every "You see" bubble (L319); the carry-forward rule at 22px (L854); "Patient arriving…" at 40px (L535); and the Landing paragraph at 13px, italic and `#8f897f` at once (L389).

Mono-caps overuse: `Label` (L125, 0.18em), `Btn` (L133, 12px, 0.14em, so every primary action is 12–14px caps), bubble labels (L318), group tabs (L746), Choice chips (L141). One Workup screen carries about twenty tracked-caps elements.

Proposed scale (390 wide, 4 a.m.):

| Role | Family | Size/line | Use |
|---|---|---|---|
| Display | Instrument Serif roman | 32/36 | true dx, patient name; italic only as emphasis |
| Title | Source Serif 4 600 | 22/26 | sheet titles, section heads, sentence case |
| Body | Source Serif 4 400 | 17/24 | log, impression, teaching text, the rule |
| Body small | Source Serif 4 400 | 15/21 | secondary columns, hints |
| Number | JetBrains Mono 500 | 20/22 | tile values, clock, score |
| Result | JetBrains Mono 400 | 15/22 | lab results (keep) |
| Label | JetBrains Mono 500 | 12/16, 0.06em | tile keys, T+ stamps, header status; caps here only |
| Button | JetBrains Mono 500 | 15/20, 0.04em | sentence case |

Rules: one tracked-caps element per component; tracking never above 0.08em; nothing under 12px, and 12px only in mono.

## 3. Color and contrast

Palette `C` (L10–21), measured:
- `text` 17.6:1; `dim` (resolves to `#a3a09a`) 7.6:1; `faint #8f897f` 5.7:1 on bg, 5.0:1 on bg3. Passes, but it colours every 12px label and goes first on a dimmed phone. Change to `faint:#9a9488` (6.6:1) and `dim:rgba(245,241,232,0.75)` (9.4:1).
- `redText #d14b4b`: 4.54:1 on bg, 4.46:1 on the abnormal tile (`#170909`), 4.30:1 on the event bubble (`#260808`). It fails AA at 15px in the two places it carries meaning. Change to `#e05a5a` (5.45:1 and 5.35:1).
- `amber #d4a04a` 8.4:1, bone on `#8B0000` 8.9:1, black on amber 8.4:1: fine.
- `#8B0000` fill against bg: 1.98:1. The primary button has no visible edge, and disabled at `opacity:0.4` (L133) it is a smudge (the lock bar, the disabled Submit). Primary becomes bone fill with black text (the Landing button, L370, already is); red fill only for Lock and Submit, with a 1px `#d14b4b` inner border; disabled is the line style with dim text, never opacity.
- `border rgba(245,241,232,0.12)` is 1.31:1 and bg2 against bg is 1.2:1, so cards do not separate on a dim screen. Interactive borders 0.16, dividers 0.08.

Red rule. Red currently has eighteen jobs: primary action (L128), the Commit outline (L716), every selected choice (L137), the slider (L31), sheet titles (L158), kickers (L355), the "Rural" tag (L858), bad conditions, and only then the tiles, banner, event bubble, missed rows and wrong answers. Allowed afterwards: physiology crossing a limit (tile value and border, banner, event bubble) and a wrong call on the Debrief (Pairs, missed rows, score). Nothing else. Selected state is bone on black, as the active group tab (L746) already is. Amber means attention; green appears only on the Debrief.

## 4. Surfaces and spacing

Five radii (2, 3, 4, 14, 22): square tiles beside 22px pills (L742, L746) and a 14px sheet (L156). Thirteen gap values. Eleven surface tints (bg, bg2, bg3, four bubble tints at L303–308, tile, event, bad, good, amber). Left accents mean a voice, a warning or a section.

System: 4px base (4/8/12/16/24/32/48). Radius 4 for everything tappable and every card, 12 for the sheet, no pills (chips become 44px tiles like Choice). Borders 1px at 0.16 on interactive elements, 0.08 for dividers. Surfaces: bg page, bg2 cards, bg3 inputs and chips. Bubbles drop their four tints and sit on bg2; the 2px left accent carries identity (patient amber, you bone, clinical none, event 3px red).

Rebuild first: `VitalTiles` (L248), `LogEntry` (L309, one surface, and a batch of results as one card instead of three stacked "CLINICAL" bubbles), and `Btn`/`Choice` (L127–144, one button language, 15px sentence case, no red for selected).

## 5. The patient figure

What it draws: a Playmobil bust — egg head, helmet hair, dot eyes, a 3px mouth that flips from smile to frown at distress 3, rectangular arms, pink mitten nails. The colour engine works (pallor greys the skin, cyanosis blues lips and nails, jaundice yellows the sclera); that is the asset. The rest fails: diaphoresis is up to twelve blue dots floating over the hair (L230); tripod is a −8° tilt of the whole bust (L212); a five-year-old gets the adult body; at 36px it is a brown blob. The worst of it lands on the screen that matters. Ruth, HR 124, BP 88/50, "slumped in a wheelchair, mottling at the knees," and the figure sits upright and smiles. The first thing he sees contradicts the second.

Direction: replace it with a silhouette, the shape in the doorway. Five pre-drawn head-and-shoulders outlines (upright, slumped, tripod, fetal, supine), one bone 1px stroke on the dark field, filled by the existing skin and pallor engine; cyanosis as a cool wash at the edges, jaundice as a warm wash, diaphoresis as a faint vertical sheen gradient rather than dots; keep the breathing scale at `rrRate` (L220), the one honest animation. No eyes, no mouth. A silhouette cannot lie about affect, it reads posture, which is what a doorway glance gives, and at 36px it is still a shape. Give it 128×160 on the Doorway; about 215px sit empty above the lock bar.

## 6. Vitals tiles and the event banner

Today (L248–269): six 56px columns, key 12px, value 15px (BP 13px), previous value 12px; abnormal is red text on a red-tinted box with an infinite pulse (L50); five of six were red at the doorway.

Design: six tiles, 56×64, gap 4, radius 4, padding 6px 2px. Line 1: key, 11px mono caps, 0.06em, `#9a9488`. Line 2: value, 20px mono 500, tabular (BP shows systolic at 20px with "/50" at 12px beneath). Line 3: delta, 12px mono ("↑11", "·"): the change, not the old number.
- Normal: bg `rgba(245,241,232,0.03)`, border at 0.16, value bone.
- Abnormal: value `#e05a5a`, border 1px `#8B0000`, bg unchanged. The number is red; the box is not.
- Changed (moved, still normal): delta in amber; border eases to amber and back over 600ms.
- Alarming (crossed a limit this turn): bg `#8B0000` solid, key and value bone, held 900ms, then settles to Abnormal. No infinite pulse; `vital-bad` goes.

Banner (L720–723): a 44px solid-red bar that repeats the log's event bubble and stays until tapped. Make it the same object as the bubble: bg `#8B0000` for 900ms, then `rgba(139,0,0,0.22)` with a 1px `#d14b4b` border; text 15px Source Serif, "BP 77/43 — falling since T+30", T+ stamp in 12px mono; a 44px × button instead of "tap to clear"; a 2px red underline beneath the offending tile while the banner lives.

## 7. Motion

Exists (L36–55, L220, L327–346): pulse-dot, pulse-slow, an infinite vital-pulse, flash-once, ekg-sweep, hr-flicker, bubble-in, case-fade, sheet-up, banner-in, chip press, toggle, StepBlock reveals, countdown ring, breathing, and a randomised HR on the Landing strip.

Go: the infinite vital-pulse; hr-flicker and the random HR (fake vitals on a marketing page); pulse-slow on the "…" busy line (keep it on "Attending reviewing…").

Keep: bubble-in, sheet-up, banner-in, case-fade, breathing, the countdown ring, ekg-sweep on the Landing only.

Add one: the clock. Time is the game's currency and it jumps from T+0 to T+45. Count the header up over about 600ms in tabular mono and resolve the tile deltas at the end of the count. Under reduced motion it jumps, as now.

## 8. Three bold moves

**The door closes.** On Lock, no screen swap: the patient panel slides left off-screen over 600ms on the app's own EASE, the vitals row docks under the header, and the lock bar becomes the clock. One room, two states. Under reduced motion it cuts.

**The divergence as a shape.** Rebuild the Debrief timeline as a vertical ruler at 2px per simulated minute: his orders on the right, the answer key's `idealSequence` (SPEC L75) on the left at its `atMin`. The gap between the columns is the divergence, visible before a word is read. Missed windows are red bands across both columns.

**The rule rides along.** The last debrief's carry-forward ("Mottling plus hypotension: fluids and antibiotics before the history") is pinned at the top of the next Doorway in 17px roman Source Serif with an amber accent, and fades as he taps Lock. On a re-exposure case it is red.

## 9. Keep

The palette core (near-black, bone, `#8B0000` for fills, amber). Instrument Serif for the title and the true-diagnosis reveal. Mono for every number and for the result bubbles. The Landing hero and its bone button. The Pairs you/truth card. The T+ rail and the "+45 min — Blood cultures" entries. The delta arrows. The left-accent-as-voice idea. The conditions strip. Haptics. The sheet pattern. Reduced-motion handling. The breathing.
