// The CLI is exercised as a child process, the way a user runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PRESET_PATH } from './default-preset.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PRESET = DEFAULT_PRESET_PATH;
const TARGETS = fileURLToPath(new URL('../targets/seven-day-idle.json', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sim-cli-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const write = (name, data) => {
  const p = join(tmp, name);
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  return p;
};

test('validate: the preset is ok, exit 0', () => {
  const r = cli('validate', '--config', PRESET);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'ok');
});

test('validate: a broken config prints path: message lines and exits 1', () => {
  const cfg = JSON.parse(readFileSync(PRESET, 'utf8'));
  cfg.jobs.list[0].cost = -1;
  delete cfg.racks.holds;
  const r = cli('validate', '--config', write('broken.json', cfg));
  assert.equal(r.code, 1);
  assert.match(r.out, /^jobs\.list\[0\]\.cost: /m);
  assert.match(r.out, /^racks\.holds: missing required key$/m);
});

test('validate: --targets validates a targets file the same way', () => {
  assert.equal(cli('validate', '--targets', TARGETS).out.trim(), 'ok');
  const r = cli('validate', '--targets', write('bad-targets.json', [{ id: 'x', label: 'x', metric: 'credits.final', op: '~=', value: 1, profile: 'all' }]));
  assert.equal(r.code, 1);
  assert.match(r.out, /^\[0\]\.op: /m);
});

test('validate: an unreadable file is an error on stderr, not a crash', () => {
  const r = cli('validate', '--config', join(tmp, 'missing.json'));
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /missing\.json/);
});

test('validate: --profile checks a profile file; both presets are ok', () => {
  const profiles = fileURLToPath(new URL('../profiles/', import.meta.url));
  assert.equal(cli('validate', '--profile', join(profiles, 'active.json')).out.trim(), 'ok');
  assert.equal(cli('validate', '--profile', join(profiles, 'casual.json')).out.trim(), 'ok');
  const r = cli('validate', '--profile', write('empty-profile.json', {}));
  assert.equal(r.code, 1);
  assert.match(r.out, /^sessions: /m);
  assert.match(r.out, /^policy: /m);
  assert.doesNotMatch(r.err, /at .*\.mjs:\d+/, 'no stack trace');
});

test('run --json: parseable, 7 summary rows per profile, verdicts array, no final state', () => {
  const r = cli('run', '--config', PRESET, '--profile', 'active', '--profile', 'casual', '--targets', TARGETS, '--json');
  const j = JSON.parse(r.out);
  assert.equal(j.config, PRESET);
  assert.equal(j.days, 7);
  assert.deepEqual(Object.keys(j.profiles), ['active', 'casual']);
  for (const p of Object.values(j.profiles)) {
    assert.equal(p.summary.length, 7);
    assert.ok(Array.isArray(p.timeline));
    assert.equal(typeof p.metrics['credits.final'], 'number');
    assert.equal(p.final, undefined);
  }
  assert.ok(Array.isArray(j.verdicts));
  assert.equal(j.verdicts.length, 10);
  // The preset's baseline failure (daily-rig-or-item, 2026-10-27 baseline) makes the exit code 1.
  assert.equal(r.code, 1);
});

test('run: without --profile both active and casual run; without targets exit 0', () => {
  const r = cli('run', '--config', PRESET, '--json');
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.deepEqual(Object.keys(j.profiles), ['active', 'casual']);
  assert.deepEqual(j.verdicts, []);
});

test('run: human output has a day table per profile and a verdict list', () => {
  const r = cli('run', '--config', PRESET, '--profile', 'casual', '--days', '3', '--targets', TARGETS);
  assert.match(r.out, /casual/);
  assert.match(r.out, /day\s+active min\s+credits\s+passive \$\/s\s+offline \$\s+active \$\s+purchases/);
  assert.equal(r.out.match(/^\s*[123]\s+\d/gm)?.length, 3, r.out);
  assert.match(r.out, /✓ first-rig\/casual/);
  assert.match(r.out, /✗ daily-rig-or-item\/casual/);
  assert.match(r.out, /[0-9.]+K/);
  assert.equal(r.code, 1);
});

test('run: a profile given by path, and a target that cannot pass exits 1', () => {
  const profile = write('p.json', JSON.parse(readFileSync(fileURLToPath(new URL('../profiles/casual.json', import.meta.url)), 'utf8')));
  const targets = write('impossible.json', [{ id: 'never', label: 'never', metric: 'credits.final', op: '<', value: 0, profile: 'all' }]);
  const r = cli('run', '--config', PRESET, '--profile', profile, '--targets', targets, '--json');
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.deepEqual(Object.keys(j.profiles), ['casual']);
  assert.equal(j.verdicts[0].pass, false);
});

test('run: an achievable target set exits 0', () => {
  const targets = write('easy.json', [{ id: 'some', label: 'some', metric: 'credits.final', op: '>', value: 0, profile: 'all' }]);
  const r = cli('run', '--config', PRESET, '--targets', targets);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ some\/active/);
});

test('run: refuses to run on an invalid config, targets or profile; diagnostics go to stderr, stdout stays empty', () => {
  const cfg = JSON.parse(readFileSync(PRESET, 'utf8'));
  cfg.schema = 99;
  const r = cli('run', '--config', write('schema.json', cfg), '--json');
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /^schema: /m);
  assert.match(r.err, /invalid config/);
  const bad = write('bad-targets2.json', [{ id: 'x' }]);
  const r2 = cli('run', '--config', PRESET, '--targets', bad);
  assert.equal(r2.code, 1);
  assert.equal(r2.out, '');
  assert.match(r2.err, /^\[0\]\./m);
  const r3 = cli('run', '--config', PRESET, '--profile', write('empty-profile2.json', {}), '--json');
  assert.equal(r3.code, 1);
  assert.equal(r3.out, '');
  assert.match(r3.err, /^sessions: /m);
  assert.match(r3.err, /invalid profile/);
  assert.doesNotMatch(r3.err, /at .*\.mjs:\d+/, 'no stack trace');
});

