import type { MarkdownRenderer } from 'vitepress';

/** `[[ui:backups]]`: what the interface calls something, in the page's language. */
export const UI_LABEL = /\[\[ui:([A-Za-z0-9_.-]+)\]\]/g;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&quot;');

/**
 * Pages name buttons, fields and screens by the interface's own keys, so a page
 * in any language says exactly what the app shows in it, and a renamed or removed
 * label breaks the build instead of leaving the page behind. A label is a text
 * with nothing to fill in; anything else is not a label and is refused.
 */
export function uiLabels(
  md: MarkdownRenderer,
  dictionaries: Record<string, Record<string, string>>,
  languageOf: (relativePath: string) => string,
) {
  md.core.ruler.push('arkvory-ui-labels', (state) => {
    const page = String(state.env?.relativePath ?? '');
    const dictionary = dictionaries[languageOf(page)] ?? dictionaries.en;
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const children = [];
      for (const token of block.children) {
        if (token.type !== 'text' || !token.content.includes('[[ui:')) {
          children.push(token);
          continue;
        }
        let last = 0;
        for (const match of token.content.matchAll(UI_LABEL)) {
          const key = match[1];
          const text = dictionary[key];
          if (text === undefined) throw new Error(`${page}: the interface has no text ${key}`);
          if (/[{}]/.test(text))
            throw new Error(`${page}: ${key} has values to fill in, so it is not a label`);
          if (match.index > last)
            children.push(
              Object.assign(new state.Token('text', '', 0), {
                content: token.content.slice(last, match.index),
              }),
            );
          children.push(
            Object.assign(new state.Token('html_inline', '', 0), {
              content: `<span class='ui-label'>${escape(text)}</span>`,
            }),
          );
          last = match.index + match[0].length;
        }
        if (last < token.content.length)
          children.push(
            Object.assign(new state.Token('text', '', 0), { content: token.content.slice(last) }),
          );
      }
      block.children = children;
    }
  });
}
