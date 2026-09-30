import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { element } from './dom.js';
import { feedback } from './feedback.js';
import { offerRepositoryOptions } from './repository-options.js';
import { readableRepositories } from './readable-repositories.js';
import { showView } from './shell.js';

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

export function installAuthConsole(ctx: AuthConsoleContext): void {
  const handleAuthSession = createAuthSessionHandler(ctx);
  bindPasswordForms(ctx, handleAuthSession);
  bindSessionLifecycle(ctx);
}

function createAuthSessionHandler(ctx: AuthConsoleContext): AuthHandler {
  const {
    client,
    token,
    repository,
    repositoryOptions,
    output,
    apiBaseUrl,
    list,
    clearCatalog,
    downloads,
    administration,
    updates,
    management,
    userTokens,
    getGeneration,
    isRepositoryEdited,
  } = ctx;

  return async (
    session: { token: string; account: { name: string; administrator: boolean } },
    generation: number,
    successKey: 'signedIn' | 'accountRegistered',
  ) => {
    if (generation !== getGeneration()) {
      await new ArkvoryClient(apiBaseUrl, () => session.token).logout().catch(() => undefined);
      return;
    }
    downloads.reset();
    token.value = session.token;
    clearCatalog();
    const [me, readable] = await Promise.all([client.me(), readableRepositories(client)]);
    if (generation !== getGeneration()) return;
    const hasRepository = offerRepositoryOptions(
      readable,
      repository,
      repositoryOptions,
      isRepositoryEdited(),
    );
    updates.connect(me.administrator);
    void management.connect();
    element('change-password', HTMLFormElement).hidden = false;
    userTokens.show();
    void userTokens.refresh();
    if (session.account.administrator) {
      administration.show();
      showView('administration');
      await administration.refresh();
    } else if (hasRepository) await list();
    if (generation !== getGeneration()) return;
    feedback(
      output,
      hasRepository || me.administrator ? successKey : 'noRepositoryAccess',
      { name: session.account.name },
      hasRepository || me.administrator ? 'success' : 'error',
    );
  };
}

function bindSessionLifecycle(ctx: AuthConsoleContext): void {
  const {
    client,
    token,
    repository,
    repositoryOptions,
    output,
    run,
    list,
    clearCatalog,
    resetHistory,
    downloads,
    administration,
    updates,
    management,
    userTokens,
    getGeneration,
    nextGeneration,
    isRepositoryEdited,
    setRepositoryEdited,
    getStopSignal,
  } = ctx;

  element('connect', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = nextGeneration();
    run(async () => {
      const [me, readable] = await Promise.all([client.me(), readableRepositories(client)]);
      if (generation !== getGeneration()) return;
      if (me.administrator) administration.show();
      updates.connect(me.administrator);
      void management.connect();
      element('change-password', HTMLFormElement).hidden = !me.id.startsWith('user:');
      if (me.id.startsWith('user:')) {
        userTokens.show();
        void userTokens.refresh();
      } else userTokens.hide();
      if (offerRepositoryOptions(readable, repository, repositoryOptions, isRepositoryEdited()))
        await list();
      else if (me.administrator) {
        showView('administration');
        await administration.refresh();
      } else feedback(output, 'noRepositoryAccess', {}, 'error');
    });
  };

  element('change-password', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = getGeneration();
    run(async () => {
      const current = element('current-password', HTMLInputElement);
      const next = element('own-new-password', HTMLInputElement);
      await client.changePassword(current.value, next.value);
      if (generation !== getGeneration()) return;
      nextGeneration();
      current.value = '';
      next.value = '';
      downloads.reset();
      token.value = '';
      userTokens.hide();
      setRepositoryEdited(false);
      repositoryOptions.replaceChildren();
      clearCatalog();
      resetHistory();
      feedback(output, 'passwordChangedSignIn', {}, 'success');
    });
  };

  element('logout', HTMLButtonElement).onclick = () => {
    downloads.reset();
    getStopSignal()?.abort();
    const generation = nextGeneration();
    run(async () => {
      try {
        if (token.value) await client.logout();
      } finally {
        if (generation === getGeneration()) {
          token.value = '';
          userTokens.hide();
          setRepositoryEdited(false);
          repositoryOptions.replaceChildren();
          clearCatalog();
          resetHistory();
          feedback(output, 'disconnected');
        }
      }
    });
  };
}

function bindPasswordForms(ctx: AuthConsoleContext, handleAuthSession: AuthHandler): void {
  const { client, run, nextGeneration } = ctx;
  element('toggle-register', HTMLButtonElement).onclick = () => {
    element('login', HTMLFormElement).hidden = true;
    element('register', HTMLFormElement).hidden = false;
  };
  element('toggle-login', HTMLButtonElement).onclick = () => {
    element('register', HTMLFormElement).hidden = true;
    element('login', HTMLFormElement).hidden = false;
  };

  element('login', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = nextGeneration();
    run(async () => {
      const name = element('login-name', HTMLInputElement).value;
      const pwd = element('login-password', HTMLInputElement);
      const session = await client.login(name, pwd.value);
      pwd.value = '';
      await handleAuthSession(session, generation, 'signedIn');
    });
  };

  element('register', HTMLFormElement).onsubmit = (event) => {
    event.preventDefault();
    const generation = nextGeneration();
    run(async () => {
      const name = element('register-name', HTMLInputElement).value;
      const pwd = element('register-password', HTMLInputElement);
      const session = await client.register(name, pwd.value);
      pwd.value = '';
      await handleAuthSession(session, generation, 'accountRegistered');
    });
  };
}
