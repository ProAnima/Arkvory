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

test('the installers show exactly the repository license, in both languages', async () => {
  const plain = (text) =>
    text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/^#+ /gm, '');
  for (const [file, license] of [
    ['deploy/legal/EULA.en.txt', 'LICENSE.md'],
    ['deploy/legal/EULA.ru.txt', 'LICENSE.ru.md'],
  ])
    assert.equal(
      plain(await readFile(file, 'utf8')),
      plain(await readFile(license, 'utf8')),
      `${file} must be generated from ${license}`,
    );
});

test('the license keeps the owner decisions of ADR 0061', async () => {
  const en = await readFile('LICENSE.md', 'utf8');
  const ru = await readFile('LICENSE.ru.md', 'utf8');
  // Free use for everyone, changes inside the organization, no forks, no sale, attribution.
  for (const required of [
    'free of charge',
    'including in the work of a commercial organization',
    'use changed versions within your organization',
    'Distribute the software or changed versions',
    'provide it to third parties as a hosted or managed service',
    'name the source',
    'This is not an open-source license',
  ])
    assert.ok(en.includes(required), required);
  for (const required of [
    'бесплатно',
    'в том числе в работе коммерческой организации',
    'использовать изменённые версии внутри своей организации',
    'Распространять программу или её изменённые версии',
    'указывайте источник',
    'при расхождении действует русский текст',
  ])
    assert.ok(ru.includes(required), required);
  assert.equal(en.match(/^## \d+\./gm).length, ru.match(/^## \d+\./gm).length, 'same sections');
});
