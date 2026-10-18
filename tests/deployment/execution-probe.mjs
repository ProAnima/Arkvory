// Started in place of an installer: records which executable ran it and with which arguments
// into ARKVORY_PROBE_OUTPUT, installs nothing and succeeds. Loaded as a script, or with
// NODE_OPTIONS=--import before an executable that is a copy of Node.js.
import { writeFileSync } from 'node:fs';

const output = process.env.ARKVORY_PROBE_OUTPUT;
if (!output) throw Error('ARKVORY_PROBE_OUTPUT is required');
writeFileSync(output, JSON.stringify({ execPath: process.execPath, args: process.argv.slice(1) }));
process.exit(0);
