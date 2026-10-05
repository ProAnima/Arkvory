// The developers' section: engineering documents stay in docs/ (Russian, AGENTS.md); the site
// shows a copy of them for search and reading, with links between them kept working.
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { root, wiki, write, REPOSITORY, INTERNAL_ID } from './site.mjs';

/** Dated audits and reviews are records of a moment, not documents to read on the site. */
const ENGINEERING = /^(?!.*(?:AUDIT|REVIEW)).*\.md$/;

function rewriteLink(target, from, copied) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path, anchor = ''] = target.split('#');
  if (!path) return target;
  const absolute = posix.normalize(posix.join(posix.dirname(from), path));
  if (copied.has(absolute)) {
    const page = copied.get(absolute);
    const relativeLink = posix.relative(posix.dirname(copied.get(from)), page).replace(/\.md$/, '');
    return `${relativeLink.startsWith('.') ? relativeLink : `./${relativeLink}`}${anchor ? `#${anchor}` : ''}`;
  }
  return `${REPOSITORY}/blob/main/${absolute}${anchor ? `#${anchor}` : ''}`;
}

const titleOf = (text, fallback) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? fallback;

/** Copies docs/ into wiki/internal/ and writes its index; returns the number of documents. */
export function internalSection() {
  const target = join(wiki, INTERNAL_ID);
  rmSync(target, { recursive: true, force: true });
  const sources = [
    ...readdirSync(join(root, 'docs'))
      .filter((n) => ENGINEERING.test(n))
      .map((n) => `docs/${n}`),
    ...readdirSync(join(root, 'docs/adr'))
      .filter((n) => n.endsWith('.md'))
      .map((n) => `docs/adr/${n}`),
  ];
  // docs/X.md -> internal/X.md; docs/adr/README.md -> internal/adr/index.md.
  const copied = new Map(
    sources.map((source) => [
      source,
      source.replace(/^docs\//, `${INTERNAL_ID}/`).replace(/\/README\.md$/, '/index.md'),
    ]),
  );
  for (const [source, page] of copied) {
    const text = readFileSync(join(root, source), 'utf8');
    const body = text.replace(
      /\]\(([^)\s]+)\)/g,
      (_, link) => `](${rewriteLink(link, source, copied)})`,
    );
    const title = titleOf(text, posix.basename(source, '.md'));
    write(join(wiki, page), `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`);
  }
  const listed = [...copied]
    .filter(([source]) => !source.startsWith('docs/adr/') || source.endsWith('README.md'))
    .map(([source, page]) => {
      const title = titleOf(readFileSync(join(root, source), 'utf8'), source);
      return `- [${title}](./${posix.relative(INTERNAL_ID, page).replace(/\.md$/, '')})`;
    });
  write(
    join(wiki, INTERNAL_ID, 'index.md'),
    [
      '---',
      'title: "Документы для разработчиков"',
      '---',
      '',
      '# Документы для разработчиков',
      '',
      'Инженерные документы Arkvory: архитектура, контракты, проверки, решения (ADR). Они ведутся на русском в `docs/` репозитория; здесь — их копия для поиска и чтения.',
      '',
      ...listed,
      '',
    ].join('\n'),
  );
  return copied.size;
}
