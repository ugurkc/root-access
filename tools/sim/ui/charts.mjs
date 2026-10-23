// Charts for the run panel: credits and passive income over simulated days, one line per profile,
// with a marker per rig, rack and item purchase. seriesFromResult() is pure (Node tests it); the
// render functions need the DOM and the Chart.js global loaded by index.html.
import { fmt } from './format.mjs';

export const MARKER_KINDS = ['rig', 'rack', 'item'];
const DAY = 86400;

// Linear interpolation of y between two points by x.
const lerp = (a, b, x) => (b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));

// run() result → { profile, credits: [{x,y}], passive: [{x,y}], markers: [{ x, kind, id, cost, passive }] }.
// x is in simulated days on the wall clock: the summary rows give the day boundaries (x = day), and
// each marker sits at its timeline `t` plus the day-1 session's start hour (`day1StartHour`, default 0),
// which is the frame `t` counts from. A marker's `passive` is the line's value at that x, so the
// passive chart can place it on the curve; its `cost` is what the credits chart uses.
export function seriesFromResult(result, profileId, { day1StartHour = 0 } = {}) {
  const summary = Array.isArray(result?.summary) ? result.summary : [];
  const timeline = Array.isArray(result?.timeline) ? result.timeline : [];
  const x0 = (day1StartHour * 3600) / DAY;
  const credits = [{ x: x0, y: 0 }, ...summary.map((d) => ({ x: d.day, y: d.credits }))];
  const passive = [{ x: x0, y: 0 }, ...summary.map((d) => ({ x: d.day, y: d.incomePassive }))];
  const markers = [];
  for (const e of timeline) {
    if (!MARKER_KINDS.includes(e.kind)) continue;
    const x = (day1StartHour * 3600 + e.t) / DAY;
    const i = Math.min(Math.max(e.day, 1), summary.length); // index of the day's end point in `passive`
    const at = i === 0 ? 0 : lerp(passive[i - 1], passive[i], Math.min(x, passive[i].x));
    markers.push({ x, kind: e.kind, id: e.id, cost: e.cost, passive: at });
  }
  return { profile: profileId, credits, passive, markers };
}

// ---------- rendering (browser only) ----------

const PROFILE_COLOURS = ['#35e0dc', '#ff3344', '#f0c050', '#9b7cf0', '#5cd65c'];
const KIND_STYLE = { rig: 'triangle', rack: 'rect', item: 'circle' };
let charts = [];

export const chartsAvailable = () => typeof globalThis.Chart === 'function';

export function clearCharts(host) {
  for (const c of charts) c.destroy();
  charts = [];
  host.replaceChildren();
}

// series: [{ profile, credits, passive, markers }] in display order.
export function renderCharts(host, series) {
  clearCharts(host);
  if (!chartsAvailable()) {
    host.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Charts need Chart.js (cdnjs); it did not load.' }));
    return;
  }
  const Chart = globalThis.Chart;
  Chart.defaults.color = '#8a7468';
  Chart.defaults.borderColor = '#3a2a24';
  Chart.defaults.font.family = "'VT323', 'Courier New', monospace";
  Chart.defaults.font.size = 15;
  const colourOf = (profile) => PROFILE_COLOURS[series.findIndex((s) => s.profile === profile) % PROFILE_COLOURS.length];
  host.append(
    chart(host, 'credits', series, (s) => s.credits, (m) => m.cost, colourOf),
    chart(host, 'passive income $/s', series, (s) => s.passive, (m) => m.passive, colourOf),
  );
}

const isPowerOfTen = (v) => v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9;

function chart(host, title, series, pick, markerY, colourOf) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${title} over simulated days`);
  wrap.append(canvas);
  const datasets = series.map((s) => ({
    type: 'line', label: s.profile, data: pick(s), borderColor: colourOf(s.profile), backgroundColor: colourOf(s.profile),
    borderWidth: 2, pointRadius: 0, pointHitRadius: 6, pointStyle: 'line', tension: 0, order: 2,
  }));
  for (const kind of MARKER_KINDS) {
    const points = series.flatMap((s) => s.markers.filter((m) => m.kind === kind).map((m) => ({ x: m.x, y: markerY(m), id: m.id, cost: m.cost, profile: s.profile })));
    datasets.push({
      type: 'scatter', label: kind, data: points, pointStyle: KIND_STYLE[kind], radius: 6, hoverRadius: 8, order: 1,
      backgroundColor: points.map((p) => colourOf(p.profile)), borderColor: '#0a0708', borderWidth: 1,
    });
  }
  const c = new globalThis.Chart(canvas, {
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        title: { display: true, text: title, color: '#ead9cf', font: { size: 16 } },
        legend: { labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => `day ${items[0].parsed.x.toFixed(2)}`,
            label: (item) => {
              const d = item.raw;
              return d.id !== undefined ? `${d.profile}: ${d.id} (${item.dataset.label}) cost ${fmt(d.cost)}` : `${item.dataset.label}: ${fmt(item.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 0, title: { display: true, text: 'day' }, ticks: { stepSize: 1 }, grid: { color: '#2a1e1a' } },
        y: { type: 'logarithmic', ticks: { callback: (v) => (v === 0 || isPowerOfTen(v) ? fmt(v) : '') }, grid: { color: '#2a1e1a' } },
      },
    },
  });
  charts.push(c);
  return wrap;
}
