const { units } = require('./config/architecture.json');

module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'no-unknown-workspaces',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: `^(?:${units.map((u) => u.path).join('|')})/` },
      to: {},
    },
    ...units.flatMap((unit) => [
      {
        name: `${unit.path.replace('/', '-')}-workspace-names-only`,
        severity: 'error',
        from: { path: `^${unit.path}/` },
        to: {
          path: '^(apps|packages)/',
          pathNot: `^${unit.path}/`,
          dependencyTypes: ['local'],
        },
      },
      {
        name: `${unit.path.replace('/', '-')}-allowed-layers`,
        severity: 'error',
        from: { path: `^${unit.path}/` },
        to: {
          path: '^(apps|packages)/',
          pathNot: `^(?:${[unit.path, ...unit.allowed].join('|')})/`,
        },
      },
      {
        name: `${unit.path.replace('/', '-')}-public-entries`,
        severity: 'error',
        from: { path: `^${unit.path}/` },
        to: {
          path: '^(apps|packages)/',
          pathNot: `^(?:${unit.path}/|packages/[^/]+/src/index\\.ts$)`,
        },
      },
    ]),
    {
      name: 'pure-core-no-external-runtime',
      severity: 'error',
      from: { path: '^packages/(domain|application)/' },
      to: {
        dependencyTypes: [
          'core',
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: '^packages/',
      },
    },
    {
      name: 'portable-layers-no-node',
      severity: 'error',
      from: { path: '^(packages/(domain|application|contracts|sdk)|apps/web)/' },
      to: { dependencyTypes: ['core'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '/dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['arkvory-source', 'types', 'import', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
