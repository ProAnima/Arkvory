import { createServer } from './server.js';
import { loadConfig } from './config.js';

try {
  const config = await loadConfig(process.env);
  const app = await createServer(config, {
    onOwnershipLost: () => {
      process.stderr.write('Depot gateway ownership lost; stopping for supervisor recovery.\n');
      shutdown(true);
    },
  });
  let stopping = false;
  function shutdown(failed = false) {
    if (failed) process.exitCode = 1;
    if (stopping) return;
    stopping = true;
    // Drain transfers first, but do not strand a fenced process forever on broken I/O.
    const deadline = setTimeout(() => process.exit(1), 120000);
    deadline.unref();
    void app.close().then(
      () => {
        clearTimeout(deadline);
      },
      () => {
        process.exit(1);
      },
    );
  }
  for (const event of ['SIGINT', 'SIGTERM'] as const) {
    process.once(event, () => {
      shutdown();
    });
  }
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  process.stdout.write(`Depot API listening on ${config.host}:${String(config.port)}\n`);
} catch {
  process.stderr.write(
    'Depot startup failed. Check configuration, database migration, and storage access.\n',
  );
  process.exitCode = 1;
}
