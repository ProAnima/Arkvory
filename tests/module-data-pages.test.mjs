import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openModuleData } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

test('module file pages preserve complete-name order across directory punctuation and cursors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-pages-'));
  t.after(() => removeTestDirectory(root));
  const names = ['a-/x', 'a.txt', 'a/0', 'a/b-/x', 'a/b/x', 'a/b0', 'a0/x', 'b/x'];
  for (const name of names) {
    const path = join(root, 'module-data', 'op-pages', 'data', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, name);
  }
  const opened = await openModuleData({
    dataDirectory: root,
    moduleId: 'op-pages',
    quota: { bytes: 1000, files: 100 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: true,
  });
  t.after(() => opened.close());
  const files = opened.directory.data;
  for (const prefix of ['', 'a', 'a/', 'a/b', 'missing/']) {
    const expected = names.filter((name) => name.startsWith(prefix)).sort();
    for (const limit of [1, 2, 3, 100]) {
      const actual = [];
      let after = null;
      do {
        const page = await files.list(prefix, after, limit);
        actual.push(...page.items);
        after = page.next;
      } while (after !== null);
      assert.deepEqual(actual, expected, `${prefix}:${limit}`);
    }
    for (const cursor of ['a', 'a/', 'a/b', 'a/b/', 'a/z', 'a0', 'z']) {
      const page = await files.list(prefix, cursor, 100);
      assert.deepEqual(
        page.items,
        expected.filter((name) => name > cursor),
      );
    }
  }
});
