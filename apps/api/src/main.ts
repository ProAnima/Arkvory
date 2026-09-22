import { createServer } from './server.js';
import { loadConfig } from './config.js';

try {
  const config = await loadConfig(process.env);
  const app = await createServer(config);
  for (const event of ['SIGINT', 'SIGTERM'] as const) {
    process.once(event, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
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
