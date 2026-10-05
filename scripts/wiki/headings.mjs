// Headings of the written pages. Every `##` and `###` carries an explicit English id
// (`## Backups {#backups}`): a translation keeps the ids, so a link to a section works in every
// language, and tests/wiki.test.mjs compares a page's ids with the English page's.

const FENCE = /^s*(```|~~~)/;
const HEADING = /^(#{2,3})\s+(.*?)\s*$/;
const ID = /\s*\{#([A-Za-z0-9_-]+)\}$/;

/** The id VitePress would make of a heading's text: lowercase words joined by `-`. */
export function slug(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/`|\[\[ui:[^\]]*\]\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .replace(/^(\d)/, '_$1');
}

/** The `##`/`###` headings of a page outside code blocks: level, text and explicit id. */
export function headings(markdown) {
  const found = [];
  let fence = null;
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const marker = FENCE.exec(line)?.[1];
    if (marker && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence !== null) continue;
    const match = HEADING.exec(line);
    if (!match) continue;
    const id = ID.exec(match[2])?.[1] ?? null;
    found.push({ line: index + 1, level: match[1].length, text: match[2].replace(ID, ''), id });
  }
  return found;
}

/**
 * The page with an id added to each heading that has none: its VitePress slug, so links
 * written against the slug keep working; a repeated slug gets `-2`, `-3`.
 */
export function withIds(markdown) {
  const used = new Set(headings(markdown).flatMap((h) => (h.id ? [h.id] : [])));
  const missing = new Map(
    headings(markdown)
      .filter((h) => !h.id)
      .map((h) => {
        const base = slug(h.text) || 'section';
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${String(n)}`;
        used.add(id);
        return [h.line, id];
      }),
  );
  return markdown
    .split(/(?<=\n)/)
    .map((line, index) => {
      const id = missing.get(index + 1);
      return id ? line.replace(/[ \t]*(\r?\n)?$/, (_, end = '') => ` {#${id}}${end}`) : line;
    })
    .join('');
}
