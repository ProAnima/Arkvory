// The HTTP API reference: one page per group of operations, written from the contract the
// server enforces (OpenAPI, operation policies, error codes) and the texts of each language.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, json, siteText, apiText, fill, cell, SOURCE } from './site.mjs';
import { fieldsOf, rulesOf, sample, typeOf } from './schema.mjs';

const MEDIA_JSON = 'application/json';

/**
 * Every operation of the contract with its policy, as the server registers it. A HEAD that
 * mirrors a GET of the same path is shown with it, as one operation with two methods.
 * Parameters of the path item (such as `repository`) come before the operation's own.
 */
/** Every description of a field in the schemas the reference shows, for translators. */
export function fieldDescriptions(list) {
  const found = new Set();
  const walk = (value, schema) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, schema));
    for (const [name, inner] of Object.entries(value))
      if (name === 'description' && schema && typeof inner === 'string') found.add(inner);
      else walk(inner, schema || ['schema', 'properties', 'items'].includes(name));
  };
  for (const operation of list) {
    walk(operation.parameters, false);
    walk(operation.requestBody, false);
    for (const [status, response] of Object.entries(operation.responseSchemas))
      if (/^2/.test(status)) walk(response, false);
  }
  return [...found].sort();
}

export async function operations() {
  const document = json(join(root, 'packages/contracts/dist/openapi.json'));
  const { operationPolicies } = await import(
    pathToFileURL(join(root, 'packages/contracts/dist/operation-policy.js')).href
  );
  const list = [];
  for (const [path, methods] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation?.operationId) continue;
      if (method === 'head' && methods.get?.operationId) continue;
      const own = operation.parameters ?? [];
      const shared = (methods.parameters ?? []).filter(
        (p) => !own.some((o) => o.name === p.name && o.in === p.in),
      );
      list.push({
        id: operation.operationId,
        method,
        methods: method === 'get' && methods.head?.operationId ? ['get', 'head'] : [method],
        path,
        tag: operation.tags?.[0] ?? '',
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        parameters: [...shared, ...own],
        body: Object.keys(operation.requestBody?.content ?? {}),
        requestBody: operation.requestBody,
        responses: Object.keys(operation.responses ?? {}),
        responseSchemas: operation.responses ?? {},
        policy: operationPolicies[path]?.[method] ?? null,
      });
    }
  return list;
}

/**
 * An operation's text as a reader sees it, and whether it is current. English is written from
 * the contract's own summary and description, a translation from that English; each keeps the
 * text it was made from (`en`). When the source changes, the page shows the source until the
 * text is redone (`fresh: false`), and tests/wiki.test.mjs fails until then.
 */
export function operationText(operation, translations, english = translations) {
  const contract = { summary: operation.summary, description: operation.description };
  const made = (own, source) =>
    own?.summary &&
    own.en?.summary === source.summary &&
    own.en?.description === source.description;
  const ownEnglish = english.operations?.[operation.id];
  const source = made(ownEnglish, contract)
    ? { summary: ownEnglish.summary, description: ownEnglish.description ?? '' }
    : contract;
  if (translations === english) return { ...source, fresh: source !== contract };
  const own = translations.operations?.[operation.id];
  return made(own, source)
    ? { summary: own.summary, description: own.description ?? '', fresh: source !== contract }
    : { ...source, fresh: false };
}

/** The reference page an operation belongs to: by its tag, the catalog by its path. */
export function pageOf(operation) {
  const byTag = {
    System: 'system',
    Repositories: 'repositories',
    Uploads: 'uploads',
    Identity: 'accounts',
    Services: 'services',
    Backups: 'backups',
    Updates: 'updates',
    Feedback: 'feedback',
  };
  if (byTag[operation.tag]) return byTag[operation.tag];
  const rest = operation.path.replace(/^\/api\/v1\/repositories\/\{repository\}/, '');
  if (operation.path.startsWith('/api/v1/links') || rest.startsWith('/links')) return 'links';
  if (operation.path.startsWith('/api/v1/jobs')) return 'uploads';
  if (/\/attachments/.test(rest)) return 'attachments';
  if (/\/stages|\/promotion|\/promote|\/resolve/.test(rest)) return 'promotion';
  if (/^\/(storage|retention)|\/deletion$/.test(rest)) return 'storage';
  if (rest.startsWith('/mirror')) return 'mirrors';
  if (/^\/packages/.test(rest)) return 'packages';
  if (/^\/(assets?|raw)\b/.test(rest)) return 'files';
  return 'artifacts';
}

