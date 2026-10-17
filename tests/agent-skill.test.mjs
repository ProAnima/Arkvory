import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { build } from 'esbuild';
import { parseArguments } from '../apps/cli/dist/arguments.js';
import { help } from '../apps/cli/dist/help.js';
import { skillCommand } from '../apps/cli/dist/skill-command.js';
import { copyAgentSkill } from '../scripts/package-client.mjs';
import { removeTestDirectory } from './helpers.mjs';

const SKILL = 'integrations/agent-skills/arkvory';
const run = promisify(execFile);

async function skillFiles(directory = SKILL) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) found.push(join(entry.parentPath, entry.name));
  return found.sort();
}
const texts = async () =>
  Promise.all(
    (await skillFiles()).map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
  );

test('SKILL.md has the frontmatter agents load: name arkvory and a description', async () => {
  const text = (await readFile(join(SKILL, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'frontmatter at the very top');
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
  assert.equal(fields.name, 'arkvory');
  assert.ok(fields.description.length > 40 && fields.description.length <= 1024);
  assert.match(fields.description, /Use when/);
});

test('every arkvoryctl command the skill shows exists and parses', async () => {
  const commands = new Set(
    help('en')
      .split('\n')
      .filter((line) => /^ {2}[a-z]/.test(line))
      .map((line) => line.trim().split(' ')[0]),
  );
  let checked = 0;
  for (const { path, text } of await texts())
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf('arkvoryctl ');
      // A command line in a code block, or after `claude mcp add … --`.
      if (at < 0 || !/^\s*(arkvoryctl |claude mcp add )/.test(line)) continue;
      const argv = line
        .slice(at + 'arkvoryctl '.length)
        .match(/"[^"]*"|\S+/g)
        .map((word) => word.replace(/^"|"$/g, ''));
      const args = parseArguments(argv);
      const [command, sub] = args.words;
      assert.ok(commands.has(command), `${path}: ${command}`);
      if (sub !== undefined && /^[a-z]+$/.test(sub)) {
        const usage = help('en')
          .split('\n')
          .filter((entry) => entry.trim().startsWith(`${command} `));
        if (usage.some((entry) => / [a-z]+ [A-Z]|\| /.test(entry)))
          assert.ok(
            usage.some((entry) => new RegExp(`(^|[ |])${sub}( |$)`).test(entry.trim())),
            `${path}: ${command} ${sub}`,
          );
      }
      checked++;
    }
  assert.ok(checked >= 15, String(checked));
});

test('skill links resolve, tool names exist, and no key or link sample appears', async () => {
  const sources = await Promise.all(
    (await readdir('apps/cli/src/mcp')).map((name) =>
      readFile(join('apps/cli/src/mcp', name), 'utf8'),
    ),
  );
  const tools = new Set(
    sources.flatMap((text) => [...text.matchAll(/'(arkvory_[a-z_]+)'/g)].map((m) => m[1])),
  );
  for (const { path, text } of await texts()) {
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      await access(join(dirname(path), target.split('#')[0]));
    }
    for (const [name] of text.matchAll(/\barkvory_[a-z_]+/g))
      assert.ok(tools.has(name), `${path}: ${name} is not a tool`);
    assert.doesNotMatch(text, /arkvory_[0-9a-f-]{8,}\.[A-Za-z0-9_-]{8,}/, `${path}: key sample`);
    assert.doesNotMatch(text, /dtl_[A-Za-z0-9_-]{8,}/, `${path}: link token`);
    assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9]/, `${path}: bearer header`);
    assert.doesNotMatch(text, /ARKVORY_TOKEN=\S/, `${path}: key in the environment`);
  }
});

