import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { root, wiki } from '../scripts/wiki/site.mjs';
import { writtenPages } from '../scripts/wiki.mjs';

// Examples omit application-owned values such as files, credentials and persistence.
// Give those values real public types; the example's calls and results stay fully checked.
const CLIENT = "import('@proanima/arkvory-sdk').ArkvoryClient";
const REPOSITORY = `ReturnType<${CLIENT}['inRepository']>`;
const CONTEXT = {
  ArkvoryClient: `typeof import('@proanima/arkvory-sdk').ArkvoryClient`,
  client: CLIENT,
  root: CLIENT,
  releases: REPOSITORY,
  prod: REPOSITORY,
  dev: REPOSITORY,
  staging: REPOSITORY,
  file: 'Blob',
  uploaded: '{ readonly id: string }',
  id: 'string',
  artifactId: 'string',
  groupId: 'string',
  idempotencyKey: 'string',
  sha256: 'string',
  requestId: 'string',
  url: 'string',
  bindings: `Parameters<${CLIENT}['administration']['services']['create']>[1]`,
  saveToSecretStore: '(secret: string) => Promise<void>',
  openAsBlob: "typeof import('node:fs').openAsBlob",
  Writable: "typeof import('node:stream').Writable",
  createWriteStream: "typeof import('node:fs').createWriteStream",
  saved: 'string',
  store: '(cursor: string) => Promise<void>',
  handle: '(event: unknown) => Promise<void>',
};

/** Names supplied by the example itself, including imports and destructuring. */
function declaredNames(text) {
  const names = new Set();
  const binding = (node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))
      for (const element of node.elements) if (ts.isBindingElement(element)) binding(element.name);
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) binding(node.name);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) names.add(node.name.text);
    if (ts.isImportClause(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('example.mts', text, ts.ScriptTarget.Latest, true));
  return names;
}

/** One virtual module per fenced example; no example code is executed. */
function examples() {
  const files = new Map();
  for (const page of writtenPages()) {
    const text = readFileSync(join(wiki, `${page}.md`), 'utf8');
    for (const match of text.matchAll(/^```(?:typescript|ts)\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
      const code = match[1];
      const declared = declaredNames(code);
      const prelude = Object.entries(CONTEXT)
        .filter(([name]) => !declared.has(name))
        .map(([name, type]) => `declare const ${name}: ${type};`)
        .join('\n');
      files.set(resolve(root, 'tests', `wiki-example-${files.size}.mts`), {
        source: `export {};\n${prelude}\n${code}`,
        page,
        line: text.slice(0, match.index).split('\n').length,
      });
    }
  }
  return files;
}

test('every TypeScript wiki example uses the current public SDK', () => {
  const files = examples();
  assert.ok(files.size > 0, 'the documentation contains SDK examples');
  const options = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const originalSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, fresh) => {
    const example = files.get(resolve(file));
    return example
      ? ts.createSourceFile(file, example.source, languageVersion, true)
      : originalSource(file, languageVersion, onError, fresh);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const problems = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const example = diagnostic.file && files.get(resolve(diagnostic.file.fileName));
    const where = example
      ? `wiki/${example.page}.md:${example.line}`
      : (diagnostic.file?.fileName ?? 'compiler');
    return `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
  assert.deepEqual(problems, []);
});