function accessText(policy, text) {
  if (!policy) return text.none;
  const kinds = text.accessKinds;
  const access = policy.access;
  if (access.kind === 'repository') {
    const base = fill(kinds.repository, {
      actions: access.actions.map((a) => `\`${a}\``).join(', '),
    });
    return access.legacy?.length
      ? `${base}; ${fill(text.legacy, { grants: access.legacy.map((g) => `\`${g}\``).join(', ') })}`
      : base;
  }
  return fill(kinds[access.kind] ?? access.kind, { action: `\`${access.action ?? ''}\`` });
}

/** A field's description from the schema, in the page's language when it has one. */
const describe = (translations, description) =>
  description ? (translations.fields?.[description] ?? description) : '';

function parametersTable(parameters, text, translations) {
  const lines = [
    `| ${text.name} | ${text.in} | ${text.type} | ${text.required} | ${text.rules.title} |`,
    '| --- | --- | --- | --- | --- |',
  ];
  for (const p of parameters) {
    const schema = p.schema ?? {};
    const rules = [rulesOf(schema, text), describe(translations, p.description)]
      .filter(Boolean)
      .join('; ');
    lines.push(
      `| \`${cell(p.name)}\` | ${text.locations[p.in] ?? p.in} | ${cell(typeOf(schema, text))} | ${p.required ? text.yes : text.no} | ${cell(rules || '—')} |`,
    );
  }
  return [...lines, ''];
}

function fieldsTable(title, schema, text, translations) {
  const rows = fieldsOf(schema, text);
  if (!rows.length) return [];
  const lines = [
    title,
    '',
    `| ${text.field} | ${text.type} | ${text.required} | ${text.rules.title} |`,
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const rules = [row.rules, describe(translations, row.description)].filter(Boolean).join('; ');
    lines.push(
      `| \`${cell(row.field)}\` | ${cell(row.type)} | ${row.required ? text.yes : text.no} | ${cell(rules || '—')} |`,
    );
  }
  return [...lines, ''];
}

const shellName = (name) => `$${name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;

/** A curl command with every required value as a shell variable, ready to adapt. */
function example(operation) {
  const method = operation.methods[0].toUpperCase();
  const required = operation.parameters.filter((p) => p.required || p.in === 'path');
  const path = operation.path.replace(/\{(\w+)\}/g, (_, name) => shellName(name));
  const query = required
    .filter((p) => p.in === 'query')
    .map((p) => `${p.name}=${shellName(p.name)}`)
    .join('&');
  const lines = [`curl -X ${method} "$ARKVORY_URL${path}${query ? `?${query}` : ''}"`];
  if (operation.policy?.access?.kind !== 'public')
    lines.push('-H "Authorization: Bearer $ARKVORY_TOKEN"');
  for (const p of required.filter((p) => p.in === 'header'))
    lines.push(
      p.name.toLowerCase() === 'idempotency-key'
        ? `-H "${p.name}: $(uuidgen)"`
        : `-H "${p.name}: ${shellName(p.name)}"`,
    );
  const media = operation.body[0];
  if (media === MEDIA_JSON) {
    const schema = operation.requestBody.content[MEDIA_JSON].schema ?? {};
    lines.push(`-H "Content-Type: ${MEDIA_JSON}"`, `-d '${JSON.stringify(sample(schema))}'`);
  } else if (media) lines.push(`-H "Content-Type: ${media}"`, '--data-binary @file');
  const success = Object.entries(operation.responseSchemas).find(([s]) => /^2/.test(s));
  const content = Object.keys(success?.[1]?.content ?? {});
  if (content.length && !content.includes(MEDIA_JSON)) lines.push('-o file');
  return ['```bash', lines.join(' \\\n  '), '```', ''];
}

function renderOperation(operation, text, translations, english) {
  const { summary, description } = operationText(operation, translations, english);
  const lines = [`### ${summary} {#${operation.id}}`, ''];
  const methods = operation.methods
    .map((method) => `<span class="http-method">${method.toUpperCase()}</span>`)
    .join(' ');
  lines.push(`${methods} \`${operation.path}\``, '');
  lines.push(
    `**${text.access}:** ${accessText(operation.policy, text)} · **${text.retry}:** ${
      text.retryKinds[operation.policy?.retry] ?? text.none
    }`,
    '',
  );
  if (description) lines.push(description, '');
  const parameters = operation.parameters.filter((p) => p.in !== 'cookie');
  if (parameters.length)
    lines.push(`**${text.parameters}**`, '', ...parametersTable(parameters, text, translations));
  if (operation.body.length) {
    const bodySchema = operation.requestBody?.content?.[MEDIA_JSON]?.schema;
    const title = `**${text.requestBody}** (${operation.body.map((t) => `\`${t}\``).join(', ')})`;
    const table = bodySchema ? fieldsTable(title, bodySchema, text, translations) : [];
    lines.push(...(table.length ? table : [title, '']));
  }
  const [status, success] =
    Object.entries(operation.responseSchemas).find(([s]) => /^2/.test(s)) ?? [];
  const responseSchema = success?.content?.[MEDIA_JSON]?.schema;
  if (responseSchema)
    lines.push(
      ...fieldsTable(`**${text.response}** \`${status}\``, responseSchema, text, translations),
    );
  const statuses = operation.responses.filter((s) => s !== 'default');
  lines.push(`**${text.responses}:** ${statuses.join(', ')}`, '');
  lines.push(`**${text.example}**`, '', ...example(operation));
  return lines.join('\n');
}

