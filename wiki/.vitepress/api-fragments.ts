import type { MarkdownRenderer } from 'vitepress';

/** VitePress slugifies link fragments, but public operation IDs are case sensitive. */
export function apiFragments(md: MarkdownRenderer) {
  const previous = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet('href') ?? '';
    const fragment = /#[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.exec(href)?.[0];
    const rendered = previous
      ? previous(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    if (!fragment) return rendered;
    token.attrSet('href', (token.attrGet('href') ?? href).replace(/#.*$/, fragment));
    return self.renderToken(tokens, index, options);
  };
}
