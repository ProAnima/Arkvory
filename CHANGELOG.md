# Changelog

Entries for the next release, copied into its GitHub release notes when it is published. Published releases and their notes: [GitHub Releases](https://github.com/ProAnima/Arkvory/releases).

## Next patch release

**Security**

- Every Arkvory process — the services, `arkvory`, the installers, `arkvoryctl` and Remote Setup — now loads code only from its own release directory and from the built-in modules of Node.js. Module resolution no longer reaches `node_modules` folders of parent directories, the home directory of the account or `NODE_PATH`, and the service definitions clear `NODE_PATH`. On Windows, Setup makes `%ProgramData%\ProAnima` writable only by administrators when it installs Arkvory or repairs the services. Updating is recommended for every installation; run Setup of the installed version again on Windows to apply the new permissions and service definitions. See [Security](https://github.com/ProAnima/Arkvory/blob/main/wiki/operate/security.md#code-loading) and [ADR 0031](docs/adr/0031-release-installation-and-supervision.md#confinement).
