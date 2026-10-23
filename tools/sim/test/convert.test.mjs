import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toJs, fromJs, PREFIX } from '../model/convert.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));

test('toJs writes a window.RA_CONFIG assignment', () => {
  const js = toJs(preset);
  assert.equal(PREFIX, 'window.RA_CONFIG = ');
  assert.ok(js.startsWith('window.RA_CONFIG = {'), js.slice(0, 40));
  assert.ok(js.endsWith('};\n'), JSON.stringify(js.slice(-10)));
});

test('fromJs(toJs(x)) round-trips the preset exactly', () => {
  const back = fromJs(toJs(preset));
  assert.deepEqual(back, preset);
  assert.equal(JSON.stringify(back), JSON.stringify(preset));
});

test('fromJs tolerates surrounding whitespace and a missing semicolon, and rejects other sources', () => {
  assert.deepEqual(fromJs(`\n  ${PREFIX}{"a":1}  \n`), { a: 1 });
  assert.deepEqual(fromJs(`${PREFIX}{"a":1};`), { a: 1 });
  assert.throws(() => fromJs('const x = 1;'), /window\.RA_CONFIG/);
  assert.throws(() => fromJs(`${PREFIX}{a: 1};`), /JSON/);
});
