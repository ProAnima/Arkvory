import { runRole } from './runtime.js';
await runRole('/opt/depot', '/run/depot/runtime.json', process.argv[2] ?? 'api');