export function renderApiPage(page, list, code) {
  const text = siteText(code).api;
  const translations = apiText(code);
  const english = code === SOURCE ? translations : apiText(SOURCE);
  const meta = text.pages?.[page] ?? { title: page, intro: '' };
  const body = [
    '---',
    `title: ${JSON.stringify(meta.title)}`,
    `description: ${JSON.stringify(meta.intro)}`,
    'outline: [2, 3]',
    '---',
    '',
    `# ${meta.title}`,
    '',
    meta.intro,
    '',
    text.intro,
    '',
    `## ${text.operations} {#operations}`,
    '',
    ...list.map((operation) => renderOperation(operation, text, translations, english)),
  ];
  return body.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function errorsPage(code) {
  const { errorReasons } = await import(
    pathToFileURL(join(root, 'packages/contracts/dist/errors.js')).href
  );
  const { httpStatus } = await import(
    pathToFileURL(join(root, 'apps/api/dist/http-errors.js')).href
  );
  const text = siteText(code).errors;
  const own = apiText(code).errors;
  const english = apiText(SOURCE).errors;
  const meaning = (group, name) => own[group]?.[name] ?? english[group]?.[name] ?? '';
  const lines = ['---', `title: ${JSON.stringify(text.title)}`, '---', '', `# ${text.title}`, ''];
  lines.push(text.intro, '');
  lines.push(
    '```json',
    '{ "code": "conflict", "reason": "version_exists", "message": "…", "requestId": "…" }',
    '```',
    '',
  );
  lines.push(`## ${text.codes} {#codes}`, '');
  lines.push(`| ${text.code} | ${text.status} | ${text.meaning} |`, '| --- | --- | --- |');
  for (const name of Object.keys(errorReasons))
    lines.push(`| \`${name}\` | ${httpStatus({ code: name })} | ${cell(meaning('codes', name))} |`);
  lines.push('', `## ${text.reasons} {#reasons}`, '');
  lines.push(
    `| ${text.code} | ${text.reason} | ${text.status} | ${text.meaning} |`,
    '| --- | --- | --- | --- |',
  );
  for (const [name, reasons] of Object.entries(errorReasons))
    for (const reason of reasons)
      lines.push(
        `| \`${name}\` | \`${reason}\` | ${httpStatus({ code: name, reason })} | ${cell(meaning('reasons', reason))} |`,
      );
  return lines.join('\n') + '\n';
}
