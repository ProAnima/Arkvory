import { appendFile } from 'node:fs/promises';
import { gateSummary } from './gates/report.mjs';

const report = await gateSummary(process.cwd());
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
