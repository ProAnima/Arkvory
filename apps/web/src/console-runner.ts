import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback, errorKey } from './feedback.js';
/** `expired` handles a 401 of an expired password session and reports whether it did. */
export function consoleRunner(output: HTMLOutputElement, expired: () => boolean = () => false) {
  return (action: () => Promise<void>) => {
    const requestId = element('request-id', HTMLSpanElement);
    clearMessage(requestId);
    void action().catch((error: unknown) => {
      if (error instanceof ArkvoryHttpError && error.status === 401 && expired()) return;
      feedback(output, errorKey(error), {}, 'error');
      if (error instanceof ArkvoryHttpError && error.requestId)
        message(requestId, 'requestId', { id: error.requestId });
    });
  };
}
