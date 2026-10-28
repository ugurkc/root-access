// Charts for the run panel: credits and passive income over simulated days, one line per profile,
// with a marker per rig, class and tier purchase and per loot claim. seriesFromResult() and
// markerValue() are pure (Node tests them); the render functions need the DOM and the Chart.js
// global loaded by index.html.
import { fmt } from './format.mjs';

export const MARKER_KINDS = ['rig', 'class', 'tier', 'loot'];
// Loot is not passive income, so the passive chart draws only the purchases.
export const PASSIVE_MARKER_KINDS = MARKER_KINDS.filter((k) => k !== 'loot');
// Chart.js point styles per kind. Purchases are filled shapes; loot is money coming in, so it is a
// hollow star drawn in the profile's colour, and a run claims loot often enough (hundreds of points
// over a week) that its dataset starts hidden: the legend shows it and a click reveals it.
export const KIND_STYLE = {
  rig: { pointStyle: 'triangle' },
  class: { pointStyle: 'rect' },
  tier: { pointStyle: 'rectRot' },
  loot: { pointStyle: 'star', hollow: true, hidden: true },
};
const DAY = 86400;

// Linear interpolation of y between two points by x.
const lerp = (a, b, x) => (b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));

// run() result → { profile, credits: [{x,y}], passive: [{x,y}], markers: [{ x, kind, id, cost, earned, drops, passive }] }.
// x is in simulated days on the wall clock: the summary rows give the day boundaries (x = day), and
// each marker sits at its timeline `t` plus the day-1 session's start hour (`day1StartHour`, default 0),
// which is the frame `t` counts from. A marker's `passive` is the line's value at that x, so the
// passive chart can place it on the curve; markerValue() (a purchase's cost, a loot claim's earned)
// is what the credits chart uses. `drops` is the loot claim's drop count.
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
    markers.push({ x, kind: e.kind, id: e.id, cost: e.cost, earned: e.earned, drops: e.drops, passive: at });
  }
  return { profile: profileId, credits, passive, markers };
}

// The credits a marker stands for: what a loot claim earned, else what a purchase cost.
export const markerValue = (m) => m.earned ?? m.cost;

// One scatter dataset per marker kind in `kinds`, pure so Node can test the shape. `markerY(m)` is the
// marker's y on this chart, `colourOf(profile)` its colour; `palette.bg` outlines filled points and
// `palette.fg` is the border a hollow dataset with no points falls back to, so its legend swatch is
// still visible (an empty colour array would draw nothing on the dark theme).
export function markerDatasets(series, kinds, markerY, colourOf, palette) {
  return kinds.map((kind) => {
    const { pointStyle, hollow, hidden } = KIND_STYLE[kind];
    const points = series.flatMap((s) => s.markers.filter((m) => m.kind === kind).map((m) => ({ ...m, y: markerY(m), profile: s.profile })));
    const colours = points.map((p) => colourOf(p.profile));
    return {
      type: 'scatter', label: kind, data: points, pointStyle, radius: hollow ? 7 : 6, hoverRadius: 8, order: 1, hidden: hidden === true,
      backgroundColor: hollow ? 'transparent' : colours,
      borderColor: hollow ? (colours.length ? colours : palette.fg) : palette.bg,
      borderWidth: hollow ? 2 : 1,
    };
  });
}

// ---------- rendering (browser only) ----------

let charts = [];
let theme; // read from the page's CSS custom properties on first render

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  theme = {
    fg: v('--fg', '#ead9cf'), dim: v('--dim', '#8a7468'), border: v('--border', '#3a2a24'), bg: v('--bg', '#0a0708'),
    grid: v('--panel-2', '#1d1614'), font: v('--font-body', 'monospace'),
    profiles: [v('--blue', '#35e0dc'), v('--red', '#ff3344'), '#f0c050', '#9b7cf0', '#5cd65c'],
  };
  const Chart = globalThis.Chart;
  Chart.defaults.color = theme.dim;
  Chart.defaults.borderColor = theme.border;
  Chart.defaults.font.family = theme.font;
  Chart.defaults.font.size = 15;
}

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
  if (!theme) readTheme();
  const colourOf = (profile) => theme.profiles[series.findIndex((s) => s.profile === profile) % theme.profiles.length];
  host.append(
    chart(host, 'credits', series, (s) => s.credits, MARKER_KINDS, markerValue, colourOf),
    chart(host, 'passive income $/s', series, (s) => s.passive, PASSIVE_MARKER_KINDS, (m) => m.passive, colourOf),
  );
}

const isPowerOfTen = (v) => v > 0 && Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9;

function chart(host, title, series, pick, kinds, markerY, colourOf) {
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
  datasets.push(...markerDatasets(series, kinds, markerY, colourOf, theme));
  const c = new globalThis.Chart(canvas, {
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        title: { display: true, text: title, color: theme.fg, font: { size: 16 } },
        legend: { labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => `day ${items[0].parsed.x.toFixed(2)}`,
            label: (item) => {
              const d = item.raw;
              if (d.id === undefined) return `${item.dataset.label}: ${fmt(item.parsed.y)}`;
              if (d.kind === 'loot') return `${d.profile}: loot ×${d.drops} earned ${fmt(markerValue(d))}`;
              return `${d.profile}: ${d.id} (${item.dataset.label}) cost ${fmt(markerValue(d))}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 0, title: { display: true, text: 'day' }, ticks: { stepSize: 1 }, grid: { color: theme.grid } },
        y: { type: 'logarithmic', ticks: { callback: (v) => (v === 0 || isPowerOfTen(v) ? fmt(v) : '') }, grid: { color: theme.grid } },
      },
    },
  });
  charts.push(c);
  return wrap;
}
