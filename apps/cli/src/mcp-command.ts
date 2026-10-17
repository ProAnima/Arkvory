import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { connection } from './profiles.js';
import { numericOption, validateCommand } from './arguments.js';
import type { Arguments } from './arguments.js';
import { CliError } from './errors.js';
import { outputBytes } from './mcp/output.js';
import { rootDirectory } from './mcp/paths.js';
import { createMcpServer, VersionGate } from './mcp/server.js';

function version(): string {
  const value = process.env['ARKVORY_CLI_VERSION'] ?? 'development';
  return /^[\x21-\x7e]{1,48}$/.test(value) ? value : 'unknown';
}

/**
 * `arkvoryctl mcp` (ADR 0081, stage M1): a read-only MCP server on stdin/stdout for an agent
 * client that starts it as a child process. No network listener; every call goes through the
 * SDK to the API, which checks the key's rights as for any client. Stdout carries only the
 * protocol; failures before the server starts go to stderr like every command's.
 */
export async function runMcp(args: Arguments, signal: AbortSignal): Promise<void> {
  validateCommand(args, 1, ['root', 'max-output-bytes']);
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
  const server = createMcpServer(
    {
      client: connected.client,
      repository: connected.repository,
      root,
      maxOutputBytes,
      secrets,
      requestTimeoutMs,
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
