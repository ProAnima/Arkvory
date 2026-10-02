import { healthReady } from './health.js';
import { localTarget } from './local-api.js';
try {
  // Runs inside the container: the API listens on its own port, with built-in TLS if configured.
  const target = localTarget(process.env);
  process.exitCode = (await healthReady(target, '/run/arkvory/health-token.txt')) ? 0 : 1;
} catch {
  process.exitCode = 1;
}
