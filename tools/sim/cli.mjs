#!/usr/bin/env node
// Balance simulator CLI. Exit codes: 0 ok, 1 errors or failed verdicts, 2 usage.
//
//   node tools/sim/cli.mjs validate --config <path> | --targets <path>
//   node tools/sim/cli.mjs run --config <path> [--profile <id|path>]… [--days 7] [--targets <path>] [--json]
//   node tools/sim/cli.mjs sweep --config <path> --param <path> --values a,b [--param2 … --values2 …] [--json]
//   node tools/sim/cli.mjs convert --to js|json --in <path> --out <path>
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { run } from './model/core.mjs';
import { validateConfig } from './model/config.mjs';
import { evaluate, validateTargets } from './model/targets.mjs';
import { sweep } from './model/sweep.mjs';
import { toJs, fromJs } from './model/convert.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PROFILES = ['active', 'casual'];

const USAGE = `usage: node tools/sim/cli.mjs <command> [options]

commands
  validate --config <path>          check a config file; prints "ok" or one "path: message" per error
  validate --targets <path>         check a targets file the same way
  run --config <path> [--profile <id|path>]... [--days N] [--targets <path>] [--json]
                                    simulate each profile (default: ${DEFAULT_PROFILES.join(', ')}) and,
                                    with targets, print the verdicts; exit 1 when any verdict fails
  sweep --config <path> --param <cfg path> --values a,b,c [--param2 <cfg path> --values2 d,e]
        [--profile <id|path>]... [--days N] [--targets <path>] [--json]
                                    run every value combination; one row per combination with
                                    passes/total, first rig time and offers left per profile.
                                    Paths: jobs.list[wifi].cost, rigs.list[ceo].cost, racks.cost, items.list[2].pay
                                    (quote them: zsh and bash expand unquoted brackets)
  convert --to js --in <config.json> --out <config.js>
  convert --to json --in <config.js> --out <config.json>
                                    between the simulator's JSON and the game's window.RA_CONFIG script
  --help                            this text

Profiles resolve by id from ${resolve(HERE, 'profiles')}/<id>.json or by path.`;

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const print = (s) => process.stdout.write(s + '\n');

