// Executable design-system and localization rules for the web console (docs/DESIGN_SYSTEM.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { en } from '../apps/web/dist/messages.js';

const web = 'apps/web';
const glyphs = new Set(['', '—', '×', '?', '↻', '·', '/', '.', '…']);
// CSS named colors (CSS Color 4). System colors stay allowed for forced-colors mode.
const namedColors = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);
const length =
  /(?<![\w-])-?(?:\d*\.)?\d+(?:%|(?:px|r?em|vh|vw|vmin|vmax|ch|ex|[dsl]v[hw])(?![\w-]))/;
const time = /(?<![\w-])(?:\d*\.)?\d+m?s\b/;

async function componentCss() {
  const files = (await readdir(web)).filter((f) => f.endsWith('.css') && f !== 'tokens.css');
  return Promise.all(
    files.map(async (file) => ({ file, css: await readFile(`${web}/${file}`, 'utf8') })),
  );
}

/** Declarations of every block, innermost first; selectors never look like checked properties. */
function declarations(css) {
  const found = [];
  let rest = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (rest.includes('{')) {
    const next = rest.replace(/\{([^{}]*)\}/g, (_, body) => {
      for (const part of body.split(';')) {
        const match = /^\s*(--[\w-]+|[a-z-]+)\s*:\s*([\s\S]+?)\s*$/i.exec(part);
        if (match) found.push({ property: match[1].toLowerCase(), value: match[2] });
      }
      return ';';
    });
    assert.notEqual(next, rest, 'unbalanced CSS braces');
    rest = next;
  }
  return found;
}

const withoutTokens = (value) => value.replace(/var\(--[\w-]+\)/g, ' ').replace(/'[^']*'/g, ' ');

function colorProblem(value) {
  const plain = withoutTokens(value);
  if (/#[a-f\d]{3,8}\b/i.test(plain)) return 'hex color';
  if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(plain)) return 'color function';
  for (const word of plain.toLowerCase().match(/[a-z-]+/g) ?? [])
    if (namedColors.has(word)) return `named color ${word}`;
  return undefined;
}

// Percentages and full-viewport units are structural layout, not visual design values.
const percent = /(?<![\w.-])-?(?:\d*\.)?\d+%|(?<![\w.-])100[dsl]?v[hw](?![\w-])/g;
const spacing = /^(margin|padding)(-[a-z]+)*$|^(row-|column-)?gap$/;
const position = /^inset(-[a-z]+)*$|^(top|right|bottom|left)$/;
const sizing =
  /^(min-|max-)?(width|height|inline-size|block-size)$|^flex(-basis)?$|^grid-(template|auto)-(columns|rows)$/;
const stroke = /^(border|outline)(-(top|right|bottom|left|block|inline|start|end|width|style))*$/;

