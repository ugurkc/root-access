// Sweep panel: one or two config paths × value lists, run in the browser one combination at a time
// so the page stays responsive; the table mirrors the CLI's and a row click loads that combination.
// Browser only; the pure parts live in sweep.mjs.
import { sweep } from '../model/sweep.mjs';
import { el, $ } from './dom.mjs';
import { leafNumericPaths, paramsFromForm, combinations, showCell } from './sweep.mjs';

const SHOWN = ['firstEvent:rig', 'offersLeft.final'];
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// { getConfig, getProfiles: () => [profile…], getTargets, onPick(values) } → panel.
export function createSweepPanel({ getConfig, getProfiles, getTargets, onPick }) {
  const results = $('sweep-results');
  const button = $('sweep-run');
  const note = $('sweep-note');
  let running = false;
  let generation = 0;

  // Datalist of numeric leaf paths for the current config.
  function refreshPaths() {
    const cfg = getConfig();
    $('sweep-paths').replaceChildren(...(cfg ? leafNumericPaths(cfg) : []).map((p) => el('option', { value: p })));
  }

  function fail(message) {
    results.replaceChildren(el('p', { class: 'error-box', text: message }));
  }

  async function onRun() {
    if (running) { generation++; return; } // a second click cancels the sweep in progress
    let params;
    try {
      params = paramsFromForm({ path: $('sweep-path').value, values: $('sweep-values').value, path2: $('sweep-path2').value, values2: $('sweep-values2').value });
    } catch (e) {
      fail(e.message);
      return;
    }
    const days = Number($('sweep-days').value);
    if (!Number.isInteger(days) || days < 1) { fail('days must be a positive integer'); return; }
    const profiles = getProfiles();
    if (profiles.length === 0) { fail('select at least one profile in the run panel'); return; }
    const targets = getTargets();
    if (!targets) { fail('fix the targets to sweep'); return; }
    const profilesById = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const ids = Object.keys(profilesById);
    const config = structuredClone(getConfig());
    const combos = combinations(params);

    const head = el('tr', {}, [
      ...params.map((p) => el('th', { text: p.path })),
      el('th', { text: 'pass' }),
      ...ids.flatMap((id) => SHOWN.map((k) => el('th', { text: `${k}/${id}` }))),
    ]);
    const body = el('tbody');
    results.replaceChildren(el('div', { class: 'table-wrap' }, [el('table', { class: 'sweep-table' }, [el('thead', {}, [head]), body])]));

    running = true;
    const mine = ++generation;
    button.textContent = 'Stop';
    button.classList.add('busy');
    let done = 0;
    try {
      for (const combo of combos) {
        await yieldToBrowser();
        if (generation !== mine) { note.textContent = `stopped after ${done}/${combos.length}`; return; }
        note.textContent = `running ${done + 1}/${combos.length}…`;
        const row = sweep({ config, profiles: profilesById, targets, days, params: combo.map(([path, v]) => ({ path, values: [v] })) })[0];
        body.append(renderRow(row, params, ids));
        done++;
      }
      note.textContent = `${done} combination${done === 1 ? '' : 's'} · click a row to load it`;
    } catch (e) {
      results.append(el('p', { class: 'error-box', text: e.message }));
      note.textContent = `stopped after ${done}/${combos.length}`;
      console.error(e);
    } finally {
      running = false;
      button.textContent = 'Run sweep';
      button.classList.remove('busy');
    }
  }

  function renderRow(row, params, ids) {
    const tr = el('tr', { class: 'pick', role: 'button', tabindex: '0', title: 'load this combination into the editor' }, [
      ...params.map((p) => el('td', { class: 'value', text: showCell(row.values[p.path]) })),
      el('td', { class: row.passes === row.total ? 'pass' : '', text: `${row.passes}/${row.total}` }),
      ...ids.flatMap((id) => SHOWN.map((k) => el('td', { text: showCell(row.metrics[id][k]) }))),
    ]);
    const pick = () => onPick(row.values);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return tr;
  }

  button.addEventListener('click', onRun);
  return { refreshPaths };
}
