import { element } from './dom.js';
import { feedback } from './feedback.js';
import type { MessageKey } from './messages.js';
import { formatRoute, parseRoute, sameRoute } from './routes.js';
import type { Route, View } from './routes.js';
import { openView, showView } from './shell.js';

// Screens whose navigation entry appears only for credentials with the matching permission.
const restricted: Partial<Record<View, string>> = {
  administration: 'admin-nav',
  repositories: 'repositories-nav',
  services: 'services-nav',
  updates: 'updates-nav',
};

export interface DeepLinkContext {
  output: HTMLOutputElement;
  repository: HTMLInputElement;
  run: (action: () => Promise<void>) => void;
  connected: () => boolean;
  isOpen: (repository: string, id: string) => boolean;
  open: (repository: string, id: string) => Promise<void>;
  reconnect: (repository: string) => void;
}

/**
 * Applies #/view and #/artifact/{repository}/{id} links on load, Back/Forward and after sign-in.
 * A link that needs a credential waits until the next successful connection.
 */
export function installDeepLinks(ctx: DeepLinkContext) {
  let pending: Route | undefined;
  const available = (view: View) => {
    const nav = restricted[view];
    return !nav || !element(nav, HTMLButtonElement).hidden;
  };
  const fallback = (key: MessageKey) => {
    showView('catalog', { history: 'replace' });
    feedback(ctx.output, key, {}, 'error');
  };
  const artifact = (repository: string, id: string) => {
    const route = formatRoute({ kind: 'artifact', repository, id });
    if (ctx.isOpen(repository, id)) {
      showView('metadata', { route, history: 'keep' });
      return;
    }
    ctx.run(async () => {
      try {
        await ctx.open(repository, id);
      } catch {
        fallback('routeArtifactMissing');
      }
    });
  };
  const apply = (route: Route) => {
    if (route.kind === 'empty') return;
    if (route.kind === 'unknown') {
      fallback('routeUnknown');
      return;
    }
    if (!ctx.connected()) {
      pending = route;
      if (route.kind === 'artifact') ctx.repository.value = route.repository;
      if (route.kind === 'view' && !restricted[route.view])
        showView(route.view, { history: 'keep' });
      else {
        showView('catalog', { history: 'keep' });
        feedback(ctx.output, 'routeSignIn');
      }
      return;
    }
    if (route.kind === 'view') {
      if (available(route.view)) openView(route.view, 'keep');
      else fallback('routeUnavailable');
    } else if (route.repository !== ctx.repository.value) {
      pending = route;
      ctx.reconnect(route.repository);
    } else artifact(route.repository, route.id);
  };
  window.addEventListener('hashchange', () => {
    pending = undefined;
    const route = parseRoute(location.hash);
    if (route.kind === 'empty') showView('catalog', { history: 'keep' });
    else apply(route);
  });
  return {
    start() {
      apply(parseRoute(location.hash));
    },
    pending: () => pending !== undefined,
    /** Called after a connection; restricted navigation appears once management access loads. */
    async restore(ready: Promise<void>) {
      const route = pending;
      pending = undefined;
      if (!route || !sameRoute(parseRoute(location.hash), route)) return;
      await ready;
      if (ctx.connected() && sameRoute(parseRoute(location.hash), route)) apply(route);
    },
  };
}
