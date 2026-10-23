import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPath, setPath, sweep } from '../model/sweep.mjs';
import { leafNumericPaths, parseValues, paramsFromForm, combinations, showCell } from '../ui/sweep.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = load('../presets/v2-2026-10-23.json');

test('leafNumericPaths: every numeric leaf of the preset, by id, job or index, none for schema/enabled', () => {
  const paths = leafNumericPaths(config);
  for (const p of ['taps.rate', 'bar.steps', 'jobs.maxLevel', 'jobs.milestones[0]', 'jobs.list[wifi].cost', 'jobs.list[sat].r', 'rigs.list[ceo].cost', 'racks.r', 'items.list[gpu].pay']) {
    assert.ok(paths.includes(p), `${p} listed`);
  }
  assert.ok(!paths.includes('schema'));
  assert.ok(!paths.some((p) => p.endsWith('.enabled')));
  assert.ok(!paths.some((p) => p.includes('.name')));
  assert.equal(new Set(paths).size, paths.length, 'no duplicates');
  for (const p of paths) assert.equal(typeof getPath(config, p), 'number', `${p} resolves to a number via getPath`);
});

test('leafNumericPaths: repeated ids fall back to the index; non-numeric leaves are skipped', () => {
  const cfg = { a: { list: [{ id: 'x', v: 1 }, { id: 'x', v: 2 }, { id: 'y', v: 3, s: 'str', b: true, n: NaN }], flag: true } };
  assert.deepEqual(leafNumericPaths(cfg), ['a.list[0].v', 'a.list[1].v', 'a.list[y].v']);
  assert.deepEqual(leafNumericPaths({}), []);
  assert.deepEqual(leafNumericPaths(null), []);
});

test('parseValues: numbers and booleans, trimmed; empty or non-numeric tokens throw', () => {
  assert.deepEqual(parseValues('500, 1000,2000'), [500, 1000, 2000]);
  assert.deepEqual(parseValues(' true ,false, 1.5'), [true, false, 1.5]);
  assert.deepEqual(parseValues('4,,6,'), [4, 6]);
  assert.throws(() => parseValues(''), /at least one number/);
  assert.throws(() => parseValues('4,six'), /"six" is not a number/);
  assert.throws(() => parseValues(undefined), /at least one number/);
});

test('paramsFromForm: one or two params, second pair must be complete and distinct', () => {
  assert.deepEqual(paramsFromForm({ path: ' jobs.list[wifi].cost ', values: '4,6,8' }), [{ path: 'jobs.list[wifi].cost', values: [4, 6, 8] }]);
  assert.deepEqual(paramsFromForm({ path: 'a', values: '1', path2: 'b', values2: '2,3' }), [{ path: 'a', values: [1] }, { path: 'b', values: [2, 3] }]);
  assert.throws(() => paramsFromForm({ path: '', values: '1' }), /param: give a config path/);
  assert.throws(() => paramsFromForm({ path: 'a', values: '1', path2: 'b' }), /go together/);
  assert.throws(() => paramsFromForm({ path: 'a', values: '1', path2: 'a', values2: '2' }), /both params name "a"/);
});

test('combinations: first param outermost, matching the order sweep() emits rows', () => {
  const params = [{ path: 'jobs.list[wifi].cost', values: [4, 8] }, { path: 'racks.cost', values: [400, 800] }];
  const combos = combinations(params);
  assert.deepEqual(combos, [
    [['jobs.list[wifi].cost', 4], ['racks.cost', 400]], [['jobs.list[wifi].cost', 4], ['racks.cost', 800]],
    [['jobs.list[wifi].cost', 8], ['racks.cost', 400]], [['jobs.list[wifi].cost', 8], ['racks.cost', 800]],
  ]);
  const rows = sweep({ config, profiles: {}, params, days: 1 });
  assert.deepEqual(rows.map((r) => r.values), combos.map((c) => Object.fromEntries(c)));
  // running one combination at a time through sweep() gives the same row as the grid does
  const single = combos.map((c) => sweep({ config, profiles: {}, params: c.map(([path, v]) => ({ path, values: [v] })), days: 1 })[0]);
  assert.deepEqual(single, rows);
  const cfg = structuredClone(config);
  for (const [p, v] of combos[3]) setPath(cfg, p, v);
  assert.equal(getPath(cfg, 'jobs.list[wifi].cost'), 8);
  assert.equal(getPath(cfg, 'racks.cost'), 800);
});

test('showCell formats like the CLI sweep table', () => {
  assert.equal(showCell(null), '-');
  assert.equal(showCell(undefined), '-');
  assert.equal(showCell(53.25), '53.3');
  assert.equal(showCell(56), '56');
  assert.equal(showCell(true), 'true');
});
