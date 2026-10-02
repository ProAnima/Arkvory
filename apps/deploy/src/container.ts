import { runRole } from './runtime.js';
const [role = 'api', ...args] = process.argv.slice(2);
await runRole('/opt/arkvory', '/run/arkvory/runtime.json', role, args);
