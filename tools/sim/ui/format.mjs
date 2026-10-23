// Number formatting shared by the CLI and the UI. Plain ES module with no node: imports.

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

// Metric values for the results panel: integers as is, fractions with two decimals, arrays joined.
export function fmtMetric(v) {
  if (Array.isArray(v)) return v.map(fmtMetric).join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}
