import { ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { clearMessage, message } from './i18n.js';
import { feedback, errorKey } from './feedback.js';
export function consoleRunner(output: HTMLOutputElement) {
  return (action: () => Promise<void>) => {
    const requestId = element('request-id', HTMLSpanElement);
    clearMessage(requestId);
    void action().catch((error: unknown) => {
      feedback(output, errorKey(error), {}, 'error');
      if (error instanceof ArkvoryHttpError && error.requestId)
        message(requestId, 'requestId', { id: error.requestId });
    });
  };
}
