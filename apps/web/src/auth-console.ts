import { ArkvoryClient, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { feedback, UiError } from './feedback.js';
import type { Credential } from './feedback.js';
import type { MessageKey } from './messages.js';
import { offerRepositoryOptions } from './repository-options.js';
import { readableRepositories } from './readable-repositories.js';
import { showView } from './shell.js';
import { applyRegistrationOption, registrationEnabled } from './user-token-model.js';

export interface AuthConsoleContext {
  client: ArkvoryClient;
  token: HTMLInputElement;
  repository: HTMLInputElement;
  repositoryOptions: HTMLElement;
  output: HTMLOutputElement;
  apiBaseUrl: string;
  run: (action: () => Promise<void>) => void;
  list: () => Promise<void>;
  clearCatalog: () => void;
  resetHistory: () => void;
  downloads: { reset: () => void };
  administration: { show: () => void; refresh: () => Promise<void> };
  updates: { connect: (admin: boolean) => void };
  management: { connect: () => Promise<void> };
  userTokens: { show: () => void; hide: () => void; refresh: () => Promise<void> };
  session: (credential: Credential) => void;
  routes: { pending: () => boolean; restore: (ready: Promise<void>) => Promise<void> };
  getGeneration: () => number;
  nextGeneration: () => number;
  isRepositoryEdited: () => boolean;
  setRepositoryEdited: (value: boolean) => void;
  getStopSignal: () => AbortController | undefined;
}

type AuthHandler = (
  session: { token: string; account: { name: string; administrator: boolean } },
  generation: number,
  successKey: 'signedIn' | 'accountRegistered',
) => Promise<void>;

/** A 401 from these forms describes the typed password, not the current credential. */
async function passwordAttempt<T>(attempt: () => Promise<T>, failure: MessageKey): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof ArkvoryHttpError && error.status === 401) throw new UiError(failure);
    throw error;
  }
}

function signedOut(ctx: AuthConsoleContext) {
  ctx.downloads.reset();
  ctx.token.value = '';
  ctx.userTokens.hide();
  ctx.setRepositoryEdited(false);
  ctx.repositoryOptions.replaceChildren();
  ctx.clearCatalog();
  ctx.resetHistory();
  ctx.session('none');
}

function showSignIn() {
  element('register', HTMLFormElement).hidden = true;
  element('login', HTMLFormElement).hidden = false;
  element('login-name', HTMLInputElement).focus();
}

export function installAuthConsole(ctx: AuthConsoleContext) {
  const handleAuthSession = createAuthSessionHandler(ctx);
  bindPasswordForms(ctx, handleAuthSession);
  bindSessionLifecycle(ctx);
  const controls = {
    toggle: element('toggle-register', HTMLButtonElement),
    register: element('register', HTMLFormElement),
    login: element('login', HTMLFormElement),
  };
  applyRegistrationOption(false, controls);
  void registrationEnabled(() => ctx.client.authOptions()).then((enabled) => {
    applyRegistrationOption(enabled, controls);
  });
  return {
    /** Ends an expired password session locally and offers the sign-in form again. */
    expire() {
      ctx.nextGeneration();
      signedOut(ctx);
      showSignIn();
      feedback(ctx.output, 'sessionExpired', {}, 'error');
    },
  };
}

function createAuthSessionHandler(ctx: AuthConsoleContext): AuthHandler {
  const { client, token, repository, repositoryOptions, output, apiBaseUrl } = ctx;
  return async (session, generation, successKey) => {
    if (generation !== ctx.getGeneration()) {
      await new ArkvoryClient(apiBaseUrl, () => session.token).logout().catch(() => undefined);
      return;
    }
    ctx.downloads.reset();
    token.value = session.token;
    ctx.clearCatalog();
    const [me, readable] = await Promise.all([client.me(), readableRepositories(client)]);
    if (generation !== ctx.getGeneration()) return;
    ctx.session('session');
    const hasRepository = offerRepositoryOptions(
      readable,
      repository,
      repositoryOptions,
      ctx.isRepositoryEdited(),
    );
    ctx.updates.connect(me.administrator);
    const managed = ctx.management.connect();
    element('change-password', HTMLFormElement).hidden = false;
    ctx.userTokens.show();
    void ctx.userTokens.refresh();
    const linked = ctx.routes.pending();
    if (session.account.administrator) {
      ctx.administration.show();
      if (!linked) showView('administration');
      await ctx.administration.refresh();
    }
    if (hasRepository && (linked || !session.account.administrator)) await ctx.list();
    if (generation !== ctx.getGeneration()) return;
    feedback(
      output,
      hasRepository || me.administrator ? successKey : 'noRepositoryAccess',
      { name: session.account.name },
      hasRepository || me.administrator ? 'success' : 'error',
    );
    await ctx.routes.restore(managed);
  };
}

