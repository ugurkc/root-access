// The preset the UI and CLI default to: the first entry in ui/manifest.json. The pacing fixture and
// the integration tests (targets, sweep, cli) load it from here, so moving the default is one
// manifest edit. Unit tests that pin exact numbers use the hand-written fixture test/fixtures/starter-base.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(readFileSync(new URL('../ui/manifest.json', import.meta.url)));
export const DEFAULT_PRESET_FILE = manifest.presets[0];
export const DEFAULT_PRESET_URL = new URL(`../presets/${DEFAULT_PRESET_FILE}`, import.meta.url);
export const DEFAULT_PRESET_PATH = fileURLToPath(DEFAULT_PRESET_URL);
export const loadDefaultPreset = () => JSON.parse(readFileSync(DEFAULT_PRESET_URL));
