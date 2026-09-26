import type { FastifyInstance } from 'fastify';

/** Only irreversible fencing loss triggers recovery; ordinary readiness failures do not. */
export function registerOwnershipRecovery(
  app: FastifyInstance,
  available: () => boolean,
  onLost: () => void,
): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook('onReady', () => {
    timer = setInterval(() => {
      if (available()) return;
      clearInterval(timer);
      onLost();
    }, 1000);
    timer.unref();
    return Promise.resolve();
  });
  // Register before other preClose hooks: intentional shutdown also marks ownership unavailable.
  app.addHook('preClose', () => {
    clearInterval(timer);
    return Promise.resolve();
  });
}
