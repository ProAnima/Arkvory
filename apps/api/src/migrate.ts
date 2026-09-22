import { PostgresCatalog, migrate } from '@proanima/depot-infrastructure';

const url = process.env['DEPOT_DATABASE_URL'];
if (!url) throw new Error('DEPOT_DATABASE_URL is required');
const catalog = new PostgresCatalog(url, 0, 1);
try {
  await migrate(catalog.pool);
  process.stdout.write('Depot database migration complete.\n');
} finally {
  await catalog.close();
}