test('the packaged skill installs, keeps changed files and removes only unchanged ones', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-skill-'));
  t.after(() => removeTestDirectory(directory));
  const client = join(directory, 'client');
  // The client package layout: arkvoryctl.mjs with agent-skills/ beside it.
  await build({
    entryPoints: ['apps/cli/src/main.ts'],
    outfile: join(client, 'arkvoryctl.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    conditions: ['arkvory-source'],
    logLevel: 'silent',
  });
  await copyAgentSkill(client);
  const target = join(directory, 'target');
  const install = (...extra) =>
    run(
      process.execPath,
      [join(client, 'arkvoryctl.mjs'), 'skill', 'install', '--target', target, '--json', ...extra],
      {
        windowsHide: true,
      },
    ).then(({ stdout }) => JSON.parse(stdout));
  const expected = (await skillFiles()).map((path) => relative(SKILL, path).split('\\').join('/'));
  const first = await install();
  assert.deepEqual([...first.added].sort(), expected);
  for (const name of expected)
    assert.equal(
      await readFile(join(target, name), 'utf8'),
      await readFile(join(SKILL, name), 'utf8'),
    );
  assert.deepEqual((await install()).added, []);
  await writeFile(join(target, 'SKILL.md'), 'my own notes');
  const refused = await install().then(
    () => assert.fail('a changed file must not be overwritten'),
    (error) => error,
  );
  assert.equal(refused.code, 6);
  assert.equal(JSON.parse(refused.stderr).error.code, 'skill_modified');
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'my own notes');
  assert.deepEqual((await install('--force')).replaced, ['SKILL.md']);
  // A newer package without a file: the unchanged installed copy goes, nothing else.
  await rm(join(client, 'agent-skills', 'arkvory', 'reference', 'cli.md'));
  const upgraded = await install();
  assert.deepEqual(upgraded.removed, ['reference/cli.md']);
  await assert.rejects(access(join(target, 'reference', 'cli.md')));
});

test('the Windows client installer ships the skill directory', async () => {
  const script = await readFile('deploy/client/windows.iss', 'utf8');
  assert.match(script, /^Source: "\{#Payload\}\\\*";.*Flags: [^;]*recursesubdirs/m);
});

test('skill install stays in the target: manifest names and linked directories lead nowhere else', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-skill-'));
  t.after(async () => {
    await rm(join(directory, 'linked', 'reference'), { force: true });
    await removeTestDirectory(directory);
  });
  const outside = join(directory, 'outside');
  await mkdir(outside);
  const victim = join(outside, 'victim.txt');
  await writeFile(victim, 'keep me');
  const sha256 = createHash('sha256').update('keep me').digest('hex');
  const install = (target, ...extra) =>
    skillCommand(parseArguments(['skill', 'install', '--target', target, ...extra]));
  // A manifest anyone with access to the target could edit names files outside it.
  const target = join(directory, 'target');
  await install(target);
  const names = [
    '../outside/victim.txt',
    'reference/../../outside/victim.txt',
    'reference\\..\\..\\outside\\victim.txt',
    victim.split('\\').join('/'),
    `${victim.split('\\').join('/')}:stream`,
    './../outside/victim.txt',
  ];
  const manifest = join(target, '.arkvory-skill.json');
  const saved = JSON.parse(await readFile(manifest, 'utf8'));
  for (const name of names) saved.files[name] = sha256;
  await writeFile(manifest, JSON.stringify(saved));
  const again = await install(target);
  assert.deepEqual(again.removed, []);
  assert.equal(await readFile(victim, 'utf8'), 'keep me');
  // A skill directory that is a link (a junction needs no privilege on Windows) is not followed.
  const linked = join(directory, 'linked');
  await mkdir(linked);
  await symlink(outside, join(linked, 'reference'), 'junction');
  await assert.rejects(install(linked), { code: 'skill_target_not_file' });
  await assert.rejects(install(linked, '--force'), { code: 'skill_target_not_file' });
  assert.deepEqual(await readdir(outside), ['victim.txt'], 'nothing written through the link');
  await assert.rejects(access(join(linked, 'SKILL.md')), 'nothing written at all');
});
