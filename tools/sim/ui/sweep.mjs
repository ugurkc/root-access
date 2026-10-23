// Pure helpers behind the sweep panel: candidate paths, value parsing and the combination grid.
// No DOM here, so Node can test it. Paths use the grammar of model/sweep.mjs (setPath/getPath).

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Every path to a finite number in `cfg`, depth first in key order. Array entries are addressed by
// `id`, else `job` (rigs), else index — the same selectors setPath() resolves; an entry whose id
// repeats falls back to its index so the path stays unambiguous.
export function leafNumericPaths(cfg) {
  const out = [];
  const walk = (node, prefix) => {
    if (Array.isArray(node)) {
      const ids = node.map((e) => (isRecord(e) ? (typeof e.id === 'string' && e.id ? e.id : e.id === undefined && typeof e.job === 'string' ? e.job : undefined) : undefined));
      node.forEach((e, i) => {
        const id = ids[i];
        const unique = id !== undefined && ids.indexOf(id) === i && ids.lastIndexOf(id) === i && /^[^\]]+$/.test(id);
        walk(e, `${prefix}[${unique ? id : i}]`);
      });
      return;
    }
    if (isRecord(node)) {
      for (const [k, v] of Object.entries(node)) {
        if ((!prefix && k === 'schema') || k === 'enabled') continue; // not balance values
        if (!/^[A-Za-z_]\w*$/.test(k)) continue;
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }
    if (typeof node === 'number' && Number.isFinite(node) && prefix) out.push(prefix);
  };
  walk(cfg, '');
  return out;
}

// '500, 1000,2000' → [500, 1000, 2000]; 'true,false' → booleans. Throws on an empty list or a token
// that is neither a number nor a boolean, naming the token.
export function parseValues(text) {
  const tokens = String(text ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (tokens.length === 0) throw new Error('values: give at least one number, comma separated');
  return tokens.map((v) => {
    if (v === 'true' || v === 'false') return v === 'true';
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`values: ${JSON.stringify(v)} is not a number`);
    return n;
  });
}

// Form fields → sweep params [{ path, values }]; throws on a missing path, bad values or a second param
// that repeats the first. The second pair is optional and must be given together.
export function paramsFromForm({ path, values, path2 = '', values2 = '' }) {
  const p1 = String(path ?? '').trim();
  if (!p1) throw new Error('param: give a config path such as jobs.list[wifi].cost');
  const params = [{ path: p1, values: parseValues(values) }];
  const p2 = String(path2 ?? '').trim();
  const v2 = String(values2 ?? '').trim();
  if (p2 || v2) {
    if (!p2 || !v2) throw new Error('second param and its values go together');
    if (p2 === p1) throw new Error(`both params name ${JSON.stringify(p1)}`);
    params.push({ path: p2, values: parseValues(v2) });
  }
  return params;
}

// Cartesian product, first param outermost, as sweep() orders its rows: [[[path, value], …], …].
export function combinations(params) {
  return params.reduce((acc, p) => acc.flatMap((prefix) => p.values.map((v) => [...prefix, [p.path, v]])), [[]]);
}

// A sweep row's cell text like the CLI prints it: '-' for a missing value, one decimal for fractions.
export const showCell = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v));
