import type { Cancellation } from '@proanima/arkvory-application';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';

/** What a command receives from the CLI entry; configuration is read only through env. */
export interface CliContext {
  readonly logger: DiagnosticLogger;
  readonly env: NodeJS.ProcessEnv;
  /** Fails with `interrupted` after SIGINT/SIGTERM. */
  readonly cancellation: Cancellation;
  readonly release: { readonly version: string; readonly commit: string | null };
}
