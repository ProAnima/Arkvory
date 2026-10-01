import type { FastifyRequest, FastifyReply } from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';

/** Public login bodies have their own budget, before parsing and password work. */
export class LoginAdmission {
  private active = 0;
  private readonly bodies = new WeakMap<FastifyRequest, ReturnType<typeof setTimeout>>();

  acquire(request: FastifyRequest, reply: FastifyReply): void {
    if (this.active >= 16) {
      // An unread body must not keep a rejected connection alive.
      reply.header('Connection', 'close');
      throw new ArkvoryError('busy', 'Login request capacity exceeded', {
        reason: 'request_limit',
      });
    }
    this.active++;
    // Absolute, not idle: trickling bytes cannot extend a login body's lifetime.
    const timer = setTimeout(() => request.raw.destroy(), 10000);
    timer.unref();
    this.bodies.set(request, timer);
    reply.raw.once('close', () => {
      this.bodyReceived(request);
      this.active--;
    });
  }

  bodyReceived(request: FastifyRequest): void {
    const timer = this.bodies.get(request);
    if (timer) clearTimeout(timer);
    this.bodies.delete(request);
  }
}
