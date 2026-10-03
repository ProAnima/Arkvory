import { fileURLToPath } from 'node:url';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nativeFiles, verifyNativeFiles } from '../native-files.mjs';
import { releaseFiles, verifyReleaseFiles } from '../release-files.mjs';
import { signDirectory, signingKeyFile } from '../release-signing.mjs';
import { runLocalCi } from './local-run.mjs';
import { npm } from './windows-lane.mjs';
import {
  createDraft,
  draftCommand,
  releaseNotes,
  releasePreconditions,
} from './github-release.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Usage: npm run release:local -- <x.y.z> [--dry-run] [--reuse-evidence]

Cuts a release on this workstation: release gates in all local CI lanes, one packaged candidate,
acceptance of that candidate on Windows and in the disposable Linux systemd container, then a
DRAFT GitHub release with the tested bytes. Publishing the draft stays a manual step.`;
const dayMs = 24 * 60 * 60 * 1000;

export function parseArguments(argv) {
  const options = { dryRun: false, reuse: false };
  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--reuse-evidence') options.reuse = true;
    else if (argument === '--help') options.help = true;
    else if (!options.version && !argument.startsWith('-')) options.version = argument;
    else throw new Error(`Unknown argument: ${argument}\n\n${usage}`);
  }
  if (!options.help && !options.version) throw new Error(usage);
  return options;
}

/** Fresh evidence for the same commit may be reused; anything older or dirty is re-run. */
async function releaseEvidence(commit, reuse, signal) {
  const path = resolve(root, 'test-results/local-ci', `${commit}-release`, 'evidence.json');
  if (reuse)
    try {
      const evidence = JSON.parse(await readFile(path, 'utf8'));
      const fresh = Date.now() - Date.parse(evidence.finishedAt) < dayMs;
      if (evidence.commit === commit && evidence.releasable === true && fresh) return evidence;
      process.stdout.write('Stored release evidence is stale or incomplete; running gates\n');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  const { evidence } = await runLocalCi(root, { profile: 'release', signal });
  if (!evidence.releasable) throw new Error('Release gates failed; see test-results/local-ci');
  return evidence;
}

async function acceptCandidate(output, signal) {
  const windowsNative = `${output}-native-win32`;
  const linuxNative = `${output}-native-linux`;
  const { evidence } = await runLocalCi(root, {
    profile: 'release',
    label: 'acceptance',
    laneNames: ['windows', 'linux-system'],
    signal,
    laneOptions: {
      windows: {
        gates: ['deployment', 'deployment-containers', 'native-package'],
        env: { ARKVORY_RELEASE_ARTIFACT: output, ARKVORY_NATIVE_ARTIFACT: windowsNative },
      },
      'linux-system': {
        gates: ['deployment', 'deployment-services', 'native-install'],
        env: {
          ARKVORY_RELEASE_ARTIFACT: '/home/runner/candidate',
          ARKVORY_NATIVE_ARTIFACT: '/home/runner/native',
        },
        inputs: [[output, '/home/runner/candidate']],
        outputs: [['/home/runner/native', linuxNative]],
      },
    },
  });
  if (evidence.status !== 'passed') throw new Error('Candidate acceptance failed');
  return { evidence, native: [windowsNative, linuxNative] };
}

async function assemble(output, version, commit, native) {
  for (const folder of native)
    for (const name of await readdir(folder))
      if (nativeFiles.includes(name)) await copyFile(join(folder, name), join(output, name));
  await verifyReleaseFiles(output, version, commit, nativeFiles);
  await verifyNativeFiles(output, version, commit);
  const files = [...releaseFiles, 'release-checksums.json', ...nativeFiles];
  for (const name of files)
    if (!(await stat(join(output, name))).isFile()) throw new Error(`Missing asset ${name}`);
  return files.map((name) => join(output, name));
}

/** A rehearsal without the key on this machine still runs; a real release cannot. */
async function sign(output, dryRun) {
  try {
    await access(signingKeyFile());
  } catch {
    if (!dryRun) throw new Error(`No release signing key: ${signingKeyFile()}`);
    process.stdout.write('Warning (rehearsal): no signing key; the release is not signed\n');
    return [];
  }
  return signDirectory(output);
}

async function main(options) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const { signal } = controller;
  // A rehearsal never reuses a real candidate folder and never touches GitHub.
  const name = options.dryRun
    ? `${options.version}-rehearsal-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`
    : options.version;
  const output = resolve(root, 'artifacts', name);
  const { commit, tag, warnings } = await releasePreconditions(root, options.version, output, {
    strict: !options.dryRun,
  });
  for (const warning of warnings) process.stdout.write(`Warning (rehearsal): ${warning}\n`);
  const evidence = await releaseEvidence(commit, options.reuse, signal);
  await npm(root, ['run', 'release:package', '--', options.version, output], { signal });
  const acceptance = await acceptCandidate(output, signal);
  const files = await assemble(output, options.version, commit, acceptance.native);
  // Installations accept only releases signed with a built-in key (ADR 0060).
  const signed = await sign(output, options.dryRun);
  const notes = resolve(root, 'artifacts', `${name}-release-notes.md`);
  const proof = resolve(root, 'artifacts', `${name}-evidence`);
  await mkdir(proof, { recursive: true });
  const evidenceFile = join(proof, 'arkvory-local-ci-evidence.json');
  await writeFile(
    evidenceFile,
    JSON.stringify({ release: evidence, acceptance: acceptance.evidence }, null, 2) + '\n',
  );
  await writeFile(notes, releaseNotes(options.version, evidence, acceptance.evidence));
  const details = { tag, commit, version: options.version, notesFile: notes };
  if (options.dryRun) {
    process.stdout.write(`\nDry run: tested assets in ${output}\nNotes: ${notes}\n`);
    process.stdout.write(
      `Would run: ${draftCommand(details)} (+${files.length + signed.length + 1} assets)\n`,
    );
    return;
  }
  const url = createDraft(root, { ...details, files: [...files, ...signed, evidenceFile] });
  process.stdout.write(`\nDraft release prepared: ${url}\nReview it on GitHub, then publish.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) process.stdout.write(usage + '\n');
  else await main(options);
}
