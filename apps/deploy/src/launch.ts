import { launch } from './runtime.js';
const [root, role, ...args] = process.argv.slice(2);
if (!root || !role) throw new Error('Expected installation directory and role');
await launch(root, role, args);
