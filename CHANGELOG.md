# Changelog

Entries for the next release, copied into its GitHub release notes when it is published. Published releases and their notes: [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).

## Next patch release

**Security**

- Updated runtime dependencies Fastify, PostgreSQL's JavaScript client, MCP server SDK and Zod, refreshed development tools and pinned minimatch 11.0.8 to fix GHSA-g3hv-75wg-m249 in the tooling dependency tree.
- The bundled Node.js runtime is 24.22.3, a security release; the installers verify it by its pinned SHA-256. The Compose installation uses PostgreSQL 18.7, a minor update of the same major version that needs no data migration.
