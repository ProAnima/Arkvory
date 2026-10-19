import ts from 'typescript';

/**
 * Product files that may build paths of stored content (ADR 0083, N9): the local storage
 * adapter itself and the vault, whose `blobs/<2 hex>/` layout is its own, not the storage's.
 * Everything else reaches bytes through `BlobStore` and temporary files through `StagingArea`.
 */
export const blobPathOwners = new Map([
  ['packages/infrastructure/src/local-blobs.ts', 'the local storage adapter'],
  ['packages/infrastructure/src/blob-files.ts', 'file helpers of the local storage adapter'],
  ['packages/infrastructure/src/file-vault.ts', 'layout of the backup vault'],
  ['packages/infrastructure/src/vault-blobs.ts', 'layout of the backup vault'],
  ['packages/infrastructure/src/vault-maintenance.ts', 'layout of the backup vault'],
]);

/** Receivers that name a storage by the conventions of this code base. */
const storageNames = /^(blobs|blobStore|store|storage|target)$/;
/** Port methods on a published upload and the argument count that includes its storage. */
const placedCalls = new Map([
  ['read', 4],
  ['verify', 4],
  ['exists', 3],
  ['collect', 4],
]);
/** A `blobs` path segment in the literal parts of a string (`\0` separates the parts). */
const blobsSegment = /(^|[\\/\0])blobs([\\/\0]|$)/;

/** The expression without parentheses, `as`, `satisfies`, `!` and `<T>` around it. */
function unwrap(expression) {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    node = node.expression;
  return node;
}

/** The last name of `a.b`, `a['b']` or `b`; empty for anything computed. */
function lastName(expression) {
  const node = unwrap(expression);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return node.argumentExpression.text;
  if (ts.isIdentifier(node)) return node.text;
  return '';
}

/** The literal parts of a string expression: literals, templates and `+` concatenations. */
function literalText(expression) {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('\0');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return `${literalText(node.left)}\0${literalText(node.right)}`;
  return '';
}

/**
 * Names bound to the `blobs` port in a file, in source order: `const s = this.blobs`, a chain
 * of such aliases and `{ blobs: s }`. Scopes are ignored: a name is an alias in the whole file.
 */
function portAliases(source) {
  const names = new Set(['blobs']);
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (names.has(lastName(node.initializer))) names.add(node.name.text);
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && key.text === 'blobs') names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return names;
}

/** `{ root }` or `{ contentPath }` taken apart from a storage. */
function destructuredPaths(node, isStorage, report) {
  if (!ts.isVariableDeclaration(node) || !ts.isObjectBindingPattern(node.name)) return;
  if (!node.initializer || !isStorage(lastName(node.initializer))) return;
  for (const element of node.name.elements) {
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) continue;
    if (key.text === 'root') report(element, 'storage root path');
    if (key.text === 'contentPath') report(element, 'blob content path');
  }
}

/** `join`/`resolve` with a `blobs` segment, and port reads of an upload without its storage. */
function calls(node, aliases, report, instancePort = false) {
  if (!ts.isCallExpression(node)) return;
  const callee = lastName(node.expression);
  if (
    (callee === 'join' || callee === 'resolve') &&
    node.arguments.some((argument) => blobsSegment.test(literalText(argument)))
  )
    report(node, 'path into the blobs directory');
  if (instancePort) return;
  const required = placedCalls.get(callee);
  const target = unwrap(node.expression);
  if (
    required === undefined ||
    !(ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
  )
    return;
  const receiver = lastName(target.expression);
  // A spread may carry every argument; the rule cannot count it.
  if (!aliases.has(receiver) || node.arguments.some((a) => ts.isSpreadElement(a))) return;
  if (node.arguments.length < required)
    report(node, `${receiver}.${callee} without the upload's storage backend`);
}

/**
 * Problems of one product source file: a `contentPath`, the `.root` of a storage, a path built
 * with a `blobs` segment, or a read, verify, exists or collect through the `blobs` port (or an
 * alias of it) without the storage backend of the upload. Syntactic on purpose: it runs before
 * any build, so a port passed under another name than `blobs` or its aliases is not seen.
 */
export function inspectBlobPaths(file, text) {
  if (!/^(apps|packages)\/[^/]+\/src\//.test(file) || blobPathOwners.has(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const aliases = portAliases(source);
  const isStorage = (name) => storageNames.test(name) || aliases.has(name);
  const problems = [];
  const report = (node, what) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    problems.push(
      `${file}:${String(line)}: ${what}; go through BlobStore or StagingArea (ADR 0083, N9)`,
    );
  };
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'contentPath' && !ts.isBindingElement(node.parent))
      report(node, 'blob content path');
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const name = node.argumentExpression.text;
      if (name === 'contentPath') report(node, 'blob content path');
      if (name === 'root' && isStorage(lastName(node.expression)))
        report(node, 'storage root path');
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'root' &&
      isStorage(lastName(node.expression))
    )
      report(node, 'storage root path');
    destructuredPaths(node, isStorage, report);
    // This adapter has already resolved the backend and calls a single portable instance.
    calls(node, aliases, report, file === 'packages/infrastructure/src/module-storage.ts');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return problems;
}
