import type { MarkdownRenderer } from 'vitepress';

const html = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');

/**
 * VitePress turns a page into
 * a Vue template, where `{{ }}` would be run as code. Braces in text and inline
 * code are written as character references, so a page shows `{{secret.TOKEN}}`
 * as it is. (Code blocks are already left alone by VitePress.)
 */
export function vueSafe(md: MarkdownRenderer) {
  md.core.ruler.push('arkvory-vue-safe', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      block.children = block.children.map((token) =>
        token.type === 'text' && /[{}]/.test(token.content)
          ? Object.assign(new state.Token('html_inline', '', 0), { content: html(token.content) })
          : token,
      );
    }
  });
  const inline = md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline = (tokens, index, options, env, self) =>
    inline(tokens, index, options, env, self).replace(/^<code/, '<code v-pre');
}
