import { healthReady } from './health.js';
try {
  process.exitCode = (await healthReady('8080', '/run/depot/health-token.txt')) ? 0 : 1;
} catch {
  process.exitCode = 1;
}
