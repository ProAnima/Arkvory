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

function lastName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return '';
}

/**
 * Problems of one product source file: a `contentPath`, the `.root` of a storage, a path built
 * with a `blobs` segment, or a read, verify, exists or collect through `blobs` without the
 * storage backend of the upload. Syntactic on purpose: it runs before any build.
 */
export function inspectBlobPaths(file, text) {
  if (!/^(apps|packages)\/[^/]+\/src\//.test(file) || blobPathOwners.has(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const problems = [];
  const report = (node, what) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    problems.push(
      `${file}:${String(line)}: ${what}; go through BlobStore or StagingArea (ADR 0083, N9)`,
    );
  };
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'contentPath') report(node, 'blob content path');
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'root' &&
      storageNames.test(lastName(node.expression))
    )
      report(node, 'storage root path');
    if (ts.isCallExpression(node)) {
      const callee = lastName(node.expression);
      if (
        (callee === 'join' || callee === 'resolve') &&
        node.arguments.some((a) => ts.isStringLiteralLike(a) && /(^|\/)blobs(\/|$)/.test(a.text))
      )
        report(node, 'path into the blobs directory');
      const required = placedCalls.get(callee);
      if (
        required !== undefined &&
        ts.isPropertyAccessExpression(node.expression) &&
        lastName(node.expression.expression) === 'blobs' &&
        node.arguments.length < required
      )
        report(node, `blobs.${callee} without the upload's storage backend`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return problems;
}
