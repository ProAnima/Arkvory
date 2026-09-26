import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('launcher icons include bounded PNG frames for every supported Windows size', async () => {
  for (const name of ['arkvory', 'arkvory-cli', 'arkvory-remote']) {
    const icon = await readFile(`branding/icons/${name}.ico`);
    assert.equal(icon.readUInt16LE(0), 0);
    assert.equal(icon.readUInt16LE(2), 1);
    assert.equal(icon.readUInt16LE(4), 7);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    for (let i = 0; i < sizes.length; i++) {
      const entry = 6 + i * 16,
        size = icon[entry] || 256;
      assert.equal(size, sizes[i]);
      const length = icon.readUInt32LE(entry + 8),
        offset = icon.readUInt32LE(entry + 12);
      assert.ok(offset >= 118 && offset + length <= icon.length);
      assert.equal(icon.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(icon.readUInt32BE(offset + 16), size);
      assert.equal(icon.readUInt32BE(offset + 20), size);
    }
  }
  const html = await readFile('apps/web/index.html', 'utf8');
  assert.match(html, /class="brand-mark"[\s\S]*?src="\/console\/arkvory.svg"/);
});
