import { credentialRejected } from './error-keys.js';
import { showFailure } from './feedback.js';
import type { ArkvoryHttpError } from '@proanima/arkvory-sdk';

/**
 * Runs a console action and reports its failure in `output` with the request reference.
 * `expired` takes over a 401 about the page's password session and reports whether it did.
 */
export function consoleRunner(
  output: HTMLOutputElement,
  expired: (error: ArkvoryHttpError) => boolean = () => false,
) {
  return (action: () => Promise<void>) => {
    void action().catch((error: unknown) => {
      if (credentialRejected(error) && expired(error)) return;
      showFailure(output, error);
    });
  };
}
