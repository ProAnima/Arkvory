import ts from 'typescript';

function symbol(node, source) {
  if (node.name) return node.name.getText(source);
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))
    return node.parent.name.getText(source);
  return '<anonymous>';
}
export function analyzeSource(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rawLines = text.split(/\r?\n/),
    codeLines = new Set();
  function collect(node) {
    const children = node.getChildren(source);
    if (children.length) return children.forEach(collect);
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const end = source.getLineAndCharacterOfPosition(node.end).line;
    for (let i = start; i <= end; i++) if (rawLines[i]?.trim()) codeLines.add(i);
  }
  collect(source);
  const comments = [];
  // Comments are read through the parsed tree, so directive-looking strings are not directives.
  function trivia(node) {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ]) {
      if (!comments.some((c) => c.start === range.pos))
        comments.push({ start: range.pos, end: range.end, text: text.slice(range.pos, range.end) });
    }
    node.getChildren(source).forEach(trivia);
  }
  trivia(source);
  const metrics = [
    { file, metric: 'file', symbol: '<file>', size: codeLines.size, line: 1, start: 0 },
  ];
  const problems = [];
  function measure(node, metric) {
    const start = node.getStart(source),
      a = source.getLineAndCharacterOfPosition(start).line;
    const b = source.getLineAndCharacterOfPosition(node.end).line;
    const name = symbol(node, source);
    const owner =
      ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)
        ? symbol(node.parent, source) + '.'
        : '';
    metrics.push({
      file,
      metric,
      symbol: owner + name,
      size: [...codeLines].filter((l) => l >= a && l <= b).length,
      line: a + 1,
      start,
    });
  }
  function inspect(node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) measure(node, 'class');
    if (ts.isFunctionLike(node) && node.body) measure(node, 'function');
    if (/^packages\/(domain|application)\//.test(file)) {
      const impureCall =
        ts.isCallExpression(node) &&
        ['Date.now', 'Math.random', 'performance.now'].includes(node.expression.getText(source));
      if (
        impureCall ||
        (ts.isNewExpression(node) &&
          node.expression.getText(source) === 'Date' &&
          !node.arguments?.length)
      )
        problems.push(`${file}: inject clocks/randomness instead of ${node.getText(source)}`);
    }
    if (
      file.startsWith('tests/') &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['only', 'skip', 'todo'].includes(node.expression.name.text)
    )
      problems.push(`${file}: focused/disabled tests are forbidden`);
    if (
      file.startsWith('tests/') &&
      ts.isPropertyAssignment(node) &&
      ['only', 'skip', 'todo'].includes(
        node.name.getText(source).replaceAll("'", '').replaceAll('"', ''),
      ) &&
      node.initializer.kind !== ts.SyntaxKind.FalseKeyword
    )
      problems.push(`${file}: conditional/focused/disabled test options are forbidden`);
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  for (const c of comments)
    if (/eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error/.test(c.text))
      problems.push(
        `${file}: lint/type suppression is forbidden; change the explicit policy through review`,
      );
  return { metrics, comments, problems, imports: sourceImports(source), text };
}

function sourceImports(source) {
  const imports = [];
  function importsIn(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, importsIn);
  }
  importsIn(source);
  return imports;
}

export function inspectExceptions(analyses, policy, exceptions, now) {
  const problems = [],
    used = new Set();
  const ids = new Set();
  for (const e of exceptions) {
    if (!/^ARCH-\d{3}$/.test(e.id) || ids.has(e.id))
      problems.push(`Invalid/duplicate exception ID: ${e.id}`);
    ids.add(e.id);
    const start = Date.parse(e.recordedAt),
      end = Date.parse(e.reviewBy);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > now ||
      end <= now ||
      end - start > policy.maxExceptionDays * 86400000 ||
      end <= start
    )
      problems.push(
        `${e.id}: invalid/expired exception dates (maximum ${policy.maxExceptionDays} days)`,
      );
    if (
      !e.reason ||
      e.reason.length < 40 ||
      !e.owner ||
      !e.decision?.startsWith('docs/adr/') ||
      !e.tests?.length
    )
      problems.push(`${e.id}: reason, accountable owner, ADR and regression evidence required`);
  }
  for (const [file, a] of analyses) {
    for (const c of a.comments)
      for (const match of c.text.matchAll(/depot-exception\s+(ARCH-\d{3})/g)) {
        const e = exceptions.find((e) => e.id === match[1] && e.file === file);
        if (!e) problems.push(`${file}: unregistered exception marker ${match[1]}`);
      }
    for (const m of a.metrics) {
      const limit = policy.limits[m.metric];
      const matches = exceptions.filter(
        (e) => e.file === file && e.metric === m.metric && e.symbol === m.symbol,
      );
      if (matches.length > 1) problems.push(`${file}:${m.line}: ambiguous exception`);
      const e = matches[0];
      if (m.size <= limit) {
        if (e) problems.push(`${e.id}: exception is no longer needed; remove it`);
        continue;
      }
      if (!e) {
        problems.push(`${file}:${m.line} ${m.metric} ${m.symbol}: ${m.size} > ${limit}`);
        continue;
      }
      used.add(e.id);
      if (!Number.isInteger(e.ceiling) || e.ceiling < m.size || e.ceiling > m.size)
        problems.push(
          `${e.id}: measured ${m.size}, frozen ceiling ${e.ceiling}; no growth/slack allowed, lower the ceiling after reductions`,
        );
      const comment = a.comments.find(
        (c) =>
          c.text.includes(`depot-exception ${e.id} -- `) &&
          c.text.split(' -- ')[1]?.replace(/\*\/$/, '').trim().length >= 20 &&
          (m.metric === 'file'
            ? !a.text.slice(0, c.start).trim()
            : c.end <= m.start && !a.text.slice(c.end, m.start).trim()),
      );
      if (!comment) problems.push(`${e.id}: adjacent explanatory depot-exception comment required`);
    }
  }
  for (const e of exceptions) if (!used.has(e.id)) problems.push(`${e.id}: stale exception target`);
  return problems;
}
