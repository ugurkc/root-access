# Pacing fixture

`starter-expected.json` locks the behaviour of the full default module set against the default preset
(the first entry in `ui/manifest.json`, currently `presets/starter-room-2026-10-28.json`; the tests read it
through `test/default-preset.mjs`) for both profiles over 7 days. `test/pacing.test.mjs` checks it in
two layers. `starter-base.mjs` in this folder is something else: the hand-written schema-2 config the
unit tests build states from (`base()`), small and complete, distinct from the generated pacing fixture.

## Layer 1: coarse facts

Hand-stated in the test and expected to survive ordinary tuning. For both profiles: the shop never
hits its buy cap, the first job level-up lands within 90 s of active play, the first rig lands inside
the first session (720 s active, 480 s casual), at least one purchase happens on each of days 2–6,
loot has paid out by day 7, every metric is finite, and by day 7 the room is complete and the wifi,
stream, phone and kebab jobs are scripted. A failure here means the game's pacing changed in a way worth a look, whatever the intent.

## Layer 2: exact fixture

Per profile, the per-day purchase lists and closing credits from `summary` (credits rounded to 6
significant digits), plus `credits.final`, `offersLeft.final`, `firstEvent:rig` and `firstDay:roomComplete`. Compared with
`deepEqual`, so any drift in the purchase order or the numbers is visible. A failure here means the
model's output changed; that is fine when a tuning or model change was deliberate, and a bug otherwise.

## Regenerating

    UPDATE_FIXTURE=1 npm test

rewrites the fixture from the current run (the test passes in that mode, so look at the diff before
committing). A fixture change must be deliberate: commit it alongside the preset or model change that
caused it and say why in the message. Never regenerate just to make the test green.

## Current baseline (2026-10-28)

Preset `starter-room-2026-10-28.json`: the accepted starter room (six jobs, free script slots, a
two-tech, one-comfort room with desk tabletop spots and a $50K expansion, storage-gated loot, comfort
on taps and the bar only, T1/T2 pay 3 and 18). Model as of the offline and shop corrections: scripted
jobs carry partial runs across absences, a hand-started run finishes once while away, the shop holds
the last free slot of a kind for the best item, and the rack is valued with the router it holds.

- Active: first script (wifi) at 251 s of day 1, the oscillator and headphones on the tabletop, the
  room complete on day 2, scripts stream and phone on day 2, kebab day 3, dentist day 6. Week earned
  $6.12M, 69% of it away, loot 16%. First loot card at 1323 s of play.
- Casual: first script at 425 s of the 8 min first session, the room complete on day 5, kebab script
  day 4. Week earned $1.16M, 81% of it away, loot 11%. First loot card at 1541 s.
- Targets: 8 of 12 pass. `daily-rig-or-item` (both) fails because the room is finished early by
  design; `first-loot` (both) fails because the Storage unit is bought late. Pinned in
  `test/targets.test.mjs`.

The draft preset `starter-2026-10-28.json` and its baseline are in git history.
