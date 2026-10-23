// Balance simulator page: config editor driven by the schema, in-browser runs per profile,
// import/export. State lives in memory only; every URL is relative so the page works from a sub-path.
import { SHAPES, validateConfig } from '../model/config.mjs';
import { run } from '../model/core.mjs';
import { defaultModules } from '../model/registry.mjs';
import { toJs, fromJs, PREFIX } from '../model/convert.mjs';
import { fmt, fmtMetric } from './format.mjs';
import {
  EDITABLE_BLOCKS, NUMERIC_KINDS, fieldsFor, columnsFor, formValue, displayValue, getAt, setAt, blankRow, groupErrors,
} from './editor.mjs';

const METRICS_SHOWN = ['rigs.count', 'items.placed', 'offersLeft.final', 'shop.capHits'];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) node.append(c);
  return node;
};

const state = {
  presetFile: '',   // manifest's preset filename
  presetName: '',   // what the header shows
  preset: null,      // untouched copy for "Reset to preset"
  config: null,      // the object the editor mutates
  profiles: [],      // [{ id, ...profile }]
  errors: [],
  shapes: new Map(), // control path → shape, for formValue
};

// ---------- loading ----------

async function fetchJson(relative) {
  const url = new URL(relative, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.pathname}`);
  return res.json();
}

async function load() {
  const manifest = await fetchJson('./manifest.json');
  state.presetFile = manifest.presets[0];
  state.presetName = state.presetFile;
  const [preset, ...profiles] = await Promise.all([
    fetchJson(`../presets/${state.presetFile}`),
    ...manifest.profiles.map((p) => fetchJson(`../profiles/${p}`)),
  ]);
  state.preset = preset;
  state.profiles = profiles;
  $('preset-name').textContent = state.presetName;
  const select = $('profiles');
  for (const p of profiles) select.append(el('option', { value: p.id, selected: true, text: p.id }));
  setConfig(structuredClone(preset));
}

function setConfig(cfg) {
  state.config = cfg;
  renderEditor();
  revalidate();
}

// ---------- editor ----------

function renderEditor() {
  const root = $('editor');
  root.replaceChildren();
  state.shapes.clear();
  for (const block of EDITABLE_BLOCKS) root.append(renderBlock(block));
}

function renderBlock(block) {
  const shape = SHAPES[block];
  const cfgBlock = state.config[block];
  const isObject = cfgBlock !== null && typeof cfgBlock === 'object' && !Array.isArray(cfgBlock);
  const fs = el('fieldset', { 'data-block': block });
  const enabled = el('input', { type: 'checkbox', 'data-path': `${block}.enabled` });
  enabled.checked = isObject && cfgBlock.enabled !== false;
  enabled.disabled = !isObject;
  state.shapes.set(`${block}.enabled`, 'boolean');
  fs.classList.toggle('off', !enabled.checked);
  fs.append(el('legend', {}, [el('label', {}, [enabled, el('span', { text: block })]), el('span', { class: 'count' })]));
  if (!isObject) {
    fs.append(el('p', { class: 'err', style: 'display:block', text: `block ${block} is missing or not an object; reset or import a config` }));
    return fs;
  }

  const scalars = el('div', { class: 'fields' });
  const tables = [];
  for (const f of fieldsFor(shape)) {
    if (f.name === 'enabled') continue;
    const path = `${block}.${f.name}`;
    if (f.kind === 'list' && typeof f.shape.of === 'object' && f.shape.of.kind === 'record') tables.push(renderTable(path, f));
    else scalars.append(renderField(path, f));
  }
  if (scalars.children.length) fs.append(scalars);
  fs.append(...tables);
  return fs;
}

// A labelled control for one scalar (or list-of-scalars) field.
function renderField(path, f) {
  const wrap = el('label', { class: `field${f.optional ? ' optional' : ''}`, 'data-path': path }, [el('span', { text: f.name })]);
  wrap.append(control(path, f), el('small', { class: 'err' }));
  return wrap;
}

function control(path, f) {
  state.shapes.set(path, f.shape);
  const value = getAt(state.config, path);
  let input;
  if (f.kind === 'bool') {
    input = el('input', { type: 'checkbox' });
    input.checked = value === true;
  } else if (f.kind === 'enum') {
    const current = displayValue(f.shape, value);
    const options = f.optional ? ['', ...f.options] : [...f.options];
    if (!options.includes(current)) options.push(current); // keep an invalid value visible until the validator's message is acted on
    input = el('select', {}, options.map((o) => el('option', { value: o, text: o === '' ? '—' : o })));
    input.value = current;
  } else if (NUMERIC_KINDS.has(f.kind)) {
    input = el('input', { type: 'number', step: f.kind === 'nonNegInt' ? '1' : 'any', min: f.min });
    input.value = Number.isNaN(value) ? '' : displayValue(f.shape, value);
  } else {
    input = el('input', { type: 'text', placeholder: f.kind === 'list' ? 'a, b, c' : '' });
    input.value = displayValue(f.shape, value);
  }
  input.dataset.path = path;
  return input;
}

function renderTable(path, f) {
  const rows = getAt(state.config, path);
  const columns = columnsFor(f.shape.of);
  const wrap = el('div', { class: 'list-wrap', 'data-path': path }, [el('h3', { text: f.name })]);
  if (!Array.isArray(rows)) {
    wrap.append(el('small', { class: 'err', style: 'display:block', text: `${path} is not an array` }));
    return wrap;
  }
  const thead = el('thead', {}, [el('tr', {}, [...columns.map((c) => el('th', { class: c.optional ? 'optional' : '', text: c.name })), el('th')])]);
  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const tr = el('tr', { 'data-path': `${path}[${i}]` });
    for (const c of columns) {
      const cellPath = `${path}[${i}].${c.name}`;
      const td = el('td', { class: c.name === 'name' ? 'name' : '', 'data-path': cellPath });
      if (row && typeof row === 'object') td.append(control(cellPath, c), el('small', { class: 'err' }));
      else td.append(el('small', { class: 'err', style: 'display:block', text: 'not an object' }));
      tr.append(td);
    }
    tr.append(el('td', { class: 'remove' }, [el('button', { type: 'button', 'data-remove': `${path}[${i}]`, title: 'remove row', text: '×' })]));
    tbody.append(tr);
  });
  wrap.append(el('table', {}, [thead, tbody]));
  wrap.append(el('button', { type: 'button', class: 'add-row', 'data-add': path, text: '+ row' }));
  return wrap;
}

function onEdit(event) {
  const input = event.target;
  const path = input.dataset.path;
  if (!path) return;
  const shape = state.shapes.get(path);
  const raw = input.type === 'checkbox' ? input.checked : input.value;
  setAt(state.config, path, formValue(shape, raw));
  if (path.endsWith('.enabled')) input.closest('fieldset').classList.toggle('off', !input.checked);
  revalidate();
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.add) {
    const path = button.dataset.add;
    const block = path.split('.')[0];
    const field = fieldsFor(SHAPES[block]).find((f) => `${block}.${f.name}` === path);
    getAt(state.config, path).push(blankRow(field.shape.of));
    rerenderBlock(block);
  } else if (button.dataset.remove) {
    const m = /^(.*)\[(\d+)\]$/.exec(button.dataset.remove);
    getAt(state.config, m[1]).splice(Number(m[2]), 1);
    rerenderBlock(m[1].split('.')[0]);
  }
}

function rerenderBlock(block) {
  const old = $('editor').querySelector(`fieldset[data-block="${block}"]`);
  for (const key of [...state.shapes.keys()]) if (key.startsWith(`${block}.`)) state.shapes.delete(key);
  old.replaceWith(renderBlock(block));
  revalidate();
}

// ---------- validation ----------

function revalidate() {
  state.errors = validateConfig(state.config);
  const byPath = groupErrors(state.errors);
  const editor = $('editor');
  for (const node of editor.querySelectorAll('.invalid')) node.classList.remove('invalid');
  const placed = new Set();
  for (const [path, messages] of byPath) {
    const holder = editor.querySelector(`[data-path="${path}"]:not(input):not(select)`);
    const err = holder?.querySelector(':scope > .err');
    if (!err) continue;
    holder.classList.add('invalid');
    err.textContent = messages.join('; ');
    placed.add(path);
  }
  for (const fs of editor.querySelectorAll('fieldset')) {
    const block = fs.dataset.block;
    const n = state.errors.filter((e) => e.path === block || e.path.startsWith(`${block}.`)).length;
    fs.querySelector('.count').textContent = n ? `${n} error${n > 1 ? 's' : ''}` : '';
  }
  const other = state.errors.filter((e) => !placed.has(e.path));
  const list = $('other-errors');
  list.replaceChildren(...other.map((e) => el('li', { text: `${e.path || '(root)'}: ${e.message}` })));
  list.hidden = other.length === 0;

  const badge = $('error-count');
  const n = state.errors.length;
  badge.textContent = n ? `${n} validation error${n > 1 ? 's' : ''}` : 'config valid';
  badge.className = `badge ${n ? 'bad' : 'good'}`;
  $('run').disabled = n > 0;
  $('run-note').textContent = n ? 'fix the config to run' : '';
}

// ---------- run ----------

function selectedProfiles() {
  const ids = new Set([...$('profiles').selectedOptions].map((o) => o.value));
  return state.profiles.filter((p) => ids.has(p.id));
}

function onRun() {
  const days = Number($('days').value);
  const results = $('results');
  results.replaceChildren();
  if (!Number.isInteger(days) || days < 1) {
    results.append(el('p', { class: 'error-box', text: 'days must be a positive integer' }));
    return;
  }
  const profiles = selectedProfiles();
  if (profiles.length === 0) {
    results.append(el('p', { class: 'error-box', text: 'select at least one profile' }));
    return;
  }
  const config = structuredClone(state.config);
  for (const profile of profiles) {
    try {
      const r = run({ config: structuredClone(config), profile, days, modules: defaultModules() });
      results.append(renderResult(profile.id, r, days));
    } catch (e) {
      results.append(el('p', { class: 'error-box', text: `${profile.id}: ${e.message}` }));
      console.error(e);
    }
  }
}

function renderResult(id, r, days) {
  const head = ['day', 'active min', 'credits', 'passive $/s', 'offline $', 'active $', 'purchases'];
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]),
    el('tbody', {}, r.summary.map((d) => el('tr', {}, [
      d.day, d.activeMinutes, fmt(d.credits), fmt(d.incomePassive), fmt(d.offlineEarned), fmt(d.activeEarned), d.purchases.length,
    ].map((v) => el('td', { text: String(v) }))))),
  ]);
  const keys = [
    ...Object.keys(r.metrics).filter((k) => k.startsWith('firstEvent:')).sort(),
    ...METRICS_SHOWN.filter((k) => k in r.metrics),
  ];
  const metrics = el('dl', { class: 'metrics' });
  for (const k of keys) {
    const v = r.metrics[k];
    metrics.append(el('dt', { text: k }), el('dd', { text: k.startsWith('firstEvent:') ? `${fmtMetric(v)} s` : fmtMetric(v) }));
  }
  return el('div', { class: 'result' }, [el('h3', { text: `${id} · ${days} day${days > 1 ? 's' : ''}` }), table, metrics]);
}

// ---------- import / export ----------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onImport(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const cfg = text.trimStart().startsWith(PREFIX) ? fromJs(text) : JSON.parse(text);
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('the file does not hold an object');
    state.presetName = `${file.name} (imported)`;
    $('preset-name').textContent = state.presetName;
    setConfig(cfg);
  } catch (e) {
    alert(`Import failed: ${e.message}`);
  }
}

function onReset() {
  state.presetName = state.presetFile;
  $('preset-name').textContent = state.presetName;
  setConfig(structuredClone(state.preset));
}

// ---------- wiring ----------

$('editor').addEventListener('input', onEdit);
$('editor').addEventListener('click', onClick);
$('run').addEventListener('click', onRun);
$('import').addEventListener('change', onImport);
$('export-json').addEventListener('click', () => download('config.json', JSON.stringify(state.config, null, 2) + '\n', 'application/json'));
$('export-js').addEventListener('click', () => download('config.js', toJs(state.config), 'text/javascript'));
$('reset').addEventListener('click', onReset);

load().catch((e) => {
  $('preset-name').textContent = 'failed to load';
  $('error-count').textContent = e.message;
  $('error-count').className = 'badge bad';
  console.error(e);
});
