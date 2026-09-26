import type { RemoteState } from './remote-workflow.js';
export type WizardLanguage = 'ru' | 'en';
const copy = {
  ru: {
    title: 'Ваш Arkvory. На вашем сервере.',
    intro: 'Подключите сервер, проверьте настройки и запустите установку одной кнопкой.',
    connection: '1 · Сервер',
    host: 'Адрес сервера',
    port: 'Порт SSH',
    username: 'Пользователь SSH',
    password: 'Пароль SSH',
    platform: 'Система сервера',
    linux: 'Linux · Debian/Ubuntu или RPM · x64',
    windows: 'Windows · Desktop / Server · x64',
    prerequisites:
      'На сервере нужен SSH. Linux: systemd, root или sudo без пароля. Windows: OpenSSH Server и учётная запись администратора. Зависимости Arkvory установит нативный пакет.',
    advanced: 'Вход по ключу и приватный GitHub',
    privateKey: 'Приватный SSH-ключ (вместо пароля)',
    passphrase: 'Пароль ключа',
    githubToken: 'GitHub token для чтения релизов приватного репозитория',
    ownerTitle: 'Владелец нового Arkvory',
    owner: 'Имя владельца',
    ownerPassword: 'Пароль владельца · от 12 символов',
    discover: 'Проверить сервер',
    trustTitle: '2 · Проверьте ключ сервера',
    trustHelp:
      'Сверьте отпечаток с SSH-ключом сервера у администратора или в панели хостинга. До подтверждения пароль серверу не отправляется.',
    trust: 'Отпечаток совпадает',
    inspect: 'Подключиться и проверить',
    reviewTitle: '3 · Всё готово к запуску',
    install: 'Установить и открыть доступ',
    connect: 'Открыть существующий Arkvory',
    existing: 'Arkvory уже установлен. Переустановка и изменение владельца выполняться не будут.',
    plan: 'Проверенный стабильный релиз → передача на сервер → нативный установщик → база и службы → владелец → проверка доступа.',
    tunnel:
      'Режим: защищённый SSH-доступ с этого компьютера. Мастер сам пробросит API на локальный адрес. Не закрывайте мастер, пока пользуетесь этим адресом. Для других клиентов нужны отдельные подключения или HTTPS-публикация сервера.',
    cancel: 'Завершить сеанс',
    progress: 'Выполняется',
    ready: 'Arkvory доступен',
    open: 'Открыть Arkvory',
    failed: 'Не удалось завершить шаг',
    preserved:
      'Данные сервера не удаляются. При разрыве во время установки её результат может быть неизвестен: проверьте службу и журнал установщика перед повтором.',
    disconnected: 'SSH-соединение закрыто. Адрес туннеля больше недоступен.',
    closed: 'Сеанс завершён. Arkvory продолжает работать на сервере.',
    retry: 'Новый сеанс',
    waiting: 'Проверяем ключ…',
    security: 'Секреты не сохраняются в браузере и не выводятся в журнал мастера.',
    error: 'Проверьте введённые данные и доступность сервера.',
    errors: {
      release:
        'Не удалось получить стабильный релиз. Проверьте публикацию EXE/DEB/RPM и доступ GitHub token к репозиторию.',
      ssh: 'Не удалось подключиться по SSH. Проверьте адрес, порт, учётные данные и отпечаток ключа.',
      command:
        'Команда на сервере завершилась ошибкой. Проверьте права администратора, журналы установщика и состояние служб.',
      target:
        'Платформа не прошла проверку. Нужны x64, поддерживаемый пакетный менеджер и необходимые права.',
      transfer:
        'Передача установщика прервалась. Проверьте соединение, доступ SFTP и свободное место на сервере.',
      checksum:
        'Контрольная сумма установщика не совпала. Получите заново проверенный комплект релиза.',
      timeout:
        'Сервер не завершил шаг за отведённое время. Проверьте его состояние перед повтором.',
      disconnected:
        'SSH-соединение прервалось. Откройте новый сеанс после проверки доступности сервера.',
      health: 'API не подтвердил доступность через туннель. Проверьте службу API и порт 8080.',
    },
    phases: {
      fingerprint: 'Ключ сервера',
      inspect: 'Проверка платформы и прав',
      review: 'План установки',
      download: 'Скачивание и проверка релиза',
      upload: 'Передача установщика',
      install: 'Установка базы и служб',
      owner: 'Создание владельца',
      verify: 'Проверка защищённого доступа',
      ready: 'Готово',
      failed: 'Операция остановлена',
      closed: 'Сеанс закрыт',
    },
  },
  en: {
    title: 'Your Arkvory. On your server.',
    intro: 'Connect a server, review the settings and start installation with one button.',
    connection: '1 · Server',
    host: 'Server address',
    port: 'SSH port',
    username: 'SSH user',
    password: 'SSH password',
    platform: 'Server platform',
    linux: 'Linux · Debian/Ubuntu or RPM · x64',
    windows: 'Windows · Desktop / Server · x64',
    prerequisites:
      'SSH must be available. Linux: systemd, root or passwordless sudo. Windows: OpenSSH Server and an administrator account. The native package installs Arkvory dependencies.',
    advanced: 'Key authentication and private GitHub',
    privateKey: 'Private SSH key (instead of password)',
    passphrase: 'Key passphrase',
    githubToken: 'GitHub token for reading private repository releases',
    ownerTitle: 'New Arkvory owner',
    owner: 'Owner name',
    ownerPassword: 'Owner password · at least 12 characters',
    discover: 'Check server',
    trustTitle: '2 · Verify the server key',
    trustHelp:
      'Compare this fingerprint with the server SSH key supplied by its administrator or hosting panel. No password is sent before confirmation.',
    trust: 'The fingerprint matches',
    inspect: 'Connect and inspect',
    reviewTitle: '3 · Ready to deploy',
    install: 'Install and connect',
    connect: 'Open existing Arkvory',
    existing: 'Arkvory is already installed. The installation and owner will remain unchanged.',
    plan: 'Verified stable release → transfer to server → native installer → database and services → owner → access check.',
    tunnel:
      'Mode: secure SSH access from this computer. The wizard forwards the API to a local address. Keep the wizard open while using this address. Other clients need their own connection or server HTTPS publication.',
    cancel: 'End session',
    progress: 'In progress',
    ready: 'Arkvory is available',
    open: 'Open Arkvory',
    failed: 'Could not complete this step',
    preserved:
      'Server data is preserved. A disconnect during installation may leave its outcome unknown: inspect services and installer logs before retrying.',
    disconnected: 'The SSH connection is closed. The tunnel address is no longer available.',
    closed: 'Session ended. Arkvory keeps running on the server.',
    retry: 'New session',
    waiting: 'Checking server key…',
    security: 'Secrets are not stored in the browser or printed in wizard logs.',
    error: 'Check the input and server connectivity.',
    errors: {
      release:
        'Could not fetch a stable release. Check published EXE/DEB/RPM assets and GitHub token repository access.',
      ssh: 'SSH connection failed. Check the address, port, credentials and server key fingerprint.',
      command:
        'A server command failed. Check administrative permissions, installer logs and service status.',
      target:
        'Platform checks failed. An x64 host, supported package manager and required permissions are necessary.',
      transfer:
        'Installer transfer failed. Check connectivity, SFTP access and free disk space on the server.',
      checksum: 'Installer checksum mismatch. Obtain a fresh verified release bundle.',
      timeout: 'The server did not complete this step in time. Inspect its state before retrying.',
      disconnected:
        'The SSH connection was interrupted. Check server availability and start a new session.',
      health: 'The API did not respond through the tunnel. Check the API service and port 8080.',
    },
    phases: {
      fingerprint: 'Server key',
      inspect: 'Platform and permissions',
      review: 'Installation plan',
      download: 'Download and verify release',
      upload: 'Transfer installer',
      install: 'Install database and services',
      owner: 'Create owner',
      verify: 'Verify secure access',
      ready: 'Ready',
      failed: 'Operation stopped',
      closed: 'Session closed',
    },
  },
};
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function wizardView(
  language: WizardLanguage,
  token: string,
  state?: RemoteState,
  connected = true,
  error = false,
) {
  const t = copy[language];
  const errors: Readonly<Record<string, string>> = t.errors;
  const form = (action: string, body: string) =>
    `<form method="post" action="/${action}?lang=${language}"><input type="hidden" name="csrf" value="${escape(token)}">${body}</form>`;
  const field = (name: string, label: string, type = 'text', value = '', attributes = '') =>
    `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${attributes}></label>`;
  let body: string;
  if (!state)
    body =
      `<h2>${t.connection}</h2><p class="muted">${t.prerequisites}</p>` +
      form(
        'discover',
        `<div class="grid">
    ${field('host', t.host, 'text', '', 'required maxlength="253" autocomplete="off" placeholder="192.168.1.20"')}
    ${field('port', t.port, 'number', '22', 'required min="1" max="65535"')}
    ${field('username', t.username, 'text', '', 'required maxlength="128" autocomplete="off"')}
    ${field('password', t.password, 'password', '', 'maxlength="1024" autocomplete="off"')}
    <label>${t.platform}<select name="platform"><option value="linux">${t.linux}</option><option value="windows">${t.windows}</option></select></label></div>
    <details><summary>${t.advanced}</summary><label>${t.privateKey}<textarea name="privateKey" rows="4" maxlength="32768" autocomplete="off" spellcheck="false"></textarea></label>${field('passphrase', t.passphrase, 'password', '', 'autocomplete="off"')}${field('githubToken', t.githubToken, 'password', '', 'autocomplete="off"')}</details>
    <p class="note">${t.tunnel}</p><button>${t.discover}</button>`,
      );
  else if (state.phase === 'fingerprint')
    body =
      `<h2>${t.trustTitle}</h2><p>${t.trustHelp}</p><code>${escape(state.fingerprint)}</code>` +
      form(
        'inspect',
        `<label class="check"><input name="trusted" type="checkbox" value="yes" required>${t.trust}</label><button>${t.inspect}</button>`,
      );
  else if (state.phase === 'review')
    body =
      `<h2>${t.reviewTitle}</h2><p>${state.target?.installed ? t.existing : t.plan}</p><p class="note">${t.tunnel}</p>` +
      form(
        'install',
        `${state.target?.installed ? '' : `<h3>${t.ownerTitle}</h3><div class="grid">${field('owner', t.owner, 'text', 'admin', 'required pattern="[a-zA-Z0-9_.-]{3,64}"')}${field('ownerPassword', t.ownerPassword, 'password', '', 'required minlength="12" maxlength="128" autocomplete="new-password"')}</div>`}<button>${state.target?.installed ? t.connect : t.install}</button>`,
      );
  else if (state.phase === 'ready' && connected)
    body = `<span class="badge">${t.ready}</span><h2>${t.phases.ready}</h2><p class="note">${t.tunnel}</p><a class="button" href="${escape(state.url)}/console/#onboarding" target="_blank" rel="noreferrer">${t.open}</a><p><code>${escape(state.url)}</code></p>`;
  else if (state.phase === 'failed' || (state.phase === 'ready' && !connected))
    body = `<h2>${t.failed}</h2><p>${state.phase === 'ready' ? t.disconnected : (errors[state.error] ?? t.error)}</p><code>${escape(state.error)}</code><p class="note">${t.preserved}</p>`;
  else if (state.phase === 'closed') body = `<h2>${t.closed}</h2>`;
  else
    body = `<span class="badge">${t.progress}</span><h2 role="status">${t.phases[state.phase]}</h2><div class="progress" aria-hidden="true"></div><p class="muted">${t.security}</p>`;
  if (state) body = `<p class="muted">${escape(state.destination)}</p>` + body;
  if (state)
    body += form(
      'reset',
      `<button class="secondary">${state.phase === 'closed' || state.phase === 'failed' ? t.retry : t.cancel}</button>`,
    );
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arkvory · Remote Setup</title><link rel="stylesheet" href="/style.css"></head><body><header><a href="/?lang=${language}" class="brand"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="accent" x2="1" y2="1"><stop stop-color="#8ab8ff"/><stop offset="1" stop-color="#68def1"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#accent)"/><path fill="#102237" fill-rule="evenodd" d="M11 50L25 15L39 15L53 50L42 50L38 40L26 40L22 50ZM29 31L35 31L32 23Z"/><rect x="38" y="37" width="24" height="23" rx="7" fill="#102237"/><path d="M44 48h12m-4-4 4 4-4 4" fill="none" stroke="#68def1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Arkvory<span>REMOTE SETUP</span></a><nav><a href="/?lang=ru" lang="ru">Русский</a><a href="/?lang=en" lang="en">English</a></nav></header><main><p class="eyebrow">PROANIMA STUDIO</p><h1>${t.title}</h1><p class="intro">${t.intro}</p><section>${error ? `<p role="alert" class="note">${t.error}</p>` : ''}${body}</section></main><footer>© Ian Panaev · ProAnimaStudio</footer></body></html>`;
}
export const wizardStyle = `:root{color-scheme:light dark;--bg:#0e1426;--panel:#171f35;--fg:#f0f4ff;--muted:#abb9d2;--line:#637493;--accent:#68def1;--button-text:#102237;--radius:18px;--control-radius:10px;--space:24px;--max-width:880px;--font:system-ui,sans-serif;--shadow:0 18px 80px #0002}
@media(prefers-color-scheme:light){:root{--bg:#f3f6fc;--panel:#fff;--fg:#17233b;--muted:#53627a;--line:#7f8fa8;--accent:#215bcc;--button-text:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--font)}header,main,footer{max-width:var(--max-width);margin:auto;padding:var(--space)}header{display:flex;justify-content:space-between;gap:var(--space);align-items:center}.brand svg{width:40px;height:40px;vertical-align:middle;margin-right:8px}.brand{font-size:26px;font-weight:750;text-decoration:none}.brand span{display:block;font-size:10px;letter-spacing:.18em;color:var(--muted)}a{color:inherit}nav{display:flex;gap:16px}h1{font-size:clamp(30px,5vw,46px);line-height:1.15;letter-spacing:-.04em;margin:8px 0}h2{font-size:24px;margin-top:0}h3{font-size:18px}p{margin:12px 0}.eyebrow{font-size:11px;letter-spacing:.16em;color:var(--muted)}.intro,.muted,footer{color:var(--muted)}section{margin-top:32px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:32px;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}label{display:grid;gap:8px;font-size:14px;font-weight:600;margin-block:12px}input,textarea,select{font:inherit;color:var(--fg);background:var(--bg);width:100%;min-width:0;border:1px solid var(--line);border-radius:var(--control-radius);padding:12px}input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button,.button{display:inline-block;border:0;border-radius:var(--control-radius);background:var(--accent);color:var(--button-text);padding:13px 22px;font:600 15px var(--font);text-decoration:none;cursor:pointer;margin-top:18px}.secondary{background:transparent;border:1px solid var(--line);color:var(--fg)}.note{padding:16px;border:1px solid var(--line);border-radius:var(--control-radius);font-size:14px}code{display:block;overflow-wrap:anywhere;padding:14px;background:var(--bg);border-radius:var(--control-radius);font-size:13px}details{margin-top:20px}summary{cursor:pointer}.check{display:flex;align-items:center}.check input{width:auto}.badge{color:var(--accent);font-size:13px}.progress{height:4px;background:var(--accent);border-radius:var(--control-radius)}footer{font-size:12px}@media(max-width:600px){:root{--space:18px}.grid{grid-template-columns:1fr;gap:0}section{padding:20px}header{align-items:flex-start}nav{gap:10px;font-size:13px}button,.button{width:100%;text-align:center}}`;
