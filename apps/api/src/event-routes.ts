import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { parseEventQuery } from '@proanima/arkvory-application';
import type { EventFeed, EventRecord, EventWindow } from '@proanima/arkvory-application';
import { cloudEvent, eventTypeList } from '@proanima/arkvory-contracts';
import type { EventPageResponse, EventWindowResponse } from '@proanima/arkvory-contracts';
import { sendFailure } from './http-errors.js';
import type { HttpFailure } from './http-errors.js';
import type { RequestContext } from './request-context.js';

function query(request: FastifyRequest): Record<string, unknown> {
  const value = request.query;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Invalid query');
  return Object.fromEntries(Object.entries(value));
}

const windowOf = (window: EventWindow): EventWindowResponse => ({
  epoch: window.epoch,
  oldest: String(window.oldest),
  head: String(window.head),
});

const stored = (event: EventRecord) => ({ ...event, position: String(event.position) });

/**
 * The installation's event feed (ADR 0080). The use case filters every event by the caller's
 * permissions; the route only maps outcomes: an expired cursor is 410 and a cursor of another
 * epoch (a restored installation) 409, both with the current window so the caller can resync.
 */
export function registerEventRoutes(
  app: FastifyInstance,
  feed: EventFeed,
  context: Pick<RequestContext, 'principal' | 'recordError'>,
  site: string,
): void {
  app.get('/api/v1/events', async (request, reply: FastifyReply) => {
    const outcome = await feed.list(context.principal(request), parseEventQuery(query(request)));
    if (outcome.kind === 'page') {
      const { epoch } = outcome.window;
      const page: EventPageResponse = {
        ...windowOf(outcome.window),
        items: outcome.items.map((event) => cloudEvent(stored(event), epoch, site)),
        next: `${epoch}:${String(outcome.next)}`,
      };
      return page;
    }
    const failure: HttpFailure =
      outcome.kind === 'cursor_expired'
        ? {
            code: 'gone',
            reason: 'events_cursor_expired',
            message: 'The cursor is older than the retained events',
          }
        : {
            code: 'conflict',
            reason: 'events_epoch_changed',
            message: 'The event feed has a new epoch; the installation was restored',
          };
    context.recordError(request, failure.code);
    // The window is part of the error envelope (ADR 0080), so the caller can resync at once.
    return sendFailure(request, reply, failure, { events: windowOf(outcome.window) });
  });
  app.get('/api/v1/events/types', () => Promise.resolve(eventTypeList()));
}