function readJson(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { throw new CliError(`${path}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
  try { return JSON.parse(text); } catch (e) { throw new CliError(`${path}: invalid JSON (${e.message})`); }
}

// Prints validation errors as "path: message" lines; true when there were any.
function report(errs) {
  for (const e of errs) print(`${e.path || '(root)'}: ${e.message}`);
  return errs.length > 0;
}

function loadConfig(path) {
  if (!path) throw new CliError('--config <path> is required', 2);
  const cfg = readJson(path);
  if (report(validateConfig(cfg))) throw new CliError(`${path}: invalid config`);
  return cfg;
}

function loadTargets(path) {
  if (!path) return [];
  const targets = readJson(path);
  if (report(validateTargets(targets))) throw new CliError(`${path}: invalid targets`);
  return targets;
}

// `--profile` values: an existing file path, else an id under profiles/.
export function resolveProfile(ref) {
  if (existsSync(ref)) return readJson(ref);
  const byId = resolve(HERE, 'profiles', `${ref}.json`);
  if (!existsSync(byId)) throw new CliError(`unknown profile ${JSON.stringify(ref)}: not a file and ${byId} does not exist`);
  return readJson(byId);
}

function loadProfiles(refs) {
  const out = {};
  for (const ref of refs.length ? refs : DEFAULT_PROFILES) {
    const profile = resolveProfile(ref);
    const id = typeof profile.id === 'string' && profile.id ? profile.id : basename(ref, '.json');
    if (id in out) throw new CliError(`profile id ${JSON.stringify(id)} given twice`);
    out[id] = profile;
  }
  return out;
}

function parseDays(value) {
  if (value === undefined) return 7;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`--days expects a positive integer, got ${JSON.stringify(value)}`, 2);
  return n;
}

// Credits like the game shows them: 999 → "999", 1234 → "1.23K", then M, B, T…
export function fmt(n) {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n))) + u[i];
}

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((cell, c) => String(cell).padStart(widths[c])).join('  ')).join('\n');
}

export function dayTable(r) {
  const rows = [['day', 'active min', 'credits', 'passive $/s', 'offline $', 'active $', 'purchases']];
  for (const d of r.summary) {
    rows.push([d.day, d.activeMinutes, fmt(d.credits), fmt(d.incomePassive), fmt(d.offlineEarned), fmt(d.activeEarned), d.purchases.length]);
  }
  return table(rows);
}

const showValue = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));

export function verdictLine(v) {
  const mark = v.pass ? '✓' : '✗';
  const days = v.expected.days ? ` days ${v.expected.days[0]}–${v.expected.days[1]}` : '';
  const expected = `${v.expected.metric}${days} ${v.expected.op} ${showValue(v.expected.value)}`;
  const actual = v.error ? v.error : `actual ${showValue(v.actual)}`;
  return `${mark} ${v.id}/${v.profile}  ${v.label}: ${actual} (${expected})`;
}

function cmdValidate(args) {
  const { values } = parseArgs({ args, options: { config: { type: 'string' }, targets: { type: 'string' } } });
  if (!values.config && !values.targets) throw new CliError('validate needs --config <path> or --targets <path>', 2);
  let failed = false;
  if (values.config) failed = report(validateConfig(readJson(values.config))) || failed;
  if (values.targets) failed = report(validateTargets(readJson(values.targets))) || failed;
  if (failed) return 1;
  print('ok');
  return 0;
}

function cmdRun(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, profile: { type: 'string', multiple: true }, days: { type: 'string' },
    targets: { type: 'string' }, json: { type: 'boolean', default: false },
  } });
  const days = parseDays(values.days);
  const config = loadConfig(values.config);
  const targets = loadTargets(values.targets);
  const profiles = loadProfiles(values.profile ?? []);

  const runs = Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, run({ config, profile, days })]));
  const verdicts = evaluate(targets, runs);
  const failed = verdicts.filter((v) => !v.pass).length;

  if (values.json) {
    const out = Object.fromEntries(Object.entries(runs).map(([id, r]) => [id, { summary: r.summary, timeline: r.timeline, metrics: r.metrics }]));
    print(JSON.stringify({ config: values.config, days, profiles: out, verdicts }, null, 2));
  } else {
    for (const [id, r] of Object.entries(runs)) print(`== ${id} (${days} days) ==\n${dayTable(r)}\n`);
    if (verdicts.length) {
      print(`targets: ${verdicts.length - failed}/${verdicts.length} pass`);
      for (const v of verdicts) print(verdictLine(v));
    }
  }
  return failed ? 1 : 0;
}

// "4,6,8" → [4, 6, 8]; "true,false" → booleans; anything else stays a string.
function parseValues(text) {
  return text.split(',').map((raw) => {
    const v = raw.trim();
    if (v === 'true' || v === 'false') return v === 'true';
    const n = Number(v);
    return v !== '' && Number.isFinite(n) ? n : v;
  });
}

// --param/--values are required; --param2/--values2 are an optional second pair.
function sweepParams(values) {
  if (values.param === undefined || values.values === undefined) throw new CliError('sweep needs --param <cfg path> --values a,b,c', 2);
  const params = [{ path: values.param, values: parseValues(values.values) }];
  if (values.param2 !== undefined || values.values2 !== undefined) {
    if (values.param2 === undefined || values.values2 === undefined) throw new CliError('--param2 and --values2 go together', 2);
    params.push({ path: values.param2, values: parseValues(values.values2) });
  }
  return params;
}

const showCell = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v));

function cmdSweep(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string' }, profile: { type: 'string', multiple: true }, days: { type: 'string' },
    targets: { type: 'string' }, json: { type: 'boolean', default: false },
    param: { type: 'string' }, values: { type: 'string' }, param2: { type: 'string' }, values2: { type: 'string' },
  } });
  const params = sweepParams(values);
  const days = parseDays(values.days);
  const config = loadConfig(values.config);
  const targets = loadTargets(values.targets);
  const profiles = loadProfiles(values.profile ?? []);
  let rows;
  try {
    rows = sweep({ config, profiles, targets, days, params });
  } catch (e) {
    throw new CliError(e.message);
  }
  if (values.json) { print(JSON.stringify(rows, null, 2)); return 0; }
  const ids = Object.keys(profiles);
  const header = [...params.map((p) => p.path), 'pass', ...ids.flatMap((id) => [`first-rig:${id}`, `offersLeft:${id}`])];
  const body = rows.map((row) => [
    ...params.map((p) => showCell(row.values[p.path])),
    `${row.passes}/${row.total}`,
    ...ids.flatMap((id) => [showCell(row.metrics[id]['firstEvent:rig']), showCell(row.metrics[id]['offersLeft.final'])]),
  ]);
  print(table([header, ...body]));
  return 0;
}

// Any config.js, including hand-written ones: evaluate it with a bare `window` and read the assignment.
function evaluateConfigJs(source, path) {
  const sandbox = { window: {} };
  try { runInNewContext(source, sandbox, { timeout: 1000 }); } catch (e) { throw new CliError(`${path}: ${e.message}`); }
  if (!sandbox.window.RA_CONFIG || typeof sandbox.window.RA_CONFIG !== 'object') throw new CliError(`${path}: did not assign window.RA_CONFIG`);
  return sandbox.window.RA_CONFIG;
}

function cmdConvert(args) {
  const { values } = parseArgs({ args, options: { to: { type: 'string' }, in: { type: 'string' }, out: { type: 'string' } } });
  if (!values.in || !values.out) throw new CliError('convert needs --in <path> and --out <path>', 2);
  if (values.to === 'js') {
    writeFileSync(values.out, toJs(readJson(values.in)));
  } else if (values.to === 'json') {
    let source;
    try { source = readFileSync(values.in, 'utf8'); } catch (e) { throw new CliError(`${values.in}: ${e.message}`); }
    let cfg;
    try { cfg = fromJs(source); } catch { cfg = evaluateConfigJs(source, values.in); }
    writeFileSync(values.out, JSON.stringify(cfg, null, 2) + '\n');
  } else {
    throw new CliError(`--to expects js or json, got ${JSON.stringify(values.to)}`, 2);
  }
  print(`wrote ${values.out}`);
  return 0;
}

const COMMANDS = { validate: cmdValidate, run: cmdRun, sweep: cmdSweep, convert: cmdConvert };

export function main(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h' || rest.includes('--help')) { print(USAGE); return 0; }
  if (!Object.hasOwn(COMMANDS, command)) { print(USAGE); return 2; }
  try {
    return COMMANDS[command](rest);
  } catch (e) {
    if (e instanceof CliError) { print(e.message); if (e.code === 2) print(USAGE); return e.code; }
    if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code?.startsWith?.('ERR_PARSE_ARGS')) { print(e.message); print(USAGE); return 2; }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
