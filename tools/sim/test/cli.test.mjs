// The CLI is exercised as a child process, the way a user runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PRESET = fileURLToPath(new URL('../presets/v2-2026-10-23.json', import.meta.url));
const TARGETS = fileURLToPath(new URL('../targets/seven-day-idle.json', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sim-cli-'));

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

test('validate: an unreadable file is an error, not a crash', () => {
  const r = cli('validate', '--config', join(tmp, 'missing.json'));
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /missing\.json/);
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
  // The preset's baseline failures make the exit code 1.
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

test('run: refuses to run on an invalid config or targets file', () => {
  const cfg = JSON.parse(readFileSync(PRESET, 'utf8'));
  cfg.schema = 99;
  const r = cli('run', '--config', write('schema.json', cfg), '--json');
  assert.equal(r.code, 1);
  assert.match(r.out, /^schema: /m);
  assert.throws(() => JSON.parse(r.out));
  const bad = write('bad-targets2.json', [{ id: 'x' }]);
  const r2 = cli('run', '--config', PRESET, '--targets', bad);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /^\[0\]\./m);
});

test('run: an unknown profile id is an error', () => {
  const r = cli('run', '--config', PRESET, '--profile', 'nobody');
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /nobody/);
});

test('--help exits 0 with usage; an unknown command exits 2 with usage', () => {
  const h = cli('--help');
  assert.equal(h.code, 0);
  assert.match(h.out, /usage/i);
  assert.match(h.out, /validate/);
  assert.match(h.out, /run/);
  const u = cli('frobnicate');
  assert.equal(u.code, 2);
  assert.match(u.out + u.err, /usage/i);
  assert.equal(cli().code, 2);
});