function geometryProblem(property, value) {
  const plain = withoutTokens(value).trim();
  const tokenOnly = (prefix) =>
    [...value.matchAll(/var\((--[\w-]+)\)/g)].every((m) => m[1].startsWith(prefix)) &&
    !/\d/.test(plain.replace(/\b0\b/g, ''));
  const typed = (prefix) => plain === 'inherit' || (plain === '' && tokenOnly(prefix));
  const numbers = plain.replace(/[*/]\s*-?\d+(?:\.\d+)?/g, '');
  if (/^border(-[a-z]+)*-radius$/.test(property))
    return tokenOnly('--radius-') ? undefined : 'radius must use --radius-*';
  if (property === 'font-size') return typed('--text-') ? undefined : 'font-size literal';
  if (property === 'font-weight') return typed('--weight-') ? undefined : 'font-weight literal';
  if (property === 'line-height') return typed('--leading-') ? undefined : 'line-height literal';
  if (property === 'letter-spacing') return typed('--tracking-') ? undefined : 'tracking literal';
  if (property === 'font') return /\d/.test(plain) ? 'font shorthand literal' : undefined;
  if (spacing.test(property))
    return length.test(numbers) || /\b(?!0\b)\d/.test(numbers) ? 'spacing literal' : undefined;
  // Structural percentages (anchoring, visually hidden) are geometry, not visual values.
  if (position.test(property))
    return length.test(numbers.replace(percent, '')) ? 'position literal' : undefined;
  if (sizing.test(property))
    return length.test(numbers.replace(percent, '').replace(/^1px$/, ''))
      ? 'size literal'
      : undefined;
  if (stroke.test(property)) return length.test(numbers) ? 'stroke literal' : undefined;
  if (property === 'box-shadow') return length.test(plain) ? 'shadow literal' : undefined;
  if (property === 'z-index')
    return /^(auto|0|)$/.test(plain) && tokenOnly('--z-') ? undefined : 'z-index literal';
  if (/^(transition|animation)(-duration|-delay)?$/.test(property))
    return time.test(plain.replace(/\b0m?s\b/g, '')) || /cubic-bezier\(/.test(plain)
      ? 'motion literal'
      : undefined;
  return undefined;
}

/** Custom properties cannot be used in media queries; only the two documented layout borders. */
function breakpointProblems(file, css) {
  return [...css.matchAll(/@media[^{]*/g)]
    .flatMap((m) => [...m[0].matchAll(/\((?:min|max)-width:\s*([^)]+)\)/g)])
    .map((m) => m[1].trim())
    .filter((width) => !['760px', '761px', '1100px'].includes(width))
    .map((width) => `${file}: breakpoint ${width}; use 760px or 1100px`);
}

test('component CSS takes colors, geometry, type, depth and motion only from tokens', async () => {
  const problems = [];
  for (const { file, css } of await componentCss())
    for (const { property, value } of declarations(css)) {
      if (property.startsWith('--')) {
        problems.push(`${file}: local custom property ${property}; define it in tokens.css`);
        continue;
      }
      const problem = colorProblem(value) ?? geometryProblem(property, value);
      if (problem) problems.push(`${file}: ${property}: ${value} (${problem})`);
    }
  for (const { file, css } of await componentCss()) problems.push(...breakpointProblems(file, css));
  assert.deepEqual(problems, []);
});

test('the gate recognises literal violations and accepts token expressions', () => {
  assert.equal(colorProblem('1px solid red'), 'named color red');
  assert.equal(colorProblem('rgb(0 0 0 / 50%)'), 'color function');
  assert.equal(colorProblem('var(--color-text) transparent currentColor'), undefined);
  assert.equal(geometryProblem('padding', '6px var(--space-2)'), 'spacing literal');
  assert.equal(geometryProblem('margin', 'calc(var(--space-2) * -1) 0 auto'), undefined);
  assert.equal(geometryProblem('border-radius', '4px'), 'radius must use --radius-*');
  assert.equal(geometryProblem('border-radius', 'var(--radius-pill)'), undefined);
  assert.equal(geometryProblem('font-size', '13px'), 'font-size literal');
  assert.equal(geometryProblem('width', '20rem'), 'size literal');
  assert.equal(geometryProblem('width', 'min(100%, var(--help-width))'), undefined);
  assert.equal(geometryProblem('inset', '100% auto auto 0'), undefined);
  assert.deepEqual(breakpointProblems('x.css', '@media (max-width: 40rem) {}'), [
    'x.css: breakpoint 40rem; use 760px or 1100px',
  ]);
  assert.equal(geometryProblem('z-index', '5'), 'z-index literal');
  assert.equal(geometryProblem('transition', 'opacity 120ms ease'), 'motion literal');
  assert.equal(
    geometryProblem('transition', 'opacity var(--motion-fast) var(--motion-ease)'),
    undefined,
  );
});

test('markup and controllers never carry color or inline style', async () => {
  const html = await readFile(`${web}/index.html`, 'utf8');
  assert.doesNotMatch(html, /\sstyle=|<style\b/i);
  assert.doesNotMatch(html, /#[a-f\d]{6}\b|\b(?:rgba?|hsla?)\(/i);
  for (const { name, attributes } of htmlNodes(html).elements)
    for (const attribute of ['fill', 'stroke', 'color', 'stop-color', 'bgcolor'])
      if (attribute in attributes)
        assert.match(attributes[attribute], /^(none|currentColor|transparent)$/, `<${name}>`);
  for (const file of await sources()) {
    const text = await readFile(`${web}/src/${file}`, 'utf8');
    assert.doesNotMatch(text, /\.style\b|cssText|setAttribute\(\s*['"]style/, file);
    assert.doesNotMatch(text, /['"`][^'"`]*(?:#[a-f\d]{6}\b|\b(?:rgba?|hsla?)\()/i, file);
  }
});

async function sources() {
  return (await readdir(`${web}/src`)).filter((f) => f.endsWith('.ts'));
}
const dictionary = (file) => /^messages-[a-z]+\.ts$|-messages\.ts$/.test(file);

/** Minimal tokenizer for the console's static markup; it only needs elements and text. */
function htmlNodes(html) {
  const voids = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta']);
  const stack = [],
    texts = [],
    elements = [];
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
  for (const match of source.matchAll(
    /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g,
  )) {
    const [, closing, tag, rest, text] = match;
    if (text !== undefined) {
      if (text.trim()) texts.push({ text: text.trim(), parents: [...stack] });
      continue;
    }
    const name = tag.toLowerCase();
    if (closing) {
      const index = stack.map((e) => e.name).lastIndexOf(name);
      if (index >= 0) stack.length = index;
      continue;
    }
    const attributes = Object.fromEntries(
      [...rest.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1].toLowerCase(), m[2] ?? '']),
    );
    const element = { name, attributes };
    elements.push(element);
    if (!voids.has(name) && !rest.trim().endsWith('/')) stack.push(element);
  }
  return { texts, elements };
}

test('every visible markup text and accessible attribute is localized', async () => {
  const { texts, elements } = htmlNodes(await readFile(`${web}/index.html`, 'utf8'));
  const problems = [];
  for (const { text, parents } of texts) {
    if (parents.some((p) => p.name === 'svg' || p.name === 'script')) continue;
    if (glyphs.has(text)) continue;
    const parent = parents.at(-1);
    if (!parent || !Object.hasOwn(parent.attributes, 'data-i18n'))
      problems.push(`<${parent?.name ?? 'document'}> ${text.slice(0, 60)}`);
  }
  for (const { name, attributes } of elements) {
    if ('aria-label' in attributes && !('data-i18n-label' in attributes))
      problems.push(`<${name}> aria-label="${attributes['aria-label']}" without data-i18n-label`);
    if ('placeholder' in attributes && !('data-i18n-placeholder' in attributes))
      problems.push(
        `<${name}> placeholder="${attributes.placeholder}" without data-i18n-placeholder`,
      );
    if ('title' in attributes) problems.push(`<${name}> title attribute; use data-help`);
    if (attributes.alt) problems.push(`<${name}> literal alt text`);
  }
  assert.deepEqual(problems, []);
});

const textProperties = new Set(['textContent', 'innerText', 'title', 'placeholder', 'ariaLabel']);
const textMethods = new Set(['append', 'prepend', 'replaceChildren', 'createTextNode', 'after']);

/** Every literal fragment an expression can evaluate to, including both conditional branches. */
function literalTexts(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node))
    return [node.head.text + node.templateSpans.map((span) => '${…}' + span.literal.text).join('')];
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node))
    return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (kind === ts.SyntaxKind.PlusToken) {
      const parts = [...literalTexts(node.left), ...literalTexts(node.right)];
      return parts.length ? [parts.join('${…}')] : [];
    }
    if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken)
      return literalTexts(node.right);
  }
  return [];
}

