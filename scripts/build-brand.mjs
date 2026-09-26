import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const brand = JSON.parse(await readFile('branding/identity.json', 'utf8'));
await mkdir('branding/icons', { recursive: true });
const path = brand.polygons
  .map((points) => 'M' + points.map((p) => p.join(' ')).join('L') + 'Z')
  .join('');
const mark = `<path fill="${brand.ink}" fill-rule="evenodd" d="${path}"/>`;
const tile = `<defs><linearGradient id="accent" x2="1" y2="1"><stop stop-color="${brand.gradientStart}"/><stop offset="1" stop-color="${brand.accent}"/></linearGradient></defs><rect width="64" height="64" rx="${brand.radius}" fill="url(#accent)"/>`;
for (const variant of ['arkvory', 'arkvory-cli', 'arkvory-remote']) {
  let detail = '';
  if (variant !== 'arkvory') {
    const glyph = variant.endsWith('cli') ? 'm44 43 4 4-4 4m7 0h5' : 'M44 48h12m-4-4 4 4-4 4';
    detail = `<rect x="38" y="37" width="24" height="23" rx="7" fill="${brand.ink}"/><path d="${glyph}" fill="none" stroke="${brand.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  await writeFile(
    `branding/icons/${variant}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${tile}${mark}${detail}</svg>\n`,
  );
}
await writeFile(
  'branding/icons/arkvory-monochrome.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="currentColor" fill-rule="evenodd" d="${path}"/></svg>\n`,
);
if (process.platform === 'win32') {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('scripts/render-brand.ps1'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
}
console.log('Arkvory brand assets generated from branding/identity.json');
