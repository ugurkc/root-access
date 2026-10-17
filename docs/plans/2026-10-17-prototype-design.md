# Root Access — design bench prototype

Date: 2026-10-17

## Purpose

A phone-first web prototype of *Root Access* (idle clicker: hack from your room,
earn money, buy gear) whose job is to let the design team and friends play
**alternative design decisions side by side**. It is a design bench, not the
game. Every contested decision is a tab; every number is in `config.js`.

Hosted at `https://ugurkc.github.io/root-access` (GitHub Pages from `main`).

## Decisions taken

| Topic | Decision |
|---|---|
| Delivery | Web link, no install. Single `index.html` + `config.js`, no build step. |
| Scope v1 | Core loop only: tap → earn → buy 6 items. No houses/helpers yet (Botnet item stands in for "helper"). |
| Test goals | Pacing/economy, tap feel, progression hooks. |
| Tuning | Edit `config.js`, push. No in-game designer panel. |
| Variants | Always-visible tabs. **Tap mode:** Instant / Bar / Jobs. **Idle mode:** Equipment / Helpers only / None. |
| Progress | Separate save per variant combo (9 slots), browser `localStorage`. Start screen: Continue / New run. Offline earnings on return. |
| Session target | 30–60 min to afford everything (~level 25 each). One cost multiplier (×1.15). |
| Equipment | Each item has one job: tap power *or* idle income; repeat purchases. Every level occupies `footprint` floor tiles. |
| House | Top-down isometric floor plan of square rooms drawn as diamonds. Start in the centre room; the 8 neighbours are dark. **Expand** in the shop lights the next room in a fixed order (E, W, N, S, then corners), each costing 3x the last. A room is 5x5 = 25 tiles; the start room loses 4 to the desk and chair. When no item fits, the shop shows NO SPACE. Fixed scale, the panel pans by touch or mouse drag, centred on the start room. Player sits with their back to the camera, facing the desk. |
| Feel | Floating +$ pops, button squash + light shake, synthesized sounds (mutable). Short suffixes ($1.2K). |
| Look | Dark pixel-art direction: black with a faint red cast, neon red for action (tap axis, money, hack button), shades of dark neon blue for systems (idle axis, screens, timers, collect), pixel font, chunky 2px borders, a stylised desk scene that gains gear as items are bought. Placeholder art, not final. |
| Feedback | Talk to testers; no telemetry. |

## Variant semantics

- **Instant** — each tap pays `tapValue`.
- **Bar** — each tap adds `tapValue` to a job bar; when the bar reaches
  `jobSize` the whole amount pays out at once with a bigger effect. Same
  income per tap as Instant; only delivery differs.
- **Jobs** — tapping starts a hack that runs `jobDuration` seconds, then pays
  `tapValue × jobTapEquivalent`. Tapping again while running does nothing
  (shows progress). Tests "manage" vs "mash".
- **Equipment** — idle items (Old Laptop, Server Rack, Botnet) earn per second.
- **Helpers only** — only the Botnet earns passively; Old Laptop and Server
  Rack switch to tap-power jobs. Tests delaying idle income.
- **None** — no passive income; idle items are hidden.

## Architecture

```
index.html   UI, rendering, input, audio, save/load, variant tabs
config.js    all tunables: items, costs, multipliers, variant parameters, visuals
docs/        this design doc
```

Pure functions for the economy (`costOf(item, level)`, `tapValue(state)`,
`idleRate(state)`) kept separate from DOM code so numbers can be unit-checked
in a console.

## Implementation plan

1. `config.js` with items, curves, variant params.
2. Economy functions + state model + save slots.
3. Screens: start (variant tabs, Continue/New), game (money, tap zone, shop, room).
4. Tap modes and idle modes.
5. Feel: pops, squash, shake, synth audio, mute.
6. Pixel-art styling pass; mobile viewport test.
7. GitHub repo + Pages; README on tuning.
