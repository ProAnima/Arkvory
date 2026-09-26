import { runRole } from './runtime.js';
await runRole('/opt/arkvory', '/run/arkvory/runtime.json', process.argv[2] ?? 'api');