function controllerTextProblems(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const problems = [];
  const report = (node, values) => {
    for (const value of values.filter((v) => !glyphs.has(v.trim())))
      problems.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${JSON.stringify(value)}`,
      );
  };
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      if (['innerHTML', 'outerHTML'].includes(node.left.name.text))
        problems.push(`${file}: ${node.left.name.text} is forbidden`);
      if (textProperties.has(node.left.name.text)) report(node, literalTexts(node.right));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [first, second] = node.arguments;
      if (
        method === 'setAttribute' &&
        first &&
        second &&
        ['aria-label', 'title', 'placeholder', 'alt'].includes(literalTexts(first)[0] ?? '')
      )
        report(node, literalTexts(second));
      if (textMethods.has(method))
        for (const arg of node.arguments) report(node, literalTexts(arg));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

test('controllers set visible text and accessible names only through translations', async () => {
  const problems = [];
  for (const file of await sources())
    problems.push(...controllerTextProblems(file, await readFile(`${web}/src/${file}`, 'utf8')));
  assert.deepEqual(problems, []);
  assert.deepEqual(
    controllerTextProblems('x.ts', "a.textContent = `${b}: `; c.title = 'Hi'; d.append(': x');"),
    ['x.ts:1 "${…}: "', 'x.ts:1 "Hi"', 'x.ts:1 ": x"'],
  );
  assert.deepEqual(
    controllerTextProblems('x.ts', "a.textContent = '—'; b.textContent = t('k');"),
    [],
  );
  assert.deepEqual(controllerTextProblems('x.ts', "a.textContent = c ? '—' : 'Empty' + d;"), [
    'x.ts:1 "Empty"',
  ]);
});

test('every message key is used by markup or a controller', async () => {
  const html = await readFile(`${web}/index.html`, 'utf8');
  const used = new Set(
    [...html.matchAll(/data-(?:i18n(?:-label|-placeholder)?|help)="([^"]+)"/g)].map((m) => m[1]),
  );
  const prefixes = [];
  for (const file of (await sources()).filter((f) => !dictionary(f))) {
    const text = await readFile(`${web}/src/${file}`, 'utf8');
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) used.add(node.text);
      if (ts.isTemplateExpression(node) && node.head.text.length >= 3)
        prefixes.push(node.head.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  const unused = Object.keys(en).filter(
    (key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
  );
  assert.deepEqual(unused, []);
});
