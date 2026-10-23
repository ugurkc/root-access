// The game reads its tuning from `config.js`, a script that assigns `window.RA_CONFIG`; the
// simulator works on the same object as plain JSON. These two functions convert between them.
// fromJs() only reads what toJs() writes (a JSON literal after the prefix); the CLI falls back to
// evaluating any other hand-written config.js with node:vm, which cannot live here.
// Plain ES module with no node: imports: it runs in the browser too.

export const PREFIX = 'window.RA_CONFIG = ';

export function toJs(cfg) {
  return `${PREFIX}${JSON.stringify(cfg, null, 2)};\n`;
}

export function fromJs(source) {
  const text = String(source).trim();
  if (!text.startsWith(PREFIX)) throw new Error(`expected the source to start with ${JSON.stringify(PREFIX.trim())}`);
  const body = text.slice(PREFIX.length).replace(/;\s*$/, '');
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`the assigned value is not JSON: ${e.message}`);
  }
}
