// Targets panel: editable target rows, validation, and verdicts per profile after each run.
// Browser only; the pure parts live in targets.mjs.
import { evaluate, validateTargets } from '../model/targets.mjs';
import { el, $, download, readFileEvent } from './dom.mjs';
import {
  OP_NAMES, targetToRow, rowToTarget, blankRow, summarizeVerdicts, metricSuggestions, groupTargetErrors,
} from './targets.mjs';

const FIELDS = ['id', 'label', 'metric', 'op', 'value', 'profile', 'from', 'to'];
const showValue = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));

// { profileIds: () => [id…] } → panel. Rows are the editor's state; targets() derives the objects.
export function createTargetsPanel({ profileIds }) {
  let rows = [];
  let runs = {};        // last run results by profile id
  let defaults = [];    // what Reset restores
  const table = $('targets-table');
  const errorList = $('targets-errors');
  const badge = $('targets-badge');
  const metricList = $('metric-list');

  const targets = () => rows.map(rowToTarget);

  function setTargets(list, { asDefault = false } = {}) {
    rows = list.map(targetToRow);
    if (asDefault) defaults = structuredClone(list);
    render();
  }

  function setRuns(next) {
    runs = next;
    metricList.replaceChildren(...metricSuggestions(runs).map((m) => el('option', { value: m })));
    render();
  }

  function render() {
    const runIds = Object.keys(runs);
    const head = el('tr', {}, [
      ...FIELDS.map((f) => el('th', { class: `col-${f}`, text: f === 'from' ? 'days from' : f === 'to' ? 'to' : f })),
      el('th'),
      ...runIds.map((id) => el('th', { class: 'verdict', text: id })),
    ]);
    const body = el('tbody');
    rows.forEach((row, i) => {
      const tr = el('tr', { 'data-row': i });
      for (const f of FIELDS) tr.append(el('td', { class: `col-${f}`, 'data-field': f }, [control(row, f, i), el('small', { class: 'err' })]));
      tr.append(el('td', { class: 'remove' }, [el('button', { type: 'button', 'data-remove': i, title: 'remove target', text: '×' })]));
      for (const id of runIds) tr.append(el('td', { class: 'verdict', 'data-profile': id }));
      body.append(tr);
    });
    table.replaceChildren(el('thead', {}, [head]), body);
    if (rows.length === 0) body.append(el('tr', {}, [el('td', { colspan: FIELDS.length + 1 + runIds.length, class: 'empty', text: 'No targets. Add one or import a targets JSON.' })]));
    refresh();
  }

  function control(row, f, i) {
    let input;
    if (f === 'op') input = el('select', {}, OP_NAMES.map((o) => el('option', { value: o, text: o })));
    else if (f === 'profile') input = el('select', {}, ['all', ...profileIds()].map((p) => el('option', { value: p, text: p })));
    else if (f === 'value' || f === 'from' || f === 'to') input = el('input', { type: 'number', step: 'any', min: f === 'value' ? undefined : 1 });
    else input = el('input', { type: 'text', list: f === 'metric' ? 'metric-list' : undefined, spellcheck: 'false' });
    if (input.tagName === 'SELECT' && ![...input.options].some((o) => o.value === row[f])) input.append(el('option', { value: row[f], text: row[f] || '—' }));
    input.value = row[f];
    input.dataset.row = i;
    input.dataset.field = f;
    return input;
  }

  // Validation marks and verdict cells, without rebuilding the inputs (so typing keeps focus).
  function refresh() {
    const list = targets();
    const errors = validateTargets(list);
    const grouped = groupTargetErrors(errors);
    const loose = [];
    for (const td of table.querySelectorAll('td.invalid')) td.classList.remove('invalid');
    for (const [rowIndex, fields] of grouped) {
      for (const [field, messages] of fields) {
        const td = field ? table.querySelector(`tr[data-row="${rowIndex}"] td[data-field="${field}"]`) : null;
        if (!td) { loose.push(`${rowIndex >= 0 ? `row ${rowIndex + 1}: ` : ''}${messages.join('; ')}`); continue; }
        td.classList.add('invalid');
        td.querySelector('.err').textContent = messages.join('; ');
      }
    }
    errorList.replaceChildren(...loose.map((m) => el('li', { text: m })));
    errorList.hidden = loose.length === 0;

    const hasRuns = Object.keys(runs).length > 0;
    if (errors.length) {
      badge.textContent = `${errors.length} target error${errors.length > 1 ? 's' : ''}`;
      badge.className = 'badge bad';
      for (const td of table.querySelectorAll('td.verdict')) td.replaceChildren();
      return;
    }
    if (!hasRuns) {
      badge.textContent = rows.length ? 'run to evaluate' : '';
      badge.className = 'badge';
      return;
    }
    const summary = summarizeVerdicts(evaluate(list, runs));
    badge.textContent = summary.label;
    badge.className = `badge ${summary.passes === summary.total ? 'good' : 'bad'}`;
    rows.forEach((row, i) => {
      for (const td of table.querySelectorAll(`tr[data-row="${i}"] td.verdict`)) {
        const v = summary.byKey.get(`${list[i].id}/${td.dataset.profile}`);
        td.replaceChildren(...(v ? verdictCell(v) : [el('span', { class: 'dim', text: '—' })]));
        td.classList.toggle('pass', Boolean(v?.pass));
        td.classList.toggle('fail', v ? !v.pass : false);
      }
    });
  }

  function verdictCell(v) {
    const mark = el('span', { class: 'mark', text: v.pass ? '✓' : '✗' });
    const days = v.expected.days ? ` d${v.expected.days[0]}–${v.expected.days[1]}` : '';
    const expected = `${v.expected.op} ${showValue(v.expected.value)}${days}`;
    if (v.error) return [mark, ' ', el('small', { class: 'error-text', text: v.error }), ' ', el('small', { text: `(${expected})` })];
    return [mark, ` ${showValue(v.actual)} `, el('small', { text: `(${expected})` })];
  }

  function onInput(event) {
    const input = event.target;
    const { row, field } = input.dataset;
    if (row === undefined || !field) return;
    rows[Number(row)][field] = input.value;
    refresh();
  }

  function onClick(event) {
    const button = event.target.closest('button[data-remove]');
    if (!button) return;
    rows.splice(Number(button.dataset.remove), 1);
    render();
  }

  async function onImport(event) {
    try {
      const file = await readFileEvent(event);
      if (!file) return;
      const list = JSON.parse(file.text);
      if (!Array.isArray(list)) throw new Error('the file does not hold an array of targets');
      setTargets(list);
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  }

  table.addEventListener('input', onInput);
  table.addEventListener('click', onClick);
  $('targets-add').addEventListener('click', () => { rows.push(blankRow()); render(); });
  $('targets-import').addEventListener('change', onImport);
  $('targets-export').addEventListener('click', () => download('targets.json', JSON.stringify(targets(), null, 2) + '\n', 'application/json'));
  $('targets-reset').addEventListener('click', () => setTargets(defaults));

  return { setTargets, setRuns, targets, isValid: () => validateTargets(targets()).length === 0 };
}
