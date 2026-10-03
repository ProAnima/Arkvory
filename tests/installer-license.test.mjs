import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installers = ['deploy/native/windows.iss', 'deploy/client/windows.iss'];
const agreements = { en: 'deploy/legal/EULA.en.txt', ru: 'deploy/legal/EULA.ru.txt' };

test('both Windows installers show the agreement in the language of the wizard', async () => {
  for (const path of installers) {
    const script = await readFile(path, 'utf8');
    assert.doesNotMatch(script, /^LicenseFile=/m, `${path}: one license for every language`);
    for (const [language, file] of Object.entries(agreements)) {
      const name = file.split('/').at(-1);
      assert.match(
        script,
        new RegExp(
          `^Name: "${language}";.*LicenseFile: "\\.\\.\\\\legal\\\\${name.replaceAll('.', '\\.')}"`,
          'm',
        ),
        `${path}: ${language}`,
      );
    }
  }
});

test('agreements are UTF-8 with BOM and CRLF and name the rights holder', async () => {
  for (const [language, path] of Object.entries(agreements)) {
    const bytes = await readFile(path);
    assert.deepEqual(
      [...bytes.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${path}: Inno Setup needs the BOM`,
    );
    const text = bytes.toString('utf8');
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, `${path}: CRLF only`);
    for (const required of ['Ian Panaev', 'Ян Панаев', 'ProAnimaStudio', 'info@proanima.net'])
      assert.ok(text.includes(required), `${path} (${language}) names ${required}`);
  }
});
