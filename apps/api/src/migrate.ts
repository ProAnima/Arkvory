import {
  DiagnosticLogger,
  PostgresCatalog,
  SCHEMA_VERSION,
  appliedSchemaVersion,
  failureCause,
  migrate,
  processIdentity,
  readReleaseVersion,
  startupReason,
} from '@proanima/arkvory-infrastructure';

const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
  process: processIdentity(
    'migrate',
    await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
  ),
});
const started = performance.now();
const elapsed = () => Math.max(0, Math.round(performance.now() - started));
try {
  const url = process.env['ARKVORY_DATABASE_URL'];
  if (!url) throw new Error('ARKVORY_DATABASE_URL is required');
  const catalog = new PostgresCatalog(url, 0, 1);
  try {
    const fromSchema = await appliedSchemaVersion(catalog.pool);
    diagnostics.write({
      level: 'info',
      component: 'migrate',
      code: 'migrate.started',
      fromSchema,
      toSchema: SCHEMA_VERSION,
    });
    await migrate(catalog.pool);
    diagnostics.write({
      level: 'info',
      component: 'migrate',
      code: 'migrate.completed',
      fromSchema,
      toSchema: await appliedSchemaVersion(catalog.pool),
      durationMs: elapsed(),
    });
  } finally {
    await catalog.close();
  }
} catch (error) {
  // Driver errors can echo the connection string; only constant identifiers are written.
  diagnostics.write({
    level: 'error',
    component: 'migrate',
    code: 'migrate.failed',
    durationMs: elapsed(),
    reason: startupReason(error),
    ...failureCause(error),
  });
  process.stderr.write(
    'Arkvory database migration failed. Check the database URL, role privileges and free space; rerunning is safe.\n',
  );
  process.exitCode = 1;
}
