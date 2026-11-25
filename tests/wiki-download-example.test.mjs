import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LANGUAGES, prefix, wiki } from '../scripts/wiki/site.mjs';

const example = (code) => {
  const source = readFileSync(join(wiki, `${prefix(code)}protocols/raw-files.md`), 'utf8');
  const block = /```bash\r?\n(etag=\$\(cat GameSetup\.etag\)[\s\S]*?)\r?\n```/.exec(source);
  assert.ok(block, `${code}: the conditional resume example is present`);
  return block[1];
};
const bash =
  process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git/bin/bash.exe') : 'bash';

test('all translations retain the safe conditional resume command', () => {
  const source = example('en');
  for (const { code } of LANGUAGES) assert.equal(example(code), source, code);
});

for (const [name, status, exit, expected] of [
  ['the same representation returns 206', '206', '0', 'abcDEF'],
  ['a changed representation returns 200', '200', '0', 'abc'],
  ['the request fails after writing a partial response', '000', '22', 'abc'],
]) {
  test(`the documented resume keeps existing bytes safe when ${name}`, (t) => {
    const folder = mkdtempSync(join(tmpdir(), 'arkvory-wiki-resume-'));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    writeFileSync(join(folder, 'GameSetup.part'), 'abc');
    writeFileSync(join(folder, 'GameSetup.etag'), '"sha256:existing"\n');
    // A deterministic transport stands in for curl; the documented shell code runs unchanged.
    const transport = String.raw`
curl() {
  local destination='' saved_etag=0 saved_range=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o) destination="$2"; shift ;;
      -H)
        case "$2" in
          'If-Range: "sha256:existing"') saved_etag=1 ;;
          'Range: bytes=3-') saved_range=1 ;;
        esac
        shift ;;
    esac
    shift
  done
  [ "$saved_etag" = 1 ] && [ "$saved_range" = 1 ] || return 99
  printf '%s' DEF > "$destination"
  printf '%s' "$MOCK_STATUS"
  return "$MOCK_EXIT"
}
`;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', transport + example('en')], {
      cwd: folder,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        MOCK_STATUS: status,
        MOCK_EXIT: exit,
        URL: 'https://example.invalid/file',
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, status === '206' && exit === '0' ? 0 : 1, result.stderr);
    assert.equal(readFileSync(join(folder, 'GameSetup.part'), 'utf8'), expected);
  });
}
