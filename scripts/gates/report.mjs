import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function gateSummary(root) {
  const folder = join(root, 'test-results/gates');
  const entries = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  if (!entries.length) throw new Error('No gate report produced; inspect setup/runner failure');
  const reports = [];
  for (const name of entries) {
    const path = join(folder, name);
    if ((await stat(path)).size > 1024 * 1024) throw new Error('Gate report exceeds 1 MiB');
    const report = JSON.parse(await readFile(path, 'utf8'));
    if (!['passed', 'failed'].includes(report.status) || !Array.isArray(report.tasks))
      throw new Error('Invalid gate report');
    reports.push(report);
  }
  // JSON escapes line breaks in messages; stdout cannot become an injected workflow command.
  return (
    '## Arkvory gate results\n\n' +
    reports.map((report) => '```json\n' + JSON.stringify(report, null, 2) + '\n```').join('\n\n') +
    '\n'
  );
}