test('run: an unknown profile id is an error on stderr', () => {
  const r = cli('run', '--config', PRESET, '--profile', 'nobody');
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /nobody/);
});

test('--help exits 0 with usage; an unknown command exits 2 with usage', () => {
  const h = cli('--help');
  assert.equal(h.code, 0);
  assert.match(h.out, /usage/i);
  assert.match(h.out, /validate/);
  assert.match(h.out, /run/);
  assert.match(h.out, /trusted/);
  const u = cli('frobnicate');
  assert.equal(u.code, 2);
  assert.equal(u.out, '');
  assert.match(u.err, /usage/i);
  assert.equal(cli().code, 2);
  const d = cli('run', '--config', PRESET, '--days', 'x');
  assert.equal(d.code, 2);
  assert.equal(d.out, '');
  assert.match(d.err, /--days/);
});

test('sweep: one row per value, with passes/total and per-profile first rig and offers left', () => {
  const r = cli('sweep', '--config', PRESET, '--targets', TARGETS, '--param', 'jobs.list[wifi].cost', '--values', '6,12');
  assert.equal(r.code, 0, r.out + r.err);
  const rows = r.out.trim().split('\n');
  assert.match(rows[0], /jobs\.list\[wifi\]\.cost/);
  assert.match(rows[0], /pass/);
  assert.match(rows[0], /firstEvent:rig\/active/);
  assert.match(rows[0], /offersLeft\.final\/casual/);
  assert.equal(rows.length, 3, r.out);
  // The first row is the preset itself: 8/10 (2026-10-27 baseline, only daily-rig-or-item fails).
  assert.match(rows[1], /^\s*6\s+8\/10\s/);
  assert.match(rows[2], /^\s*12\s+\d+\/10\s/);
});

test('sweep --json: the raw grid, two params', () => {
  const r = cli('sweep', '--config', PRESET, '--profile', 'casual', '--days', '2', '--param', 'racks.cost', '--values', '400,800',
    '--param2', 'taps.enabled', '--values2', 'true,false', '--json');
  assert.equal(r.code, 0, r.out + r.err);
  const rows = JSON.parse(r.out);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3].values, { 'racks.cost': 800, 'taps.enabled': false });
  assert.deepEqual(Object.keys(rows[0].metrics), ['casual']);
});

test('sweep: --param and --values are required and must have matching pairs', () => {
  assert.equal(cli('sweep', '--config', PRESET, '--values', '1,2').code, 2);
  assert.equal(cli('sweep', '--config', PRESET, '--param', 'racks.cost').code, 2);
  assert.equal(cli('sweep', '--config', PRESET, '--param', 'racks.cost', '--values', '1', '--param2', 'taps.rate').code, 2);
  assert.equal(cli('sweep', '--config', PRESET, '--param2', 'racks.cost', '--values2', '1').code, 2);
  const r = cli('sweep', '--config', PRESET, '--param', 'racks.nope', '--values', '1');
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /racks\.nope/);
  const same = cli('sweep', '--config', PRESET, '--param', 'racks.cost', '--values', '1', '--param2', 'racks.cost', '--values2', '2');
  assert.equal(same.code, 2);
  assert.match(same.err, /same path/);
});

test('convert: --to js writes window.RA_CONFIG that fromJs reads back equal; --to json reverses it', async () => {
  const { fromJs } = await import('../model/convert.mjs');
  const js = join(tmp, 'config.js');
  const r = cli('convert', '--to', 'js', '--in', PRESET, '--out', js);
  assert.equal(r.code, 0, r.out + r.err);
  const source = readFileSync(js, 'utf8');
  assert.ok(source.startsWith('window.RA_CONFIG = '));
  assert.deepEqual(fromJs(source), JSON.parse(readFileSync(PRESET, 'utf8')));
  const back = join(tmp, 'back.json');
  assert.equal(cli('convert', '--to', 'json', '--in', js, '--out', back).code, 0);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(back, 'utf8'))), JSON.stringify(JSON.parse(readFileSync(PRESET, 'utf8'))));
});

test('convert: --to js refuses an invalid config; a write failure is a clean error', () => {
  const cfg = JSON.parse(readFileSync(PRESET, 'utf8'));
  cfg.racks.cost = 0;
  const out = join(tmp, 'never.js');
  const r = cli('convert', '--to', 'js', '--in', write('zero.json', cfg), '--out', out);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /^racks\.cost: /m);
  assert.throws(() => readFileSync(out));
  const w = cli('convert', '--to', 'js', '--in', PRESET, '--out', join(tmp, 'no-such-dir', 'x.js'));
  assert.equal(w.code, 1);
  assert.match(w.err, /no-such-dir/);
  assert.doesNotMatch(w.err, /at .*\.mjs:\d+/, 'no stack trace');
});

test('convert: --to json falls back to evaluating a hand-written config.js', () => {
  const src = write('hand.js', "// comment\nwindow.RA_CONFIG = { schema: 1, list: [1, 2,], };\n");
  const out = join(tmp, 'hand.json');
  const r = cli('convert', '--to', 'json', '--in', src, '--out', out);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { schema: 1, list: [1, 2] });
  assert.equal(cli('convert', '--to', 'yaml', '--in', src, '--out', out).code, 2);
  assert.equal(cli('convert', '--to', 'json', '--in', src).code, 2);
});
