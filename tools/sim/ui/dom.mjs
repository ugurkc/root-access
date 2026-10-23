// Tiny DOM helpers shared by the page's panels. Browser only.

export const $ = (id) => document.getElementById(id);

// el('td', { class: 'x', text: 'y', 'data-k': v }, [children…]); attrs set to undefined/false are skipped.
export const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) node.append(c);
  return node;
};

// Triggers a file download of `text` named `name`.
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Reads a `<input type="file">` change event's first file as text; resolves undefined when none.
export async function readFileEvent(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return undefined;
  return { name: file.name, text: await file.text() };
}
