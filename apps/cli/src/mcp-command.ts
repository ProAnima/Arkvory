import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { cliHome, connection, repositoryName } from './profiles.js';
import { numericOption, validateCommand } from './arguments.js';
import type { Arguments } from './arguments.js';
import { CliError } from './errors.js';
import { privateDirectory } from './local-files.js';
import { pruneCheckpoints } from './mcp/checkpoints.js';
import { outputBytes } from './mcp/output.js';
import { rootDirectory } from './mcp/paths.js';
import { createMcpServer, VersionGate } from './mcp/server.js';

function version(): string {
  const value = process.env['ARKVORY_CLI_VERSION'] ?? 'development';
  return /^[\x21-\x7e]{1,48}$/.test(value) ? value : 'unknown';
}

/** `--write-repositories R1,R2`: valid names, at least one; only together with `--write`. */
function writeRepositories(args: Arguments): ReadonlySet<string> | null {
  const value = args.options.get('write-repositories');
  if (value === undefined) return null;
  if (!args.options.has('write')) throw new CliError('write_repositories_without_write');
  const names = value.split(',');
  if (names.length > 100 || names.some((name) => name === ''))
    throw new CliError('invalid_write_repositories');
  return new Set(names.map(repositoryName));
}

/**
 * `arkvoryctl mcp` (ADR 0081, stages M1 and M2): an MCP server on stdin/stdout for an agent
 * client that starts it as a child process. Read-only unless `--write`; `--write-repositories`
 * narrows writes further before any request. No network listener; every call goes through the
 * SDK to the API, which checks the key's rights as for any client. Stdout carries only the
 * protocol; failures before the server starts go to stderr like every command's.
 */
export async function runMcp(args: Arguments, signal: AbortSignal): Promise<void> {
  validateCommand(args, 1, ['root', 'max-output-bytes', 'write', 'write-repositories']);
  const repositories = writeRepositories(args);
  let maxOutputBytes;
  try {
    maxOutputBytes = outputBytes(args.options.get('max-output-bytes'));
  } catch {
    throw new CliError('invalid_max_output_bytes');
  }
  const root = await rootDirectory(args.options.get('root') ?? process.cwd());
  const secrets: string[] = [];
  const connected = await connection(args, signal, {
    clientName: `arkvoryctl-mcp/${version()}`,
    onCredential: (token) => secrets.push(token),
  });
  const requestTimeoutMs = numericOption(args, 'timeout', 60000, 1, 3600000);
  const permissions = await connected.client.permissions(
    AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
  );
  const actions = new Set<string>(permissions.bindings.flatMap((binding) => binding.actions));
  let write;
  if (args.options.has('write')) {
    const checkpoints = join(cliHome(), 'mcp-uploads');
    await privateDirectory(checkpoints);
    // Housekeeping only: a directory that cannot be tidied must not keep the server from starting.
    await pruneCheckpoints(checkpoints, Date.now()).catch(() => undefined);
    write = { repositories, checkpoints, server: connected.server };
  }
  const server = createMcpServer(
    {
      client: connected.client,
      repository: connected.repository,
      root,
      maxOutputBytes,
      secrets,
      requestTimeoutMs,
      ...(write === undefined ? {} : { write }),
    },
    actions,
    version(),
  );
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  const stop = () => void server.close();
  signal.addEventListener('abort', stop, { once: true });
  try {
    await server.connect(new VersionGate(new StdioServerTransport()));
    await closed;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
