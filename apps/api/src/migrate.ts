import { PostgresCatalog, migrate } from '@proanima/arkvory-infrastructure';
import { normalizeRuntimeSettings } from '@proanima/arkvory-contracts';

const url = normalizeRuntimeSettings(process.env)['ARKVORY_DATABASE_URL'];
if (!url) throw new Error('ARKVORY_DATABASE_URL is required');
const catalog = new PostgresCatalog(url, 0, 1);
try {
  await migrate(catalog.pool);
  process.stdout.write('Arkvory database migration complete.\n');
} finally {
  await catalog.close();
}
