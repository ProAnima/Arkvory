import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from '@proanima/arkvory-contracts';
import { validateCommand, word } from './arguments.js';
import type { Arguments } from './arguments.js';
import { CliError } from './errors.js';
import { exists, isMissing, readJson, saveJson } from './local-files.js';

const MANIFEST = '.arkvory-skill.json';
const MAX_FILES = 64;
const MAX_FILE_BYTES = 256 * 1024;

/**
 * Where the skill ships (ADR 0081, section 6): beside arkvoryctl.mjs in the client packages,
 * or in the repository when the CLI runs from `apps/cli/dist`.
 */
async function skillSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, 'agent-skills', 'arkvory'),
    join(here, '..', '..', '..', 'integrations', 'agent-skills', 'arkvory'),
  ])
    if (await exists(join(candidate, 'SKILL.md'))) return candidate;
  throw new CliError('skill_not_found', 7);
}

/** The skill's files by relative path (`/` separators): regular files only, bounded. */
async function sourceFiles(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, `${name}/`);
      else if (entry.isFile()) {
        const content = await readFile(path);
        if (content.length > MAX_FILE_BYTES || files.size >= MAX_FILES)
          throw new CliError('invalid_skill_source', 7);
        files.set(name, content);
      } else throw new CliError('invalid_skill_source', 7);
    }
  };
  await walk(root, '');
  return files;
}

const hash = (content: Buffer) => createHash('sha256').update(content).digest('hex');

/** SHA-256 of each file the last install wrote; a damaged manifest protects every file. */
async function installed(target: string): Promise<Map<string, string>> {
  const path = join(target, MANIFEST);
  if (!(await exists(path))) return new Map();
  try {
    const files = record(record(await readJson(path))['files']);
    return new Map(
      Object.entries(files).flatMap(([name, value]) =>
        typeof value === 'string' ? [[name, value]] : [],
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * Where a skill or manifest name lies in the target: `/`-separated relative segments only. A
 * manifest is a file in the target that anyone with access there could edit, so `..`, an empty
 * or `.` segment, a backslash, a drive or stream colon and NUL are refused (null), and every
 * directory between the target and the file must be a real directory, not a link or junction
 * that would lead the write or removal elsewhere (`skill_target_not_file`).
 */
async function placed(target: string, name: string): Promise<string | null> {
  const segments = name.split('/');
  const unsafe = (s: string) => ['\\', ':', '\0'].some((part) => s.includes(part));
  if (segments.some((s) => s === '' || s === '.' || s === '..' || unsafe(s))) return null;
  let at = target;
  for (const segment of segments.slice(0, -1)) {
    at = join(at, segment);
    try {
      if (!(await lstat(at)).isDirectory()) throw new CliError('skill_target_not_file', 6);
    } catch (error) {
      if (isMissing(error)) break;
      throw error;
    }
  }
  return join(target, ...segments);
}

/** SHA-256 of a file in the target, null when absent; a link or directory is never written. */
async function present(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new CliError('skill_target_not_file', 6);
    return hash(await readFile(path));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function writeFileAtomically(path: string, content: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o644);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * `arkvoryctl skill install [--target DIR] [--force]`: copies the agent skill into DIR
 * (`~/.claude/skills/arkvory` by default). A file changed since the last install, by the user
 * or anyone else, is not overwritten without `--force`: then nothing is written at all
 * (`skill_modified`). A file the skill no longer has is removed only when unchanged.
 */
export async function skillCommand(args: Arguments) {
  if (word(args, 1) !== 'install') throw new CliError('unknown_command');
  validateCommand(args, 2, ['target', 'force']);
  const force = args.options.has('force');
  const target = resolve(
    args.options.get('target') ?? join(homedir(), '.claude', 'skills', 'arkvory'),
  );
  const files = await sourceFiles(await skillSource());
  const before = await installed(target);
  const plan = { added: [] as string[], updated: [] as string[], unchanged: [] as string[] };
  const modified: string[] = [];
  const paths = new Map<string, string>();
  for (const [name, content] of files) {
    const path = await placed(target, name);
    if (path === null) throw new CliError('invalid_skill_source', 7);
    paths.set(name, path);
    const current = await present(path);
    if (current === null) plan.added.push(name);
    else if (current === hash(content)) plan.unchanged.push(name);
    else if (current === before.get(name)) plan.updated.push(name);
    else modified.push(name);
  }
  if (modified.length > 0 && !force) throw new CliError('skill_modified', 6);
  // Decided before anything changes. A name differing from a kept one only in case is the same
  // file on Windows and macOS, so it is never removed.
  const kept = new Set([...files.keys()].map((name) => name.toLowerCase()));
  const obsolete: [string, string][] = [];
  for (const [name, sha256] of before) {
    if (kept.has(name.toLowerCase())) continue;
    // A name that is not a plain file in the target any more is left alone, not an error.
    const path = await placed(target, name).catch(() => null);
    const current = path === null ? null : await present(path).catch(() => null);
    if (path !== null && current === sha256) obsolete.push([name, path]);
  }
  for (const [, path] of obsolete) await unlink(path);
  for (const name of [...plan.added, ...plan.updated, ...modified]) {
    const content = files.get(name);
    const path = paths.get(name);
    if (content && path) await writeFileAtomically(path, content);
  }
  await saveJson(join(target, MANIFEST), {
    format: 1,
    files: Object.fromEntries([...files].map(([name, content]) => [name, hash(content)])),
  });
  return { target, ...plan, replaced: modified, removed: obsolete.map(([name]) => name) };
}
