// Pure helpers behind the config editor: shape → field descriptors, form text ⇄ config values,
// and path access into a config object. No DOM here, so Node can test it.
import { SHAPES } from '../model/config.mjs';

export const EDITABLE_BLOCKS = Object.keys(SHAPES).filter((b) => b !== 'schema');

// Normalises the schema's two shape spellings ('number' | { kind }) to one kind name.
export function kindOf(shape) {
  if (shape === 'number') return 'num';
  if (shape === 'boolean') return 'bool';
  if (shape === 'string') return 'str';
  return shape.kind;
}

export const NUMERIC_KINDS = new Set(['num', 'pos', 'atLeast', 'nonNegInt']);

function describe(name, shape, optional) {
  const d = { name, kind: kindOf(shape), optional, shape };
  if (d.kind === 'enum') d.options = shape.values;
  if (d.kind === 'atLeast') d.min = shape.min;
  if (d.kind === 'pos') d.min = 0;
  if (d.kind === 'nonNegInt') d.min = 0;
  return d;
}

// Ordered field descriptors for a record shape: required keys in schema order, then the optional ones.
export function fieldsFor(shape) {
  if (kindOf(shape) !== 'record') throw new Error('fieldsFor needs a record shape');
  return [
    ...Object.entries(shape.keys).map(([k, s]) => describe(k, s, false)),
    ...Object.entries(shape.optional ?? {}).map(([k, s]) => describe(k, s, true)),
  ];
}

// Columns for a table of records: fieldsFor() with nested records flattened to dotted names
// (items: event → event.boost, event.dur). A sub-field of an optional record is optional too.
export function columnsFor(shape) {
  const out = [];
  for (const f of fieldsFor(shape)) {
    if (f.kind !== 'record') { out.push(f); continue; }
    for (const sub of columnsFor(f.shape)) out.push({ ...sub, name: `${f.name}.${sub.name}`, optional: f.optional || sub.optional });
  }
  return out;
}

// Raw control value (string, or boolean from a checkbox) → config value.
// Empty text → undefined (the key is removed; the validator reports a required one as missing).
// Non-numeric text for a numeric kind → NaN, so the validator, not the editor, rejects it.
// A list of scalars is edited as comma-separated text; empty text is an empty list.
export function formValue(shape, raw) {
  const kind = kindOf(shape);
  if (kind === 'bool') return typeof raw === 'boolean' ? raw : String(raw).trim() === 'true';
  const text = raw == null ? '' : String(raw).trim();
  if (kind === 'list') return text === '' ? [] : text.split(',').map((s) => formValue(shape.of, s));
  if (text === '') return undefined;
  if (kind === 'str' || kind === 'enum') return text;
  return Number(text);
}

// Config value → text for a control. Inverse of formValue for everything a control can hold.
export function displayValue(shape, value) {
  if (value === undefined || value === null) return '';
  if (kindOf(shape) === 'list') return value.map((v) => displayValue(shape.of, v)).join(', ');
  return String(value);
}

const SEGMENT_RE = /^([A-Za-z_]\w*)(?:\[([^\]]+)\])?$/;

// 'jobs.list[2].cost' → [{ key: 'jobs' }, { key: 'list', selector: '2' }, { key: 'cost' }].
export function parsePath(path) {
  if (typeof path !== 'string' || path === '') throw new Error('empty path');
  return path.split('.').map((seg) => {
    const m = SEGMENT_RE.exec(seg);
    if (!m) throw new Error(`malformed path ${JSON.stringify(path)} at ${JSON.stringify(seg)}`);
    return { key: m[1], selector: m[2] };
  });
}

// A selector is an index, or the entry's id (or job, for rigs). → index or -1.
function indexIn(list, selector) {
  if (!Array.isArray(list)) return -1;
  if (/^\d+$/.test(selector)) return Number(selector) < list.length ? Number(selector) : -1;
  return list.findIndex((e) => e && typeof e === 'object' && (e.id === selector || (e.id === undefined && e.job === selector)));
}

// Flattens a path to the keys and indices to walk, resolving id selectors against `cfg`.
// → [keys] or null when an array selector matches nothing.
function keysOf(cfg, path) {
  const keys = [];
  let node = cfg;
  for (const { key, selector } of parsePath(path)) {
    keys.push(key);
    node = node == null ? undefined : node[key];
    if (selector === undefined) continue;
    const i = indexIn(node, selector);
    if (i === -1) return null;
    keys.push(i);
    node = node[i];
  }
  return keys;
}

export function getAt(cfg, path) {
  const keys = keysOf(cfg, path);
  if (!keys) return undefined;
  let node = cfg;
  for (const k of keys) {
    if (node == null) return undefined;
    node = node[k];
  }
  return node;
}

// Mutates `cfg` in place and returns it. Missing intermediate objects are created (an absent
// `event` when `event.boost` is set); `value === undefined` deletes the key instead.
export function setAt(cfg, path, value) {
  const keys = keysOf(cfg, path);
  if (!keys) throw new Error(`${path}: no such entry`);
  let node = cfg;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (node[k] == null || typeof node[k] !== 'object') {
      if (value === undefined) return cfg;
      node[k] = {};
    }
    node = node[k];
  }
  const last = keys.at(-1);
  if (value === undefined) delete node[last];
  else node[last] = value;
  return cfg;
}

// A new list entry with every required key present but empty, so the validator lists what to fill.
export function blankRow(shape) {
  const row = {};
  for (const f of fieldsFor(shape).filter((f) => !f.optional)) {
    if (f.kind === 'bool') row[f.name] = false;
    else if (f.kind === 'enum') row[f.name] = f.options[0];
    else if (f.kind === 'list') row[f.name] = [];
    else if (f.kind === 'record') row[f.name] = blankRow(f.shape);
    else row[f.name] = f.kind === 'str' ? '' : NaN;
  }
  return row;
}

// Groups validator errors by the exact path they name; `errorsAt(map, path)` reads one field's.
export function groupErrors(errors) {
  const map = new Map();
  for (const e of errors) (map.get(e.path) ?? map.set(e.path, []).get(e.path)).push(e.message);
  return map;
}
