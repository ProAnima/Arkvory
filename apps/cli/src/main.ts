#!/usr/bin/env node
import { parseArguments } from './arguments.js';
import { execute } from './commands.js';
import { failure, failureText } from './errors.js';
import { help } from './help.js';

const controller = new AbortController();
const interrupt = () => {
  controller.abort();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let json = process.argv.includes('--json');
let language: 'en' | 'ru' = 'en';
try {
  const args = parseArguments(process.argv.slice(2));
  json = args.json;
  language = args.language;
  if (args.options.has('version')) {
    console.log(
      JSON.stringify({ version: process.env['ARKVORY_CLI_VERSION'] ?? 'development', api: 'v1' }),
    );
  } else if (args.options.has('help') || args.words.length === 0) {
    const content = help(args.language);
    console.log(json ? JSON.stringify({ help: content }) : content);
  } else {
    let lastProgress = 0;
    const result = await execute(args, controller.signal, (bytes, total) => {
      if (!process.stderr.isTTY || json || Date.now() - lastProgress < 1000) return;
      lastProgress = Date.now();
      process.stderr.write(
        `${args.language === 'ru' ? 'Передано' : 'Transferred'}: ${String(bytes)} / ${String(total)} B\n`,
      );
    });
    console.log(JSON.stringify(result, null, json ? undefined : 2));
  }
} catch (error) {
  const result = failure(error, controller.signal.aborted);
  console.error(json ? JSON.stringify({ error: result }) : failureText(result, language));
  process.exitCode = result.exitCode;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