function bindSessionLifecycle(ctx: AuthConsoleContext): void {
  const { client, token, repository, repositoryOptions, output, run } = ctx;
  element('connect', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = ctx.nextGeneration();
    run(async () => {
      const [me, readable] = await Promise.all([client.me(), readableRepositories(client)]);
      if (generation !== ctx.getGeneration()) return;
      // Password and token management need an interactive session, not a pasted token.
      const session = me.credential === 'session';
      ctx.session(session ? 'session' : 'key');
      if (me.administrator) ctx.administration.show();
      ctx.updates.connect(me.administrator);
      const managed = ctx.management.connect();
      element('change-password', HTMLFormElement).hidden = !session;
      if (session) {
        ctx.userTokens.show();
        void ctx.userTokens.refresh();
      } else ctx.userTokens.hide();
      if (offerRepositoryOptions(readable, repository, repositoryOptions, ctx.isRepositoryEdited()))
        await ctx.list();
      else if (me.administrator) {
        if (!ctx.routes.pending()) showView('administration');
        await ctx.administration.refresh();
      } else feedback(output, 'noRepositoryAccess', {}, 'error');
      if (generation === ctx.getGeneration()) await ctx.routes.restore(managed);
    });
  };

  element('change-password', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = ctx.getGeneration();
    run(async () => {
      const current = element('current-password', HTMLInputElement);
      const next = element('own-new-password', HTMLInputElement);
      await passwordAttempt(
        () => client.changePassword(current.value, next.value),
        'currentPasswordWrong',
      );
      if (generation !== ctx.getGeneration()) return;
      ctx.nextGeneration();
      current.value = '';
      next.value = '';
      signedOut(ctx);
      feedback(output, 'passwordChangedSignIn', {}, 'success');
    });
  };

  element('logout', HTMLButtonElement).onclick = () => {
    ctx.downloads.reset();
    ctx.getStopSignal()?.abort();
    const generation = ctx.nextGeneration();
    run(async () => {
      try {
        if (token.value) await client.logout();
      } finally {
        if (generation === ctx.getGeneration()) {
          signedOut(ctx);
          feedback(output, 'disconnected');
        }
      }
    });
  };
}

function bindPasswordForms(ctx: AuthConsoleContext, handleAuthSession: AuthHandler): void {
  const { client, run } = ctx;
  element('toggle-register', HTMLButtonElement).onclick = () => {
    element('login', HTMLFormElement).hidden = true;
    element('register', HTMLFormElement).hidden = false;
    element('register-name', HTMLInputElement).focus();
  };
  element('toggle-login', HTMLButtonElement).onclick = showSignIn;

  element('login', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = ctx.nextGeneration();
    run(async () => {
      const name = element('login-name', HTMLInputElement).value;
      const pwd = element('login-password', HTMLInputElement);
      const session = await passwordAttempt(() => client.login(name, pwd.value), 'signInFailed');
      pwd.value = '';
      await handleAuthSession(session, generation, 'signedIn');
    });
  };

  element('register', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = ctx.nextGeneration();
    run(async () => {
      const name = element('register-name', HTMLInputElement).value;
      const pwd = element('register-password', HTMLInputElement);
      const session = await client.register(name, pwd.value);
      pwd.value = '';
      await handleAuthSession(session, generation, 'accountRegistered');
    });
  };
}
