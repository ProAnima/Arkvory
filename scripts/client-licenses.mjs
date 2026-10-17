import { readFile } from 'node:fs/promises';

/**
 * Third-party code bundled into arkvoryctl.mjs for `arkvoryctl mcp` (ADR 0081). The MCP server
 * package ships ajv, ajv-formats, fast-deep-equal, fast-uri, json-schema-traverse and
 * content-type compiled into its own files, so their notices travel with it although npm does
 * not install them for it. Each entry: package, license, where its text comes from.
 */
export const mcpLicenses = [
  [
    '@modelcontextprotocol/server',
    'Apache-2.0',
    'node_modules/@modelcontextprotocol/server/LICENSE',
  ],
  ['@modelcontextprotocol/core', 'Apache-2.0', 'node_modules/@modelcontextprotocol/core/LICENSE'],
  ['zod', 'MIT', 'node_modules/zod/LICENSE'],
  ['ajv (inside @modelcontextprotocol/server)', 'MIT', 'node_modules/ajv/LICENSE'],
  ['ajv-formats (inside @modelcontextprotocol/server)', 'MIT', 'node_modules/ajv-formats/LICENSE'],
  [
    'fast-deep-equal (inside @modelcontextprotocol/server)',
    'MIT',
    'node_modules/fast-deep-equal/LICENSE',
  ],
  [
    'fast-uri (inside @modelcontextprotocol/server)',
    'BSD-3-Clause',
    'node_modules/fast-uri/LICENSE',
  ],
  [
    'json-schema-traverse (inside @modelcontextprotocol/server)',
    'MIT',
    'node_modules/json-schema-traverse/LICENSE',
  ],
  [
    'content-type (inside @modelcontextprotocol/server)',
    'MIT',
    'deploy/client/licenses/content-type.txt',
  ],
];

/** Text of MCP-LICENSES.txt in the client packages. */
export async function mcpLicenseText() {
  const parts = await Promise.all(
    mcpLicenses.map(
      async ([name, license, path]) =>
        `${'='.repeat(72)}\n${name} — ${license}\n${'='.repeat(72)}\n\n${(await readFile(path, 'utf8')).trim()}\n`,
    ),
  );
  return `Third-party software in arkvoryctl (arkvoryctl mcp)\n\n${parts.join('\n')}`;
}
