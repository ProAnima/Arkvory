# ProAnima Arkvory Plugin SDK License 1.0 — DRAFT

> **DRAFT — NOT IN EFFECT.** This text is a proposal recorded in [ADR 0082](../adr/0082-custom-plugins.md) ("Решения владельца 2026-10-17", Р1). It grants no rights. It takes effect only after the licensor approves it, after legal review, and after it is published with the SDK Materials as their license. Until then the SDK Materials, like the rest of ProAnima Arkvory, are licensed only under the [ProAnima Arkvory License](../../LICENSE.md).

This license lets you build plugins for ProAnima Arkvory and distribute them, including commercially. It covers only the SDK Materials. It grants no rights to the rest of ProAnima Arkvory, which stays under the ProAnima Arkvory License. This is not an open-source license.

Licensor: Ian Panaev (Ян Панаев), author and copyright holder of ProAnima Arkvory and owner of the ProAnimaStudio brand. Contact: info@proanima.net.

## Definitions

- **Core**: ProAnima Arkvory as defined in the ProAnima Arkvory License, except the SDK Materials.
- **SDK Materials**: the following packages, as the licensor publishes them with this license, and their documentation:
  - `@proanima/arkvory-extension-api` (`packages/extension-api`);
  - `@proanima/arkvory-plugin-protocol` (`packages/plugin-protocol`);
  - `@proanima/arkvory-plugin-sdk` (`packages/plugin-sdk`);
  - `@proanima/arkvory-extension-testkit` (`packages/extension-testkit`);
  - the Plugin Protocol Specification: the protocol documents and JSON Schemas that the licensor publishes for plugin authors.
- **Plugin**: software that works with the Core only through the plugin protocol or the extension API described by the SDK Materials, and that contains no code of the Core other than SDK Materials.
- **You**: the individual or organization that uses the SDK Materials.

## 1. What you may do

Free of charge, worldwide and non-exclusively, for as long as you comply with this license, you may:

- use, copy and change the SDK Materials to develop, build and test Plugins;
- distribute the SDK Materials, changed or unchanged, in source or built form, but only as part of a Plugin, its source code or its build and test tooling;
- use, distribute, publish, sell and license your Plugins under terms of your choice, provided that those terms pass on the SDK Materials included in the Plugin only under this license;
- let the recipients of your Plugin use the SDK Materials included in it as part of that Plugin.

## 2. Plugin Protocol Specification

You may implement the Plugin Protocol Specification in your own code, in any programming language, without using any SDK Materials. The licensor does not consider a Plugin that implements the specification without containing code of the Core to be a part or a changed version of the Core.

## 3. What you may not do

- Distribute the SDK Materials on their own, other than as part of a Plugin, for example as a standalone library or package in a public registry.
- Distribute the Core or any part of it other than the SDK Materials. Rights to the Core come only from the ProAnima Arkvory License.
- Present a Plugin or changed SDK Materials as made, published, reviewed or endorsed by the licensor or ProAnimaStudio, or use identifiers reserved for the licensor's own modules (such as the publisher name `proanimastudio` or module identifiers outside the `op-` namespace for Plugins).
- Make a Plugin whose purpose is to circumvent the license checks or technical protection of the licensor's paid modules.
- Remove or change copyright notices or this license in the SDK Materials you distribute.

## 4. Notices

When you distribute SDK Materials as part of a Plugin, include this license text and the copyright notices of the SDK Materials. State in the Plugin's documentation that the Plugin is not made or endorsed by ProAnimaStudio.

## 5. Names and brands

This license grants no rights to the names and marks ProAnima, ProAnimaStudio and ProAnima Arkvory, except to state truthfully that a Plugin is "for ProAnima Arkvory" or "compatible with ProAnima Arkvory". You may not use the logos of the licensor.

## 6. Your Plugins

You own your Plugins. The licensor claims no rights to them and does not support, review or certify them. Whether a Plugin is trusted and run is decided by the operator of each installation.

## 7. Contributions

The licensor may use, change and publish bug reports, suggestions and code about the SDK Materials that you send to the licensor, including pull requests, without restriction or payment. By sending them you confirm that you have the right to do so.

## 8. No warranty

The SDK Materials are provided "as is", without warranties of any kind, express or implied, including fitness for a particular purpose.

## 9. Limitation of liability

To the extent permitted by law, the licensor is not liable for damages, lost profits, loss of data or other harm arising from the use of or inability to use the SDK Materials or any Plugin. This does not exclude liability that cannot be excluded by law.

## 10. Termination

Your rights under this license end automatically if you breach it. If it is your first breach and you remedy it within 30 days after the licensor tells you about it, your rights are restored. Termination does not end the rights of recipients of your Plugins who comply with this license.

## 11. Versions

The licensor may publish new versions of this license for new versions of the SDK Materials. Each published version of the SDK Materials stays available under the license version it was published with.

## 12. Relationship to the ProAnima Arkvory License

For the SDK Materials only, this license applies in addition to the ProAnima Arkvory License, and where they conflict, this license prevails. For everything else, the ProAnima Arkvory License applies unchanged.

## 13. Language

This license will exist in Russian and English. Both texts will have the same meaning; if they differ, the Russian text prevails.

Copyright © 2026 Ian Panaev (Ян Панаев), ProAnimaStudio. Rights not granted by this license are reserved.

---

## Notes for approval and legal review (not part of the license)

1. **How the license takes effect.** Proposed: a `LICENSE.md` with this text in the directory of each SDK package, the `license` field of those packages pointing to it, and a note in NOTICE.md. Check whether LICENSE §2 ("in whole or in part") and §11 ("separate written agreement") of the ProAnima Arkvory License need a sentence that excludes the SDK Materials, or whether §12 of this text is enough. ADR 0082 does not change LICENSE.md.
2. **Definition of Plugin.** Check under the licensor's jurisdiction whether a Plugin that implements the protocol without Core code can be treated as part of or derived from the Core, and whether in-process Plugins (level 3 in ADR 0082, which use `extension-api` inside the Core process) fit the definition.
3. **Scope of SDK Materials.** Whether `extension-testkit` should be included or licensed only for development use, and whether the protocol specification needs its own short notice.
4. **Distribution channel.** SDK packages are published as tarballs in GitHub releases (ADR 0079); publication to npm is an open question in ADR 0078, §2, and would require updating the list of official sources.
5. **Russian text.** A Russian text with the same meaning must be prepared before the license takes effect, as for the ProAnima Arkvory License.
6. **Third-party components.** Check that the dependencies of the SDK packages allow distribution as part of third-party Plugins.
