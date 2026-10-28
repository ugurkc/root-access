# Presets

One JSON file per snapshot of the game's numbers, named `<game>-<YYYY-MM-DD>.json`
(e.g. `starter-2026-10-28.json`). Add a preset when a balancing decision ships: convert the
game's `config.js` with `node tools/sim/cli.mjs convert --to json --in <config.js> --out tools/sim/presets/<name>.json`,
run `validate --config` on it, run it against `tools/sim/targets/seven-day-idle.json`, and
commit the file together with any target changes the decision implied. Never edit an old
preset in place; the pacing fixture (`tools/sim/test/fixtures/`) is regenerated against the
preset the UI and CLI default to, which is the first entry in `tools/sim/ui/manifest.json`.

Presets before `starter-2026-10-28.json` (`v2-2026-10-23.json`, `v2-2026-10-27.json`) use schema 1
(items, racks, a fixed rig slot count) and live in git history only, last at commit `65ac455`. They do
not load in this version of the sim: `validate` rejects schema 1, and there is no converter from it.
